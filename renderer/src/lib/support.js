// Datos de contacto de soporte y ventas de DELPA Gestión PRO.
// Centralizados acá para reutilizarlos en trial, licencia vencida, configuración, footer y about.

export const SUPPORT = {
  phoneDisplay: '11 3857-4444',
  phoneE164: '5491138574444',
  email: 'delpa555@gmail.com',
  web: 'delpagestion.com.ar',
  webUrl: 'https://delpagestion.com.ar',
}

export const DEFAULT_WA_MSG = 'Hola, quiero activar mi licencia de DELPA Gestión PRO'

export const waLink = (text = DEFAULT_WA_MSG) =>
  `https://wa.me/${SUPPORT.phoneE164}?text=${encodeURIComponent(text)}`

export const mailtoLink = (subject = 'Licencia DELPA Gestión PRO') =>
  `mailto:${SUPPORT.email}?subject=${encodeURIComponent(subject)}`

// Abre un enlace externo. Usa el shell de Electron si está disponible; si no, window.open.
export function openExternal(url) {
  try {
    if (window.electron?.invoke) { window.electron.invoke('shell:openExternal', url); return }
  } catch {}
  try { window.open(url, '_blank') } catch {}
}
