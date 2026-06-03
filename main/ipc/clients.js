const { ipcMain, dialog } = require('electron')
const { getDB } = require('../../database/db')
const fs = require('fs')

function parseCSVRow(line) {
  const fields = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') { inQuotes = false }
      else { field += ch }
    } else {
      if (ch === '"') { inQuotes = true }
      else if (ch === ';') { fields.push(field.trim()); field = '' }
      else { field += ch }
    }
  }
  fields.push(field.trim())
  return fields
}

function findCol(headers, fragment) {
  const frag = fragment.toLowerCase()
  return headers.findIndex(h => h.toLowerCase().includes(frag))
}

function normalizeDate(str) {
  if (!str || !str.trim()) return ''
  str = str.trim()
  let m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
  m = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`
  return ''
}

ipcMain.handle('clients:list', (_, { search = '', page = 1, limit = 25 } = {}) => {
  const db = getDB()
  const offset = (page - 1) * limit
  let where = 'WHERE active=1'
  const params = []
  if (search) {
    where += ' AND (name LIKE ? OR phone LIKE ? OR dni LIKE ? OR email LIKE ?)'
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
  }
  const { count } = db.prepare(`SELECT COUNT(*) as count FROM clients ${where}`).get(...params)
  const clients = db.prepare(`SELECT * FROM clients ${where} ORDER BY name ASC LIMIT ? OFFSET ?`).all(...params, limit, offset)
  return { clients, total: count, pages: Math.ceil(count / limit) }
})

ipcMain.handle('clients:get', (_, id) => getDB().prepare('SELECT * FROM clients WHERE id=?').get(id))

ipcMain.handle('clients:create', (_, { name, phone, dni, email, address, notes, birth_date }) => {
  const db = getDB()
  const { lastInsertRowid: id } = db.prepare(
    'INSERT INTO clients (name,phone,dni,email,address,notes,birth_date) VALUES (?,?,?,?,?,?,?)'
  ).run(name, phone||'', dni||'', email||'', address||'', notes||'', birth_date||'')
  db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES ('CREATE','clients',?,?)`).run(id, `Cliente creado: ${name}`)
  return id
})

ipcMain.handle('clients:update', (_, { id, name, phone, dni, email, address, notes, birth_date }) => {
  const db = getDB()
  db.prepare('UPDATE clients SET name=?,phone=?,dni=?,email=?,address=?,notes=?,birth_date=? WHERE id=?')
    .run(name, phone||'', dni||'', email||'', address||'', notes||'', birth_date||'', id)
  db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES ('UPDATE','clients',?,?)`).run(id, `Cliente actualizado: ${name}`)
  return true
})

ipcMain.handle('clients:delete', (_, id) => {
  const db = getDB()
  const c = db.prepare('SELECT name FROM clients WHERE id=?').get(id)
  db.prepare('UPDATE clients SET active=0 WHERE id=?').run(id)
  db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES ('DELETE','clients',?,?)`).run(id, `Cliente eliminado: ${c?.name}`)
  return true
})

ipcMain.handle('clients:history', (_, clientId) =>
  getDB().prepare(`
    SELECT s.id, s.total, s.discount, s.payment_method, s.created_at, s.voided,
           COUNT(si.id) as items
    FROM sales s LEFT JOIN sale_items si ON si.sale_id=s.id
    WHERE s.client_id=? GROUP BY s.id ORDER BY s.created_at DESC
  `).all(clientId)
)

ipcMain.handle('clients:addPayment', (_, { clientId, amount, notes }) => {
  const db = getDB()
  return db.transaction(() => {
    db.prepare('UPDATE clients SET balance=balance-? WHERE id=?').run(amount, clientId)
    db.prepare(`INSERT INTO account_movements (client_id,type,amount,notes) VALUES (?,'payment',?,?)`).run(clientId, amount, notes||'Pago de cuenta corriente')
    db.prepare(`INSERT INTO audit_log (action,module,entity_id,description) VALUES ('PAYMENT','clients',?,?)`).run(clientId, `Pago recibido $${amount}`)
    return true
  })()
})

ipcMain.handle('clients:importCSV', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Importar clientes desde CSV de Tienda Nube',
    filters: [{ name: 'Archivo CSV', extensions: ['csv'] }],
    properties: ['openFile'],
  })
  if (canceled || !filePaths[0]) return null

  let content = fs.readFileSync(filePaths[0], 'latin1')
  content = content.replace(/^\xef\xbb\xbf/, '').replace(/^���/, '')

  const lines = content.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { imported: 0, duplicates: 0, errors: 0 }

  const headers = parseCSVRow(lines[0])
  const iName  = findCol(headers, 'ombre y')
  const iEmail = findCol(headers, 'mail')
  const iPhone = findCol(headers, 'tel')
  const iAddr  = findCol(headers, 'irecci')
  const iNum   = findCol(headers, 'mero')
  const iCity  = findCol(headers, 'iudad')
  const iProv  = findCol(headers, 'rovincia')
  const iSpent = findCol(headers, 'al consumido')
  const iCount = findCol(headers, 'antidad de')
  const iLast  = findCol(headers, 'ltima')
  const iBirth = findCol(headers, 'nacimiento')

  const db = getDB()
  const existingEmails = new Set(
    db.prepare("SELECT email FROM clients WHERE email != ''").all().map(r => r.email.toLowerCase().trim())
  )
  const insert = db.prepare(
    `INSERT INTO clients (name,phone,email,address,city,province,birth_date,total_spent,purchase_count,last_purchase,notes,dni)
     VALUES (?,?,?,?,?,?,?,?,?,?,'','')`
  )

  let imported = 0, duplicates = 0, errors = 0
  const rows = lines.slice(1)

  for (let b = 0; b < rows.length; b += 100) {
    const batch = rows.slice(b, b + 100)
    db.transaction(() => {
      for (const line of batch) {
        try {
          const cols = parseCSVRow(line)
          const name = iName >= 0 ? (cols[iName]||'').trim() : ''
          if (!name) continue
          const email = iEmail >= 0 ? (cols[iEmail]||'').toLowerCase().trim() : ''
          if (email && existingEmails.has(email)) { duplicates++; continue }
          if (email) existingEmails.add(email)
          const addr  = [iAddr>=0?cols[iAddr]:'', iNum>=0?cols[iNum]:''].filter(Boolean).join(' ').trim()
          const spent = iSpent >= 0 ? (parseFloat((cols[iSpent]||'0').replace(',','.')) || 0) : 0
          const count = iCount >= 0 ? (parseInt(cols[iCount]||'0') || 0) : 0
          insert.run(
            name,
            iPhone>=0?(cols[iPhone]||'').trim():'',
            email, addr,
            iCity>=0?(cols[iCity]||'').trim():'',
            iProv>=0?(cols[iProv]||'').trim():'',
            iBirth>=0?normalizeDate(cols[iBirth]||''):'',
            spent, count,
            iLast>=0?normalizeDate(cols[iLast]||''):''
          )
          imported++
        } catch { errors++ }
      }
    })()
  }

  return { imported, duplicates, errors }
})

ipcMain.handle('clients:birthdays', () =>
  getDB().prepare(`
    SELECT id, name, phone, birth_date FROM clients
    WHERE active=1 AND birth_date != ''
    AND strftime('%m-%d', birth_date) = strftime('%m-%d', 'now', 'localtime')
    ORDER BY name ASC
  `).all()
)

ipcMain.handle('clients:birthdayMonth', () =>
  getDB().prepare(`
    SELECT id, name, phone, birth_date FROM clients
    WHERE active=1 AND birth_date != ''
    AND strftime('%m', birth_date) = strftime('%m', 'now', 'localtime')
    ORDER BY CAST(strftime('%d', birth_date) AS INTEGER) ASC
  `).all()
)

ipcMain.handle('clients:ranking', () =>
  getDB().prepare(`
    SELECT c.*,
      c.total_spent + COALESCE((SELECT SUM(s.total) FROM sales s WHERE s.client_id=c.id AND s.voided=0),0) AS effective_spent,
      c.purchase_count + COALESCE((SELECT COUNT(*) FROM sales s WHERE s.client_id=c.id AND s.voided=0),0) AS effective_count,
      CASE WHEN (julianday('now','localtime') - julianday(c.created_at)) <= 30 THEN 1 ELSE 0 END AS is_new
    FROM clients c WHERE c.active=1
    ORDER BY effective_spent DESC LIMIT 50
  `).all()
)

ipcMain.handle('clients:points:history', (_, clientId) =>
  getDB().prepare(`
    SELECT p.*, s.sale_number FROM client_points_log p
    LEFT JOIN sales s ON s.id=p.sale_id
    WHERE p.client_id=? ORDER BY p.created_at DESC LIMIT 50
  `).all(clientId)
)

ipcMain.handle('clients:points:adjust', (_, { clientId, amount, notes }) => {
  const db = getDB()
  const client = db.prepare('SELECT points FROM clients WHERE id=?').get(clientId)
  if (!client) return { ok: false, error: 'Cliente no encontrado' }
  const newPoints = Math.max(0, (client.points || 0) + amount)
  db.prepare('UPDATE clients SET points=? WHERE id=?').run(newPoints, clientId)
  db.prepare('INSERT INTO client_points_log (client_id,type,amount,notes) VALUES (?,?,?,?)')
    .run(clientId, amount >= 0 ? 'adjust_add' : 'adjust_remove', amount, notes || 'Ajuste manual')
  return { ok: true, newPoints }
})
