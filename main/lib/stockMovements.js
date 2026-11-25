/* Historial de movimientos de mercadería (v1.46.0).
 *
 * Diseño: un TRIGGER en product_sizes (ver database/schema.js) registra en la tabla
 * stock_movements TODO cambio de stock, con stock_anterior → stock_nuevo correctos y
 * sin que ninguna operación pueda "olvidarse" de loguear. Lo único que el trigger no
 * puede saber por sí solo es el CONTEXTO del cambio (si fue venta, cambio, ingreso…,
 * a qué comprobante pertenece y quién lo hizo). Ese contexto lo deja la operación en
 * la fila única stock_ctx (id=1) justo antes de tocar el stock, y el trigger lo lee.
 *
 * Por qué es seguro: todas las escrituras a la base pasan por UNA sola conexión
 * better-sqlite3 (en multi-caja, el servidor ejecuta la operación; los clientes solo
 * reenvían la llamada). better-sqlite3 es síncrono, así que no hay intercalado: se
 * setea el contexto, se opera, se resetea. Si la operación abre su propia transacción,
 * el contexto seteado antes es visible adentro; si algo falla, el finally lo resetea.
 *
 * Sin contexto explícito, un cambio de stock queda como 'ajuste' (edición manual de
 * stock desde Productos, recuento, etc.) — que es justo lo correcto para esos casos.
 */

const DEFAULT_CTX = {
  tipo: 'ajuste',
  referencia_id: null,
  referencia_tipo: null,
  usuario: null,
  detalle: null,
  suppress: 0,
}

// Setea el contexto para los próximos cambios de stock de ESTA conexión.
function setCtx(db, ctx = {}) {
  const c = { ...DEFAULT_CTX, ...ctx }
  db.prepare(
    `UPDATE stock_ctx SET tipo=?, referencia_id=?, referencia_tipo=?, usuario=?, detalle=?, suppress=? WHERE id=1`
  ).run(
    c.tipo || 'ajuste',
    c.referencia_id ?? null,
    c.referencia_tipo ?? null,
    c.usuario ?? null,
    c.detalle ?? null,
    c.suppress ? 1 : 0
  )
}

// Vuelve el contexto al default ('ajuste', sin referencia). Nunca tira.
function resetCtx(db) {
  try {
    db.prepare(
      `UPDATE stock_ctx SET tipo='ajuste', referencia_id=NULL, referencia_tipo=NULL, usuario=NULL, detalle=NULL, suppress=0 WHERE id=1`
    ).run()
  } catch {}
}

// Corre fn() con el contexto seteado y SIEMPRE lo resetea al terminar (aunque falle).
// Devuelve lo que devuelva fn.
function withStockCtx(db, ctx, fn) {
  setCtx(db, ctx)
  try {
    return fn()
  } finally {
    resetCtx(db)
  }
}

module.exports = { setCtx, resetCtx, withStockCtx, DEFAULT_CTX }
