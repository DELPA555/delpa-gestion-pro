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
// Secreto de ADMIN (panel de licencias). Viene por entorno (lo genera deploy.sh y NO
// está en el repo ni en la app). Si no está seteado, los endpoints admin quedan cerrados.
const ADMIN_SECRET = process.env.DELPA_ADMIN_SECRET || ''
// Email por HTTP vía Resend (DigitalOcean bloquea los puertos SMTP permanentemente).
// La API key viene por entorno (la setea deploy.sh / PM2, NO está en el repo).
const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
const RESEND_FROM = process.env.RESEND_FROM || 'DELPA Alertas <alertas@delpagestion.com.ar>'
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
  CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT );
  CREATE TABLE IF NOT EXISTS email_alerts_sent ( slug TEXT, trigger_type TEXT, fecha TEXT, PRIMARY KEY (slug, trigger_type, fecha) );
  CREATE TABLE IF NOT EXISTS portal_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT, networkCode TEXT,
    ventasHoy REAL DEFAULT 0, cajaHoy REAL DEFAULT 0, stockTotal INTEGER DEFAULT 0,
    timestamp TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_hist_slug ON portal_history (slug, timestamp);
  CREATE TABLE IF NOT EXISTS licenses (
    hwid TEXT PRIMARY KEY,
    businessName TEXT,
    plan TEXT,
    activatedAt TEXT,
    expiresAt TEXT,
    active INTEGER DEFAULT 0,
    updatedAt TEXT
  );
`)
// Migración: columnas de alertas en nodes (idempotente).
for (const col of ['alertEmail TEXT', 'ventaThreshold REAL', 'alertsJson TEXT', 'ventaMaxHoy REAL', 'prevStockJson TEXT', 'mediosPagoJson TEXT']) {
  try { db.exec('ALTER TABLE nodes ADD COLUMN ' + col) } catch {}
}

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

  const existing = db.prepare('SELECT * FROM nodes WHERE hwid=?').get(b.hwid)
  const slug = existing?.slug || uniqueSlug(slugify(b.businessName), b.hwid)

  // PIN: si el ping trae uno y cambió (o no había), se re-hashea; si no, se conserva.
  let pinHash = existing?.pinHash || null
  if (b.pin != null && String(b.pin).length) {
    if (!pinHash || !verifyPin(b.pin, pinHash)) pinHash = hashPin(b.pin)
  }
  if (!pinHash) pinHash = hashPin('1234')

  // Un ping MÍNIMO (p. ej. el de registro de licencia) NO trae stock/ventas/caja: en ese
  // caso conservamos lo que ya había para no pisar los datos del portal.
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k)
  const row = {
    hwid: String(b.hwid), slug,
    businessName: has('businessName') && String(b.businessName || '') ? String(b.businessName) : (existing?.businessName || ''),
    cuit: has('cuit') ? String(b.cuit || '') : (existing?.cuit || ''),
    networkCode: has('networkCode') ? String(b.networkCode || '') : (existing?.networkCode || ''),
    branchName: has('branchName') ? String(b.branchName || '') : (existing?.branchName || ''),
    pinHash,
    stockJson: has('stockSnapshot') ? JSON.stringify(b.stockSnapshot || []) : (existing?.stockJson || '[]'),
    ventasHoy: has('ventasHoy') ? (Number(b.ventasHoy) || 0) : (Number(existing?.ventasHoy) || 0),
    cajaHoy: has('cajaHoy') ? (Number(b.cajaHoy) || 0) : (Number(existing?.cajaHoy) || 0),
    version: has('version') && String(b.version || '') ? String(b.version) : (existing?.version || ''),
    updatedAt: new Date().toISOString(),
    alertEmail: has('alertEmail') ? String(b.alertEmail || '') : (existing?.alertEmail || ''),
    ventaThreshold: has('ventaThreshold') ? (Number(b.ventaThreshold) || 0) : (Number(existing?.ventaThreshold) || 0),
    alertsJson: has('alerts') ? JSON.stringify(b.alerts || {}) : (existing?.alertsJson || '{}'),
    ventaMaxHoy: has('ventaMaxHoy') ? (Number(b.ventaMaxHoy) || 0) : (Number(existing?.ventaMaxHoy) || 0),
  }
  db.prepare(`
    INSERT INTO nodes (hwid,slug,businessName,cuit,networkCode,branchName,pinHash,stockJson,ventasHoy,cajaHoy,version,updatedAt,alertEmail,ventaThreshold,alertsJson,ventaMaxHoy)
    VALUES (@hwid,@slug,@businessName,@cuit,@networkCode,@branchName,@pinHash,@stockJson,@ventasHoy,@cajaHoy,@version,@updatedAt,@alertEmail,@ventaThreshold,@alertsJson,@ventaMaxHoy)
    ON CONFLICT(hwid) DO UPDATE SET
      slug=@slug, businessName=@businessName, cuit=@cuit, networkCode=@networkCode, branchName=@branchName,
      pinHash=@pinHash, stockJson=@stockJson, ventasHoy=@ventasHoy, cajaHoy=@cajaHoy, version=@version, updatedAt=@updatedAt,
      alertEmail=@alertEmail, ventaThreshold=@ventaThreshold, alertsJson=@alertsJson, ventaMaxHoy=@ventaMaxHoy
  `).run(row)

  // FIX 2 (v1.54.1): si el cliente no tiene licencia en el VPS pero su ping trae una
  // licencia local con fecha futura, la importamos como activa (no pisa si ya hay una).
  try {
    if (b.licenseExpires) {
      const exp = new Date(b.licenseExpires)
      if (!isNaN(exp.getTime()) && exp.getTime() > Date.now()) {
        const hasLic = db.prepare('SELECT 1 FROM licenses WHERE hwid=?').get(String(b.hwid))
        if (!hasLic) {
          db.prepare('INSERT INTO licenses (hwid,businessName,plan,activatedAt,expiresAt,active,updatedAt) VALUES (?,?,?,?,?,1,?)')
            .run(String(b.hwid), row.businessName, String(b.licensePlan || ''), new Date().toISOString(), exp.toISOString(), new Date().toISOString())
          console.log('[license-import] importada licencia local de ' + String(b.hwid).slice(0, 8) + ' vence ' + exp.toISOString().slice(0, 10))
        }
      }
    }
  } catch (e) { console.error('[license-import] ' + e.message) }

  // Histórico para los gráficos de evolución. Solo guardamos si algún valor cambió
  // respecto al último registro del día (para no llenar la tabla). Un ping mínimo de
  // licencia (sin ventas/stock) no genera histórico.
  if (has('ventasHoy') || has('stockSnapshot')) try {
    const ventasHoy = Number(b.ventasHoy) || 0, cajaHoy = Number(b.cajaHoy) || 0
    let stockTotal = 0
    try { stockTotal = (b.stockSnapshot || []).reduce((s, p) => s + (p.s || []).reduce((a, x) => a + (Number(x[1]) || 0), 0), 0) } catch {}
    const hoy = new Date().toISOString().slice(0, 10)
    const last = db.prepare("SELECT ventasHoy, cajaHoy, stockTotal FROM portal_history WHERE slug=? AND substr(timestamp,1,10)=? ORDER BY id DESC LIMIT 1").get(slug, hoy)
    const changed = !last || Number(last.ventasHoy) !== ventasHoy || Number(last.cajaHoy) !== cajaHoy || Number(last.stockTotal) !== stockTotal
    if (changed) {
      db.prepare('INSERT INTO portal_history (slug,networkCode,ventasHoy,cajaHoy,stockTotal,timestamp) VALUES (?,?,?,?,?,?)')
        .run(slug, String(b.networkCode || ''), ventasHoy, cajaHoy, stockTotal, new Date().toISOString())
    }
  } catch (e) { console.error('[history] ' + e.message) }

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

// Stock COMPLETO de cada nodo de la red (para el tab "Stock por sucursal" del portal).
// Si no hay networkCode, devuelve solo el nodo propio. Auth por PIN (igual que el resto).
app.get('/api/:slug/red/stock', auth, (req, res) => {
  const me = db.prepare('SELECT networkCode FROM nodes WHERE slug=?').get(req.params.slug)
  const code = String((me && me.networkCode) || '').trim()
  const rows = code
    ? db.prepare('SELECT slug, businessName, branchName, stockJson, updatedAt FROM nodes WHERE networkCode=? ORDER BY branchName, businessName').all(code)
    : db.prepare('SELECT slug, businessName, branchName, stockJson, updatedAt FROM nodes WHERE slug=?').all(req.params.slug)
  const now = Date.now()
  const nodes = rows.map(r => {
    let stock = []
    try { stock = JSON.parse(r.stockJson || '[]') } catch {}
    const productos = stock.map(p => ({ n: p.n || '', c: p.c || '', cat: p.cat || '', total: (p.s || []).reduce((a, x) => a + (Number(x[1]) || 0), 0) }))
    const unidades = productos.reduce((a, p) => a + p.total, 0)
    const online = r.updatedAt ? (now - new Date(r.updatedAt).getTime() < 20 * 60 * 1000) : false
    return { slug: r.slug, nombre: r.branchName || r.businessName || 'Local', online, unidades, esYo: r.slug === req.params.slug, productos }
  })
  res.json({ networkCode: code, nodes })
})

// Histórico para los gráficos de evolución (agregado por día). Opcional: comparativo
// por sucursal de la red (7 días). Usa la misma sesión (PIN) que el resto de /api/:slug.
app.get('/api/:slug/historia', auth, (req, res) => {
  const dias = Math.min(90, Math.max(1, Number(req.query.dias) || 30))
  const since = new Date(Date.now() - dias * 86400000).toISOString()
  // ventasHoy/cajaHoy/stockTotal son acumulados del día → tomamos el MAX por fecha.
  const historia = db.prepare(`
    SELECT substr(timestamp,1,10) AS fecha, MAX(ventasHoy) AS ventasHoy, MAX(cajaHoy) AS cajaHoy, MAX(stockTotal) AS stockTotal
    FROM portal_history WHERE slug=? AND timestamp>=? GROUP BY fecha ORDER BY fecha
  `).all(req.params.slug, since)

  let red = []
  const node = db.prepare('SELECT networkCode FROM nodes WHERE slug=?').get(req.params.slug)
  const code = node && String(node.networkCode || '').trim()
  if (code) {
    const since7 = new Date(Date.now() - 7 * 86400000).toISOString()
    const rows = db.prepare(`
      SELECT slug, substr(timestamp,1,10) AS fecha, MAX(ventasHoy) AS ventasHoy
      FROM portal_history WHERE networkCode=? AND timestamp>=? GROUP BY slug, fecha ORDER BY fecha
    `).all(code, since7)
    const names = {}
    for (const n of db.prepare('SELECT slug, branchName, businessName FROM nodes WHERE networkCode=?').all(code)) names[n.slug] = n.branchName || n.businessName || n.slug
    const bySlug = {}
    for (const r of rows) { (bySlug[r.slug] = bySlug[r.slug] || []).push({ fecha: r.fecha, ventasHoy: r.ventasHoy }) }
    red = Object.keys(bySlug).map(s => ({ nombre: names[s] || s, ventas: bySlug[s] }))
  }
  res.json({ historia, red })
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

// ── Alertas por email (v1.52.0) ─────────────────────────────────────────────────
function getS(key) { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key); return r ? r.value : '' }
function setS(key, val) { db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(key, String(val)) }

// Configurar el remitente (from) del email. La API key de Resend va por entorno, no acá.
// Se mantienen las claves smtp_* por compatibilidad; sólo 'from' se usa hoy.
app.post('/admin/smtp', secretAuth, (req, res) => {
  const b = req.body || {}
  for (const k of ['host', 'port', 'user', 'pass', 'from']) if (b[k] !== undefined) setS('smtp_' + k, b[k])
  res.json({ ok: true })
})

// Enviar un email de prueba por Resend (verifica el pipeline completo del server).
app.post('/admin/test-email', secretAuth, async (req, res) => {
  const b = req.body || {}
  const to = b.to || getS('smtp_from') || RESEND_FROM
  const r = await resendSend(to, b.subject || '[DELPA] Prueba de email', b.text || 'Email de prueba desde el portal DELPA (Resend).')
  res.status(r.ok ? 200 : 502).json(r)
})

// ── POST /evento — alerta puntual en TIEMPO REAL (v3.0.0) ────────────────────────
// La app manda un evento concreto y el servidor dispara el email al instante al
// alertEmail del negocio. Body: { slug, tipo, datos }.
//   tipo: 'anulacion' | 'cierre_caja' | 'stock_bajo' | 'ingreso_stock'
// (money() está definido más abajo, en la sección de alertas — hoisting.)
app.post('/evento', secretAuth, async (req, res) => {
  const b = req.body || {}
  const slug = String(b.slug || '').trim()
  const tipo = String(b.tipo || '').trim()
  const d = b.datos || {}
  if (!slug || !tipo) return res.status(400).json({ error: 'slug y tipo requeridos' })
  const node = db.prepare('SELECT slug, businessName, branchName, alertEmail FROM nodes WHERE slug=?').get(slug)
  if (!node) return res.status(404).json({ error: 'nodo no encontrado' })
  if (!node.alertEmail) return res.json({ ok: false, skipped: true, error: 'el negocio no tiene email de alertas' })
  const nombre = node.branchName || node.businessName || 'tu local'
  let subject = '', text = ''
  switch (tipo) {
    case 'anulacion':
      subject = '⚠️ Anulación de venta — ' + nombre
      text = 'Se anuló una venta en ' + nombre + '.\n\n' +
             'Venta #' + (d.numero || '?') + '\n' +
             'Total: ' + money(d.total) + '\n' +
             'Motivo: ' + (d.motivo ? d.motivo : '(sin especificar)')
      break
    case 'cierre_caja':
      subject = '🔴 Diferencia de caja — ' + nombre
      text = 'El cierre de caja de ' + nombre + ' cerró con diferencia.\n\n' +
             'Esperado: ' + money(d.esperado) + '\n' +
             'Declarado: ' + money(d.declarado) + '\n' +
             'Diferencia: ' + money(d.diferencia)
      break
    case 'stock_bajo':
      subject = '📦 Stock bajo — ' + nombre
      text = 'Un producto quedó en stock bajo en ' + nombre + '.\n\n' +
             'Producto: ' + (d.nombre || '?') + (d.talle ? ' — talle ' + d.talle : '') + '\n' +
             'Stock actual: ' + (d.stock != null ? d.stock : '?') + ' unidades\n' +
             'Mínimo configurado: ' + (d.min_stock != null ? d.min_stock : '?')
      break
    case 'ingreso_stock':
      subject = '📥 Ingreso de mercadería — ' + nombre
      text = 'Se registró un ingreso de mercadería en ' + nombre + '.\n\n' +
             (d.productos != null ? d.productos : '?') + ' productos ingresados\n' +
             (d.unidades != null ? d.unidades : '?') + ' unidades en total'
      break
    default:
      return res.status(400).json({ error: 'tipo desconocido: ' + tipo })
  }
  const r = await resendSend(node.alertEmail, subject, text)
  if (r.ok) console.log('[evento] ' + tipo + ' -> ' + node.alertEmail + ' (resend id ' + (r.id || '?') + ')')
  else console.error('[evento] ' + tipo + ' FALLO: ' + (r.error || 'desconocido'))
  res.status(r.ok ? 200 : 502).json(r)
})

// Envía un email por la API HTTP de Resend. Devuelve {ok, id?, status?, error?}.
async function resendSend(to, subject, text) {
  if (!RESEND_API_KEY) return { ok: false, error: 'RESEND_API_KEY no configurada' }
  const from = getS('smtp_from') || RESEND_FROM
  // alertEmail puede traer varios destinatarios separados por coma o punto y coma.
  // Resend espera un array de emails válidos → partir, limpiar y filtrar vacíos.
  const toArr = String(to || '').split(/[,;]/).map(s => s.trim()).filter(Boolean)
  if (!toArr.length) return { ok: false, error: 'destinatario vacío' }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: toArr, subject, text })
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, status: r.status, error: (data && (data.message || data.name)) || ('HTTP ' + r.status) }
    return { ok: true, id: data && data.id }
  } catch (e) { return { ok: false, error: e.message } }
}
function argHour() { try { return Number(new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', hour12: false })) } catch { return new Date().getHours() } }
function today() { return new Date().toISOString().slice(0, 10) }
function alreadySent(slug, trig) { return !!db.prepare("SELECT 1 FROM email_alerts_sent WHERE slug=? AND trigger_type=? AND fecha=?").get(slug, trig, today()) }
function markSent(slug, trig) { try { db.prepare('INSERT OR IGNORE INTO email_alerts_sent (slug,trigger_type,fecha) VALUES (?,?,?)').run(slug, trig, today()) } catch {} }
function money(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-AR') }

async function sendAlert(node, trig, subject, text) {
  if (!node.alertEmail) return
  if (alreadySent(node.slug, trig)) return
  if (!RESEND_API_KEY) return // Resend sin configurar → no se manda nada
  const r = await resendSend(node.alertEmail, '[DELPA] ' + subject, text)
  if (r.ok) {
    markSent(node.slug, trig)
    console.log('[alerts] enviado ' + trig + ' -> ' + node.alertEmail + ' (resend id ' + (r.id || '?') + ')')
  } else {
    console.error('[alerts] error enviando ' + trig + ': ' + (r.error || 'desconocido'))
  }
}
function alertsOn(node) { try { return JSON.parse(node.alertsJson || '{}') } catch { return {} } }

async function runAlerts() {
  try {
    const nodes = db.prepare("SELECT * FROM nodes WHERE alertEmail IS NOT NULL AND alertEmail<>''").all()
    const now = Date.now()
    for (const n of nodes) {
      const on = alertsOn(n)
      const nombre = n.branchName || n.businessName || 'tu local'
      // 1. Local offline > 2hs
      if (on.offline !== false && n.updatedAt && (now - new Date(n.updatedAt).getTime()) > 2 * 60 * 60 * 1000) {
        await sendAlert(n, 'offline', 'Local sin conexión', nombre + ' no reporta datos hace más de 2 horas. Revisá que la PC esté encendida y con internet.')
      }
      // 2. Stock a 0 (diff contra el snapshot anterior)
      if (on.stock0 !== false) {
        let prev = [], cur = []
        try { prev = JSON.parse(n.prevStockJson || '[]') } catch {}
        try { cur = JSON.parse(n.stockJson || '[]') } catch {}
        if (prev.length) {
          const curKeys = new Set(cur.map(p => (p.b || p.n || '')))
          const zeroed = prev.filter(p => !curKeys.has(p.b || p.n || '')).map(p => p.n).filter(Boolean)
          if (zeroed.length) await sendAlert(n, 'stock0', 'Productos sin stock', 'Estos productos llegaron a 0 unidades en ' + nombre + ': ' + zeroed.slice(0, 30).join(', ') + (zeroed.length > 30 ? '…' : ''))
        }
        try { db.prepare('UPDATE nodes SET prevStockJson=? WHERE hwid=?').run(n.stockJson || '[]', n.hwid) } catch {}
      }
      // 3. Venta grande (la mayor venta del día supera el umbral)
      if (on.ventaGrande !== false) {
        const thr = Number(n.ventaThreshold) || 50000
        if (Number(n.ventaMaxHoy) > thr) await sendAlert(n, 'venta_grande', 'Venta grande', 'Se registró una venta de ' + money(n.ventaMaxHoy) + ' en ' + nombre + '.')
      }
      // 4. Caja cerrada (cajaHoy>0 y después de las 20hs de Argentina)
      if (on.cajaCerrada !== false && Number(n.cajaHoy) > 0 && argHour() >= 20) {
        await sendAlert(n, 'caja_cerrada', 'Resumen del día', 'Cierre del día en ' + nombre + ': ventas ' + money(n.ventasHoy) + ', caja ' + money(n.cajaHoy) + '.')
      }
    }
  } catch (e) { console.error('[alerts] runAlerts: ' + e.message) }
}
setInterval(runAlerts, 30 * 60 * 1000)
setTimeout(runAlerts, 60 * 1000)

// ── Licencias (v1.54.0) ──────────────────────────────────────────────────────────
// CORS para que el panel admin (GitHub Pages, otro origen) pueda llamar estos endpoints.
// La auth es por el header X-Delpa-Admin (no por cookies), así que Allow-Origin * es seguro.
app.use('/license', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Delpa-Admin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})
function adminAuth(req, res, next) {
  if (!ADMIN_SECRET) return res.status(503).json({ error: 'Panel admin no configurado en el servidor.' })
  if ((req.headers['x-delpa-admin'] || '') !== ADMIN_SECRET) return res.status(401).json({ error: 'No autorizado' })
  next()
}
const PLAN_MONTHS = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 }
const PLAN_NAME = { '1m': 'mensual', '3m': 'trimestral', '6m': 'semestral', '1y': 'anual' }
function daysLeft(expiresAt) { if (!expiresAt) return 0; return Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000) }

// Admin: lista de clientes (va ANTES de /license/:hwid para no chocar la ruta).
app.get('/license/list', adminAuth, (_req, res) => {
  const rows = db.prepare('SELECT hwid,businessName,plan,expiresAt,active FROM licenses').all()
  const pingBy = {}
  for (const n of db.prepare('SELECT hwid,updatedAt FROM nodes').all()) pingBy[n.hwid] = n.updatedAt
  const clients = rows.map(r => {
    const dl = daysLeft(r.expiresAt)
    return { hwid: r.hwid, businessName: r.businessName || '', plan: PLAN_NAME[r.plan] || r.plan || '', expiresAt: r.expiresAt || null, active: !!r.active && dl >= 0, daysLeft: dl, lastPing: pingBy[r.hwid] || null }
  })
  clients.sort((a, b) => a.daysLeft - b.daysLeft)
  res.json({ clients })
})

// Admin: activar o extender una licencia.
app.post('/license/activate', adminAuth, (req, res) => {
  const b = req.body || {}
  const hwid = String(b.hwid || '').trim()
  if (!hwid) return res.status(400).json({ error: 'hwid requerido' })
  const months = PLAN_MONTHS[b.plan]
  if (!months) return res.status(400).json({ error: 'plan inválido (1m|3m|6m|1y)' })
  // Extiende desde hoy, o desde el vencimiento futuro si la licencia sigue vigente.
  const existing = db.prepare('SELECT expiresAt,active FROM licenses WHERE hwid=?').get(hwid)
  let base = Date.now()
  if (existing && existing.active && existing.expiresAt && new Date(existing.expiresAt).getTime() > base) base = new Date(existing.expiresAt).getTime()
  const exp = new Date(base); exp.setMonth(exp.getMonth() + months)
  const expiresAt = exp.toISOString()
  let businessName = String(b.businessName || '').trim()
  if (!businessName) { const n = db.prepare('SELECT businessName FROM nodes WHERE hwid=?').get(hwid); businessName = (n && n.businessName) || '' }
  db.prepare(`INSERT INTO licenses (hwid,businessName,plan,activatedAt,expiresAt,active,updatedAt)
    VALUES (?,?,?,?,?,1,?)
    ON CONFLICT(hwid) DO UPDATE SET businessName=excluded.businessName, plan=excluded.plan, expiresAt=excluded.expiresAt, active=1, updatedAt=excluded.updatedAt`)
    .run(hwid, businessName, String(b.plan), new Date().toISOString(), expiresAt, new Date().toISOString())
  res.json({ ok: true, expiresAt })
})

// Admin: desactivar inmediatamente.
app.post('/license/deactivate', adminAuth, (req, res) => {
  const hwid = String((req.body && req.body.hwid) || '').trim()
  if (!hwid) return res.status(400).json({ error: 'hwid requerido' })
  db.prepare('UPDATE licenses SET active=0, updatedAt=? WHERE hwid=?').run(new Date().toISOString(), hwid)
  res.json({ ok: true })
})

// CORS para el panel admin (GitHub Pages) sobre /admin/*. Auth por header (no cookies).
app.use('/admin', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Delpa-Admin, X-Delpa-Secret')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// Admin: registrar un nodo manualmente (antes de que la app haga su primer ping).
// Crea la fila en nodes y, si viene vencimiento, también la licencia (para que aparezca
// en el panel). No pisa datos de un nodo que ya existe.
app.post('/admin/node', adminAuth, (req, res) => {
  const b = req.body || {}
  const hwid = String(b.hwid || '').trim()
  if (!hwid) return res.status(400).json({ error: 'hwid requerido' })
  const businessName = String(b.businessName || '').trim()
  const branchName = String(b.branchName || '').trim()
  const cuit = String(b.cuit || '').trim()
  // Slug: reusar el del nodo si ya existe; si no, slugify(negocio) + 4 chars random.
  const existing = db.prepare('SELECT slug FROM nodes WHERE hwid=?').get(hwid)
  let slug = existing && existing.slug
  if (!slug) slug = (slugify(businessName) || 'local') + '-' + Math.random().toString(36).slice(2, 6)
  db.prepare('INSERT OR IGNORE INTO nodes (hwid, slug, businessName, branchName, cuit, pinHash) VALUES (?,?,?,?,?,?)')
    .run(hwid, slug, businessName, branchName, cuit, hashPin('1234'))
  // Completar nombre/sucursal/cuit si estaban vacíos (sin pisar datos reales ya reportados).
  db.prepare("UPDATE nodes SET businessName=COALESCE(NULLIF(businessName,''),?), branchName=COALESCE(NULLIF(branchName,''),?), cuit=COALESCE(NULLIF(cuit,''),?) WHERE hwid=?")
    .run(businessName, branchName, cuit, hwid)
  // Si vino vencimiento, crear/actualizar la licencia para que el nodo figure en el panel.
  const licExp = String(b.licenseExpires || '').trim()
  if (licExp) {
    let expIso = licExp
    const d = new Date(licExp.length === 10 ? licExp + 'T23:59:59' : licExp)
    if (!isNaN(d.getTime())) expIso = d.toISOString()
    db.prepare(`INSERT INTO licenses (hwid,businessName,plan,activatedAt,expiresAt,active,updatedAt)
      VALUES (?,?,?,?,?,1,?)
      ON CONFLICT(hwid) DO UPDATE SET businessName=excluded.businessName, plan=excluded.plan, expiresAt=excluded.expiresAt, active=1, updatedAt=excluded.updatedAt`)
      .run(hwid, businessName, String(b.licensePlan || 'trial'), new Date().toISOString(), expIso, new Date().toISOString())
  }
  res.json({ ok: true, slug, hwid })
})

// Público: la app consulta su propia licencia por hwid (sin auth).
app.get('/license/:hwid', (req, res) => {
  const lic = db.prepare('SELECT businessName,plan,expiresAt,active FROM licenses WHERE hwid=?').get(String(req.params.hwid))
  if (!lic) return res.json({ active: false, registered: false })
  const dl = daysLeft(lic.expiresAt)
  res.json({ active: !!lic.active && dl >= 0, registered: true, plan: PLAN_NAME[lic.plan] || lic.plan || '', expiresAt: lic.expiresAt || null, daysLeft: dl, businessName: lic.businessName || '' })
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
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root{--bg:#0f0f0f;--card:#17171a;--bd:#262629;--tx:#e8e8ea;--mut:#8a8a94;--acc:#22c55e;--rd:#ef4444;--am:#f59e0b}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.5 Inter,system-ui,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{max-width:880px;margin:0 auto;padding:16px}
  .card{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:16px;margin-bottom:14px}
  h1{font-size:18px;margin:0 0 2px} h2{font-size:12px;color:var(--mut);margin:0 0 12px;text-transform:uppercase;letter-spacing:.05em;font-weight:600}
  input{width:100%;background:#0b0b0d;border:1px solid var(--bd);border-radius:10px;color:var(--tx);padding:12px;font-size:16px;font-family:inherit}
  button{background:var(--acc);border:0;color:#05140b;border-radius:10px;padding:12px 16px;font-size:15px;font-weight:600;cursor:pointer;width:100%;font-family:inherit}
  button.sec{background:#222228;color:var(--tx)}
  .logo{display:inline-flex;align-items:center;gap:9px;font-weight:700;font-size:20px;letter-spacing:.01em}
  .logo .dot{width:11px;height:11px;border-radius:3px;background:var(--acc);box-shadow:0 0 12px rgba(34,197,94,.6)}
  .tabs{display:flex;gap:6px;margin-bottom:14px}
  .tabs button{flex:1;min-width:0;padding:10px 6px;background:#141417;border:1px solid var(--bd);color:var(--mut);font-weight:500;font-size:14px}
  .tabs button.on{background:var(--acc);color:#05140b;border-color:var(--acc)}
  .kpis{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:4px}
  .kpis .b{flex:1;min-width:150px;background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:14px}
  .kpis .ic{font-size:17px;line-height:1} .kpis .n{font-size:21px;font-weight:700;margin-top:7px} .kpis .l{color:var(--mut);font-size:12px;margin-top:3px}
  .row{display:flex;justify-content:space-between;gap:8px;padding:9px 0;border-bottom:1px solid var(--bd);font-size:14px}
  .row:last-child{border:0} .mut{color:var(--mut)} .neg{color:var(--rd)} .r{text-align:right}
  .tb{width:100%;border-collapse:collapse;font-size:14px}
  .tb th{text-align:left;color:var(--mut);font-weight:500;font-size:11px;text-transform:uppercase;letter-spacing:.03em;padding:8px;border-bottom:1px solid var(--bd);white-space:nowrap}
  .tb td{padding:10px 8px;border-bottom:1px solid var(--bd)}
  .tb tr:last-child td{border-bottom:0}
  .tb tr.me td{background:rgba(34,197,94,.08)}
  .bd{display:inline-block;font-size:11px;padding:1px 8px;border-radius:999px;font-weight:600;white-space:nowrap}
  .bd.rd{background:rgba(239,68,68,.16);color:#fca5a5} .bd.am{background:rgba(245,158,11,.16);color:#fcd34d}
  .bd.ok{background:rgba(34,197,94,.16);color:#86efac} .bd.of{background:#26262c;color:var(--mut)}
  .dotg{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:middle;background:var(--acc)}
  .dotx{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:middle;background:#555}
  .br{border:1px solid var(--bd);border-radius:12px;margin-bottom:8px;overflow:hidden}
  .brh{display:flex;justify-content:space-between;align-items:center;background:#131316;color:var(--tx);font-weight:500;text-align:left;border-radius:0}
  .brb{padding:2px 14px 10px}
  .tfoot{display:flex;justify-content:space-between;padding-top:12px;margin-top:4px;border-top:1px solid var(--bd);font-weight:600}
  .err{color:var(--rd);font-size:13px;margin-top:8px;min-height:18px}
  .hide{display:none}
  canvas{max-width:100%}
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script></head>
<body><div class="wrap">
  <div id="login" class="card" style="max-width:380px;margin:48px auto">
    <div class="logo" style="margin-bottom:16px"><span class="dot"></span> DELPA</div>
    <p class="mut" style="margin:0 0 14px">Ingresá el PIN para ver tu negocio.</p>
    <input id="pin" type="password" inputmode="numeric" placeholder="PIN" autocomplete="off">
    <div class="err" id="loginErr"></div>
    <button id="btnLogin" style="margin-top:8px">Entrar</button>
  </div>
  <div id="app" class="hide">
    <div class="card" style="display:flex;justify-content:space-between;align-items:center">
      <div><div class="logo" style="font-size:16px"><span class="dot"></span> ${biz}</div><span class="mut" style="font-size:12px">Portal · solo lectura</span></div>
      <button class="sec" style="width:auto;padding:8px 12px" id="btnOut">Salir</button>
    </div>
    <div class="tabs">
      <button data-t="hoy" class="on">Hoy</button>
      <button data-t="stock">Stock</button>
      <button data-t="red">Red</button>
      <button data-t="historia">Historia</button>
    </div>
    <div id="view"></div>
  </div>
</div>
<script>
  var SLUG=${JSON.stringify(slug)}, token='';
  var fmt=new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0});
  function money(n){return fmt.format(Number(n)||0)}
  function esc(s){return String(s==null?'':s).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}
  function api(p){return fetch('/api/'+SLUG+p,{headers:{Authorization:'Bearer '+token}}).then(function(r){if(!r.ok)throw 0;return r.json()})}
  function ago(ts){ if(!ts) return '—'; var m=Math.floor((Date.now()-new Date(ts).getTime())/60000); if(m<1)return 'recién'; if(m<60)return 'hace '+m+' min'; var h=Math.floor(m/60); if(h<24)return 'hace '+h+' h'; return 'hace '+Math.floor(h/24)+' d'; }
  var charts=[];
  function clearCharts(){ charts.forEach(function(c){try{c.destroy()}catch(e){}}); charts=[]; }
  function mkChart(id,type,labels,datasets,pesos){
    var el=document.getElementById(id); if(!el||typeof Chart==='undefined') return;
    var yTicks={color:'#8a8a94'}; if(pesos){ yTicks.callback=function(v){return money(v)}; }
    charts.push(new Chart(el,{type:type,data:{labels:labels,datasets:datasets},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#8a8a94'},grid:{color:'#1f1f27'}},y:{beginAtZero:true,ticks:yTicks,grid:{color:'#1f1f27'}}}}}));
  }
  // ── Login ──
  document.getElementById('btnLogin').onclick=login;
  document.getElementById('pin').addEventListener('keydown',function(e){if(e.key==='Enter')login()});
  function login(){
    var pin=document.getElementById('pin').value; document.getElementById('loginErr').textContent='';
    fetch('/api/'+SLUG+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:pin})})
      .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})})
      .then(function(x){ if(!x.ok){document.getElementById('loginErr').textContent=x.j.error||'Error';return}
        token=x.j.token; document.getElementById('login').classList.add('hide'); document.getElementById('app').classList.remove('hide'); show('hoy'); })
      .catch(function(){document.getElementById('loginErr').textContent='No se pudo conectar'});
  }
  document.getElementById('btnOut').onclick=function(){token='';location.reload()};
  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'),function(b){ b.onclick=function(){
    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'),function(x){x.classList.remove('on')}); b.classList.add('on'); show(b.getAttribute('data-t')); }; });
  function fail(){document.getElementById('view').innerHTML='<p class="neg">No se pudo cargar.</p>'}
  function show(t){ clearCharts(); var v=document.getElementById('view'); v.innerHTML='<p class="mut">Cargando…</p>';
    if(t==='hoy') Promise.all([api('/status'),api('/stock')]).then(function(a){renderHoy(a[0],a[1])}).catch(fail);
    if(t==='stock') renderStock();
    if(t==='red') api('/red').then(renderRed).catch(fail);
    if(t==='historia') api('/historia?dias=30').then(renderHistoria).catch(fail); }
  // ── TAB HOY ──
  function kpi(ic,label,val){ return '<div class="b"><div class="ic">'+ic+'</div><div class="n">'+val+'</div><div class="l">'+label+'</div></div>'; }
  function renderHoy(st,stk){
    var conStock=(stk.productos||[]).filter(function(p){return (Number(p.total)||0)>0}).length;
    document.getElementById('view').innerHTML=
      '<div class="kpis">'+
      kpi('💰','Ventas del día',money(st.ventasHoy))+
      kpi('💵','Efectivo en caja',money(st.cajaHoy))+
      kpi('📦','Productos con stock',conStock)+
      kpi('🕐','Última actualización',ago(st.updatedAt))+
      '</div>'+
      '<div class="card"><h2>Ventas — últimos 7 días</h2><div style="height:200px"><canvas id="cV"></canvas></div></div>';
    api('/historia?dias=30').then(function(d){
      var h=(d.historia||[]).slice(-7);
      mkChart('cV','bar',h.map(function(x){return x.fecha.slice(5)}),[{label:'Ventas',data:h.map(function(x){return Number(x.ventasHoy)||0}),backgroundColor:'#22c55e',borderRadius:6}],true);
    }).catch(function(){});
  }
  // ── TAB STOCK ──
  function keyOf(p){ return (p.n||'').toLowerCase()+'|'+(p.c||'').toLowerCase(); }
  function renderStock(){
    document.getElementById('view').innerHTML=
      '<div class="card"><h2>Stock unificado (toda la red)</h2><input id="sq" placeholder="Buscar producto…"><div id="sl" style="margin-top:12px"><p class="mut">Cargando…</p></div></div>'+
      '<div class="card"><h2>Stock por sucursal</h2><div id="bl"><p class="mut">Cargando…</p></div></div>';
    api('/red/stock').then(function(d){
      window.__rs=d.nodes||[]; buildUnified(); buildBranches(window.__rs);
      var inp=document.getElementById('sq'),tmr; inp.addEventListener('input',function(){clearTimeout(tmr);tmr=setTimeout(buildUnified,200)});
    }).catch(function(){document.getElementById('sl').innerHTML='<p class="neg">Error.</p>';document.getElementById('bl').innerHTML='';});
  }
  function buildUnified(){
    var nodes=window.__rs||[]; var q=((document.getElementById('sq')||{}).value||'').toLowerCase().trim();
    var map={};
    nodes.forEach(function(nd){ (nd.productos||[]).forEach(function(p){ var k=keyOf(p); if(!map[k])map[k]={n:p.n,c:p.c,cat:p.cat,total:0}; map[k].total+=Number(p.total)||0; }); });
    var list=Object.keys(map).map(function(k){return map[k]}).filter(function(p){ return !q || (p.n||'').toLowerCase().indexOf(q)>=0 || (p.cat||'').toLowerCase().indexOf(q)>=0; });
    list.sort(function(a,b){return (a.n||'').localeCompare(b.n||'')});
    var rows=list.map(function(p){
      var badge=''; if(p.total===0)badge=' <span class="bd rd">Sin stock</span>'; else if(p.total<=3)badge=' <span class="bd am">Crítico</span>';
      return '<tr><td>'+esc(p.n)+(p.c?' <span class="mut">'+esc(p.c)+'</span>':'')+'</td><td class="mut">'+esc(p.cat||'—')+'</td><td class="r">'+p.total+badge+'</td></tr>';
    }).join('');
    document.getElementById('sl').innerHTML=rows?('<table class="tb"><thead><tr><th>Producto</th><th>Categoría</th><th class="r">Total</th></tr></thead><tbody>'+rows+'</tbody></table>'):'<p class="mut">Sin resultados.</p>';
  }
  function buildBranches(nodes){
    if(!nodes.length){document.getElementById('bl').innerHTML='<p class="mut">Sin sucursales.</p>';return}
    var html=nodes.map(function(nd,i){
      var dot=nd.online?'<span class="dotg"></span>':'<span class="dotx"></span>';
      var prods=(nd.productos||[]).slice().sort(function(a,b){return (Number(b.total)||0)-(Number(a.total)||0)});
      var inner=prods.map(function(p){ return '<div class="row"><span>'+esc(p.n)+(p.c?' <span class="mut">'+esc(p.c)+'</span>':'')+'</span><span'+((Number(p.total)||0)>0?'':' class="neg"')+'>'+p.total+'</span></div>'; }).join('')||'<p class="mut">Sin stock.</p>';
      return '<div class="br"><button class="brh" data-i="'+i+'"><span>'+dot+'<b>'+esc(nd.nombre)+'</b>'+(nd.esYo?' <span class="mut" style="font-size:11px">(este)</span>':'')+'</span><span class="mut">'+nd.unidades+' u. ▾</span></button><div class="brb hide" id="brb'+i+'">'+inner+'</div></div>';
    }).join('');
    document.getElementById('bl').innerHTML=html;
    Array.prototype.forEach.call(document.querySelectorAll('.brh'),function(b){ b.onclick=function(){ document.getElementById('brb'+b.getAttribute('data-i')).classList.toggle('hide'); }; });
  }
  // ── TAB RED ──
  function renderRed(d){
    var ns=d.nodes||[];
    if(!ns.length){document.getElementById('view').innerHTML='<div class="card mut">Todavía no hay locales reportando en tu red.</div>';return}
    var tv=0,tc=0;
    var rows=ns.map(function(n){
      tv+=Number(n.ventasHoy)||0; tc+=Number(n.cajaHoy)||0;
      var badge=n.online?'<span class="bd ok">EN LÍNEA</span>':'<span class="bd of">OFFLINE</span>';
      return '<tr class="'+(n.esYo?'me':'')+'"><td>'+esc(n.nombre)+(n.esYo?' <span class="mut" style="font-size:11px">(vos)</span>':'')+'</td><td>'+badge+'</td><td class="r">'+money(n.ventasHoy)+'</td><td class="r">'+money(n.cajaHoy)+'</td><td class="r">'+(n.unidades||0)+'</td></tr>';
    }).join('');
    document.getElementById('view').innerHTML='<div class="card"><h2>Sucursales de la red</h2><div style="overflow-x:auto"><table class="tb"><thead><tr><th>Sucursal</th><th>Estado</th><th class="r">Ventas hoy</th><th class="r">Efectivo</th><th class="r">Unidades</th></tr></thead><tbody>'+rows+'</tbody></table></div><div class="tfoot"><span>Total de la red ('+ns.length+')</span><span>'+money(tv)+' · '+money(tc)+'</span></div></div>';
  }
  // ── TAB HISTORIA ──
  function renderHistoria(d){
    var h=d.historia||[];
    document.getElementById('view').innerHTML=
      '<div class="card"><h2>Ventas — últimos 30 días</h2><div style="height:220px"><canvas id="cH"></canvas></div></div>'+
      '<div class="card"><h2>Detalle diario</h2><div style="overflow-x:auto"><table class="tb"><thead><tr><th>Fecha</th><th class="r">Ventas</th><th class="r">Caja</th><th class="r">Stock</th></tr></thead><tbody>'+
      (h.slice().reverse().map(function(x){return '<tr><td>'+esc(x.fecha)+'</td><td class="r">'+money(x.ventasHoy)+'</td><td class="r">'+money(x.cajaHoy)+'</td><td class="r">'+(x.stockTotal||0)+'</td></tr>'}).join('')||'<tr><td colspan="4" class="mut">Sin datos todavía.</td></tr>')+
      '</tbody></table></div></div>';
    mkChart('cH','line',h.map(function(x){return x.fecha.slice(5)}),[{label:'Ventas',data:h.map(function(x){return Number(x.ventasHoy)||0}),borderColor:'#22c55e',backgroundColor:'rgba(34,197,94,.15)',tension:.3,fill:true,pointRadius:2}],true);
  }
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
# Secreto de ADMIN del panel de licencias: se genera UNA vez y persiste en el server
# (NO está en el repo ni en la app). Si ya existe, se reusa.
ADMIN_SECRET_FILE="$APP_DIR/.admin_secret"
if [ ! -s "$ADMIN_SECRET_FILE" ]; then
  (openssl rand -hex 24 2>/dev/null || (head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')) > "$ADMIN_SECRET_FILE"
  chmod 600 "$ADMIN_SECRET_FILE"
fi
ADMIN_SECRET="$(cat "$ADMIN_SECRET_FILE")"
# Clave de Resend (email por HTTP; DigitalOcean bloquea SMTP). Persiste en el server.
# Si se pasa RESEND_API_KEY por entorno al correr deploy, se actualiza el archivo.
RESEND_KEY_FILE="$APP_DIR/.resend_key"
if [ -n "${RESEND_API_KEY:-}" ]; then printf '%s' "$RESEND_API_KEY" > "$RESEND_KEY_FILE"; chmod 600 "$RESEND_KEY_FILE"; fi
RESEND_API_KEY="$( [ -s "$RESEND_KEY_FILE" ] && cat "$RESEND_KEY_FILE" || true )"
# PING_SECRET ya está embebido en server.js; igual lo exponemos por env por si se quiere rotar.
pm2 delete delpa-portal >/dev/null 2>&1 || true
DELPA_PING_SECRET="${PING_SECRET}" DELPA_ADMIN_SECRET="${ADMIN_SECRET}" RESEND_API_KEY="${RESEND_API_KEY}" pm2 start server.js --name delpa-portal --update-env
pm2 save
pm2 startup systemd -u root --hp /root | tail -n 1 | bash || true

echo ""
echo "==> LISTO. Portal en: https://${DOMAIN}/portal/<slug>"
echo "    Probar salud:   curl -s https://${DOMAIN}/   (debe responder 'DELPA Portal · OK')"
echo "    Logs:           pm2 logs delpa-portal"
echo ""
echo "    >> SECRETO DE ADMIN (pegalo en el panel admin.html, NO lo compartas):"
echo "       ${ADMIN_SECRET}"
echo "       (guardado en ${ADMIN_SECRET_FILE})"
