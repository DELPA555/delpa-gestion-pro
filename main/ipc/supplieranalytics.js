const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

ipcMain.handle('supplieranalytics:margins', (_, { from, to } = {}) => {
  const db = getDB()
  const defaultFrom = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const defaultTo   = new Date().toISOString().slice(0, 10)
  const f = from || defaultFrom
  const t = to   || defaultTo

  // Map each product to its most-recently-used supplier (via purchase_items)
  // Then aggregate sales revenue and cost by that supplier
  const rows = db.prepare(`
    WITH latest_sup AS (
      SELECT pi.product_id, pu.supplier_id
      FROM purchase_items pi
      JOIN purchases pu ON pu.id = pi.purchase_id
      WHERE pu.supplier_id IS NOT NULL
      GROUP BY pi.product_id
      HAVING pi.purchase_id = MAX(pi.purchase_id)
    )
    SELECT
      COALESCE(s.name, 'Sin proveedor') as supplier_name,
      COUNT(DISTINCT si.product_id) as product_count,
      SUM(si.quantity) as units_sold,
      ROUND(SUM(si.quantity * si.unit_price), 2) as revenue,
      ROUND(SUM(si.quantity * COALESCE(si.unit_cost, 0)), 2) as cost,
      ROUND(SUM(si.quantity * (si.unit_price - COALESCE(si.unit_cost, 0))), 2) as gross_profit
    FROM sale_items si
    JOIN sales sa ON sa.id = si.sale_id AND sa.voided = 0
    LEFT JOIN latest_sup ls ON ls.product_id = si.product_id
    LEFT JOIN suppliers s ON s.id = ls.supplier_id
    WHERE date(sa.created_at,'localtime') BETWEEN ? AND ?
    GROUP BY s.id, s.name
    ORDER BY revenue DESC
  `).all(f, t)

  return rows.map(r => ({
    ...r,
    margin_rate: r.revenue > 0 ? Number((r.gross_profit / r.revenue * 100).toFixed(1)) : 0,
  }))
})
