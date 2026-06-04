const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

// ── Límites anuales Monotributo 2025 ─────────────────────────────────────────

const MONO_CATEGORIAS = {
  A: 2_960_000,
  B: 4_440_000,
  C: 6_210_000,
  D: 8_520_000,
  E: 10_720_000,
  F: 13_420_000,
  G: 16_870_000,
  H: 21_885_000,
  I: 26_260_000,
  J: 31_260_000,
  K: 36_760_000,
}

function getSettings(db) {
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('afip_cond_fiscal','mono_categoria','iva_alicuota','afip_punto_venta')").all()
  const s = Object.fromEntries(rows.map(r => [r.key, r.value]))
  return {
    regimen:       s.afip_cond_fiscal || 'MONO',
    monoCategoria: s.mono_categoria   || 'C',
    ivaAlicuota:   parseFloat(s.iva_alicuota || '21'),
    puntoVenta:    parseInt(s.afip_punto_venta || '1', 10),
  }
}

// ── fiscal:stats ─────────────────────────────────────────────────────────────
// Devuelve datos de facturación del mes y año actual para el widget fiscal

ipcMain.handle('fiscal:stats', () => {
  const db   = getDB()
  const cfg  = getSettings(db)
  const now  = new Date()
  const year = now.getFullYear()
  const month= String(now.getMonth() + 1).padStart(2, '0')
  const ym   = `${year}-${month}`

  // Ventas del mes (usamos sales + invoices de AFIP)
  const mesVentas = db.prepare(`
    SELECT COALESCE(SUM(total),0) as total
    FROM sales WHERE voided=0
      AND strftime('%Y-%m', created_at, 'localtime') = ?
  `).get(ym)

  // Ventas del año
  const anioVentas = db.prepare(`
    SELECT COALESCE(SUM(total),0) as total
    FROM sales WHERE voided=0
      AND strftime('%Y', created_at, 'localtime') = ?
  `).get(String(year))

  // Últimos 12 meses para proyección
  const meses12 = db.prepare(`
    SELECT strftime('%Y-%m', created_at, 'localtime') as mes,
           COALESCE(SUM(total),0) as total
    FROM sales WHERE voided=0
      AND created_at >= date('now','localtime','-12 months')
    GROUP BY mes ORDER BY mes
  `).all()

  const result = {
    regimen: cfg.regimen,
    mes:     ym,
    anio:    year,
    facturadoMes:  mesVentas.total,
    facturadoAnio: anioVentas.total,
  }

  if (cfg.regimen === 'MONO') {
    const limAnual = MONO_CATEGORIAS[cfg.monoCategoria] ?? MONO_CATEGORIAS['C']
    const limMes   = limAnual / 12
    const pctMes   = limMes  > 0 ? (mesVentas.total  / limMes   * 100) : 0
    const pctAnio  = limAnual > 0 ? (anioVentas.total / limAnual * 100) : 0

    // Proyección: ¿en qué mes se supera el límite anual?
    let proyMes = null
    if (meses12.length >= 3) {
      const ultimos3 = meses12.slice(-3).reduce((s,m) => s + m.total, 0)
      const promedioMensual = ultimos3 / 3
      if (promedioMensual > 0) {
        const restante = limAnual - anioVentas.total
        const mesesRestantes = Math.ceil(restante / promedioMensual)
        if (mesesRestantes > 0 && mesesRestantes <= 24) {
          const proyDate = new Date(now)
          proyDate.setMonth(proyDate.getMonth() + mesesRestantes)
          proyMes = proyDate.toLocaleString('es-AR', { month: 'long', year: 'numeric' })
        }
      }
    }

    result.monoCategoria  = cfg.monoCategoria
    result.limiteAnual    = limAnual
    result.limiteMes      = limMes
    result.pctMes         = pctMes
    result.pctAnio        = pctAnio
    result.disponibleMes  = Math.max(0, limMes  - mesVentas.total)
    result.disponibleAnio = Math.max(0, limAnual - anioVentas.total)
    result.proyeccionMes  = proyMes
    result.alertaMes      = pctMes  >= 95 ? 'roja' : pctMes  >= 80 ? 'amarilla' : 'ok'
    result.alertaAnio     = pctAnio >= 95 ? 'roja' : pctAnio >= 80 ? 'amarilla' : 'ok'
  } else {
    // RI — posición IVA del mes
    const alicuota = cfg.ivaAlicuota / 100
    const debitoFiscal = mesVentas.total * alicuota / (1 + alicuota)

    const compras = db.prepare(`
      SELECT COALESCE(SUM(total),0) as total
      FROM purchases WHERE date(created_at,'localtime') >= date('now','localtime','start of month')
    `).get()
    const creditoFiscal = compras.total * alicuota / (1 + alicuota)

    // Vencimiento DDJJ IVA: último día hábil del mes siguiente
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 20)
    result.ivaAlicuota   = cfg.ivaAlicuota
    result.debitoFiscal  = Math.round(debitoFiscal  * 100) / 100
    result.creditoFiscal = Math.round(creditoFiscal * 100) / 100
    result.posicionIva   = Math.round((debitoFiscal - creditoFiscal) * 100) / 100
    result.vencimientoDDJJ = nextMonth.toLocaleDateString('es-AR')
  }

  return result
})

// ── fiscal:ivaVentas ─────────────────────────────────────────────────────────

ipcMain.handle('fiscal:ivaVentas', (_, { from, to } = {}) => {
  const db = getDB()
  const f = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  const t = to   || new Date().toISOString().split('T')[0]
  const cfg = getSettings(db)
  const alicuota = cfg.ivaAlicuota / 100

  // Comprobantes locales de DELPA
  const ventas = db.prepare(`
    SELECT s.id, date(s.created_at,'localtime') as fecha,
           s.sale_number as numero,
           COALESCE(c.name,'Consumidor Final') as cliente,
           s.total,
           CASE WHEN s.voucher_type IN ('A','facturaA') THEN ROUND(s.total / (1 + ?), 2) ELSE s.total END as neto,
           CASE WHEN s.voucher_type IN ('A','facturaA') THEN ROUND(s.total - ROUND(s.total / (1 + ?), 2), 2) ELSE 0 END as iva,
           COALESCE(s.cae,'') as cae,
           COALESCE(s.voucher_type,'ticket') as tipo
    FROM sales s
    LEFT JOIN clients c ON c.id = s.client_id
    WHERE s.voided = 0 AND date(s.created_at,'localtime') BETWEEN ? AND ?
    ORDER BY s.created_at
  `).all(alicuota, alicuota, f, t)

  // Comprobantes AFIP sincronizados
  const afipCbtes = db.prepare(`
    SELECT fecha, tipo_cbte, pto_vta || '-' || printf('%08d',nro_cbte) as numero,
           cuit_receptor as cliente,
           imp_neto as neto, imp_iva as iva, imp_total as total, cae
    FROM fiscal_comprobantes
    WHERE fecha BETWEEN ? AND ?
    ORDER BY fecha, nro_cbte
  `).all(f, t)

  const totalNeto = ventas.reduce((s, r) => s + r.neto, 0)
  const totalIva  = ventas.reduce((s, r) => s + r.iva,  0)
  const totalTotal= ventas.reduce((s, r) => s + r.total, 0)

  return { ventas, afipCbtes, totalNeto, totalIva, totalTotal, desde: f, hasta: t }
})

// ── fiscal:ivaCompras ────────────────────────────────────────────────────────

ipcMain.handle('fiscal:ivaCompras', (_, { from, to } = {}) => {
  const db = getDB()
  const f = from || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  const t = to   || new Date().toISOString().split('T')[0]
  const cfg = getSettings(db)
  const alicuota = cfg.ivaAlicuota / 100

  const compras = db.prepare(`
    SELECT p.id, date(p.created_at,'localtime') as fecha,
           COALESCE(s.name,'—') as proveedor,
           p.total,
           ROUND(p.total / (1 + ?), 2) as neto,
           ROUND(p.total - ROUND(p.total / (1 + ?), 2), 2) as iva
    FROM purchases p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE date(p.created_at,'localtime') BETWEEN ? AND ?
    ORDER BY p.created_at
  `).all(alicuota, alicuota, f, t)

  const totalNeto  = compras.reduce((s, r) => s + r.neto,  0)
  const totalIva   = compras.reduce((s, r) => s + r.iva,   0)
  const totalTotal = compras.reduce((s, r) => s + r.total, 0)

  return { compras, totalNeto, totalIva, totalTotal, desde: f, hasta: t }
})

// ── fiscal:posicion ──────────────────────────────────────────────────────────

ipcMain.handle('fiscal:posicion', () => {
  const db  = getDB()
  const cfg = getSettings(db)
  const alicuota = cfg.ivaAlicuota / 100

  const meses = db.prepare(`
    SELECT strftime('%Y-%m', s.created_at,'localtime') as mes,
           COALESCE(SUM(s.total),0) as ventas
    FROM sales s WHERE s.voided=0
      AND created_at >= date('now','localtime','-12 months')
    GROUP BY mes ORDER BY mes
  `).all()

  const comprasMes = db.prepare(`
    SELECT strftime('%Y-%m', created_at,'localtime') as mes,
           COALESCE(SUM(total),0) as compras
    FROM purchases
      WHERE created_at >= date('now','localtime','-12 months')
    GROUP BY mes ORDER BY mes
  `).all()

  const comprasMap = Object.fromEntries(comprasMes.map(r => [r.mes, r.compras]))

  return meses.map(r => {
    const debito  = Math.round(r.ventas   * alicuota / (1 + alicuota) * 100) / 100
    const credito = Math.round((comprasMap[r.mes] || 0) * alicuota / (1 + alicuota) * 100) / 100
    return {
      mes: r.mes, ventas: r.ventas,
      compras:  comprasMap[r.mes] || 0,
      debito, credito,
      posicion: Math.round((debito - credito) * 100) / 100,
    }
  })
})

// ── fiscal:monotributo12m ────────────────────────────────────────────────────

ipcMain.handle('fiscal:monotributo12m', () => {
  const db  = getDB()
  const cfg = getSettings(db)
  const limAnual = MONO_CATEGORIAS[cfg.monoCategoria] ?? MONO_CATEGORIAS['C']

  const meses = db.prepare(`
    SELECT strftime('%Y-%m', created_at,'localtime') as mes,
           COALESCE(SUM(total),0) as facturado,
           COUNT(*) as operaciones
    FROM sales WHERE voided=0
      AND created_at >= date('now','localtime','-12 months')
    GROUP BY mes ORDER BY mes
  `).all()

  return {
    meses,
    limiteAnual: limAnual,
    limiteMensual: limAnual / 12,
    categoria: cfg.monoCategoria,
    categorias: MONO_CATEGORIAS,
  }
})

// ── afip:syncComprobantes ────────────────────────────────────────────────────
// Trae comprobantes del mes desde WSFE y los guarda en fiscal_comprobantes

ipcMain.handle('afip:syncComprobantes', async (_, { tipoComprobante = 11, mes } = {}) => {
  const db  = getDB()
  const cfg = getSettings(db)

  // Determinar tipo según condición fiscal (11=C Monotributo, 1=A RI, 6=B RI)
  const tipo = tipoComprobante || (cfg.regimen === 'MONO' ? 11 : 6)

  try {
    // Usar los helpers compartidos para autenticarse y consultar WSFE
    const afipModule = require('./afip-helpers')
    if (!afipModule) return { ok: false, error: 'Módulo AFIP no disponible', sincronizados: 0 }

    const { authenticate, getSoapClient, getEnv, getPtoVta, CUIT } = afipModule
    const afipCuit = CUIT
    const env    = getEnv()
    const pv     = getPtoVta()
    const ta     = await authenticate(env)
    const client = await getSoapClient('wsfev1', env)

    // Último comprobante autorizado
    const [ultRes] = await client.FECompUltimoAutorizadoAsync({
      Auth: { Token: ta.token, Sign: ta.sign, Cuit: parseInt(afipCuit, 10) },
      PtoVta: pv, CbteTipo: tipo,
    })
    const ultimo = ultRes?.FECompUltimoAutorizadoResult?.CbteNro ?? 0
    if (ultimo === 0) return { ok: true, sincronizados: 0, message: 'Sin comprobantes en AFIP' }

    // Consultar los últimos 50 comprobantes del mes
    const mesStr = mes || new Date().toISOString().slice(0, 7)
    const [anioS, mesS] = mesStr.split('-')
    const primerDia = `${anioS}${mesS}01`

    const ins = db.prepare(`
      INSERT OR REPLACE INTO fiscal_comprobantes
        (tipo_cbte, pto_vta, nro_cbte, fecha, cuit_receptor, imp_neto, imp_iva, imp_total, cae, cae_fch_vto, fuente)
      VALUES (?,?,?,?,?,?,?,?,?,?,'afip')
    `)

    let sincronizados = 0
    const desde = Math.max(1, ultimo - 50)

    for (let nro = ultimo; nro >= desde; nro--) {
      try {
        const [cbteRes] = await client.FECompConsultarAsync({
          Auth: { Token: ta.token, Sign: ta.sign, Cuit: parseInt(afipCuit, 10) },
          FeCompConsReq: { CbteTipo: tipo, CbteNro: nro, PtoVta: pv },
        })
        const c = cbteRes?.FECompConsultarResult?.ResultGet
        if (!c) continue

        const fecha = String(c.CbteFch || '')
        if (fecha < primerDia) break   // Ya pasamos del mes

        const neto  = c.ImpNeto  ?? 0
        const iva   = c.ImpIVA   ?? 0
        const total = c.ImpTotal ?? 0
        const fecFmt = `${fecha.slice(0,4)}-${fecha.slice(4,6)}-${fecha.slice(6,8)}`

        ins.run(tipo, pv, nro, fecFmt, String(c.DocNro || ''), neto, iva, total, String(c.CAE || ''), String(c.CAEFchVto || ''))
        sincronizados++
      } catch { /* skip */ }
    }

    return { ok: true, sincronizados, ultimo }
  } catch (e) {
    return { ok: false, error: e.message, sincronizados: 0 }
  }
})
