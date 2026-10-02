const { ipcMain, app, BrowserWindow } = require('electron')
const { getDB } = require('../../database/db')
const { getCurrentSession } = require('./auth')

// ── Mapeo item del checklist → tablas reales de la DB ───────────────────────────
// Cada item borra un conjunto de tablas. Los nombres están verificados contra
// database/schema.js. Algunos items resetean secuencias en `settings` (sale_seq,
// etc) para que la numeración vuelva a empezar desde cero.
const RESET_MAP = {
  productos: {
    label: 'Productos y stock',
    tables: ['products', 'product_sizes', 'tn_product_map', 'tn_variant_map', 'inventory_items', 'inventory_sessions'],
  },
  ventas: {
    label: 'Ventas y tickets',
    tables: ['sales', 'sale_items', 'sale_payments', 'invoices', 'fiscal_comprobantes', 'paused_sales', 'sales_training'],
    seq: ['sale_seq'],
  },
  clientes: {
    label: 'Clientes y puntos',
    tables: ['clients', 'client_points_log', 'account_movements', 'waitlist', 'vouchers'],
  },
  caja_chica: {
    label: 'Historial de caja chica',
    tables: ['cashbox', 'cashbox_movements'],
  },
  caja_grande: {
    label: 'Historial de caja grande',
    tables: ['main_cashbox_movements', 'main_cashbox_openings', 'main_cashbox_audits'],
    extra: (db) => { db.prepare("UPDATE main_cashbox SET balance=0, last_updated=CURRENT_TIMESTAMP WHERE id=1").run() },
  },
  gastos: {
    label: 'Gastos registrados',
    tables: ['expenses'],
  },
  senas: {
    label: 'Señas pendientes y cerradas',
    tables: ['senas'],
    seq: ['sena_seq'],
  },
  pedidos: {
    label: 'Pedidos (proveedores y clientes)',
    tables: ['orders', 'supplier_orders'],
  },
  consignaciones: {
    label: 'Consignaciones y liquidaciones',
    tables: ['consignment_sales', 'consignment_liquidations', 'consignment_products'],
  },
  mercaderia: {
    label: 'Ingresos y egresos de mercadería',
    tables: ['stock_entries', 'stock_egresos', 'stock_egreso_items', 'remitos', 'stock_transfers'],
  },
  cambios: {
    label: 'Tickets de cambio',
    tables: ['change_tickets', 'product_exchanges', 'product_returns'],
    seq: ['change_ticket_seq'],
  },
  proveedores: {
    label: 'Proveedores',
    tables: ['suppliers', 'supplier_payments', 'purchases', 'purchase_items'],
  },
  precios: {
    label: 'Historial de precios',
    tables: ['price_history'],
  },
  informes: {
    label: 'Informes y reportes guardados',
    tables: ['saved_reports'],
  },
}

// Orden en que se muestran en el checklist (coincide con el pedido del dueño)
const ORDER = [
  'productos', 'ventas', 'clientes', 'caja_chica', 'caja_grande', 'gastos',
  'senas', 'pedidos', 'consignaciones', 'mercaderia', 'cambios',
  'proveedores', 'precios', 'informes',
]

function requireAdmin() {
  const s = getCurrentSession()
  if (!s || s.role !== 'admin') {
    throw new Error('Solo el administrador puede resetear el sistema')
  }
}

function driveConnected() {
  try {
    const Store = require('electron-store')
    const store = new Store({ name: 'gdrive-tokens' })
    return !!store.get('tokens')
  } catch {
    return false
  }
}

// ── Info para la pantalla de reseteo ────────────────────────────────────────────
ipcMain.handle('reset:info', () => {
  requireAdmin()
  const db = getDB()
  const get = (k) => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value
  return {
    items: ORDER.map(k => ({ key: k, label: RESET_MAP[k].label })),
    lastResetAt: get('last_reset_at') || null,
    resetCount: Number(get('reset_count') || 0),
    driveConnected: driveConnected(),
  }
})

// ── Ejecutar el reseteo selectivo ───────────────────────────────────────────────
ipcMain.handle('reset:execute', async (_, payload) => {
  requireAdmin()

  const keys = Array.isArray(payload?.items) ? payload.items.filter(k => RESET_MAP[k]) : []
  if (keys.length === 0) {
    return { ok: false, stage: 'validate', error: 'No seleccionaste nada para borrar' }
  }

  const db = getDB()

  // 1. Backup en Drive ANTES de borrar (si está conectado). Si falla, abortamos:
  //    preferimos no perder datos aunque el dueño ya haya confirmado.
  let backup = null
  if (driveConnected()) {
    try {
      const { performBackup } = require('./googledrive')
      const r = await performBackup()
      if (r && r.ok === false) {
        return {
          ok: false, stage: 'backup',
          error: 'No se pudo guardar el backup en Google Drive (la sesión expiró). Reconectá Drive en Configuración → Pagos & Drive, o desconectalo para continuar sin backup.',
        }
      }
      backup = { ok: true }
    } catch (e) {
      return {
        ok: false, stage: 'backup',
        error: 'No se pudo guardar el backup en Google Drive antes de borrar: ' + (e.message || 'error desconocido') + '. No se borró nada.',
      }
    }
  }

  // 2. Borrado en una única transacción. Desactivamos las FK durante la operación
  //    (SQLite no permite cambiar el pragma dentro de una transacción) para poder
  //    borrar padres sin que fallen las restricciones cuando se dejan hijos.
  db.pragma('foreign_keys = OFF')
  try {
    const deletedTables = []

    const run = db.transaction((selected) => {
      const setS = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')

      for (const key of selected) {
        const entry = RESET_MAP[key]
        for (const t of entry.tables) {
          db.prepare(`DELETE FROM "${t}"`).run()
          deletedTables.push(t)
        }
        if (entry.extra) entry.extra(db)
        for (const s of (entry.seq || [])) setS.run(s, '0')
      }

      // Reiniciar autoincrement de las tablas borradas (IDs vuelven a 1)
      if (deletedTables.length) {
        const placeholders = deletedTables.map(() => '?').join(',')
        try { db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${placeholders})`).run(...deletedTables) } catch {}
      }

      // Settings que se reinician SIEMPRE (independiente de lo borrado)
      setS.run('tour_completed', '0')
      setS.run('tour_skipped', '0')
      setS.run('onboarding_completed', '0')
      setS.run('onboarding_dismissed', '0')
      setS.run('active_session_user', '')
      setS.run('last_seen_version', '')

      // Registro del reseteo
      const now = new Date()
      const prevCount = Number(db.prepare("SELECT value FROM settings WHERE key='reset_count'").get()?.value || 0)
      const labels = selected.map(k => RESET_MAP[k].label)
      setS.run('last_reset_at', now.toISOString())
      setS.run('reset_count', String(prevCount + 1))
      setS.run('reset_items', JSON.stringify(labels))
    })

    run(keys)

    const labels = keys.map(k => RESET_MAP[k].label)
    const newCount = Number(db.prepare("SELECT value FROM settings WHERE key='reset_count'").get()?.value || 0)
    return { ok: true, deleted: labels, backup, resetCount: newCount }
  } catch (e) {
    // La transacción hace ROLLBACK automático si algo tira excepción
    return { ok: false, stage: 'delete', error: 'Error durante el borrado (no se aplicó ningún cambio): ' + (e.message || 'error desconocido') }
  } finally {
    db.pragma('foreign_keys = ON')
  }
})

// ── Borrado TOTAL (factory reset): deja la app como recién instalada ─────────────
// Borra TODAS las tablas de la base (datos + settings + usuarios + AFIP + licencia
// + red de locales + recargos + emails) y limpia electron-store. Al relanzar,
// createTables (schema.js) regenera los valores por defecto (admin + business_name
// 'DELPA' + caja), quedando idéntico a una instalación nueva. El renderer limpia
// localStorage antes de relanzar.
ipcMain.handle('reset:factory', async () => {
  requireAdmin()
  const db = getDB()

  // 1. Backup en Drive ANTES de borrar (si está conectado). Si falla, abortamos.
  let backup = null
  if (driveConnected()) {
    try {
      const { performBackup } = require('./googledrive')
      const r = await performBackup()
      if (r && r.ok === false) {
        return {
          ok: false, stage: 'backup',
          error: 'No se pudo guardar el backup en Google Drive (la sesión expiró). Reconectá Drive en Configuración → Pagos & Drive, o desconectalo para continuar sin backup. No se borró nada.',
        }
      }
      backup = { ok: true }
    } catch (e) {
      return {
        ok: false, stage: 'backup',
        error: 'No se pudo guardar el backup en Google Drive antes de borrar: ' + (e.message || 'error desconocido') + '. No se borró nada.',
      }
    }
  }

  // 2. Borrado total de TODAS las tablas (descubiertas dinámicamente para no
  //    dejar ninguna afuera) en una transacción, con FK desactivadas.
  db.pragma('foreign_keys = OFF')
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map(r => r.name)
    const run = db.transaction(() => {
      for (const t of tables) db.prepare(`DELETE FROM "${t}"`).run()
      try { db.prepare('DELETE FROM sqlite_sequence').run() } catch {}
    })
    run()
  } catch (e) {
    return { ok: false, stage: 'delete', error: 'Error durante el borrado total (no se aplicó ningún cambio): ' + (e.message || 'error desconocido') }
  } finally {
    db.pragma('foreign_keys = ON')
  }

  // 3. electron-store: tokens de Google Drive + store por defecto.
  try { const Store = require('electron-store'); new Store({ name: 'gdrive-tokens' }).clear() } catch {}
  try { const Store = require('electron-store'); new Store().clear() } catch {}

  return { ok: true, backup, factory: true }
})

// ── Reiniciar la app (lo llama el front después del countdown) ───────────────────
ipcMain.handle('reset:relaunch', () => {
  requireAdmin()
  setTimeout(() => { app.relaunch(); app.exit(0) }, 250)
  return true
})

module.exports = {}
