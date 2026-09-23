// Datos del tour guiado, mini-tours por módulo y textos de tooltips.
// Los selectores apuntan a atributos data-tour="..." en el layout/páginas.
// Si un selector no existe (por permisos o layout), el paso cae al centro.

export const SOPORTE = { tel: '11 3857-4444', wa: '5491138574444', web: 'delpagestion.com.ar' }

// Tour principal (al iniciar por primera vez). route = a qué ruta navegar antes del paso.
export const MAIN_TOUR = [
  { id: 'welcome', route: '/', sel: '[data-tour="brand"]', title: '¡Bienvenida a DELPA Gestión PRO!',
    body: 'En los próximos minutos te mostramos todo lo que podés hacer. ¿Lista? Podés salir cuando quieras con “Saltar tour”.' },
  { id: 'sidebar', route: '/', sel: '[data-tour="sidebar"]', title: 'Tu menú principal',
    body: 'Desde acá accedés a todos los módulos del sistema. Empecemos por los más importantes.' },
  { id: 'dash-ventas', route: '/', sel: '[data-tour="dash-ventas"]', title: 'El Dashboard',
    body: 'Un resumen completo de tu negocio en tiempo real: ventas del día, ganancias, stock crítico y recomendaciones de la IA.' },
  { id: 'ventas-buscar', route: '/ventas', sel: '[data-tour="ventas-buscador"]', title: 'Registrar una venta',
    body: 'Buscá el producto por nombre o escaneá el código de barras con el lector. El stock se descuenta automáticamente.' },
  { id: 'ventas-carrito', route: '/ventas', sel: '[data-tour="ventas-carrito"]', title: 'El carrito',
    body: 'Los productos se agregan acá. Podés cambiar la cantidad, aplicar descuentos por monto o porcentaje, y elegir el medio de pago.' },
  { id: 'ventas-pagos', route: '/ventas', sel: '[data-tour="ventas-pagos"]', title: 'Medios de pago',
    body: 'Efectivo, transferencia, débito, crédito o Mercado Pago QR. Si cobrás en efectivo, DELPA calcula el vuelto automáticamente.' },
  { id: 'productos', route: '/productos', sel: '[data-tour="nav-productos"]', title: 'Tu catálogo',
    body: 'Acá cargás tus productos. Cada uno con sus talles y colores, cada talle con su propio código de barras y stock individual.' },
  { id: 'caja', route: '/caja', sel: '[data-tour="nav-caja"]', title: 'La caja',
    body: 'Abrí la caja al empezar el día y cerrala al terminar. Al cerrar te llega un informe por email con el resumen del día.' },
  { id: 'clientes', route: '/clientes', sel: '[data-tour="nav-clientes"]', title: 'Tus clientas',
    body: 'Guardá sus datos: historial de compras, puntos acumulados, cuenta corriente y lista de espera para talles sin stock.' },
  { id: 'dash-ia', route: '/', sel: '[data-tour="dash-ia"]', title: 'Recomendaciones con IA',
    body: 'La inteligencia analiza tus ventas y te avisa cuando un producto se está por agotar o tenés stock sin rotación.' },
  { id: 'dash-fiscal', route: '/', sel: '[data-tour="dash-fiscal"]', title: 'Control fiscal',
    body: 'Controlá tu facturación vs el límite del monotributo en tiempo real. Te avisamos al 80% y 95% para que nunca te sorprenda.' },
  { id: 'config', route: '/configuracion', sel: '[data-tour="nav-configuracion"]', title: 'Configuración',
    body: 'Antes de empezar configurá el nombre de tu negocio, el email para los informes y conectá Google Drive para los backups.' },
  { id: 'final', route: '/', center: true, title: '¡Listo! 🚀',
    body: `Ya conocés lo más importante de DELPA. Si tenés dudas, tocá el botón ❓ en cualquier momento.\nSoporte: 📱 ${SOPORTE.tel} · ${SOPORTE.web}`,
    finish: '¡Empezar a usar DELPA! 🚀' },
]

// Mini-tours por módulo (botón ❓ Ayuda en el header de cada uno).
export const MODULE_TOURS = {
  ventas: [
    { id: 'v1', sel: '[data-tour="ventas-buscador"]', title: 'Buscar productos', body: 'Escribí el nombre o escaneá el código de barras. También podés filtrar por talle.' },
    { id: 'v2', sel: '[data-tour="ventas-carrito"]', title: 'Carrito', body: 'Ajustá cantidades y descuentos. El total se actualiza solo.' },
    { id: 'v3', sel: '[data-tour="ventas-pagos"]', title: 'Cobro', body: 'Elegí el medio de pago (o pago dividido) y, si es efectivo, DELPA calcula el vuelto.' },
    { id: 'v4', sel: '[data-tour="ventas-pausar"]', title: 'Pausar venta', body: 'Guardá el carrito para atender otra clienta y retomalo después (hasta 3 a la vez).' },
    { id: 'v5', sel: '[data-tour="ventas-ingresar"]', title: 'Cerrar la venta', body: 'INGRESAR registra con ticket interno; FACTURAR emite factura electrónica AFIP con CAE.' },
  ],
  productos: [
    { id: 'p1', sel: '[data-tour="productos-nuevo"]', title: 'Nuevo producto', body: 'Cargá nombre, categoría, precio y los talles/colores con su stock.' },
    { id: 'p2', sel: '[data-tour="productos-talle"]', title: 'Buscar por talle', body: 'Encontrá al instante qué tenés en un talle puntual (38, XL, 42…).' },
  ],
  caja: [
    { id: 'c1', sel: '[data-tour="caja-abrir"]', title: 'Abrir / cerrar', body: 'Abrí con el fondo inicial y cerrá al final del día. El efectivo se transfiere solo a la Caja Grande.' },
  ],
  clientes: [
    { id: 'cl1', sel: '[data-tour="clientes-lista"]', title: 'Tus clientas', body: 'Ficha con historial, puntos, cuenta corriente y lista de espera.' },
  ],
}

// Tooltips (hover) por clave. Máx ~2 líneas.
export const TOOLTIPS = {
  ingresar: 'Registra la venta con ticket interno (sin factura AFIP)',
  facturar: 'Registra la venta y emite factura electrónica con CAE de AFIP',
  cajaGrande: 'Caja central donde se acumula el efectivo de todos los turnos',
  consignacion: 'Mercadería de proveedores que pagás cuando la vendés',
  healthScore: 'Indica qué tan completo y aprovechado está tu sistema (0-100)',
  descuentoPct: 'Se calcula sobre el precio sin recargo del medio de pago',
  puntosTicket: 'Los puntos vencen a los 6 meses si no se usan',
  pausar: 'Guarda el carrito actual para atender otra clienta',
  ia: 'Recomendaciones basadas en tu historial de ventas de los últimos 90 días',
}
