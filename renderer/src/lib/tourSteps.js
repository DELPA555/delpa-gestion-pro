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
    { id: 'cl1', center: true, title: 'Tus clientas', body: 'Acá guardás la información de tus clientas: historial de compras, puntos, cuenta corriente y más.' },
    { id: 'cl2', sel: '[data-tour="clientes-nueva"]', title: 'Nueva clienta', body: 'Cargá nombre, teléfono, email y cumpleaños. El cumpleaños te permite felicitarla y darle un beneficio.' },
    { id: 'cl3', sel: '[data-tour="clientes-lista"]', title: 'Historial', body: 'Al hacer click en una clienta ves todas sus compras anteriores, los talles que usa y sus productos favoritos.' },
    { id: 'cl4', center: true, title: 'Puntos', body: 'Los puntos se acumulan automáticamente en cada compra y vencen a los 6 meses si no se usan.' },
    { id: 'cl5', center: true, title: 'Lista de espera', body: 'Si pide un talle que no tenés, la anotás en lista de espera. Cuando llega el talle, DELPA te avisa para contactarla.' },
  ],

  caja: [
    { id: 'ca1', center: true, title: 'Caja del día', body: 'Este módulo registra el dinero del día en el local. Abrí la caja al empezar y cerrala al terminar el turno.' },
    { id: 'ca2', sel: '[data-tour="caja-abrir"]', title: 'Abrir caja', body: 'Ingresá el fondo inicial (el dinero con el que arrancás). Si no tenés fondo, ponés 0.' },
    { id: 'ca3', sel: '[data-tour="caja-movimientos"]', title: 'Movimientos', body: 'Acá ves todas las ventas, gastos e ingresos del turno en tiempo real.' },
    { id: 'ca4', sel: '[data-tour="caja-abrir"]', title: 'Cerrar caja', body: 'Al cerrar, contás el efectivo físico. DELPA compara con lo esperado y te muestra si sobra o falta. Te llega un resumen por email.' },
  ],

  cajaGrande: [
    { id: 'cg1', center: true, title: 'Caja Grande', body: 'Es tu caja central o caja fuerte. Acá se acumula el efectivo de todos los cierres de caja del día.' },
    { id: 'cg2', sel: '[data-tour="cajagrande-saldo"]', title: 'Saldo actual', body: 'Este es el saldo actual de tu caja grande. Se actualiza automáticamente cada vez que cerrás una caja chica.' },
    { id: 'cg3', center: true, title: 'Transferencia automática', body: 'Cuando cerrás la caja chica, el efectivo contado se transfiere automáticamente acá.' },
    { id: 'cg4', sel: '[data-tour="cajagrande-mov"]', title: 'Movimientos manuales', body: 'Podés registrar ingresos y egresos manuales: pagos a proveedores, retiros del dueño, depósitos.' },
    { id: 'cg5', center: true, title: 'Avisos por email', body: 'Cada movimiento te llega por email con el detalle y el saldo actualizado.' },
  ],

  reportes: [
    { id: 're1', center: true, title: 'Reportes', body: 'Los reportes te dan información detallada para tomar mejores decisiones en tu negocio.' },
    { id: 're2', sel: '[data-tour="reportes-tabs"]', title: 'Ranking de productos', body: 'Ranking de los más vendidos con unidades, ingresos y comparativa vs el período anterior.' },
    { id: 're3', center: true, title: 'Análisis de colores', body: 'Qué colores se venden más por categoría. Útil para saber qué reponer.' },
    { id: 're4', center: true, title: 'Rentabilidad', body: 'Ganancia real por categoría, con margen % para saber qué es más negocio.' },
    { id: 're5', center: true, title: 'Deudas', body: 'Clientes con cuenta corriente vencida, con botón directo de WhatsApp para cobrar.' },
    { id: 're6', center: true, title: 'Exportar', body: 'Todos los reportes se pueden exportar a PDF o CSV para compartir con tu contador.' },
  ],

  fiscal: [
    { id: 'fi1', center: true, title: 'Control fiscal', body: 'Este módulo controla tu situación fiscal en tiempo real para que nunca te sorprenda la AFIP.' },
    { id: 'fi2', center: true, title: 'Barra del monotributo', body: 'Ves cuánto facturaste vs el límite de tu categoría. Solo cuenta facturas con CAE real.' },
    { id: 'fi3', center: true, title: 'Alertas', body: 'Al llegar al 80% del límite aparece una alerta amarilla; al 95% una roja. Tiempo de actuar.' },
    { id: 'fi4', center: true, title: 'Proyección', body: 'DELPA calcula en qué fecha superarías el límite si seguís al mismo ritmo de facturación.' },
    { id: 'fi5', center: true, title: 'IVA (Responsable Inscripto)', body: 'Si sos RI, ves tu posición mensual de IVA: débito vs crédito y saldo a pagar o a favor.' },
  ],

  consignacion: [
    { id: 'co1', center: true, title: 'Consignación', body: 'Mercadería de un proveedor que pagás solo cuando la vendés, no al recibirla.' },
    { id: 'co2', sel: '[data-tour="consignacion-lista"]', title: 'Proveedores', body: 'Ves todos los proveedores con mercadería en consignación y la deuda acumulada con cada uno.' },
    { id: 'co3', center: true, title: 'Deuda automática', body: 'Cada vez que vendés un producto en consignación, la deuda al proveedor se suma sola.' },
    { id: 'co4', center: true, title: 'Liquidar', body: 'Cuando querés pagar, hacés click en Liquidar. DELPA genera un PDF con el detalle para que el proveedor firme.' },
    { id: 'co5', center: true, title: 'Stock', body: 'Podés ver el stock en consignación por proveedor y enviárselo por email directamente.' },
  ],

  inventario: [
    { id: 'in1', center: true, title: 'Inventario físico', body: 'Te permite comparar el stock real del local vs lo que dice el sistema.' },
    { id: 'in2', sel: '[data-tour="inventario-escanear"]', title: 'Escanear', body: 'Escaneá todos los productos con el lector, sin importar el orden. DELPA lleva la cuenta.' },
    { id: 'in3', center: true, title: 'Comparativa', body: 'Al finalizar, DELPA muestra las diferencias: qué productos tienen más o menos stock del esperado.' },
    { id: 'in4', center: true, title: 'Ajuste', body: 'Si querés que el sistema quede igual al inventario real, hacé click en Ajustar stock.' },
  ],

  reposicion: [
    { id: 'rp1', center: true, title: 'Pedidos a proveedores', body: 'Organizá los pedidos con grilla de talles y generá un PDF para enviar por WhatsApp.' },
    { id: 'rp2', sel: '[data-tour="reposicion-nuevo"]', title: 'Nuevo pedido', body: 'Elegí el proveedor y agregá productos con la grilla de talles. Solo se procesan los talles con cantidad > 0.' },
    { id: 'rp3', center: true, title: 'Estados', body: 'El pedido pasa por: Borrador → Enviado → Confirmado → Recibido.' },
    { id: 'rp4', center: true, title: 'Recibir', body: 'Al marcar como Recibido, el pedido se convierte automáticamente en un Ingreso de Mercadería.' },
  ],

  egresos: [
    { id: 'eg1', center: true, title: 'Egreso de mercadería', body: 'Registrá la devolución de mercadería a un proveedor para mantener el stock actualizado.' },
    { id: 'eg2', sel: '[data-tour="egresos-nuevo"]', title: 'Proveedor y motivo', body: 'Seleccioná el proveedor y el motivo: defecto, talle incorrecto, exceso de stock.' },
    { id: 'eg3', center: true, title: 'Grilla de talles', body: 'Ingresá cuántas unidades de cada talle devolvés. El stock actual se muestra como referencia.' },
    { id: 'eg4', center: true, title: 'PDF de devolución', body: 'Al confirmar, DELPA genera un PDF para que el proveedor lo firme y vos tengas el comprobante.' },
  ],

  etiquetas: [
    { id: 'et1', center: true, title: 'Etiquetas', body: 'Imprimí etiquetas con código de barras para todos tus productos.' },
    { id: 'et2', center: true, title: 'Selección', body: 'Seleccioná los productos a etiquetar. Podés elegir por categoría o proveedor.' },
    { id: 'et3', center: true, title: 'Cantidad', body: 'Para cada producto elegí qué talles y cuántas etiquetas de cada uno.' },
    { id: 'et4', center: true, title: 'Formatos', body: 'A4 imprime 65 etiquetas por hoja. Brother QL-700 imprime en rollo térmico. Importante: imprimir al 100% sin escalar.' },
  ],

  config: [
    { id: 'cf1', center: true, title: 'Configuración', body: 'Configurá correctamente el sistema antes de empezar a usar DELPA.' },
    { id: 'cf2', sel: '[data-tour="config-nav"]', title: 'Datos del negocio', body: 'Completá nombre, CUIT, dirección y logo. Estos datos aparecen en tickets y facturas.' },
    { id: 'cf3', center: true, title: 'Email', body: 'Configurá tu Gmail con contraseña de aplicación para recibir informes y cierres de caja.' },
    { id: 'cf4', center: true, title: 'Integraciones', body: 'Conectá Google Drive (backups), Tienda Nube (stock online) y Mercado Pago (cobro con QR).' },
    { id: 'cf5', center: true, title: 'AFIP', body: 'Configurá tu CUIT y certificado digital de AFIP para emitir facturas electrónicas con CAE.' },
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
