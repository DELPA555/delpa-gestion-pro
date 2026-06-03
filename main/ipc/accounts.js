const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

ipcMain.handle('accounts:list', () =>
  getDB().prepare(`
    SELECT c.id, c.name, c.phone, c.dni, c.balance,
           COUNT(DISTINCT s.id) as ventas_cc
    FROM clients c
    LEFT JOIN sales s ON s.client_id=c.id AND s.payment_method='Cuenta Corriente'
    WHERE c.active=1 AND c.balance!=0
    GROUP BY c.id ORDER BY c.balance DESC
  `).all()
)

ipcMain.handle('accounts:movements', (_, clientId) =>
  getDB().prepare(`
    SELECT am.id, am.type, am.amount, am.notes, am.created_at, am.sale_id,
           s.total as sale_total, s.payment_method as sale_method
    FROM account_movements am
    LEFT JOIN sales s ON s.id=am.sale_id
    WHERE am.client_id=? ORDER BY am.created_at DESC LIMIT 200
  `).all(clientId)
)
