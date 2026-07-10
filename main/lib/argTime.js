// Helpers de fecha/hora en horario de Argentina.
//
// SQLite guarda los timestamps (CURRENT_TIMESTAMP) en UTC como 'YYYY-MM-DD HH:MM:SS'
// SIN indicador de zona. Si se hace new Date(str) sobre ese string, V8 lo interpreta
// como hora LOCAL, con lo cual la hora mostrada queda corrida (+3h en Argentina).
// Estos helpers parsean el string COMO UTC y lo formatean en zona Argentina.

const TZ = 'America/Argentina/Buenos_Aires'

function toDate(v) {
  if (v instanceof Date) return v
  if (typeof v === 'number') return new Date(v)
  if (v == null) return new Date()
  const s = String(v).trim()
  // Timestamp de SQLite (UTC, sin zona): 'YYYY-MM-DD HH:MM:SS' o con 'T'
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(s)) {
    return new Date(s.replace(' ', 'T') + 'Z')
  }
  return new Date(s)
}

// Fecha + hora completa (ej: "10/7/2026, 14:35:12")
function fmtDateTimeAR(v, opts = {}) {
  return toDate(v).toLocaleString('es-AR', { timeZone: TZ, ...opts })
}

// Solo fecha (ej: "10/7/2026")
function fmtDateAR(v, opts = {}) {
  return toDate(v).toLocaleDateString('es-AR', { timeZone: TZ, ...opts })
}

// Solo hora en formato 24h (ej: "14:35")
function fmtTimeAR(v, opts = {}) {
  return toDate(v).toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false, ...opts })
}

// Fecha de hoy en Argentina en formato ISO 'YYYY-MM-DD' (útil para filtros SQL)
function todayAR() {
  return new Date().toLocaleDateString('sv', { timeZone: TZ }) // 'sv' → YYYY-MM-DD
}

module.exports = { TZ, toDate, fmtDateTimeAR, fmtDateAR, fmtTimeAR, todayAR }
