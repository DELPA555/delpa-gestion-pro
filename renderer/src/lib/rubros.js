// Rubros del negocio (v1.48.0). El rubro define comportamientos por defecto:
// con/sin talles, con/sin unidad de medida. Se guarda en settings con la key `rubro`.
export const RUBROS = [
  { v: 'indumentaria', label: 'Indumentaria / Calzado', desc: 'Productos con talles y colores (el comportamiento clásico).' },
  { v: 'almacen',      label: 'Almacén / Dietética',    desc: 'Sin talles ni colores. Con unidad de medida (kg, lt, etc.).' },
  { v: 'ferreteria',   label: 'Ferretería / Materiales', desc: 'Sin talles. Con unidad de medida y cantidades.' },
  { v: 'farmacia',     label: 'Farmacia / Perfumería',  desc: 'Sin talles. Pensado para productos con vencimiento.' },
  { v: 'general',      label: 'Otros / General',        desc: 'Sin talles ni restricciones.' },
]

export const DEFAULT_RUBRO = 'indumentaria'

// Sólo Indumentaria maneja talles. Cualquier otro rubro oculta la grilla de talles
// (el stock se maneja como una única cantidad por producto, igual que `no_sizes`).
export function rubroHasSizes(rubro) {
  return (rubro || DEFAULT_RUBRO) === 'indumentaria'
}

// Rubros que muestran un campo "unidad de medida" (texto libre: kg, lt, m…).
export function rubroHasUnit(rubro) {
  return rubro === 'almacen' || rubro === 'ferreteria'
}

export function rubroLabel(rubro) {
  return (RUBROS.find(r => r.v === rubro) || RUBROS[0]).label
}
