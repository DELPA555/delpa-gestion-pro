/* Envío de email por HTTP vía Resend (v3.2.0).
 *
 * Reemplaza a nodemailer/SMTP en todo el main process. La API key se guarda en la
 * tabla settings bajo la clave 'resend_api_key' (se configura en Ajustes → Email).
 * El remitente ("from") es SIEMPRE alertas@delpagestion.com.ar (dominio verificado en
 * Resend); se conserva el nombre visible que traiga el `from` del llamador.
 *
 * sendEmail(opts) acepta la misma forma de opciones que usaba transporter.sendMail:
 *   { from, to, cc, subject, html, text, attachments:[{filename, content|path, contentType?}] }
 * - `to`/`cc` pueden ser string ("a@b, c@d") o array.
 * - attachments: `content` puede ser Buffer o string; o se pasa `path` (se lee del disco).
 *   Resend espera el contenido en base64 → se convierte acá.
 * Nunca usa SMTP. Lanza Error con mensaje claro si falta la API key o si Resend responde mal.
 */
const fs = require('fs')
const { getDB } = require('../../database/db')

const FROM_ADDR = 'alertas@delpagestion.com.ar'
const RESEND_URL = 'https://api.resend.com/emails'

// Lee la API key de Resend desde settings. Devuelve '' si no está configurada.
function getResendKey() {
  try {
    const r = getDB().prepare("SELECT value FROM settings WHERE key='resend_api_key'").get()
    return String((r && r.value) || '').trim()
  } catch { return '' }
}

// ¿Hay email configurado (= hay API key de Resend)? Para los guards de los handlers.
function emailConfigured() { return !!getResendKey() }

// Construye el "from" fijo conservando el nombre visible del negocio si vino en opts.from.
function fromHeader(opts) {
  let name = (opts && opts.fromName) || 'DELPA'
  const m = String((opts && opts.from) || '').match(/^\s*"?([^"<]*?)"?\s*</)
  if (m && m[1].trim()) name = m[1].trim()
  name = String(name).replace(/["<>]/g, '').trim() || 'DELPA'
  return name + ' <' + FROM_ADDR + '>'
}

// Normaliza destinatarios a array de emails no vacíos.
function toArray(to) {
  if (Array.isArray(to)) return to.map(s => String(s).trim()).filter(Boolean)
  return String(to || '').split(/[,;]/).map(s => s.trim()).filter(Boolean)
}

// Convierte los adjuntos al formato de Resend ({ filename, content: base64 }).
function encodeAttachments(atts) {
  if (!atts || !atts.length) return undefined
  return atts.map(a => {
    let content = a.content
    if (content == null && a.path) content = fs.readFileSync(a.path)
    if (Buffer.isBuffer(content)) content = content.toString('base64')
    else if (typeof content === 'string') content = Buffer.from(content).toString('base64')
    return { filename: a.filename, content }
  })
}

// Envía un email por Resend. Devuelve { ok:true, id }. Lanza Error si falla.
async function sendEmail(opts) {
  opts = opts || {}
  const key = getResendKey()
  if (!key) throw new Error('Falta la API key de Resend. Configurala en Ajustes → Email.')
  const to = toArray(opts.to)
  if (!to.length) throw new Error('Falta el email destinatario.')

  const body = { from: fromHeader(opts), to, subject: opts.subject || '' }
  if (opts.html) body.html = opts.html
  if (opts.text) body.text = opts.text
  if (!body.html && !body.text) body.text = ' '
  const cc = toArray(opts.cc); if (cc.length) body.cc = cc
  const replyTo = opts.replyTo || opts.reply_to; if (replyTo) body.reply_to = replyTo
  const attachments = encodeAttachments(opts.attachments); if (attachments) body.attachments = attachments

  const r = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((data && (data.message || data.name)) || ('Resend HTTP ' + r.status))
  return { ok: true, id: data && data.id }
}

module.exports = { sendEmail, getResendKey, emailConfigured, FROM_ADDR }
