const { ipcMain, shell, BrowserWindow } = require('electron')
const { getDB } = require('../../database/db')
const http = require('http')

const APP_ID = '32496'
const CLIENT_SECRET = 'b0a1667c8fda3404c55bac8abdb3ec51151734175400cc69'
const REDIRECT_PORT = 9876
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/tn-callback`
const AUTH_URL = `https://www.tiendanube.com/apps/${APP_ID}/authorize`
const TOKEN_URL = 'https://www.tiendanube.com/apps/authorize/token'
const API_BASE = 'https://api.tiendanube.com/v1'
const USER_AGENT = `DELPA Gestion PRO (${APP_ID})`

const sleep = ms => new Promise(r => setTimeout(r, ms))
let lastRequestTime = 0

function getSetting(key) {
  return getDB().prepare("SELECT value FROM settings WHERE key=?").get(key)?.value || ''
}
function setSetting(key, value) {
  getDB().prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run(key, value)
}
function sendToRenderer(channel, payload) {
  BrowserWindow.getAllWindows()[0]?.webContents.send(channel, payload)
}

async function tnFetch(endpoint, options = {}) {
  const now = Date.now()
  const elapsed = now - lastRequestTime
  if (elapsed < 550) await sleep(550 - elapsed)
  lastRequestTime = Date.now()

  const token = getSetting('tn_access_token')
  const storeId = getSetting('tn_store_id')
  if (!token || !storeId) throw new Error('No conectado a Tienda Nube')

  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}/${storeId}${endpoint}`
  const res = await fetch(url, {
    ...options,
    headers: {
      Authentication: `bearer ${token}`,
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  if (res.status === 204) return null
  if (!res.ok) {
    let msg = `Error ${res.status}`
    try { const j = await res.json(); msg = j.description || j.message || msg } catch {}
    throw new Error(`Tienda Nube: ${msg}`)
  }
  return res.json()
}

async function tnFetchAll(endpoint) {
  let results = []
  let page = 1
  while (true) {
    const sep = endpoint.includes('?') ? '&' : '?'
    const batch = await tnFetch(`${endpoint}${sep}per_page=200&page=${page}`)
    if (!Array.isArray(batch) || batch.length === 0) break
    results = results.concat(batch)
    if (batch.length < 200) break
    page++
  }
  return results
}

// ─── Connect (OAuth2) ───────────────────────────────────────────────────────

ipcMain.handle('tn:connect', () => {
  return new Promise((resolve, reject) => {
    let server = null
    let timeout = null
    let settled = false

    const cleanup = () => {
      clearTimeout(timeout)
      try { server?.close() } catch {}
    }
    const done = (fn) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }

    server = http.createServer(async (req, res) => {
      // Parse the incoming request path (strips query string)
      const reqPath = req.url.split('?')[0]

      // Ignore anything that isn't our callback (e.g. /favicon.ico)
      if (reqPath !== '/tn-callback') {
        res.writeHead(404)
        res.end()
        return
      }

      // Parse query params from the full URL
      const urlObj = new URL(req.url, 'http://localhost')
      const code = urlObj.searchParams.get('code')

      if (!code) {
        res.writeHead(400)
        res.end('<html><body>Error: no code received.</body></html>')
        done(() => reject(new Error('No code received')))
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<html><body style="font-family:sans-serif;padding:40px;background:#f0f0f0"><h2 style="color:#e91e8c">✓ Conectado a Tienda Nube</h2><p>Podés cerrar esta ventana y volver a la app.</p></body></html>')

      try {
        const r = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: APP_ID, client_secret: CLIENT_SECRET, grant_type: 'authorization_code', code }),
        })
        if (!r.ok) { const t = await r.text(); throw new Error(`Token exchange ${r.status}: ${t}`) }
        const data = await r.json()

        setSetting('tn_access_token', data.access_token || '')
        setSetting('tn_store_id', String(data.user_id || ''))
        setSetting('tn_store_url', data.domain || '')
        setSetting('tn_connected_at', new Date().toISOString())
        setSetting('tn_last_sync', '')

        const status = { connected: true, storeId: data.user_id, domain: data.domain }
        sendToRenderer('tn:status', status)
        done(() => resolve({ ok: true, ...status }))
      } catch (e) {
        done(() => reject(e))
      }
    })

    server.on('error', e => done(() => reject(e)))

    // Start server FIRST, then open browser inside the listen callback
    server.listen(REDIRECT_PORT, 'localhost', () => {
      const authUrl = `${AUTH_URL}?redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
      shell.openExternal(authUrl)
    })

    // 5-minute timeout
    timeout = setTimeout(() => {
      done(() => reject(new Error('Timeout: no se recibió autorización en 5 minutos')))
    }, 300000)
  })
})

// ─── Status ─────────────────────────────────────────────────────────────────

ipcMain.handle('tn:status', async () => {
  const token = getSetting('tn_access_token')
  const storeId = getSetting('tn_store_id')
  if (!token || !storeId) return { connected: false }
  return {
    connected: true,
    storeId,
    domain: getSetting('tn_store_url'),
    connectedAt: getSetting('tn_connected_at'),
    lastSync: getSetting('tn_last_sync'),
  }
})

// ─── Sales today (web orders from TN) ────────────────────────────────────────

ipcMain.handle('tn:salesToday', async () => {
  const token = getSetting('tn_access_token')
  const storeId = getSetting('tn_store_id')
  if (!token || !storeId) return { connected: false, total: 0, count: 0 }
  try {
    // Build today's start in Argentina timezone (UTC-3)
    const now = new Date()
    const arMs = now.getTime() - (now.getTimezoneOffset() + 180) * 60000
    const arDate = new Date(arMs)
    const y = arDate.getUTCFullYear()
    const m = String(arDate.getUTCMonth() + 1).padStart(2, '0')
    const d = String(arDate.getUTCDate()).padStart(2, '0')
    const todayAr = `${y}-${m}-${d}T00:00:00-0300`
    const orders = await tnFetch(`/orders?created_at_min=${encodeURIComponent(todayAr)}&payment_status=paid&per_page=200`)
    const arr = Array.isArray(orders) ? orders : []
    const total = arr.reduce((s, o) => s + parseFloat(o.total || '0'), 0)
    return { connected: true, total, count: arr.length }
  } catch (e) {
    return { connected: true, total: 0, count: 0, error: e.message }
  }
})

// ─── Ventas TN por período (day/week/month) ──────────────────────────────────
ipcMain.handle('tn:salesPeriod', async (_, period = 'day') => {
  const token = getSetting('tn_access_token')
  const storeId = getSetting('tn_store_id')
  if (!token || !storeId) return { connected: false, total: 0, count: 0 }
  try {
    const now = new Date()
    const arMs = now.getTime() - (now.getTimezoneOffset() + 180) * 60000
    const arDate = new Date(arMs)
    const y = arDate.getUTCFullYear()
    const m = String(arDate.getUTCMonth() + 1).padStart(2, '0')
    const d = String(arDate.getUTCDate()).padStart(2, '0')
    let minIso
    if (period === 'month') {
      minIso = `${y}-${m}-01T00:00:00-0300`
    } else if (period === 'week') {
      const wk = new Date(arDate.getTime() - 7 * 86400000)
      minIso = `${wk.getUTCFullYear()}-${String(wk.getUTCMonth() + 1).padStart(2, '0')}-${String(wk.getUTCDate()).padStart(2, '0')}T00:00:00-0300`
    } else {
      minIso = `${y}-${m}-${d}T00:00:00-0300`
    }
    let page = 1, total = 0, count = 0
    while (page <= 20) {
      const orders = await tnFetch(`/orders?created_at_min=${encodeURIComponent(minIso)}&payment_status=paid&per_page=200&page=${page}`)
      const arr = Array.isArray(orders) ? orders : []
      total += arr.reduce((s, o) => s + parseFloat(o.total || '0'), 0)
      count += arr.length
      if (arr.length < 200) break
      page++
    }
    return { connected: true, total, count }
  } catch (e) {
    return { connected: true, total: 0, count: 0, error: e.message }
  }
})

// ─── Disconnect ──────────────────────────────────────────────────────────────

ipcMain.handle('tn:disconnect', () => {
  const db = getDB()
  ;['tn_access_token','tn_store_id','tn_store_url','tn_connected_at','tn_last_sync'].forEach(k =>
    db.prepare("UPDATE settings SET value='' WHERE key=?").run(k)
  )
  db.prepare('DELETE FROM tn_product_map').run()
  db.prepare('DELETE FROM tn_variant_map').run()
  sendToRenderer('tn:status', { connected: false })
  return { ok: true }
})

// ─── Sync products: local → TN ──────────────────────────────────────────────

async function pushProductToTN(db, product) {
  let existing = db.prepare('SELECT tn_product_id FROM tn_product_map WHERE local_product_id=?').get(product.id)
  const rawSizes = db.prepare('SELECT * FROM product_sizes WHERE product_id=?').all(product.id)

  // Deduplicate: trim whitespace + case-insensitive key so "Gray" and "gray " collapse to one
  const seen = new Set()
  const sizes = []
  for (const s of rawSizes) {
    const key = s.size.trim().toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      sizes.push({ ...s, size: s.size.trim() })
    }
  }
  if (sizes.length === 0) return

  console.log(`[TN] pushProductToTN "${product.name}" (id=${product.id}) — ${sizes.length} sizes: [${sizes.map(s => `"${s.size}":${s.stock}`).join(', ')}]`)

  if (existing) {
    // ── Update path ─────────────────────────────────────────────────────────
    await tnFetch(`/products/${existing.tn_product_id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: { es: product.name }, price: String(product.price) }),
    })
    for (const localSize of sizes) {
      const mapped = db.prepare('SELECT tn_variant_id FROM tn_variant_map WHERE local_product_id=? AND size=?')
        .get(product.id, localSize.size)
      if (mapped) {
        await tnFetch(`/products/${existing.tn_product_id}/variants/${mapped.tn_variant_id}`, {
          method: 'PUT',
          body: JSON.stringify({ stock: localSize.stock }),
        })
      }
    }
  } else {
    // ── Create path ──────────────────────────────────────────────────────────
    // Guard: product may already exist on TN from a previous partial sync
    // (local mapping lost). Search by name to recover the mapping instead of
    // creating a duplicate.
    try {
      const found = await tnFetch(`/products?name=${encodeURIComponent(product.name)}&per_page=5`)
      if (Array.isArray(found) && found.length > 0) {
        const match = found.find(p => (p.name?.es || p.name?.['es'] || '').toLowerCase() === product.name.toLowerCase())
        if (match?.id) {
          console.log(`[TN] "${product.name}" already exists on TN (id=${match.id}) — recovering mapping`)
          db.prepare('INSERT OR REPLACE INTO tn_product_map (local_product_id,tn_product_id) VALUES (?,?)').run(product.id, match.id)
          existing = { tn_product_id: match.id }
          // Fall through to update path
          await tnFetch(`/products/${match.id}`, {
            method: 'PUT',
            body: JSON.stringify({ name: { es: product.name }, price: String(product.price) }),
          })
          return
        }
      }
    } catch {}

    // TN API format (v1):
    //   - product-level: attributes = [{es: "Talle"}]   (the attribute names)
    //   - variant-level: values     = [{es: "S"}]        (the attribute values)
    // Sending "attributes" inside each variant is WRONG and causes TN to create
    // all variants with empty values → "Variant values should not be repeated".
    const isSingleNoSize = sizes.length === 1 && sizes[0].size.toUpperCase() === 'N/A'

    let body
    if (isSingleNoSize) {
      // No size attribute needed — TN creates one default variant automatically
      body = {
        name: { es: product.name },
        description: { es: product.brand || '' },
        price: String(product.price),
        published: true,
      }
    } else {
      body = {
        name: { es: product.name },
        description: { es: product.brand || '' },
        price: String(product.price),
        published: true,
        attributes: [{ es: 'Talle' }],
        variants: sizes.map(s => ({
          price: String(product.price),
          stock_management: true,
          stock: s.stock,
          values: [{ es: s.size }],   // ← correct field name
        })),
      }
    }

    console.log(`[TN] POST /products payload: ${JSON.stringify(body)}`)
    const created = await tnFetch('/products', { method: 'POST', body: JSON.stringify(body) })
    if (!created?.id) return
    db.prepare('INSERT OR REPLACE INTO tn_product_map (local_product_id,tn_product_id) VALUES (?,?)').run(product.id, created.id)

    if (Array.isArray(created.variants)) {
      if (isSingleNoSize) {
        const defVar = created.variants[0]
        if (defVar?.id) {
          db.prepare('INSERT OR IGNORE INTO tn_variant_map (local_product_id,size,tn_variant_id,tn_product_id) VALUES (?,?,?,?)')
            .run(product.id, 'N/A', defVar.id, created.id)
          await tnFetch(`/products/${created.id}/variants/${defVar.id}`, {
            method: 'PUT',
            body: JSON.stringify({ stock: sizes[0].stock, stock_management: true }),
          })
        }
      } else {
        // Match returned variants to local sizes by value (not by array index)
        for (const tnVar of created.variants) {
          if (!tnVar.id) continue
          const talleValue = tnVar.values?.[0]?.es ?? ''
          const localSize = sizes.find(s => s.size === talleValue)
          if (localSize) {
            db.prepare('INSERT OR IGNORE INTO tn_variant_map (local_product_id,size,tn_variant_id,tn_product_id) VALUES (?,?,?,?)')
              .run(product.id, localSize.size, tnVar.id, created.id)
          }
        }
      }
    }
  }
}

ipcMain.handle('tn:syncProducts', async () => {
  const db = getDB()
  const localProducts = db.prepare('SELECT * FROM products WHERE active=1 AND COALESCE(tn_sync,1)=1').all()
  let pushed = 0, errors = []
  for (const p of localProducts) {
    try { await pushProductToTN(db, p); pushed++ }
    catch (e) { errors.push(`${p.name}: ${e.message}`) }
  }
  setSetting('tn_last_sync', new Date().toISOString())
  return { ok: true, pushed, errors }
})

// ─── Sync individual product ─────────────────────────────────────────────────

ipcMain.handle('tn:syncProduct', async (_, productId) => {
  const db = getDB()
  try {
    const product = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(productId)
    if (!product) return { ok: false, error: 'Producto no encontrado' }
    await pushProductToTN(db, product)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ─── Sync stock for specific items (called after sale) ──────────────────────

async function syncStockItems(items) {
  const db = getDB()
  for (const item of items) {
    try {
      const mapped = db.prepare('SELECT tn_product_id, tn_variant_id FROM tn_variant_map WHERE local_product_id=? AND size=?')
        .get(item.productId, item.size)
      if (!mapped) continue
      const sizeRow = db.prepare('SELECT stock FROM product_sizes WHERE product_id=? AND size=?').get(item.productId, item.size)
      if (!sizeRow) continue
      await tnFetch(`/products/${mapped.tn_product_id}/variants/${mapped.tn_variant_id}`, {
        method: 'PUT',
        body: JSON.stringify({ stock: sizeRow.stock }),
      })
      db.prepare('UPDATE product_sizes SET tn_last_synced=CURRENT_TIMESTAMP WHERE product_id=? AND size=?')
        .run(item.productId, item.size)
    } catch (e) {
      console.error(`[TN syncStock] Error al sincronizar productId=${item.productId} size="${item.size}":`, e.message)
    }
  }
}

// Exported so sales.js can call it after creating a sale
function syncStockAfterSale(items) {
  const token = getSetting('tn_access_token')
  if (!token) return
  syncStockItems(items).catch(e => console.error('[TN syncStockAfterSale]', e.message))
}

// ─── Orders ─────────────────────────────────────────────────────────────────

ipcMain.handle('tn:getOrders', async (_, { status = 'open', page = 1 } = {}) => {
  try {
    const orders = await tnFetch(`/orders?status=${status}&per_page=50&page=${page}&fields=id,number,status,total,created_at,customer,products`)
    return { ok: true, orders: Array.isArray(orders) ? orders : [] }
  } catch (e) {
    return { ok: false, error: e.message, orders: [] }
  }
})

// ─── Customer sync helpers ───────────────────────────────────────────────────

function upsertClientFromTN(db, customer) {
  if (!customer) return null
  const name  = `${customer.name || ''} ${customer.surname || ''}`.trim() || 'Cliente TN'
  const email = customer.email || ''
  const phone = customer.phone || ''

  if (email) {
    const existing = db.prepare('SELECT id, name, phone FROM clients WHERE email=?').get(email)
    if (existing) {
      // Update empty fields
      if (!existing.phone && phone) db.prepare('UPDATE clients SET phone=? WHERE id=?').run(phone, existing.id)
      if (existing.name === 'Cliente TN' || !existing.name) db.prepare('UPDATE clients SET name=? WHERE id=?').run(name, existing.id)
      return existing.id
    }
  } else {
    // No email — try exact name match
    const existing = db.prepare('SELECT id FROM clients WHERE lower(trim(name))=lower(trim(?)) LIMIT 1').get(name)
    if (existing) return existing.id
  }

  // Create new client
  const { lastInsertRowid } = db.prepare(
    'INSERT INTO clients (name, email, phone, balance, points, active) VALUES (?,?,?,0,0,1)'
  ).run(name, email, phone)
  return lastInsertRowid
}

ipcMain.handle('tn:importCustomer', async (_, tnCustomerId) => {
  const db = getDB()
  try {
    const customer = await tnFetch(`/customers/${tnCustomerId}`)
    const clientId = upsertClientFromTN(db, customer)
    return { ok: true, clientId }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('tn:syncCustomers', async (_, { onProgress } = {}) => {
  const db = getDB()
  try {
    let page = 1, total = 0, created = 0, updated = 0
    while (true) {
      const batch = await tnFetch(`/customers?per_page=200&page=${page}`)
      if (!Array.isArray(batch) || batch.length === 0) break
      for (const c of batch) {
        const name  = `${c.name || ''} ${c.surname || ''}`.trim() || 'Cliente TN'
        const email = c.email || ''
        const phone = c.phone || ''
        if (email) {
          const ex = db.prepare('SELECT id FROM clients WHERE email=?').get(email)
          if (ex) { updated++; if (!ex.phone && phone) db.prepare('UPDATE clients SET phone=? WHERE id=?').run(phone, ex.id) }
          else { db.prepare('INSERT INTO clients (name,email,phone,balance,points,active) VALUES (?,?,?,0,0,1)').run(name, email, phone); created++ }
        } else {
          const ex = db.prepare('SELECT id FROM clients WHERE lower(trim(name))=lower(trim(?)) LIMIT 1').get(name)
          if (!ex) { db.prepare('INSERT INTO clients (name,email,phone,balance,points,active) VALUES (?,?,?,0,0,1)').run(name, email, phone); created++ }
          else updated++
        }
        total++
        if (total % 50 === 0) sendToRenderer('tn:customerSyncProgress', { total, created, updated })
      }
      if (batch.length < 200) break
      page++
    }
    sendToRenderer('tn:customerSyncProgress', { total, created, updated, done: true })
    return { ok: true, total, created, updated }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('tn:importOrder', async (_, tnOrderId) => {
  const db = getDB()
  try {
    const order = await tnFetch(`/orders/${tnOrderId}`)
    const clientName = order.customer ? `${order.customer.name || ''} ${order.customer.surname || ''}`.trim() : 'Cliente TN'
    const clientPhone = order.customer?.phone || ''

    // Auto-create or update client in DELPA
    const clientId = upsertClientFromTN(db, order.customer)
    const itemsJson = (order.products || []).map(p => ({
      name: p.name,
      quantity: p.quantity,
      price: Number(p.price),
      size: p.variant_values?.join(' / ') || 'N/A',
    }))
    const total = Number(order.total) || 0
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO orders (client_name,client_phone,items_json,total,status,notes)
      VALUES (?,?,?,?,'pendiente',?)
    `).run(clientName, clientPhone, JSON.stringify(itemsJson), total, `Importado de Tienda Nube #${order.number}`)
    void clientId // used for auto-create above

    // Deduct stock for each product in the TN order
    const stockSyncItems = []
    const notFound = []
    for (const p of order.products || []) {
      try {
        const pName = String(p.name || '').trim()
        const size  = p.variant_values?.join(' / ') || 'N/A'
        const qty   = Number(p.quantity) || 1
        console.log(`[TN importOrder] Procesando: "${pName}" T.${size} x${qty} SKU="${p.sku || '—'}"`)

        // 1. By exact barcode/SKU
        let localProduct = p.sku
          ? db.prepare('SELECT id, name FROM products WHERE barcode=? AND active=1').get(p.sku)
          : null

        // 2. By exact name (case-insensitive)
        if (!localProduct) {
          localProduct = db.prepare('SELECT id, name FROM products WHERE lower(trim(name))=lower(trim(?)) AND active=1').get(pName)
        }

        // 3. By partial name match (first 40 chars)
        if (!localProduct) {
          const fragment = pName.substring(0, 40)
          localProduct = db.prepare('SELECT id, name FROM products WHERE lower(name) LIKE lower(?) AND active=1 LIMIT 1').get(`%${fragment}%`)
        }

        // 4. By tn_product_map (if previously synced)
        if (!localProduct && p.product_id) {
          const mapped = db.prepare('SELECT local_product_id FROM tn_product_map WHERE tn_product_id=?').get(p.product_id)
          if (mapped) {
            localProduct = db.prepare('SELECT id, name FROM products WHERE id=? AND active=1').get(mapped.local_product_id)
          }
        }

        if (!localProduct) {
          console.log(`[TN importOrder] ❌ No encontrado: "${pName}"`)
          notFound.push(pName)
          continue
        }

        console.log(`[TN importOrder] ✓ Mapeado: "${pName}" → "${localProduct.name}" (id=${localProduct.id}) T.${size}`)

        if (size !== 'N/A') {
          const sizeRow = db.prepare('SELECT stock FROM product_sizes WHERE product_id=? AND size=?').get(localProduct.id, size)
          if (!sizeRow) {
            console.log(`[TN importOrder] Talle ${size} no existe en "${localProduct.name}", se omite descuento`)
          } else {
            console.log(`[TN importOrder] Stock antes: ${sizeRow.stock} → descontando ${qty}`)
            db.prepare('UPDATE product_sizes SET stock=MAX(0,stock-?) WHERE product_id=? AND size=?').run(qty, localProduct.id, size)
            const after = db.prepare('SELECT stock FROM product_sizes WHERE product_id=? AND size=?').get(localProduct.id, size)
            console.log(`[TN importOrder] Stock después: ${after?.stock}`)
            stockSyncItems.push({ productId: localProduct.id, size })
          }
        }
      } catch (e) {
        console.error(`[TN importOrder] Error al procesar "${p.name}":`, e.message)
      }
    }
    // Fire-and-forget TN stock sync for affected items
    if (stockSyncItems.length > 0) syncStockItems(stockSyncItems).catch(() => {})

    return {
      ok: true,
      orderId: lastInsertRowid,
      notFound: notFound.length > 0 ? notFound : undefined,
    }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('tn:syncStock', async () => {
  const db = getDB()
  const totalCount = db.prepare('SELECT COUNT(*) as count FROM tn_variant_map').get()?.count || 0
  const toSync = db.prepare(`
    SELECT vm.local_product_id AS productId, vm.size, vm.tn_product_id, vm.tn_variant_id, ps.stock
    FROM tn_variant_map vm
    JOIN product_sizes ps ON ps.product_id=vm.local_product_id AND ps.size=vm.size
    WHERE ps.stock_modified_at IS NOT NULL
      AND (ps.tn_last_synced IS NULL OR ps.stock_modified_at > ps.tn_last_synced)
  `).all()
  console.log(`[TN syncStock] Sincronizando ${toSync.length} de ${totalCount} variantes modificadas`)
  let synced = 0, errors = []
  for (const m of toSync) {
    try {
      await tnFetch(`/products/${m.tn_product_id}/variants/${m.tn_variant_id}`, {
        method: 'PUT', body: JSON.stringify({ stock: m.stock }),
      })
      db.prepare('UPDATE product_sizes SET tn_last_synced=CURRENT_TIMESTAMP WHERE product_id=? AND size=?')
        .run(m.productId, m.size)
      synced++
    } catch (e) { errors.push(e.message) }
  }
  setSetting('tn_last_sync', new Date().toISOString())
  return { ok: true, synced, total: totalCount, delta: toSync.length, errors }
})

// ─── Pull products TN → local ────────────────────────────────────────────────

async function pullProductsFromTN(db) {
  const tnProducts = await tnFetchAll('/products')
  let imported = 0; const errors = []

  for (const tnProd of tnProducts) {
    try {
      const tnId = tnProd.id
      // Skip already mapped
      if (db.prepare('SELECT id FROM tn_product_map WHERE tn_product_id=?').get(tnId)) continue

      const productName = tnProd.name?.es || tnProd.name?.en || `TN-${tnId}`
      const price = parseFloat(tnProd.price || 0)

      // Try to match by name to an existing local product
      const nameMatch = db.prepare('SELECT id FROM products WHERE lower(trim(name))=lower(trim(?)) AND active=1').get(productName)
      let localId = nameMatch?.id

      if (!localId) {
        // Create new product in DELPA
        const { lastInsertRowid } = db.prepare(
          'INSERT INTO products (name, price, cost, barcode, category, brand, active) VALUES (?,?,0,?,?,?,1)'
        ).run(productName, price, `TN-${tnId}`, tnProd.categories?.[0]?.name?.es || '', '')
        localId = lastInsertRowid
      }

      db.prepare('INSERT OR REPLACE INTO tn_product_map (local_product_id, tn_product_id) VALUES (?,?)').run(localId, tnId)

      // Import variants/sizes
      const variants = await tnFetch(`/products/${tnId}/variants?per_page=200`)
      const varList = Array.isArray(variants) ? variants : []
      for (const v of varList) {
        const size = v.values?.[0]?.es || 'N/A'
        const stock = v.stock != null ? Number(v.stock) : 0
        db.prepare('INSERT OR IGNORE INTO product_sizes (product_id, size, stock, min_stock) VALUES (?,?,?,0)').run(localId, size, stock)
        db.prepare('INSERT OR IGNORE INTO tn_variant_map (local_product_id, size, tn_variant_id, tn_product_id) VALUES (?,?,?,?)').run(localId, size, v.id, tnId)
      }

      imported++
    } catch (e) { errors.push(`TN#${tnProd.id}: ${e.message}`) }
  }
  return { imported, errors }
}

ipcMain.handle('tn:syncAll', async () => {
  const db = getDB()
  const token = getSetting('tn_access_token')
  if (!token) return { ok: false, error: 'No conectado a Tienda Nube' }

  let pushed = 0, stockSynced = 0, imported = 0, errors = []

  // 1. Push local products → TN (only those with tn_sync=1)
  const localProducts = db.prepare('SELECT * FROM products WHERE active=1 AND COALESCE(tn_sync,1)=1').all()
  for (const p of localProducts) {
    try { await pushProductToTN(db, p); pushed++ }
    catch (e) { errors.push(`${p.name}: ${e.message}`) }
  }

  // 2. Pull TN products → local (import new ones)
  try {
    const pulled = await pullProductsFromTN(db)
    imported = pulled.imported
    errors = errors.concat(pulled.errors)
  } catch (e) { errors.push(`Pull: ${e.message}`) }

  // 3. Sync customers TN → local
  let customersSynced = 0
  try {
    let page = 1
    while (true) {
      const batch = await tnFetch(`/customers?per_page=200&page=${page}`)
      if (!Array.isArray(batch) || batch.length === 0) break
      for (const c of batch) { upsertClientFromTN(db, c); customersSynced++ }
      if (batch.length < 200) break
      page++
    }
  } catch (e) { errors.push(`Clientes: ${e.message}`) }

  // 4. Sync stock for all mapped variants
  const maps = db.prepare('SELECT * FROM tn_variant_map').all()
  for (const m of maps) {
    try {
      const s = db.prepare('SELECT stock FROM product_sizes WHERE product_id=? AND size=?').get(m.local_product_id, m.size)
      if (!s) continue
      await tnFetch(`/products/${m.tn_product_id}/variants/${m.tn_variant_id}`, {
        method: 'PUT', body: JSON.stringify({ stock: s.stock }),
      })
      stockSynced++
    } catch (e) { errors.push(e.message) }
  }

  setSetting('tn_last_sync', new Date().toISOString())
  sendToRenderer('tn:status', { connected: true, lastSync: new Date().toISOString() })
  return { ok: true, pushed, imported, stockSynced, errors }
})

// ─── Auto-sync (called from main/index.js every 10 min) — delta only ────────

async function autoSync() {
  const token = getSetting('tn_access_token')
  if (!token) return
  console.log('[TN autoSync] Iniciando sync automática:', new Date().toLocaleString('es-AR'))
  try {
    const db = getDB()
    // Pull new TN orders and notify renderer
    try {
      const orders = await tnFetch('/orders?status=open&per_page=50&fields=id,number,status,total,created_at,customer,products')
      if (Array.isArray(orders)) sendToRenderer('tn:orders', { count: orders.length })
    } catch (e) {
      console.error('[TN autoSync] Error al obtener pedidos:', e.message)
    }

    // Delta stock sync: only variants where stock changed since last TN sync
    const totalCount = db.prepare('SELECT COUNT(*) as count FROM tn_variant_map').get()?.count || 0
    const toSync = db.prepare(`
      SELECT vm.local_product_id AS productId, vm.size, vm.tn_product_id, vm.tn_variant_id, ps.stock
      FROM tn_variant_map vm
      JOIN product_sizes ps ON ps.product_id=vm.local_product_id AND ps.size=vm.size
      WHERE ps.stock_modified_at IS NOT NULL
        AND (ps.tn_last_synced IS NULL OR ps.stock_modified_at > ps.tn_last_synced)
    `).all()
    console.log(`[TN autoSync] Sincronizando ${toSync.length} de ${totalCount} variantes modificadas`)

    for (const m of toSync) {
      try {
        await tnFetch(`/products/${m.tn_product_id}/variants/${m.tn_variant_id}`, {
          method: 'PUT', body: JSON.stringify({ stock: m.stock }),
        })
        db.prepare('UPDATE product_sizes SET tn_last_synced=CURRENT_TIMESTAMP WHERE product_id=? AND size=?')
          .run(m.productId, m.size)
      } catch (e) {
        console.error(`[TN autoSync] Error al sincronizar variant ${m.tn_variant_id} (productId=${m.productId} size="${m.size}"):`, e.message)
      }
    }

    const lastSync = new Date().toISOString()
    setSetting('tn_last_sync', lastSync)
    sendToRenderer('tn:status', {
      connected: true,
      storeId: getSetting('tn_store_id'),
      domain: getSetting('tn_store_url'),
      connectedAt: getSetting('tn_connected_at'),
      lastSync,
    })
    console.log(`[TN autoSync] Completada: ${toSync.length} variantes sincronizadas`)
  } catch (e) {
    console.error('[TN autoSync] Error:', e.message)
  }
}

module.exports = { syncStockAfterSale, autoSync }
