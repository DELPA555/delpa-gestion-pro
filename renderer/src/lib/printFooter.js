// Pie con datos de contacto del negocio (solo campos completos) para PDFs e impresiones.
// `biz` es el objeto de settings (api.settings.getAll()).
export function bizContactFooterHtml(biz = {}, opts = {}) {
  const lines = []
  if (biz.business_instagram) lines.push(`📱 Instagram: @${String(biz.business_instagram).replace(/^@/, '')}`)
  if (biz.business_facebook)  lines.push(`📘 Facebook: ${biz.business_facebook}`)
  if (biz.business_whatsapp)  lines.push(`💬 WhatsApp: ${biz.business_whatsapp}`)
  if (biz.business_website)   lines.push(`🌐 ${biz.business_website}`)
  if (biz.business_hours)     lines.push(`🕐 Horario: ${biz.business_hours}`)
  if (!lines.length) return ''
  const color = opts.color || '#666'
  const size = opts.size || '11px'
  const mt = opts.marginTop || '14px'
  return `<div style="text-align:center;color:${color};font-size:${size};line-height:1.55;margin-top:${mt};padding-top:8px;border-top:1px solid #ddd">`
    + lines.map(l => `<div style="margin:1px 0">${l}</div>`).join('')
    + '</div>'
}
