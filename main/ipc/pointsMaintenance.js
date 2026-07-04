const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

// Vence los puntos de clientes cuya fecha de vencimiento ya pasó.
// Modelo de "reloj único": cada acumulación reinicia points_expires_at para todos
// los puntos activos del cliente. Se ejecuta al abrir DELPA.
function runPointsExpiry(db = getDB()) {
  try {
    const vencidos = db.prepare(
      `SELECT id, points FROM clients
       WHERE points > 0 AND points_expires_at IS NOT NULL
         AND points_expires_at < datetime('now','localtime')`
    ).all()
    if (!vencidos.length) return 0
    const logIns = db.prepare("INSERT INTO client_points_log (client_id,type,amount,notes) VALUES (?,?,?,?)")
    const upd = db.prepare("UPDATE clients SET points=0, points_expires_at=NULL WHERE id=?")
    const tx = db.transaction(() => {
      for (const c of vencidos) {
        upd.run(c.id)
        logIns.run(c.id, 'expired', -c.points, 'Puntos vencidos por inactividad (6 meses)')
      }
    })
    tx()
    console.log(`[POINTS] Vencidos ${vencidos.length} cliente(s) con puntos expirados`)
    return vencidos.length
  } catch (e) {
    console.error('[POINTS] runPointsExpiry error:', e.message)
    return 0
  }
}

ipcMain.handle('points:runExpiry', () => ({ expired: runPointsExpiry() }))

// Estado de puntos de un cliente para la ficha.
ipcMain.handle('points:status', (_, { clientId }) => {
  const db = getDB()
  const c = db.prepare('SELECT points, points_expires_at FROM clients WHERE id=?').get(clientId)
  if (!c) return { active: 0 }
  const expiredTotal = db.prepare(
    "SELECT COALESCE(-SUM(amount),0) AS t FROM client_points_log WHERE client_id=? AND type='expired'"
  ).get(clientId)?.t || 0

  let daysLeft = null, expiringSoon = false
  if (c.points > 0 && c.points_expires_at) {
    const exp = new Date(c.points_expires_at.replace(' ', 'T'))
    daysLeft = Math.ceil((exp - new Date()) / 86400000)
    expiringSoon = daysLeft <= 30
  }
  return {
    active: c.points || 0,
    expiresAt: c.points_expires_at || null,
    daysLeft,
    expiringSoon,
    expiredTotal,
  }
})

module.exports = { runPointsExpiry }
