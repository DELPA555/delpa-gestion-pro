// Preferencias de apariencia/accesibilidad (tamaño de texto + tipo de letra).
// Se guardan en localStorage por usuario (clave `appearance:<username>`) y además
// en `appearance:last` para aplicarlas al instante en el arranque, antes de saber
// quién va a loguear (evita el "flash" de fuente). Es device-local, igual que el tema.
//
// El tamaño se aplica cambiando el font-size del <html>: como toda la UI usa
// utilidades rem de Tailwind, el texto escala proporcionalmente. La familia se
// aplica en el <body> vía variable CSS y se hereda a toda la app (salvo el ticket,
// que fuerza monoespaciada aparte).

export const FONT_SIZES = {
  small:  { label: 'Pequeño',    px: '14px' },
  normal: { label: 'Normal',     px: '16px' }, // = tamaño actual de la app (default)
  large:  { label: 'Grande',     px: '18px' },
  xlarge: { label: 'Muy grande', px: '20px' },
}

export const FONT_FAMILIES = {
  inter:        { label: 'Inter (predeterminada)',   stack: "ui-sans-serif, system-ui, -apple-system, 'Inter', sans-serif" },
  arial:        { label: 'Arial (clásica)',          stack: 'Arial, Helvetica, sans-serif' },
  georgia:      { label: 'Georgia (serif, fácil de leer)', stack: "Georgia, 'Times New Roman', serif" },
  opendyslexic: { label: 'OpenDyslexic (para dislexia)',   stack: "'OpenDyslexic', 'Inter', sans-serif" },
}

export const DEFAULT_APPEARANCE = { size: 'normal', family: 'inter' }

function normalize(prefs) {
  const p = prefs || {}
  return {
    size:   FONT_SIZES[p.size] ? p.size : DEFAULT_APPEARANCE.size,
    family: FONT_FAMILIES[p.family] ? p.family : DEFAULT_APPEARANCE.family,
  }
}

// Aplica las preferencias al documento (sin persistir).
export function applyAppearance(prefs) {
  const { size, family } = normalize(prefs)
  const root = document.documentElement
  root.style.setProperty('--app-font-size', FONT_SIZES[size].px)
  root.style.setProperty('--app-font-family', FONT_FAMILIES[family].stack)
}

// Lee las preferencias guardadas para un usuario (o las últimas usadas / defaults).
export function readAppearance(username) {
  try {
    const raw = (username && localStorage.getItem(`appearance:${username}`)) || localStorage.getItem('appearance:last')
    if (raw) return normalize(JSON.parse(raw))
  } catch {}
  return { ...DEFAULT_APPEARANCE }
}

// Guarda para el usuario + como "últimas usadas" y aplica.
export function saveAppearance(username, prefs) {
  const clean = normalize(prefs)
  try {
    const data = JSON.stringify(clean)
    if (username) localStorage.setItem(`appearance:${username}`, data)
    localStorage.setItem('appearance:last', data)
  } catch {}
  applyAppearance(clean)
  return clean
}
