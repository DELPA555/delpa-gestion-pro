// ─── Caché en memoria + timing para los handlers del dashboard ────────────────
//
// Medición (2026-11-11, DB real): TODAS las queries SQL del dashboard suman
// ~0.26 ms en una pasada — el SQL NO es el cuello de botella. El costo real
// son las llamadas por red a la API de Tienda Nube que hacen algunos handlers
// (dashboard:monthlyProfit y breakeven:data hacen `await getTnSalesForPeriod`).
//
// Este caché evita recalcular y, sobre todo, re-pegarle a la red en cada carga
// del dashboard y en el auto-refresh de 60 s. Se invalida al registrar o anular
// una venta (ver invalidateDashCache en sales.js). Con DASH_PERF=1 loguea el
// tiempo de cada handler para diagnóstico.
//
// En modo multi-caja el caché vive en el proceso servidor (los clientes
// reenvían los canales por HTTP y ejecutan el handler cacheado allí), así que
// una venta de cualquier caja invalida el caché compartido.

const { ipcMain } = require('electron')

const PERF = process.env.DASH_PERF === '1'
const store = new Map() // key -> { exp:number, value:Promise }

function makeKey(channel, args) {
  if (!args || args.length === 0) return channel
  try { return channel + '|' + JSON.stringify(args) } catch { return channel }
}

// Envuelve ipcMain.handle agregando caché TTL + (opcional) medición de tiempo.
// Devuelve una Promise, así que los llamados concurrentes en vuelo se comparten
// (se cachea la promesa, no solo el valor) y los errores no se cachean.
function cachedHandle(channel, ttlMs, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    const key = makeKey(channel, args)
    const now = Date.now()
    const hit = store.get(key)
    if (hit && hit.exp > now) return hit.value

    const started = PERF ? process.hrtime.bigint() : 0n
    const p = Promise.resolve().then(() => fn(event, ...args))
    store.set(key, { exp: now + ttlMs, value: p })
    p.then(
      () => {
        if (PERF) {
          const ms = Number(process.hrtime.bigint() - started) / 1e6
          console.log(`[dash-perf] ${channel} ${ms.toFixed(1)}ms${hit ? ' (stale-refresh)' : ' (miss)'}`)
        }
      },
      () => { store.delete(key) }, // no cachear errores: que el próximo reintente
    )
    return p
  })
}

// Invalida todo el caché del dashboard (llamar al crear/anular ventas).
function invalidateDashCache() {
  store.clear()
}

module.exports = { cachedHandle, invalidateDashCache }
