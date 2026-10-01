const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

// Valorización de stock: totales y desglose por categoría.
// El stock vive por talle en product_sizes (stock), el costo/precio en products.
// Solo cuenta productos activos con stock > 0.
ipcMain.handle('valuation:data', async () => {
  const db = getDB()

  const totals = db.prepare(`
    SELECT COUNT(DISTINCT p.id)                 AS total_productos,
           COALESCE(SUM(ps.stock), 0)          AS total_unidades,
           COALESCE(SUM(p.cost  * ps.stock), 0) AS valor_costo,
           COALESCE(SUM(p.price * ps.stock), 0) AS valor_publico
    FROM products p
    JOIN product_sizes ps ON ps.product_id = p.id
    WHERE p.active = 1 AND ps.stock > 0
  `).get() || { total_productos: 0, total_unidades: 0, valor_costo: 0, valor_publico: 0 }

  const byCategory = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(p.category), ''), 'Sin categoría') AS categoria,
           COUNT(DISTINCT p.id)                 AS total_productos,
           COALESCE(SUM(ps.stock), 0)          AS total_unidades,
           COALESCE(SUM(p.cost  * ps.stock), 0) AS valor_costo,
           COALESCE(SUM(p.price * ps.stock), 0) AS valor_publico
    FROM products p
    JOIN product_sizes ps ON ps.product_id = p.id
    WHERE p.active = 1 AND ps.stock > 0
    GROUP BY categoria
    ORDER BY valor_publico DESC
  `).all()

  return { totals, byCategory }
})
