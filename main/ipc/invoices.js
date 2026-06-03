const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

ipcMain.handle('invoices:list', (_, { page = 1, limit = 25 } = {}) => {
  const db = getDB()
  const offset = (page - 1) * limit
  const { count } = db.prepare('SELECT COUNT(*) as count FROM invoices').get()
  const rows = db.prepare('SELECT * FROM invoices ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset)
  return { invoices: rows, total: count, pages: Math.ceil(count / limit) }
})

ipcMain.handle('invoices:create', (_, {
  saleId, type, clientName, clientDni, clientAddress, total, itemsJson,
  // AFIP fields (optional)
  cae, caeFchVto, tipoCbte, cbteNro, ptoVenta,
}) => {
  const db = getDB()
  const year = new Date().getFullYear()
  const { count } = db.prepare("SELECT COUNT(*) as count FROM invoices WHERE type=? AND strftime('%Y',created_at)=?").get(type, String(year))
  const number = `${type}-${year}-${String(count + 1).padStart(6, '0')}`
  const { lastInsertRowid: id } = db.prepare(`
    INSERT INTO invoices (sale_id,type,number,client_name,client_dni,client_address,total,items_json,
                          cae,cae_fch_vto,tipo_cbte,cbte_nro,pto_venta)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    saleId || null, type, number, clientName || '', clientDni || '',
    clientAddress || '', total, itemsJson || '[]',
    cae || '', caeFchVto || '', tipoCbte || 0, cbteNro || 0, ptoVenta || 0,
  )
  db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES ('CREATE','invoices',?,?)`).run(id, `Comprobante ${number} generado${cae ? ' [CAE: ' + cae + ']' : ''}`)
  return { id, number, cae: cae || '', caeFchVto: caeFchVto || '', cbteNro: cbteNro || 0, ptoVenta: ptoVenta || 0 }
})
