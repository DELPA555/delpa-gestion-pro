const { ipcMain } = require('electron')
const { getDB } = require('../../database/db')

// Valorización de stock: totales y desglose por categoría.
// El stock vive por talle en product_sizes (stock), el costo/precio en products.
// Solo cuenta productos activos con stock > 0.
// Variantes de color: cada una es una fila products con su propio stock. Para el CONTEO se
// agrupan bajo el padre (COUNT DISTINCT COALESCE(parent_product_id, id)) para no contarlas
// como productos separados; su stock/valor SÍ se suma (es stock real de cada color).
ipcMain.handle('valuation:data', async () => {
  const db = getDB()

  const totals = db.prepare(`
    SELECT COUNT(DISTINCT COALESCE(p.parent_product_id, p.id)) AS total_productos,
           COALESCE(SUM(ps.stock), 0)          AS total_unidades,
           COALESCE(SUM(p.cost  * ps.stock), 0) AS valor_costo,
           COALESCE(SUM(p.price * ps.stock), 0) AS valor_publico,
           COALESCE(SUM(p.price_wholesale   * ps.stock), 0) AS valor_mayorista,
           COALESCE(SUM(p.price_distributor * ps.stock), 0) AS valor_distribuidor
    FROM products p
    JOIN product_sizes ps ON ps.product_id = p.id
    WHERE p.active = 1 AND ps.stock > 0
  `).get() || { total_productos: 0, total_unidades: 0, valor_costo: 0, valor_publico: 0, valor_mayorista: 0, valor_distribuidor: 0 }

  const byCategory = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(p.category), ''), 'Sin categoría') AS categoria,
           COUNT(DISTINCT COALESCE(p.parent_product_id, p.id)) AS total_productos,
           COALESCE(SUM(ps.stock), 0)          AS total_unidades,
           COALESCE(SUM(p.cost  * ps.stock), 0) AS valor_costo,
           COALESCE(SUM(p.price * ps.stock), 0) AS valor_publico,
           COALESCE(SUM(p.price_wholesale   * ps.stock), 0) AS valor_mayorista,
           COALESCE(SUM(p.price_distributor * ps.stock), 0) AS valor_distribuidor
    FROM products p
    JOIN product_sizes ps ON ps.product_id = p.id
    WHERE p.active = 1 AND ps.stock > 0
    GROUP BY categoria
    ORDER BY valor_publico DESC
  `).all()

  return { totals, byCategory }
})
