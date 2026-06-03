const { ipcMain } = require('electron')
const https = require('https')
const crypto = require('crypto')
const { getDB } = require('../../database/db')

const STORE_EXTERNAL_ID = 'DELPASTORE1'
const POS_EXTERNAL_ID   = 'petalogestion'

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function mpRequest(method, path, body, token, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null
    const req = https.request({
      hostname: 'api.mercadopago.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DELPA-Gestion-PRO/2.1',
        ...extraHeaders,
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        let parsed = {}
        try { if (data) parsed = JSON.parse(data) } catch {}
        console.log(`[MP] ${method} ${path} → ${res.statusCode}`, JSON.stringify(parsed).slice(0, 700))
        resolve({ status: res.statusCode, body: parsed })
      })
    })
    req.on('error', err => { console.error(`[MP] ${method} ${path} ERROR:`, err.message); reject(err) })
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Tiempo de espera agotado')) })
    if (bodyStr) req.write(bodyStr)
    req.end()
  })
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

function getSetting(key) {
  return getDB().prepare('SELECT value FROM settings WHERE key=?').get(key)?.value || ''
}

function setSetting(key, value) {
  getDB().prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run(key, String(value ?? ''))
}

function getToken() { return getSetting('mp_access_token') }

function getPosConfig() {
  return {
    sandbox:          getSetting('mp_sandbox') === '1',
    token:            getSetting('mp_access_token'),
    user_id:          getSetting('mp_user_id'),
    store_id:         getSetting('mp_store_id'),
    store_external_id:getSetting('mp_store_external_id'),
    pos_id:           getSetting('mp_pos_id'),
    external_id:      getSetting('mp_pos_external_id'),
    pos_name:         getSetting('mp_pos_name'),
    qr_data:          getSetting('mp_qr_data'),
    qr_image:         getSetting('mp_qr_image'),
    qr_pdf:           getSetting('mp_qr_pdf'),
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

ipcMain.handle('mp:getConfig', () => {
  const cfg = getPosConfig()
  return { configured: !!cfg.token, ...cfg }
})

ipcMain.handle('mp:saveConfig', (_, { token, sandbox, posExternalId } = {}) => {
  if (token          !== undefined) setSetting('mp_access_token',    token || '')
  if (sandbox        !== undefined) setSetting('mp_sandbox',         sandbox ? '1' : '0')
  if (posExternalId  !== undefined && posExternalId.trim()) setSetting('mp_pos_external_id', posExternalId.trim())
  return { ok: true }
})

ipcMain.handle('mp:testConnection', async (_, { token } = {}) => {
  try {
    const t = token || getToken()
    if (!t) return { ok: false, error: 'No hay Access Token configurado' }
    console.log('[MP] testConnection → GET /users/me')
    const { status, body } = await mpRequest('GET', '/users/me', null, t)
    if (body.id) {
      return { ok: true, email: body.email || '', name: [body.first_name, body.last_name].filter(Boolean).join(' '), id: body.id }
    }
    const err = body.message || body.error || `HTTP ${status}`
    return { ok: false, error: err }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ─── mp:createPos — 3-step setup: user → store → POS ────────────────────────

ipcMain.handle('mp:createPos', async (_, { posName } = {}) => {
  try {
    const token = getToken()
    if (!token) return { ok: false, error: 'Configurá el Access Token primero' }

    // ── PASO 1: Obtener user_id ───────────────────────────────────────────
    console.log('[MP] PASO 1 → GET /users/me')
    const meRes = await mpRequest('GET', '/users/me', null, token)
    if (!meRes.body.id) {
      return { ok: false, error: `No se pudo obtener el usuario MP: ${meRes.body.message || meRes.body.error || 'HTTP ' + meRes.status}` }
    }
    const userId = meRes.body.id
    setSetting('mp_user_id', String(userId))
    console.log('[MP] user_id:', userId)

    // ── PASO 2: Crear sucursal ────────────────────────────────────────────
    const storeName = posName || 'Mi Local'
    const storeBody = {
      name: storeName,
      external_id: STORE_EXTERNAL_ID,
      location: {
        street_number: '0',
        street_name: 'Sin direccion',
        city_name: 'Mar del Plata',
        state_name: 'Buenos Aires',
        latitude: -38.0023,
        longitude: -57.5575,
        reference: 'Local principal',
      },
      business_hours: {
        monday:    [{ open: '09:00', close: '20:00' }],
        tuesday:   [{ open: '09:00', close: '20:00' }],
        wednesday: [{ open: '09:00', close: '20:00' }],
        thursday:  [{ open: '09:00', close: '20:00' }],
        friday:    [{ open: '09:00', close: '20:00' }],
        saturday:  [{ open: '09:00', close: '20:00' }],
      },
    }

    console.log('[MP] PASO 2 → POST /users/' + userId + '/stores')
    const storeRes = await mpRequest('POST', `/users/${userId}/stores`, storeBody, token)
    let storeId

    if (storeRes.body.id) {
      storeId = storeRes.body.id
      console.log('[MP] store creada — id:', storeId)
    } else if (storeRes.status === 409) {
      // Store already exists — fetch and use the first one matching our external_id
      console.log('[MP] PASO 2 → store ya existe (409), buscando con GET /users/' + userId + '/stores')
      const listRes = await mpRequest('GET', `/users/${userId}/stores`, null, token)
      const stores = listRes.body.data || listRes.body.results || listRes.body.stores || []
      const match = stores.find(s => s.external_id === STORE_EXTERNAL_ID) || stores[0]
      if (!match?.id) {
        return { ok: false, error: `Sucursal ya existe pero no se pudo obtener. Respuesta: ${JSON.stringify(listRes.body).slice(0, 200)}` }
      }
      storeId = match.id
      console.log('[MP] store existente encontrada — id:', storeId)
    } else {
      return { ok: false, error: `Error al crear sucursal (HTTP ${storeRes.status}): ${storeRes.body.message || storeRes.body.error || JSON.stringify(storeRes.body).slice(0, 200)}` }
    }

    setSetting('mp_store_id', String(storeId))
    setSetting('mp_store_external_id', STORE_EXTERNAL_ID)

    // ── PASO 3: Crear caja (POS) ──────────────────────────────────────────
    const posBody = {
      name: posName || 'Caja 1',
      fixed_amount: true,
      store_id: storeId,
      external_store_id: STORE_EXTERNAL_ID,
      external_id: POS_EXTERNAL_ID,
      category: 621102,
    }

    console.log('[MP] PASO 3 → POST /pos', JSON.stringify(posBody))
    const posRes = await mpRequest('POST', '/pos', posBody, token)
    let pos

    if (posRes.body.id) {
      pos = posRes.body
      console.log('[MP] POS creado — id:', pos.id)
    } else if (posRes.status === 409) {
      // POS already exists — fetch by external_id
      console.log('[MP] PASO 3 → POS ya existe (409), buscando con GET /pos')
      const listRes = await mpRequest('GET', `/pos?external_id=${POS_EXTERNAL_ID}`, null, token)
      const results = listRes.body.results || listRes.body || []
      const match = Array.isArray(results)
        ? results.find(p => p.external_id === POS_EXTERNAL_ID) || results[0]
        : null
      if (!match?.id) {
        // Try without filter
        const listRes2 = await mpRequest('GET', '/pos', null, token)
        const results2 = listRes2.body.results || []
        const match2 = results2.find(p => p.external_id === POS_EXTERNAL_ID) || results2[0]
        if (!match2?.id) {
          return { ok: false, error: `POS ya existe pero no se pudo obtener. Respuesta: ${JSON.stringify(listRes.body).slice(0, 200)}` }
        }
        pos = match2
      } else {
        pos = match
      }
      console.log('[MP] POS existente encontrado — id:', pos.id)
    } else {
      return { ok: false, error: `Error al crear POS (HTTP ${posRes.status}): ${posRes.body.message || posRes.body.error || JSON.stringify(posRes.body).slice(0, 200)}` }
    }

    const qrImage = pos.qr?.image || ''
    const qrPdf   = pos.qr?.template_document || ''
    const qrData  = pos.qr?.qr_data || pos.qr_data || ''

    setSetting('mp_pos_id',          String(pos.id))
    setSetting('mp_pos_external_id', POS_EXTERNAL_ID)
    setSetting('mp_pos_name',        posName || 'Caja 1')
    setSetting('mp_qr_data',         qrData)
    setSetting('mp_qr_image',        qrImage)
    setSetting('mp_qr_pdf',          qrPdf)

    console.log('[MP] Configuración completa — pos_id:', pos.id, 'qr_image:', qrImage.slice(0, 60), 'qr_pdf:', qrPdf.slice(0, 60))
    return {
      ok: true,
      user_id:    userId,
      store_id:   storeId,
      pos_id:     pos.id,
      external_id: POS_EXTERNAL_ID,
      pos_name:   posName || 'Caja 1',
      qr_image:   qrImage,
      qr_pdf:     qrPdf,
      qr_data:    qrData,
    }
  } catch (e) {
    console.error('[MP] createPos exception:', e.message)
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('mp:getPos', () => getPosConfig())

// ─── mp:createOrder — POST /v1/orders ────────────────────────────────────────

ipcMain.handle('mp:createOrder', async (_, { amount, externalReference }) => {
  try {
    let cfg = getPosConfig()
    if (!cfg.token) return { ok: false, error: 'Access Token no configurado' }

    // Pre-seed: si el external_id está vacío o es el viejo default incorrecto, corregirlo
    const BAD_DEFAULTS = ['', 'DELPACAJA1', 'DELPA1']
    if (BAD_DEFAULTS.includes(cfg.external_id)) {
      setSetting('mp_pos_external_id', POS_EXTERNAL_ID)
      setSetting('mp_pos_id',          '132581975')
      setSetting('mp_user_id',         '3429544372')
      cfg = getPosConfig()
    }

    const posExternalId = cfg.external_id || POS_EXTERNAL_ID
    const tokenEnv = cfg.token.startsWith('TEST-') ? 'SANDBOX' : cfg.token.startsWith('APP_USR-') ? 'PRODUCCIÓN' : 'DESCONOCIDO'

    console.log('=== MP CREATE ORDER ===')
    console.log('token env:       ', tokenEnv)
    console.log('token (primeros 20):', cfg.token.slice(0, 20) + '...')
    console.log('user_id:         ', cfg.user_id || '(no guardado)')
    console.log('pos_id:          ', cfg.pos_id  || '(no guardado)')
    console.log('external_pos_id: ', posExternalId)
    console.log('monto:           ', amount)

    // ── DEBUG: verificar usuario ─────────────────────────────────────────────
    console.log('\n[MP DEBUG] GET /users/me')
    const meRes = await mpRequest('GET', '/users/me', null, cfg.token)
    console.log('[MP DEBUG] /users/me → HTTP', meRes.status)
    console.log('[MP DEBUG] /users/me body:', JSON.stringify(meRes.body, null, 2))

    // ── DEBUG: verificar que el POS existe ───────────────────────────────────
    const posId = cfg.pos_id || '132581975'
    console.log(`\n[MP DEBUG] GET /pos/${posId}`)
    const posRes = await mpRequest('GET', `/pos/${posId}`, null, cfg.token)
    console.log(`[MP DEBUG] /pos/${posId} → HTTP`, posRes.status)
    console.log(`[MP DEBUG] /pos/${posId} body:`, JSON.stringify(posRes.body, null, 2))

    const amountStr = Number(amount).toFixed(2)
    const ref       = externalReference || `DELPA-${Date.now()}`
    const idempotencyKey = crypto.randomUUID()

    const body = {
      type: 'qr',
      total_amount: amountStr,
      description: 'Venta DELPA',
      external_reference: ref,
      expiration_time: 'PT5M',
      config: {
        qr: {
          external_pos_id: posExternalId,
          mode: 'static',
        },
      },
      transactions: {
        payments: [{ amount: amountStr }],
      },
      items: [{
        title: 'Venta en local',
        unit_price: amountStr,
        quantity: 1,
        unit_measure: 'unit',
      }],
    }

    console.log('\n[MP] POST https://api.mercadopago.com/v1/orders')
    console.log('[MP] X-Idempotency-Key:', idempotencyKey)
    console.log('[MP] Body:', JSON.stringify(body, null, 2))

    const res = await mpRequest('POST', '/v1/orders', body, cfg.token, {
      'X-Idempotency-Key': idempotencyKey,
    })

    console.log('\n[MP] POST /v1/orders → HTTP', res.status)
    console.log('[MP] Response completa:', JSON.stringify(res.body, null, 2))
    console.log('=== FIN MP CREATE ORDER ===\n')

    if (res.status === 200 || res.status === 201) {
      const orderId = res.body.id || res.body.order_id
      console.log('[MP] createOrder OK — order_id:', orderId)
      return { ok: true, order_id: String(orderId) }
    }

    const errMsg = res.body?.message || res.body?.error || `HTTP ${res.status}`
    console.error('[MP] createOrder FAILED — HTTP', res.status, '| error:', errMsg)
    return { ok: false, error: `${errMsg} (HTTP ${res.status})` }
  } catch (e) {
    console.error('[MP] createOrder exception:', e.message, e.stack)
    return { ok: false, error: e.message }
  }
})

// ─── mp:pollOrder — PASO 5 (GET /v1/orders/{order_id}) ───────────────────────

ipcMain.handle('mp:pollOrder', async (_, { orderId } = {}) => {
  try {
    if (!orderId) return { ok: false, error: 'Sin order_id para verificar' }
    const token = getToken()
    if (!token) return { ok: false, error: 'Token no configurado' }

    const path = `/v1/orders/${orderId}`
    const res = await mpRequest('GET', path, null, token)

    if (res.status === 404) return { ok: true, paid: false }

    const order = res.body
    const paymentStatus = order.transactions?.payments?.[0]?.status
    console.log('[MP] pollOrder order_id:', orderId, 'status:', order.status, 'payment status:', paymentStatus)

    // Terminal failure states
    if (order.status === 'expired')  return { ok: true, paid: false, expired: true }
    if (order.status === 'canceled') return { ok: true, paid: false, canceled: true }

    const isPaid = order.status === 'processed' || paymentStatus === 'processed'

    if (isPaid) {
      const payment = order.transactions?.payments?.[0]
      const payerEmail = payment?.payer?.email || payment?.payer_id || ''
      const payerName  = [payment?.payer?.first_name, payment?.payer?.last_name].filter(Boolean).join(' ')
      console.log('[MP] PASO 5 pollOrder → PAGO CONFIRMADO — order:', orderId, 'payer:', payerEmail)
      return {
        ok: true,
        paid: true,
        payment: {
          id: String(orderId),
          amount: payment?.amount ? Number(payment.amount) : Number(order.total_amount) || 0,
          payerEmail,
          payerName,
        },
      }
    }

    return { ok: true, paid: false }
  } catch (e) {
    console.error('[MP] pollOrder exception:', e.message)
    return { ok: false, error: e.message }
  }
})

// ─── mp:cancelOrder — DELETE /v1/orders/{orderId} ────────────────────────────

ipcMain.handle('mp:cancelOrder', async (_, { orderId } = {}) => {
  try {
    if (!orderId) return { ok: false }
    const token = getToken()
    if (!token) return { ok: false }
    console.log('[MP] cancelOrder → DELETE /v1/orders/' + orderId)
    const res = await mpRequest('DELETE', `/v1/orders/${orderId}`, null, token)
    console.log('[MP] cancelOrder response:', res.status)
    return { ok: res.status === 200 || res.status === 204 || res.status === 404 }
  } catch (e) {
    console.error('[MP] cancelOrder exception:', e.message)
    return { ok: false }
  }
})

// ─── Legacy: búsqueda por monto (fallback) ───────────────────────────────────

ipcMain.handle('mp:checkPayment', async (_, { amount, since }) => {
  try {
    const token = getToken()
    if (!token) return { ok: false, error: 'Token no configurado' }
    const beginMs = since ? Math.max(0, new Date(since).getTime() - 30000) : Date.now() - 6 * 60 * 1000
    const beginDate = encodeURIComponent(new Date(beginMs).toISOString())
    const endDate = encodeURIComponent(new Date().toISOString())
    const path = `/v1/payments/search?sort=date_created&criteria=desc&range=date_created&begin_date=${beginDate}&end_date=${endDate}&status=approved&limit=20`
    const res = await mpRequest('GET', path, null, token)
    if (!Array.isArray(res.body.results)) return { ok: false, found: false }
    const match = res.body.results.find(p => Math.abs(Number(p.transaction_amount) - Number(amount)) < 1)
    if (match) {
      return {
        ok: true, found: true,
        payment: {
          id: String(match.id),
          amount: match.transaction_amount,
          payerEmail: match.payer?.email || '',
          payerName: [match.payer?.first_name, match.payer?.last_name].filter(Boolean).join(' '),
        },
      }
    }
    return { ok: true, found: false }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})
