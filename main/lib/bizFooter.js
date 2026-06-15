// Helper compartido: datos de contacto del negocio para pies de emails y PDFs.
// Solo incluye los campos que estén completos.
const { getDB } = require('../../database/db')

const CONTACT_KEYS = [
  'business_name', 'business_address', 'business_phone', 'business_cuit',
  'business_instagram', 'business_facebook', 'business_whatsapp', 'business_website', 'business_hours',
]

function getBizContact(db) {
  db = db || getDB()
  const out = {}
  for (const k of CONTACT_KEYS) {
    try { out[k] = db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value || '' } catch { out[k] = '' }
  }
  return out
}

// Líneas de contacto/redes (texto plano), solo las completas
function bizContactLines(biz = {}) {
  const L = []
  if (biz.business_instagram) L.push('📱 Instagram: @' + String(biz.business_instagram).replace(/^@/, ''))
  if (biz.business_facebook)  L.push('📘 Facebook: ' + biz.business_facebook)
  if (biz.business_whatsapp)  L.push('💬 WhatsApp: ' + biz.business_whatsapp)
  if (biz.business_website)   L.push('🌐 ' + biz.business_website)
  if (biz.business_hours)     L.push('🕐 Horario: ' + biz.business_hours)
  return L
}

// Bloque HTML para emails / PDFs (centrado, gris). '' si no hay nada.
function bizFooterHtml(biz = {}, opts = {}) {
  const lines = bizContactLines(biz)
  if (!lines.length) return ''
  const color = opts.color || '#888'
  const size = opts.size || '12px'
  const mt = opts.marginTop || '14px'
  return `<div style="text-align:center;color:${color};font-size:${size};line-height:1.6;margin-top:${mt};padding-top:10px;border-top:1px solid #e5e5e5">`
    + lines.map(l => `<div style="margin:1px 0">${l}</div>`).join('')
    + '</div>'
}

module.exports = { getBizContact, bizContactLines, bizFooterHtml, CONTACT_KEYS }
