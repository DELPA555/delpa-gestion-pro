#!/usr/bin/env bash
#
# DELPA Portal central — deploy en el VPS (Ubuntu 24.04, Node 20, nginx, PM2 ya instalados).
#
# Qué hace (idempotente — se puede correr varias veces):
#   1. Crea /opt/delpa-portal/ con server.js, package.json y la base SQLite.
#   2. npm install (express + better-sqlite3).
#   3. Configura nginx como reverse proxy para portal.delpagestion.com.ar → localhost:3000.
#   4. Instala certbot y obtiene/renueva el certificado SSL (Let's Encrypt).
#   5. Levanta el server con PM2 y lo deja arrancando solo al reboot.
#
# Uso (en el servidor, como root):
#   scp -r tools/portal-server root@206.189.193.230:/tmp/   # (o pegá este archivo)
#   ssh root@206.189.193.230 'bash /tmp/portal-server/deploy.sh'
#
# Requiere que el DNS de portal.delpagestion.com.ar ya apunte a la IP del VPS (para el SSL).
set -euo pipefail

APP_DIR="/opt/delpa-portal"
DOMAIN="portal.delpagestion.com.ar"
PORT="3000"
# Secreto compartido con la app DELPA (header X-Delpa-Secret). Mismo valor en el cliente.
PING_SECRET="0822e42fa23b4f9dd3b79afb29d3a4a4b8489b7709c46276"
# Email para los avisos de Let's Encrypt (renovación/expiración).
LE_EMAIL="delpa555@gmail.com"

echo "==> 1/5  Creando $APP_DIR"
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# ── package.json ────────────────────────────────────────────────────────────────
cat > "$APP_DIR/package.json" <<'PKG'
{
  "name": "delpa-portal",
  "version": "1.0.0",
  "private": true,
  "main": "server.js",
  "dependencies": {
    "better-sqlite3": "^11.10.0",
    "express": "^4.21.2",
    "multer": "^1.4.5-lts.1"
  }
}
PKG

# ── server.js ───────────────────────────────────────────────────────────────────
# Heredoc con comillas ('SERVER') → NADA se interpola; los ${...} y backticks del JS
# quedan tal cual.
cat > "$APP_DIR/server.js" <<'SERVER'
/* DELPA Portal central (VPS). Node 20 + Express + better-sqlite3.
 *
 * Recibe pings de cada instalación de DELPA (POST /ping, autenticado con un secreto
 * compartido) y sirve un portal web de SOLO LECTURA por negocio en una URL fija:
 *   https://portal.delpagestion.com.ar/portal/<slug>
 *
 * Seguridad:
 *  - /ping requiere el header X-Delpa-Secret (evita que random internet escriba datos).
 *  - El PIN se guarda HASHEADO (scrypt), nunca en texto plano.
 *  - Login con PIN por slug, con bloqueo tras varios intentos fallidos (anti fuerza bruta).
 *  - Las vistas son de solo lectura: no hay ningún endpoint que modifique el negocio.
 */
const express = require('express')
const Database = require('better-sqlite3')
const crypto = require('crypto')
const path = require('path')
const fs = require('fs')
const multer = require('multer')

const PORT = Number(process.env.PORT || 3000)
const DB_PATH = path.join(__dirname, 'data.db')
const BACKUP_DIR = path.join(__dirname, 'backups')
const PING_SECRET = process.env.DELPA_PING_SECRET || '__PING_SECRET__'
const SESSION_TTL_MS = 8 * 60 * 60 * 1000
const MAX_FAILS = 8
const LOCK_MS = 5 * 60 * 1000

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS nodes (
    hwid TEXT PRIMARY KEY,
    slug TEXT UNIQUE,
    businessName TEXT,
    cuit TEXT,
    networkCode TEXT,
    branchName TEXT,
    pinHash TEXT,
    stockJson TEXT DEFAULT '[]',
    ventasHoy REAL DEFAULT 0,
    cajaHoy REAL DEFAULT 0,
    version TEXT,
    updatedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS red_stock (
    networkCode TEXT,
    hwid TEXT,
    branchName TEXT,
    stockJson TEXT DEFAULT '[]',
    updatedAt TEXT,
    PRIMARY KEY (networkCode, hwid)
  );
  CREATE TABLE IF NOT EXISTS red_precios (
    networkCode TEXT,
    hwid TEXT,
    preciosJson TEXT DEFAULT '[]',
    updatedAt TEXT,
    PRIMARY KEY (networkCode, hwid)
  );
`)

// ── PIN hasheado (scrypt, sin dependencias extra) ───────────────────────────────
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex')
  const h = crypto.scryptSync(String(pin), salt, 32).toString('hex')
  return salt + ':' + h
}
function verifyPin(pin, stored) {
  try {
    const [salt, h] = String(stored).split(':')
    const c = crypto.scryptSync(String(pin), salt, 32).toString('hex')
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(c, 'hex'))
  } catch { return false }
}

// ── slug a partir del nombre del negocio (único por hwid) ────────────────────────
function slugify(name) {
  return String(name || 'negocio')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'negocio'
}
function uniqueSlug(base, hwid) {
  let s = base, i = 1
  for (;;) {
    const row = db.prepare('SELECT hwid FROM nodes WHERE slug=?').get(s)
    if (!row || row.hwid === hwid) return s
    s = base + '-' + (++i)
  }
}

const sessions = new Map()   // token -> { slug, exp }
const limits = new Map()     // slug  -> { fails, lockedUntil }

const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '2mb' }))
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cache-Control', 'no-store')
  next()
})

// ── POST /ping — recibe datos de una instalación DELPA (auth por secreto) ────────
app.post('/ping', (req, res) => {
  if ((req.headers['x-delpa-secret'] || '') !== PING_SECRET) return res.status(401).json({ error: 'No autorizado' })
  const b = req.body || {}
  if (!b.hwid) return res.status(400).json({ error: 'hwid requerido' })

  const existing = db.prepare('SELECT slug, pinHash FROM nodes WHERE hwid=?').get(b.hwid)
  const slug = existing?.slug || uniqueSlug(slugify(b.businessName), b.hwid)

  // PIN: si el ping trae uno y cambió (o no había), se re-hashea; si no, se conserva.
  let pinHash = existing?.pinHash || null
  if (b.pin != null && String(b.pin).length) {
    if (!pinHash || !verifyPin(b.pin, pinHash)) pinHash = hashPin(b.pin)
  }
  if (!pinHash) pinHash = hashPin('1234')

  db.prepare(`
    INSERT INTO nodes (hwid,slug,businessName,cuit,networkCode,branchName,pinHash,stockJson,ventasHoy,cajaHoy,version,updatedAt)
    VALUES (@hwid,@slug,@businessName,@cuit,@networkCode,@branchName,@pinHash,@stockJson,@ventasHoy,@cajaHoy,@version,@updatedAt)
    ON CONFLICT(hwid) DO UPDATE SET
      slug=@slug, businessName=@businessName, cuit=@cuit, networkCode=@networkCode, branchName=@branchName,
      pinHash=@pinHash, stockJson=@stockJson, ventasHoy=@ventasHoy, cajaHoy=@cajaHoy, version=@version, updatedAt=@updatedAt
  `).run({
    hwid: String(b.hwid), slug,
    businessName: String(b.businessName || ''), cuit: String(b.cuit || ''),
    networkCode: String(b.networkCode || ''), branchName: String(b.branchName || ''),
    pinHash, stockJson: JSON.stringify(b.stockSnapshot || []),
    ventasHoy: Number(b.ventasHoy) || 0, cajaHoy: Number(b.cajaHoy) || 0,
    version: String(b.version || ''), updatedAt: new Date().toISOString(),
  })
  res.json({ ok: true, slug, url: 'https://' + req.headers.host + '/portal/' + slug })
})

// ── GET /portal/:slug — página del portal (login + dashboard, una sola página) ───
app.get('/portal/:slug', (req, res) => {
  const node = db.prepare('SELECT slug, businessName, networkCode FROM nodes WHERE slug=?').get(req.params.slug)
  if (!node) return res.status(404).send('<p style="font:16px system-ui;padding:24px">Negocio no encontrado.</p>')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(PORTAL_HTML(node.slug, node.businessName, !!String(node.networkCode || '').trim()))
})

// ── Login por slug (rate-limited) ────────────────────────────────────────────────
app.post('/api/:slug/login', (req, res) => {
  const slug = req.params.slug
  const lim = limits.get(slug) || { fails: 0, lockedUntil: 0 }
  if (Date.now() < lim.lockedUntil) return res.status(429).json({ error: 'Demasiados intentos. Probá en unos minutos.' })
  const node = db.prepare('SELECT pinHash FROM nodes WHERE slug=?').get(slug)
  if (!node) return res.status(404).json({ error: 'Negocio no encontrado' })
  const pin = String((req.body && req.body.pin) || '')
  if (!verifyPin(pin, node.pinHash)) {
    lim.fails++
    if (lim.fails >= MAX_FAILS) { lim.lockedUntil = Date.now() + LOCK_MS; lim.fails = 0 }
    limits.set(slug, lim)
    return res.status(401).json({ error: 'PIN incorrecto' })
  }
  lim.fails = 0; limits.set(slug, lim)
  const token = crypto.randomBytes(24).toString('hex')
  sessions.set(token, { slug, exp: Date.now() + SESSION_TTL_MS })
  res.json({ token })
})

function auth(req, res, next) {
  const h = req.headers.authorization || ''
  const m = h.match(/^Bearer\s+(.+)$/i)
  const s = m && sessions.get(m[1].trim())
  if (!s || s.exp < Date.now() || s.slug !== req.params.slug) return res.status(401).json({ error: 'No autorizado' })
  next()
}

app.get('/api/:slug/status', auth, (req, res) => {
  const n = db.prepare('SELECT businessName, branchName, ventasHoy, cajaHoy, version, updatedAt FROM nodes WHERE slug=?').get(req.params.slug)
  res.json(n || {})
})
app.get('/api/:slug/stock', auth, (req, res) => {
  const n = db.prepare('SELECT stockJson FROM nodes WHERE slug=?').get(req.params.slug)
  let stock = []
  try { stock = JSON.parse(n?.stockJson || '[]') } catch {}
  const q = String(req.query.q || '').toLowerCase().trim()
  if (q) stock = stock.filter(p => String(p.n || '').toLowerCase().includes(q) || String(p.b || '').toLowerCase().includes(q))
  // total por producto (suma de los talles) para la grilla
  const out = stock.map(p => ({ n: p.n, c: p.c || '', cat: p.cat || '', total: (p.s || []).reduce((s, x) => s + (Number(x[1]) || 0), 0) }))
  res.json({ productos: out })
})
app.get('/api/:slug/ventas', auth, (req, res) => {
  const n = db.prepare('SELECT ventasHoy, cajaHoy, updatedAt FROM nodes WHERE slug=?').get(req.params.slug)
  res.json(n || {})
})
// "Mi Red": todos los locales con el mismo networkCode. No pide PIN extra (ya está
// autenticado con el PIN del slug). Si el local no tiene networkCode, devuelve vacío.
app.get('/api/:slug/red', auth, (req, res) => {
  const me = db.prepare('SELECT networkCode FROM nodes WHERE slug=?').get(req.params.slug)
  const code = String((me && me.networkCode) || '').trim()
  if (!code) return res.json({ networkCode: '', nodes: [] })
  const rows = db.prepare('SELECT slug, businessName, branchName, ventasHoy, cajaHoy, stockJson, updatedAt FROM nodes WHERE networkCode=? ORDER BY branchName, businessName').all(code)
  const now = Date.now()
  const nodes = rows.map(r => {
    let units = 0
    try { units = (JSON.parse(r.stockJson || '[]')).reduce((s, p) => s + (p.s || []).reduce((a, x) => a + (Number(x[1]) || 0), 0), 0) } catch {}
    const online = r.updatedAt ? (now - new Date(r.updatedAt).getTime() < 20 * 60 * 1000) : false
    return { nombre: r.branchName || r.businessName || 'Local', online, ventasHoy: Number(r.ventasHoy) || 0, cajaHoy: Number(r.cajaHoy) || 0, unidades: units, esYo: r.slug === req.params.slug }
  })
  res.json({ networkCode: code, nodes })
})

// ── Sync de red (reemplaza al Apps Script). Auth por secreto compartido ──────────
function secretAuth(req, res, next) {
  if ((req.headers['x-delpa-secret'] || '') !== PING_SECRET) return res.status(401).json({ error: 'No autorizado' })
  next()
}

// Stock de red: cada local sube su stock completo; cualquiera de la red lo consulta.
app.post('/red/stock/:networkCode', secretAuth, (req, res) => {
  const b = req.body || {}
  if (!b.hwid) return res.status(400).json({ error: 'hwid requerido' })
  db.prepare(`INSERT INTO red_stock (networkCode,hwid,branchName,stockJson,updatedAt) VALUES (?,?,?,?,?)
    ON CONFLICT(networkCode,hwid) DO UPDATE SET branchName=excluded.branchName, stockJson=excluded.stockJson, updatedAt=excluded.updatedAt`)
    .run(String(req.params.networkCode), String(b.hwid), String(b.branchName || ''), JSON.stringify(b.stock || []), new Date().toISOString())
  res.json({ ok: true })
})
app.get('/red/stock/:networkCode', secretAuth, (req, res) => {
  const rows = db.prepare('SELECT hwid,branchName,stockJson,updatedAt FROM red_stock WHERE networkCode=? ORDER BY branchName').all(String(req.params.networkCode))
  const locales = rows.map(r => {
    let stock = []
    try { stock = JSON.parse(r.stockJson || '[]') } catch {}
    return { branchName: r.branchName, hwid: r.hwid, lastUpdate: r.updatedAt, stock }
  })
  res.json({ locales })
})

// Precios de red.
app.post('/red/precios/:networkCode', secretAuth, (req, res) => {
  const b = req.body || {}
  if (!b.hwid) return res.status(400).json({ error: 'hwid requerido' })
  db.prepare(`INSERT INTO red_precios (networkCode,hwid,preciosJson,updatedAt) VALUES (?,?,?,?)
    ON CONFLICT(networkCode,hwid) DO UPDATE SET preciosJson=excluded.preciosJson, updatedAt=excluded.updatedAt`)
    .run(String(req.params.networkCode), String(b.hwid), JSON.stringify(b.precios || []), new Date().toISOString())
  res.json({ ok: true })
})
app.get('/red/precios/:networkCode', secretAuth, (req, res) => {
  const rows = db.prepare('SELECT preciosJson,updatedAt FROM red_precios WHERE networkCode=?').all(String(req.params.networkCode))
  const sorted = rows.slice().sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)))
  const map = new Map() // último precio por código gana
  for (const r of sorted) {
    let ps = []
    try { ps = JSON.parse(r.preciosJson || '[]') } catch {}
    for (const p of ps) { if (p && p.codigo != null) map.set(String(p.codigo), { codigo: p.codigo, precio: p.precio, precioLista: p.precioLista }) }
  }
  res.json({ precios: Array.from(map.values()) })
})

// ── Backup en la nube (v1.50.0) ──────────────────────────────────────────────────
try { fs.mkdirSync(path.join(BACKUP_DIR, '_tmp'), { recursive: true }) } catch {}
const upload = multer({ dest: path.join(BACKUP_DIR, '_tmp'), limits: { fileSize: 200 * 1024 * 1024 } })
function safeSlug(s) { return String(s || '').replace(/[^a-z0-9-]/gi, '').slice(0, 60) }

app.post('/backup/:slug', secretAuth, upload.single('backup'), (req, res) => {
  const slug = safeSlug(req.params.slug)
  if (!slug) return res.status(400).json({ error: 'slug inválido' })
  if (!req.file) return res.status(400).json({ error: 'falta el archivo "backup"' })
  const dir = path.join(BACKUP_DIR, slug)
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  fs.renameSync(req.file.path, path.join(dir, stamp + '.sqlite.gz'))
  // Retención: solo los últimos 7.
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sqlite.gz')).sort()
    while (files.length > 7) { fs.unlinkSync(path.join(dir, files.shift())) }
  } catch {}
  res.json({ ok: true, savedAt: new Date().toISOString() })
})
app.get('/backup/:slug/latest', secretAuth, (req, res) => {
  const slug = safeSlug(req.params.slug)
  const dir = path.join(BACKUP_DIR, slug)
  let files = []
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.sqlite.gz')).sort() } catch {}
  if (!files.length) return res.status(404).json({ error: 'sin backups' })
  const latest = files[files.length - 1]
  res.setHeader('Content-Type', 'application/gzip')
  res.setHeader('Content-Disposition', 'attachment; filename="' + latest + '"')
  fs.createReadStream(path.join(dir, latest)).pipe(res)
})

app.get('/', (_req, res) => res.send('DELPA Portal · OK'))

app.listen(PORT, '127.0.0.1', () => console.log('DELPA Portal escuchando en 127.0.0.1:' + PORT))

// ── HTML del portal (una sola página, mobile-first) ──────────────────────────────
function PORTAL_HTML(slug, businessName, hasNet) {
  const biz = String(businessName || 'DELPA').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  return `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${biz} — Portal</title>
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
  .row:last-child{border:0} .mut{color:var(--mut)} .neg{color:var(--rd)}
  .err{color:var(--rd);font-size:13px;margin-top:8px;min-height:18px}
  .hide{display:none}
</style></head>
<body><div class="wrap">
  <div id="login" class="card">
    <h1>${biz}</h1>
    <p class="mut" style="margin:0 0 14px">Ingresá el PIN para ver tu negocio.</p>
    <input id="pin" type="password" inputmode="numeric" placeholder="PIN" autocomplete="off">
    <div class="err" id="loginErr"></div>
    <button id="btnLogin" style="margin-top:8px">Entrar</button>
  </div>
  <div id="app" class="hide">
    <div class="card" style="display:flex;justify-content:space-between;align-items:center">
      <div><h1 id="biz" style="margin:0">${biz}</h1><span class="mut" style="font-size:12px">Solo lectura</span></div>
      <button class="sec" style="width:auto;padding:8px 12px" id="btnOut">Salir</button>
    </div>
    <div class="tabs"><button data-t="dash" class="on">Resumen</button><button data-t="stock">Stock</button>${hasNet ? '<button data-t="red">Mi Red</button>' : ''}</div>
    <div id="view"></div>
  </div>
</div>
<script>
  var SLUG=${JSON.stringify(slug)}, token='';
  function api(p){return fetch('/api/'+SLUG+p,{headers:{Authorization:'Bearer '+token}}).then(function(r){if(!r.ok)throw 0;return r.json()})}
  function money(n){return '$'+(Number(n)||0).toLocaleString('es-AR')}
  function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}
  document.getElementById('btnLogin').onclick=login;
  document.getElementById('pin').addEventListener('keydown',function(e){if(e.key==='Enter')login()});
  function login(){
    var pin=document.getElementById('pin').value; document.getElementById('loginErr').textContent='';
    fetch('/api/'+SLUG+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:pin})})
      .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})})
      .then(function(x){ if(!x.ok){document.getElementById('loginErr').textContent=x.j.error||'Error';return}
        token=x.j.token; document.getElementById('login').classList.add('hide'); document.getElementById('app').classList.remove('hide'); show('dash'); })
      .catch(function(){document.getElementById('loginErr').textContent='No se pudo conectar'});
  }
  document.getElementById('btnOut').onclick=function(){token='';location.reload()};
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'),function(b){ b.onclick=function(){
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'),function(x){x.classList.remove('on')}); b.classList.add('on'); show(b.getAttribute('data-t')); }; });
  function show(t){ var v=document.getElementById('view'); v.innerHTML='<p class="mut">Cargando…</p>';
    if(t==='dash') api('/status').then(renderDash).catch(fail);
    if(t==='stock') renderStock();
    if(t==='red') api('/red').then(renderRed).catch(fail); }
  function renderRed(d){ var ns=d.nodes||[];
    if(!ns.length){document.getElementById('view').innerHTML='<div class="card mut">Todavía no hay locales reportando en tu red.</div>';return}
    var tv=ns.reduce(function(s,n){return s+(Number(n.ventasHoy)||0)},0), tc=ns.reduce(function(s,n){return s+(Number(n.cajaHoy)||0)},0);
    var rows=ns.map(function(n){ var dot=n.online?'<span style="color:var(--ok)">●</span>':'<span style="color:var(--mut)">●</span>';
      return '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><div><b>'+esc(n.nombre)+'</b>'+(n.esYo?' <span class="mut" style="font-size:11px">(este local)</span>':'')+'</div><div style="font-size:12px">'+dot+' '+(n.online?'Online':'Offline')+'</div></div>'+
        '<div class="kpi" style="margin-top:10px"><div class="b"><div class="n">'+money(n.ventasHoy)+'</div><div class="l">Ventas hoy</div></div><div class="b"><div class="n">'+money(n.cajaHoy)+'</div><div class="l">Caja</div></div><div class="b"><div class="n">'+n.unidades+'</div><div class="l">Unid. en stock</div></div></div></div>'; }).join('');
    document.getElementById('view').innerHTML='<div class="card"><h2>Total de la red</h2><div class="kpi"><div class="b"><div class="n">'+money(tv)+'</div><div class="l">Ventas hoy</div></div><div class="b"><div class="n">'+money(tc)+'</div><div class="l">Caja</div></div><div class="b"><div class="n">'+ns.length+'</div><div class="l">Locales</div></div></div></div>'+rows; }
  function fail(){document.getElementById('view').innerHTML='<p class="neg">No se pudo cargar.</p>'}
  function renderDash(d){ document.getElementById('view').innerHTML=
    '<div class="card"><h2>Hoy</h2><div class="kpi">'+
    '<div class="b"><div class="n">'+money(d.ventasHoy)+'</div><div class="l">Ventas del día</div></div>'+
    '<div class="b"><div class="n">'+money(d.cajaHoy)+'</div><div class="l">Caja (efectivo)</div></div>'+
    '</div></div>'+
    '<div class="card mut" style="font-size:12px">Último dato recibido: '+(d.updatedAt?new Date(d.updatedAt).toLocaleString('es-AR'):'—')+(d.branchName?(' · '+esc(d.branchName)):'')+'</div>'; }
  function renderStock(){ document.getElementById('view').innerHTML='<div class="card"><input id="sq" placeholder="Buscar producto…"><div id="sl" style="margin-top:10px"></div></div>';
    var inp=document.getElementById('sq'),tmr; inp.addEventListener('input',function(){clearTimeout(tmr);tmr=setTimeout(loadStock,250)}); loadStock(); }
  function loadStock(){ var q=(document.getElementById('sq')||{}).value||''; document.getElementById('sl').innerHTML='<p class="mut">Cargando…</p>';
    api('/stock?q='+encodeURIComponent(q)).then(function(d){ document.getElementById('sl').innerHTML=(d.productos||[]).map(function(p){
      return '<div class="row"><span>'+esc(p.n)+(p.c?' <span class="mut">'+esc(p.c)+'</span>':'')+'</span><span'+(p.total>0?'':' class="neg"')+'>'+p.total+'</span></div>'; }).join('')||'<p class="mut">Sin resultados.</p>'; })
      .catch(function(){document.getElementById('sl').innerHTML='<p class="neg">Error.</p>'}); }
</script></body></html>`
}
SERVER

# Inyectar el secreto en server.js (reemplaza el placeholder).
sed -i "s|__PING_SECRET__|${PING_SECRET}|g" "$APP_DIR/server.js"

echo "==> 2/5  Instalando dependencias (npm)"
apt-get install -y build-essential python3 >/dev/null 2>&1 || true   # por si better-sqlite3 compila
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund

echo "==> 3/5  Configurando nginx"
cat > "/etc/nginx/sites-available/delpa-portal" <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};
    location / {
        proxy_pass http://localhost:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/delpa-portal /etc/nginx/sites-enabled/delpa-portal
nginx -t && systemctl reload nginx

echo "==> 4/5  SSL con certbot (Let's Encrypt)"
if ! command -v certbot >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y certbot python3-certbot-nginx
fi
# --nginx edita el vhost y agrega el 443 con el cert. Idempotente (si ya hay cert, renueva/no hace nada).
certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${LE_EMAIL}" --redirect || \
  echo "   (certbot falló — revisá que el DNS de ${DOMAIN} apunte a este servidor y reintentá)"

echo "==> 5/5  Iniciando con PM2"
cd "$APP_DIR"
# PING_SECRET ya está embebido en server.js; igual lo exponemos por env por si se quiere rotar.
pm2 delete delpa-portal >/dev/null 2>&1 || true
DELPA_PING_SECRET="${PING_SECRET}" pm2 start server.js --name delpa-portal --update-env
pm2 save
pm2 startup systemd -u root --hp /root | tail -n 1 | bash || true

echo ""
echo "==> LISTO. Portal en: https://${DOMAIN}/portal/<slug>"
echo "    Probar salud:   curl -s https://${DOMAIN}/   (debe responder 'DELPA Portal · OK')"
echo "    Logs:           pm2 logs delpa-portal"
