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

// Extrae el mensaje de error más útil de una respuesta de error de MP.
// Los 400 de MP suelen traer un array `cause` con el detalle por campo.
function mpErrorMessage(body) {
  if (!body) return 'Sin respuesta del servidor'
  if (Array.isArray(body.cause) && body.cause.length) {
    const causes = body.cause.map(c => c.description || c.message || JSON.stringify(c)).join(' · ')
    return body.message ? `${body.message} — ${causes}` : causes
  }
  return body.message || body.error || JSON.stringify(body)
}

// Busca una sucursal por external_id usando el endpoint correcto de MP:
// GET /users/{user_id}/stores/search (devuelve { paging, results: [...] }).
async function findStoreByExternalId(userId, externalId, token) {
  // 1) filtrando por external_id
  let res = await mpRequest('GET', `/users/${userId}/stores/search?external_id=${encodeURIComponent(externalId)}`, null, token)
  let results = res.body?.results || []
  let match = results.find(s => s.external_id === externalId)
  if (match?.id) return match
  // 2) sin filtro, traer todas y filtrar localmente (por si el filtro falla)
  res = await mpRequest('GET', `/users/${userId}/stores/search`, null, token)
  results = res.body?.results || []
  return results.find(s => s.external_id === externalId) || null
}

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

ipcMain.handle('mp:saveConfig', (_, { token, sandbox, posExternalId, userId, posId } = {}) => {
  if (token          !== undefined) setSetting('mp_access_token',    token || '')
  if (sandbox        !== undefined) setSetting('mp_sandbox',         sandbox ? '1' : '0')
  if (posExternalId  !== undefined && String(posExternalId).trim()) setSetting('mp_pos_external_id', String(posExternalId).trim())
  if (userId         !== undefined && String(userId).trim())        setSetting('mp_user_id',         String(userId).trim())
  if (posId          !== undefined && String(posId).trim())         setSetting('mp_pos_id',          String(posId).trim())
  return { ok: true }
})

// ─── mp:linkExistingPos — vincula un POS ya creado (sin crear uno nuevo) ──────
// Verifica el token con /users/me y busca el POS por su external_id, persistiendo
// user_id, pos_id y los datos del QR en settings. Es la forma "limpia" de
// configurar credenciales cuando el POS ya existe en la cuenta de Mercado Pago.
ipcMain.handle('mp:linkExistingPos', async (_, { posExternalId } = {}) => {
  try {
    const token = getToken()
    if (!token) return { ok: false, error: 'Configurá el Access Token primero' }
    const externalId = (posExternalId || getSetting('mp_pos_external_id') || POS_EXTERNAL_ID).trim()

    // PASO 1: verificar token + obtener user_id
    const meRes = await mpRequest('GET', '/users/me', null, token)
    if (!meRes.body?.id) {
      return { ok: false, error: `Token inválido o sin permisos: ${meRes.body?.message || meRes.body?.error || 'HTTP ' + meRes.status}` }
    }
    const userId = meRes.body.id
    setSetting('mp_user_id', String(userId))

    // PASO 2: buscar el POS por external_id
    const listRes = await mpRequest('GET', `/pos?external_id=${encodeURIComponent(externalId)}`, null, token)
    const results = listRes.body?.results || (Array.isArray(listRes.body) ? listRes.body : [])
    const pos = results.find(p => p.external_id === externalId) || results[0]
    if (!pos?.id) {
      return { ok: false, error: `No se encontró un POS con External ID "${externalId}" en esta cuenta. Verificá el External ID o creá el punto de venta.` }
    }

    const qrImage = pos.qr?.image || ''
    const qrPdf   = pos.qr?.template_document || ''
    const qrData  = pos.qr?.qr_data || ''

    setSetting('mp_pos_external_id', externalId)
    setSetting('mp_pos_id',          String(pos.id))
    setSetting('mp_pos_name',        pos.name || 'Caja principal')
    setSetting('mp_qr_data',         qrData)
    setSetting('mp_qr_image',        qrImage)
    setSetting('mp_qr_pdf',          qrPdf)

    return {
      ok: true,
      user_id:     String(userId),
      pos_id:      String(pos.id),
      external_id: externalId,
      pos_name:    pos.name || 'Caja principal',
      qr_image:    qrImage,
      qr_pdf:      qrPdf,
      qr_data:     qrData,
    }
  } catch (e) {
    console.error('[MP] linkExistingPos exception:', e.message)
    return { ok: false, error: e.message }
  }
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

ipcMain.handle('mp:createPos', async (_, { posName, storeId: manualStoreId } = {}) => {
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

    // ── PASO 2: Sucursal (store) — manual o automática ────────────────────
    let storeId
    let storeExternalId = STORE_EXTERNAL_ID

    if (manualStoreId && String(manualStoreId).trim()) {
      // El usuario creó la sucursal en el panel de MP y pegó su Store ID.
      storeId = String(manualStoreId).trim()
      console.log('[MP] PASO 2 → usando Store ID manual:', storeId)
      // Obtener su external_id (GET /stores/{id}) para asociar el POS correctamente.
      const storeGet = await mpRequest('GET', `/stores/${storeId}`, null, token)
      if (storeGet.body?.external_id) {
        storeExternalId = storeGet.body.external_id
      } else {
        storeExternalId = ''
        console.warn('[MP] No se encontró external_id para el Store ID manual; se omitirá external_store_id en el POS')
      }
    } else {
      // Creación automática de la sucursal.
      const storeBody = {
        name: posName || 'Mi Local',
        external_id: STORE_EXTERNAL_ID,
        // NOTA: la API de sucursales de MP NO acepta `country` dentro de location;
        // incluirlo devuelve HTTP 400. Campos válidos: street_number, street_name,
        // city_name, state_name, latitude, longitude, reference.
        location: {
          street_number: '1',
          street_name: 'General Paz',
          city_name: 'Mar del Plata',
          state_name: 'Buenos Aires',
          latitude: -38.0023,
          longitude: -57.5575,
          reference: 'Local',
        },
        business_hours: {
          monday:    [{ open: '08:00', close: '20:00' }],
          tuesday:   [{ open: '08:00', close: '20:00' }],
          wednesday: [{ open: '08:00', close: '20:00' }],
          thursday:  [{ open: '08:00', close: '20:00' }],
          friday:    [{ open: '08:00', close: '20:00' }],
          saturday:  [{ open: '08:00', close: '14:00' }],
        },
      }

      console.log('[MP] PASO 2 → POST /users/' + userId + '/stores', JSON.stringify(storeBody))
      const storeRes = await mpRequest('POST', `/users/${userId}/stores`, storeBody, token)

      if (storeRes.body.id) {
        storeId = storeRes.body.id
        console.log('[MP] store creada — id:', storeId)
      } else {
        // La sucursal no se creó. Caso más común: ya existe con ese external_id.
        // MP lo reporta como 409, o como 400 con "external id ... is already
        // assigned to user ...". En cualquiera de esos casos la reutilizamos.
        const errText = JSON.stringify(storeRes.body || {}).toLowerCase()
        const alreadyExists =
          storeRes.status === 409 ||
          errText.includes('already') ||
          errText.includes('assigned') ||
          errText.includes('exist')

        if (alreadyExists) {
          console.log('[MP] PASO 2 → la sucursal ya existe, buscando con GET /users/' + userId + '/stores/search')
          const match = await findStoreByExternalId(userId, STORE_EXTERNAL_ID, token)
          if (!match?.id) {
            console.error('[MP] sucursal ya existe pero no se pudo recuperar por external_id', STORE_EXTERNAL_ID)
            return { ok: false, error: `La sucursal "${STORE_EXTERNAL_ID}" ya existe pero no se pudo recuperar. Probá con el Store ID manual. (${mpErrorMessage(storeRes.body)})` }
          }
          storeId = match.id
          if (match.external_id) storeExternalId = match.external_id
          console.log('[MP] store existente reutilizada — id:', storeId)
        } else {
          // Log COMPLETO del error de MP — trae el campo exacto que falló.
          console.error('[MP] Error crear sucursal — HTTP', storeRes.status)
          console.error('[MP] Error crear sucursal (body completo):', JSON.stringify(storeRes.body, null, 2))
          return {
            ok: false,
            error: `Error al crear sucursal (HTTP ${storeRes.status}): ${mpErrorMessage(storeRes.body)}`,
          }
        }
      }
    }

    setSetting('mp_store_id', String(storeId))
    setSetting('mp_store_external_id', storeExternalId)

    // ── PASO 3: Crear caja (POS) ──────────────────────────────────────────
    const posBody = {
      name: posName || 'Caja 1',
      fixed_amount: true,
      store_id: storeId,
      external_id: POS_EXTERNAL_ID,
      category: 621102,
    }
    if (storeExternalId) posBody.external_store_id = storeExternalId

    console.log('[MP] PASO 3 → POST /pos', JSON.stringify(posBody))
    const posRes = await mpRequest('POST', '/pos', posBody, token)
    let pos

    const posErrText = JSON.stringify(posRes.body || {}).toLowerCase()
    const posAlreadyExists = posRes.status === 409 ||
      posErrText.includes('already') || posErrText.includes('assigned') || posErrText.includes('exist')

    if (posRes.body.id) {
      pos = posRes.body
      console.log('[MP] POS creado — id:', pos.id)
    } else if (posAlreadyExists) {
      // POS ya existe (MP lo reporta como 409 o como 400 "already assigned") — buscarlo
      console.log('[MP] PASO 3 → el POS ya existe, buscando con GET /pos')
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
      console.error('[MP] Error crear POS — HTTP', posRes.status)
      console.error('[MP] Error crear POS (body completo):', JSON.stringify(posRes.body, null, 2))
      return { ok: false, error: `Error al crear POS (HTTP ${posRes.status}): ${mpErrorMessage(posRes.body)}` }
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
    const cfg = getPosConfig()
    if (!cfg.token) return { ok: false, error: 'Access Token no configurado' }

    const posExternalId = cfg.external_id || POS_EXTERNAL_ID
    if (!posExternalId) return { ok: false, error: 'Punto de venta no configurado (External ID)' }

    const tokenEnv = cfg.token.startsWith('TEST-') ? 'SANDBOX' : cfg.token.startsWith('APP_USR-') ? 'PRODUCCIÓN' : 'DESCONOCIDO'
    console.log(`[MP] createOrder → env:${tokenEnv} pos:${posExternalId} monto:${amount}`)

    const amountStr = Number(amount).toFixed(2)
    const ref       = externalReference || `DELPA-${Date.now()}`
    const idempotencyKey = crypto.randomUUID()

    // Texto que ve el cliente al escanear el QR: nombre del negocio si está
    // configurado (ej: "Pago en Petalo"), si no "Pago en comercio".
    const bizName = getSetting('business_name')
    const payDescription = bizName ? `Pago en ${bizName}` : 'Pago en comercio'

    const body = {
      type: 'qr',
      total_amount: amountStr,
      description: payDescription,
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
        title: payDescription,
        unit_price: amountStr,
        quantity: 1,
        unit_measure: 'unit',
      }],
    }

    const res = await mpRequest('POST', '/v1/orders', body, cfg.token, {
      'X-Idempotency-Key': idempotencyKey,
    })

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
