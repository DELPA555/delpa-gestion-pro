/* Portal web de solo lectura (v1.47.0).
 *
 * Levanta un servidor Express INDEPENDIENTE (puerto 4280, bind 127.0.0.1) y abre un
 * túnel de Cloudflare (quick tunnel, sin cuenta) para que el dueño vea el negocio desde
 * el celular: ventas del día, caja, stock y últimos movimientos. SOLO LECTURA.
 *
 * Seguridad (decisiones deliberadas):
 *  - Es un servidor SEPARADO del de multi-caja (puerto 4242, que tiene /invoke con
 *    escritura). Acá NO existe ningún endpoint que modifique datos: solo SELECTs.
 *  - Protegido por PIN (4-6 dígitos). Login devuelve un token de sesión en memoria
 *    (expira). Con bloqueo tras varios intentos fallidos (anti fuerza bruta).
 *  - Bind a 127.0.0.1: solo accesible vía el túnel de Cloudflare (que corre local) — no
 *    queda expuesto en la LAN.
 *  - La URL pública de trycloudflare es aleatoria y cambia en cada reinicio del túnel.
 */
const express = require('express')
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')

const PORT = 4280
const SESSION_TTL_MS = 8 * 60 * 60 * 1000   // 8 horas
const MAX_FAILS = 8                          // intentos fallidos antes de bloquear
const LOCK_MS = 5 * 60 * 1000                // 5 minutos de bloqueo

let server = null          // http.Server
let tunnelHandle = null     // { url, child, stop }
let publicUrl = ''          // https://xxx.trycloudflare.com
let startedAt = null
let lastError = ''
const sessions = new Map()  // token -> expiresAt(ms)
let fails = 0
let lockedUntil = 0

function getDB() { return require('../database/db').getDB() }
function getSetting(key) {
  try { return getDB().prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || '' } catch { return '' }
}
function getPin() { return String(getSetting('portal_pin') || '').trim() }

// ── Sesiones ────────────────────────────────────────────────────────────────
function issueToken() {
  const token = crypto.randomBytes(24).toString('hex')
  sessions.set(token, Date.now() + SESSION_TTL_MS)
  return token
}
function validToken(token) {
  if (!token) return false
  const exp = sessions.get(token)
  if (!exp) return false
  if (Date.now() > exp) { sessions.delete(token); return false }
  return true
}
function requireAuth(req, res, next) {
  const h = req.headers['authorization'] || ''
  const m = h.match(/^Bearer\s+(.+)$/i)
  if (!m || !validToken(m[1].trim())) return res.status(401).json({ error: 'No autorizado' })
  next()
}

// ── Datos (solo lectura) ──────────────────────────────────────────────────────
function dashboardData() {
  const db = getDB()
  const hoy = "date(created_at,'localtime') = date('now','localtime')"
  const ventas = db.prepare(
    `SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM sales WHERE voided=0 AND ${hoy}`
  ).get()
  let caja = { abierta: false, efectivo: 0 }
  try {
    const cb = db.prepare("SELECT id, opening_cash FROM cashbox WHERE status='open' ORDER BY id DESC LIMIT 1").get()
    if (cb) {
      const mov = db.prepare(
        "SELECT COALESCE(SUM(CASE WHEN type='ingreso' THEN amount ELSE -amount END),0) n FROM cashbox_movements WHERE cashbox_id=?"
      ).get(cb.id)
      caja = { abierta: true, efectivo: (Number(cb.opening_cash) || 0) + (Number(mov.n) || 0) }
    }
  } catch {}
  let top = []
  try {
    top = db.prepare(
      `SELECT si.product_name name, SUM(si.quantity) qty
       FROM sale_items si JOIN sales s ON s.id=si.sale_id
       WHERE s.voided=0 AND date(s.created_at,'localtime')=date('now','localtime')
       GROUP BY si.product_name ORDER BY qty DESC LIMIT 5`
    ).all()
  } catch {}
  return {
    ventasHoy: { cantidad: ventas.c, total: ventas.t },
    caja,
    topProductos: top,
  }
}

function stockData(q) {
  const db = getDB()
  const search = String(q || '').trim()
  const params = []
  let where = 'WHERE p.active=1'
  if (search) {
    where += ' AND (p.name LIKE ? OR p.barcode LIKE ? OR p.color LIKE ?)'
    const s = `%${search}%`; params.push(s, s, s)
  }
  const rows = db.prepare(
    `SELECT p.id, p.name, p.color, p.category, p.barcode, COALESCE(SUM(ps.stock),0) total
     FROM products p LEFT JOIN product_sizes ps ON ps.product_id=p.id
     ${where}
     GROUP BY p.id
     ORDER BY p.name LIMIT 200`
  ).all(...params)
  return { productos: rows }
}

function movementsData() {
  const db = getDB()
  let ventas = [], movimientos = []
  try {
    ventas = db.prepare(
      `SELECT id, sale_number, total, payment_method, created_at FROM sales
       WHERE voided=0 ORDER BY id DESC LIMIT 20`
    ).all()
  } catch {}
  try {
    movimientos = db.prepare(
      `SELECT created_at, tipo, product_name, size, cantidad, stock_nuevo FROM stock_movements
       ORDER BY id DESC LIMIT 20`
    ).all()
  } catch {}
  return { ventas, movimientos }
}

// ── Servidor ─────────────────────────────────────────────────────────────────
function buildApp() {
  const app = express()
  app.use(express.json({ limit: '256kb' }))
  // Cabeceras de seguridad básicas + anti-caché: el navegador no debe servir una
  // versión vieja/vacía de una URL de túnel anterior (cada túnel es una URL nueva,
  // pero algunos navegadores reusan la pestaña y cachean el blanco de un intento fallido).
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    next()
  })

  app.get('/', (_req, res) => {
    try { require('./ipc/techLogs').logTech('info', 'portal', 'GET / (portal) — sirviendo página, ' + PORTAL_HTML.length + ' bytes') } catch {}
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(PORTAL_HTML)
  })

  app.post('/api/login', (req, res) => {
    const now = Date.now()
    if (now < lockedUntil) {
      return res.status(429).json({ error: 'Demasiados intentos. Probá de nuevo en unos minutos.' })
    }
    const pin = getPin()
    if (!pin) return res.status(503).json({ error: 'El portal no tiene PIN configurado.' })
    const given = String((req.body && req.body.pin) || '').trim()
    // Comparación en tiempo constante.
    const ok = given.length === pin.length &&
      crypto.timingSafeEqual(Buffer.from(given.padEnd(16, '\0')), Buffer.from(pin.padEnd(16, '\0')))
    if (!ok) {
      fails++
      if (fails >= MAX_FAILS) { lockedUntil = now + LOCK_MS; fails = 0 }
      return res.status(401).json({ error: 'PIN incorrecto' })
    }
    fails = 0
    res.json({ token: issueToken() })
  })

  app.get('/api/dashboard', requireAuth, (_req, res) => {
    try { res.json(dashboardData()) } catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.get('/api/stock', requireAuth, (req, res) => {
    try { res.json(stockData(req.query.q)) } catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.get('/api/movements', requireAuth, (_req, res) => {
    try { res.json(movementsData()) } catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.get('/api/meta', requireAuth, (_req, res) => {
    res.json({ negocio: getSetting('business_name') || 'DELPA', generadoEn: new Date().toISOString() })
  })

  return app
}

// ── Túnel Cloudflare ───────────────────────────────────────────────────────────
const MIN_BIN_BYTES = 10 * 1024 * 1024  // un cloudflared válido pesa ~30 MB

// Devuelve el binario de cloudflared, descargándolo si falta o si quedó corrupto.
async function ensureCloudflaredBin() {
  const cloudflared = require('cloudflared')
  const { app } = require('electron')
  const binPath = path.join(app.getPath('userData'), process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared')
  try { cloudflared.use(binPath) } catch {}

  // ¿Existe pero quedó incompleto/corrupto (descarga cortada, bloqueo del antivirus)?
  let needDownload = !fs.existsSync(binPath)
  if (!needDownload) {
    try { if (fs.statSync(binPath).size < MIN_BIN_BYTES) { fs.unlinkSync(binPath); needDownload = true } } catch {}
  }
  if (needDownload) {
    await cloudflared.install(binPath)  // descarga (~30 MB) una sola vez
    let size = 0
    try { size = fs.statSync(binPath).size } catch {}
    if (size < MIN_BIN_BYTES) {
      // Borrarlo para forzar una descarga limpia el próximo intento.
      try { fs.unlinkSync(binPath) } catch {}
      throw new Error('La descarga del componente del túnel falló o quedó incompleta (binario demasiado chico). Revisá tu conexión a internet o el antivirus y probá de nuevo.')
    }
    // Asegurar permiso de ejecución (clave en Linux/Mac; inocuo en Windows).
    try { fs.chmodSync(binPath, 0o755) } catch {}
  }
  return { cloudflared, binPath }
}

async function startTunnel() {
  const { cloudflared, binPath } = await ensureCloudflaredBin()

  // IMPORTANTE: quick tunnel = `cloudflared tunnel --url http://...` (sin cuenta).
  // Tunnel.quick() arma ESOS args. (Usar cloudflared.tunnel({'--url'}) arma
  // `tunnel run --url`, que requiere un túnel con credenciales y muere al instante
  // con código 0xFFFFFFFF.)
  const t = cloudflared.Tunnel.quick(`http://127.0.0.1:${PORT}`)
  tunnelHandle = t

  // Capturar la salida de cloudflared para diagnosticar si muere antes de dar la URL.
  let outBuf = ''
  const onOut = (d) => {
    outBuf = (outBuf + String(d)).slice(-3000)
    try { require('./ipc/techLogs').logTech('info', 'portal', '[cloudflared] ' + String(d).trim().slice(0, 300)) } catch {}
  }
  try { t.on('stderr', onOut); t.on('stdout', onOut) } catch {}
  const tail = () => { const s = outBuf.trim(); return s ? ' — Detalle: ' + s.slice(-400) : ' Puede estar bloqueado por el antivirus; permití "cloudflared.exe" y probá de nuevo.' }

  const url = await new Promise((resolve, reject) => {
    let settled = false
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v) } }
    const timer = setTimeout(() => done(reject, new Error('El túnel tardó demasiado en iniciar.' + tail())), 45000)
    t.once('url', (u) => done(resolve, u))
    t.once('error', (e) => {
      // EFTYPE/ENOENT/EACCES = el cloudflared.exe no es ejecutable (corrupto, incompleto
      // o neutralizado por el antivirus). Lo borramos para que se re-descargue limpio al
      // volver a activar, y damos un mensaje accionable.
      const code = e && e.code
      if (code === 'EFTYPE' || code === 'ENOENT' || code === 'EACCES') {
        try { fs.unlinkSync(binPath) } catch {}
        return done(reject, new Error('El componente del portal necesita reinstalarse. Desactivá y volvé a activar el portal para descargarlo de nuevo. (Si vuelve a pasar, revisá que el antivirus no esté bloqueando "cloudflared.exe".)'))
      }
      done(reject, new Error('No se pudo ejecutar cloudflared: ' + ((e && e.message) || e) + tail()))
    })
    t.once('exit', (code) => done(reject, new Error('cloudflared se cerró (código ' + code + ').' + tail())))
  })
  // Si cloudflared reconecta y cambia la URL, mantenerla actualizada.
  t.on('url', (u) => { if (u) publicUrl = u })
  publicUrl = url
  return url
}

// ── API pública del módulo ─────────────────────────────────────────────────────
async function startPortal() {
  if (server) return { ok: true, url: publicUrl, already: true }
  // Requiere base local (no corre en una caja cliente de multi-caja).
  try { getDB() } catch {
    throw new Error('El portal web solo funciona en la PC principal (la que tiene la base de datos).')
  }
  if (!getPin()) throw new Error('Configurá un PIN de 4 a 6 dígitos antes de activar el portal.')

  lastError = ''
  await new Promise((resolve, reject) => {
    server = buildApp().listen(PORT, '127.0.0.1', resolve)
    server.on('error', (e) => { lastError = e.message; reject(e) })
  })
  try {
    await startTunnel()
  } catch (e) {
    lastError = 'No se pudo abrir el túnel: ' + (e && e.message || e)
    await stopPortal()
    throw new Error(lastError)
  }
  startedAt = new Date().toISOString()
  return { ok: true, url: publicUrl }
}

async function stopPortal() {
  try { if (tunnelHandle && tunnelHandle.stop) tunnelHandle.stop() } catch {}
  try { if (tunnelHandle && tunnelHandle.child) tunnelHandle.child.kill() } catch {}
  tunnelHandle = null
  publicUrl = ''
  if (server) { try { server.close() } catch {} ; server = null }
  startedAt = null
  sessions.clear()
  return { ok: true }
}

function portalStatus() {
  return {
    active: !!server,
    url: publicUrl,
    startedAt,
    hasPin: !!getPin(),
    lastError,
    port: PORT,
  }
}

module.exports = { startPortal, stopPortal, portalStatus, PORT }

// ── HTML del portal (una sola página, mobile-first, sin dependencias) ───────────
const PORTAL_HTML = `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>DELPA — Portal</title>
<style>
  :root{--bg:#0b0b0f;--card:#15151c;--bd:#26262f;--tx:#e7e7ea;--mut:#8a8a94;--acc:#6366f1;--ok:#22c55e;--rd:#ef4444}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif}
  .wrap{max-width:720px;margin:0 auto;padding:16px}
  .card{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:16px;margin-bottom:14px}
  h1{font-size:18px;margin:0 0 2px} h2{font-size:14px;color:var(--mut);margin:0 0 10px;text-transform:uppercase;letter-spacing:.04em}
  input{width:100%;background:#0e0e14;border:1px solid var(--bd);border-radius:10px;color:var(--tx);padding:12px;font-size:16px}
  button{background:var(--acc);border:0;color:#fff;border-radius:10px;padding:12px 16px;font-size:15px;font-weight:600;cursor:pointer;width:100%}
  button.sec{background:#20202a}
  .tabs{display:flex;gap:6px;margin-bottom:12px}
  .tabs button{background:#16161d;border:1px solid var(--bd);color:var(--mut);font-weight:500}
  .tabs button.on{background:var(--acc);color:#fff;border-color:var(--acc)}
  .kpi{display:flex;gap:10px;flex-wrap:wrap}
  .kpi .b{flex:1;min-width:120px;background:#0e0e14;border:1px solid var(--bd);border-radius:12px;padding:12px}
  .kpi .n{font-size:22px;font-weight:700} .kpi .l{color:var(--mut);font-size:12px}
  .row{display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--bd);font-size:14px}
  .row:last-child{border:0} .mut{color:var(--mut)} .pos{color:var(--ok)} .neg{color:var(--rd)}
  .pill{font-size:11px;padding:2px 8px;border-radius:999px;background:#20202a;color:var(--mut)}
  .err{color:var(--rd);font-size:13px;margin-top:8px;min-height:18px}
  .hide{display:none}
</style></head>
<body><div class="wrap">
  <div id="login" class="card">
    <h1>DELPA — Portal</h1>
    <p class="mut" style="margin:0 0 14px">Ingresá el PIN para ver tu negocio.</p>
    <input id="pin" type="password" inputmode="numeric" placeholder="PIN" autocomplete="off">
    <div class="err" id="loginErr"></div>
    <button id="btnLogin" style="margin-top:8px">Entrar</button>
  </div>

  <div id="app" class="hide">
    <div class="card" style="display:flex;justify-content:space-between;align-items:center">
      <div><h1 id="biz" style="margin:0">DELPA</h1><span class="mut" style="font-size:12px">Solo lectura</span></div>
      <button class="sec" style="width:auto;padding:8px 12px" id="btnOut">Salir</button>
    </div>
    <div class="tabs">
      <button data-t="dash" class="on">Resumen</button>
      <button data-t="stock">Stock</button>
      <button data-t="mov">Movimientos</button>
    </div>
    <div id="view"></div>
  </div>
</div>
<script>
  var token='';
  function api(path){return fetch(path,{headers:{Authorization:'Bearer '+token}}).then(function(r){if(!r.ok)throw new Error('http');return r.json()})}
  function money(n){return '$'+(Number(n)||0).toLocaleString('es-AR')}
  function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}
  function when(s){try{return new Date(s).toLocaleString('es-AR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}catch(e){return s||''}}

  document.getElementById('btnLogin').onclick=login;
  document.getElementById('pin').addEventListener('keydown',function(e){if(e.key==='Enter')login()});
  function login(){
    var pin=document.getElementById('pin').value;
    document.getElementById('loginErr').textContent='';
    fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:pin})})
      .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})})
      .then(function(x){
        if(!x.ok){document.getElementById('loginErr').textContent=x.j.error||'Error';return}
        token=x.j.token;
        document.getElementById('login').classList.add('hide');
        document.getElementById('app').classList.remove('hide');
        api('/api/meta').then(function(m){document.getElementById('biz').textContent=m.negocio||'DELPA'}).catch(function(){});
        show('dash');
      }).catch(function(){document.getElementById('loginErr').textContent='No se pudo conectar'});
  }
  document.getElementById('btnOut').onclick=function(){token='';location.reload()};
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'),function(b){
    b.onclick=function(){
      Array.prototype.forEach.call(document.querySelectorAll('.tabs button'),function(x){x.classList.remove('on')});
      b.classList.add('on'); show(b.getAttribute('data-t'));
    };
  });

  function show(t){
    var v=document.getElementById('view'); v.innerHTML='<p class="mut">Cargando…</p>';
    if(t==='dash') api('/api/dashboard').then(renderDash).catch(fail);
    if(t==='stock') renderStockView();
    if(t==='mov') api('/api/movements').then(renderMov).catch(fail);
  }
  function fail(){document.getElementById('view').innerHTML='<p class="neg">No se pudo cargar.</p>'}

  function renderDash(d){
    var top=(d.topProductos||[]).map(function(p){return '<div class="row"><span>'+esc(p.name)+'</span><span class="mut">'+p.qty+'</span></div>'}).join('')||'<p class="mut">Sin ventas hoy.</p>';
    document.getElementById('view').innerHTML=
      '<div class="card"><h2>Hoy</h2><div class="kpi">'+
      '<div class="b"><div class="n">'+d.ventasHoy.cantidad+'</div><div class="l">Ventas</div></div>'+
      '<div class="b"><div class="n">'+money(d.ventasHoy.total)+'</div><div class="l">Facturado</div></div>'+
      '<div class="b"><div class="n">'+(d.caja.abierta?money(d.caja.efectivo):'—')+'</div><div class="l">Caja '+(d.caja.abierta?'(efectivo)':'cerrada')+'</div></div>'+
      '</div></div>'+
      '<div class="card"><h2>Top productos de hoy</h2>'+top+'</div>';
  }
  function renderStockView(){
    document.getElementById('view').innerHTML=
      '<div class="card"><input id="sq" placeholder="Buscar producto…"><div id="stockList" style="margin-top:10px"></div></div>';
    var inp=document.getElementById('sq'); var tmr;
    inp.addEventListener('input',function(){clearTimeout(tmr);tmr=setTimeout(loadStock,250)});
    loadStock();
  }
  function loadStock(){
    var q=(document.getElementById('sq')||{}).value||'';
    document.getElementById('stockList').innerHTML='<p class="mut">Cargando…</p>';
    api('/api/stock?q='+encodeURIComponent(q)).then(function(d){
      var html=(d.productos||[]).map(function(p){
        var cls=p.total>0?'':'neg';
        return '<div class="row"><span>'+esc(p.name)+(p.color?' <span class="mut">'+esc(p.color)+'</span>':'')+'</span><span class="'+cls+'">'+p.total+'</span></div>';
      }).join('')||'<p class="mut">Sin resultados.</p>';
      document.getElementById('stockList').innerHTML=html;
    }).catch(function(){document.getElementById('stockList').innerHTML='<p class="neg">Error.</p>'});
  }
  function renderMov(d){
    var ventas=(d.ventas||[]).map(function(v){return '<div class="row"><span>'+esc(v.sale_number||('#'+v.id))+' <span class="mut">'+when(v.created_at)+'</span></span><span>'+money(v.total)+'</span></div>'}).join('')||'<p class="mut">—</p>';
    var movs=(d.movimientos||[]).map(function(m){var c=m.cantidad<0?'neg':'pos';return '<div class="row"><span><span class="pill">'+esc(m.tipo)+'</span> '+esc(m.product_name)+(m.size&&m.size!=='N/A'?' <span class="mut">T.'+esc(m.size)+'</span>':'')+'</span><span class="'+c+'">'+(m.cantidad>0?'+':'')+m.cantidad+'</span></div>'}).join('')||'<p class="mut">—</p>';
    document.getElementById('view').innerHTML=
      '<div class="card"><h2>Últimas ventas</h2>'+ventas+'</div>'+
      '<div class="card"><h2>Últimos movimientos de stock</h2>'+movs+'</div>';
  }
</script></body></html>`
