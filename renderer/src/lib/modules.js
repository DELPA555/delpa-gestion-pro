// Sistema de módulos activables/desactivables (v1.45.1).
// Fuente ÚNICA de verdad: la navegación lateral (Sidebar) y la pantalla de
// Configuración (Settings) importan de acá para no desincronizarse.
//
// Cada módulo se persiste en la tabla `settings` con la clave `mod_<key>`
// ('1' = activo, '0' = inactivo). Ventas y Productos son el núcleo del sistema:
// están marcados como `locked` y NO se pueden desactivar.
//
// Desactivar un módulo sólo OCULTA su acceso en el menú: nunca borra datos ni
// credenciales. Reactivarlo vuelve a mostrar todo tal cual estaba.

export const MODULES = [
  {
    key: 'ventas', label: 'Ventas', locked: true, default: '1', routes: ['/ventas'],
    desc: 'Punto de venta y registro de ventas. Núcleo del sistema.',
  },
  {
    key: 'productos', label: 'Productos', locked: true, default: '1', routes: ['/productos'],
    desc: 'Catálogo, stock y precios. Núcleo del sistema.',
  },
  {
    key: 'clientes', label: 'Clientes', default: '1', routes: ['/clientes', '/cuentas'],
    desc: 'Ficha de clientes, cuentas corrientes y puntos de fidelización.',
  },
  {
    // Caja es núcleo del sistema (como Ventas y Productos): SIEMPRE visible, no se
    // puede desactivar. locked=true hace que isModuleEnabled la dé por activa aunque
    // en una instalación existente haya quedado mod_caja='0' por un apagado previo.
    key: 'caja', label: 'Caja / Movimientos', locked: true, default: '1', routes: ['/caja', '/gastos'],
    desc: 'Apertura y cierre de caja, movimientos de dinero y gastos. Núcleo del sistema.',
  },
  {
    // Caja Grande (caja central / consolidación de las cajas chicas). Es un módulo
    // propio: NO depende de Multi-caja (funciona también en un solo local). Visible
    // por defecto; se puede ocultar desde Ajustes → Módulos activos.
    key: 'caja_grande', label: 'Caja Grande', default: '1', routes: ['/caja-grande'],
    desc: 'Caja central que consolida y resume las cajas chicas (apertura, cierre y transferencias).',
  },
  {
    key: 'proveedores', label: 'Proveedores', default: '1', routes: ['/proveedores', '/compras', '/reposicion'],
    desc: 'Proveedores, compras y pedidos de reposición de mercadería.',
  },
  {
    key: 'informes', label: 'Informes / Reportes', default: '1', routes: ['/reportes', '/informes'],
    desc: 'Reportes de ventas, rentabilidad e informes automáticos por email.',
  },
  {
    key: 'creditos', label: 'Créditos', default: '0', routes: ['/creditos'],
    desc: 'Ventas financiadas en cuotas con intereses y seguimiento de pagos.',
  },
  {
    key: 'consignacion', label: 'Consignación', default: '0', routes: ['/consignacion'],
    desc: 'Mercadería a consignación de proveedores y su liquidación.',
  },
  {
    key: 'promotions', label: 'Promociones', default: '0', routes: ['/promociones'],
    desc: 'Promos que se aplican solas en la venta: 2x1, Nx1, combos y descuentos por cantidad.',
  },
  {
    // Sin entrada propia en el menú lateral: controla la sincronización y su
    // pestaña de configuración. Las credenciales NO se borran al desactivar.
    key: 'tiendanube', label: 'Tienda Nube (sync)', default: '0', routes: [], tab: 'tiendanube',
    desc: 'Sincronización de productos, stock y pedidos con tu tienda de Tienda Nube.',
  },
  {
    key: 'multicaja', label: 'Multi-caja', default: '0', routes: [], tab: 'multicaja',
    desc: 'Caja central para varias terminales o sucursales en red local.',
  },
  {
    key: 'afip', label: 'AFIP / Facturación', default: '0', routes: ['/facturacion'], tab: 'afip',
    desc: 'Facturación electrónica con CAE ante AFIP/ARCA. El certificado se conserva.',
  },
]

export const moduleKey = (key) => `mod_${key}`

// Dado el mapa de settings (api.settings.getAll()), indica si un módulo está activo,
// respetando el default de cada módulo y el flag `locked` (siempre activo).
export function isModuleEnabled(settingsMap, key) {
  const mod = MODULES.find(m => m.key === key)
  if (!mod) return true
  if (mod.locked) return true
  const v = settingsMap?.[moduleKey(key)]
  if (v === undefined || v === null || v === '') return mod.default === '1'
  return String(v) === '1'
}

// Conjunto de rutas (`to` del menú) que deben ocultarse según el estado de los módulos.
export function hiddenRoutes(settingsMap) {
  const hidden = new Set()
  for (const m of MODULES) {
    if (m.locked) continue
    if (!isModuleEnabled(settingsMap, m.key) && Array.isArray(m.routes)) {
      for (const r of m.routes) hidden.add(r)
    }
  }
  return hidden
}
