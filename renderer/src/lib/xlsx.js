import * as XLSX from 'xlsx'

// Exporta filas a un archivo .xlsx y dispara la descarga en el navegador (Electron renderer).
// - filename: nombre del archivo (se le agrega .xlsx si falta)
// - rows: array de objetos planos
// - columns: [{ key, header, format? }] define orden y encabezados. Si se omite, usa las claves
//   del primer objeto. `format(valor, fila)` permite transformar el valor (ej: redondear).
// Devuelve false si no hay filas (para poder avisar al usuario).
export function exportXlsx(filename, rows, columns = null) {
  if (!Array.isArray(rows) || rows.length === 0) return false
  const cols = columns || Object.keys(rows[0]).map(k => ({ key: k, header: k }))
  const aoa = [cols.map(c => c.header)]
  for (const r of rows) {
    aoa.push(cols.map(c => {
      const v = r[c.key]
      const out = c.format ? c.format(v, r) : v
      return out == null ? '' : out
    }))
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Hoja1')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  const safe = String(filename || 'informe').replace(/[^\w.-]+/g, '_')
  const name = safe.toLowerCase().endsWith('.xlsx') ? safe : safe + '.xlsx'
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  return true
}
