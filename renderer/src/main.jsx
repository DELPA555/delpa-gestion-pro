import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { applyAppearance, readAppearance } from './lib/appearance'
import { api } from './lib/api'

// Aplica las últimas preferencias de apariencia antes del primer render (sin flash).
// Al loguear, AuthContext reaplica las del usuario que corresponda.
applyAppearance(readAppearance())

// Logs técnicos: capturar errores no atrapados del renderer.
window.addEventListener('error', (ev) => {
  try { api.techLogs.log({ level: 'error', module: 'ui', message: ev?.message || 'Error de UI', detail: ev?.error?.stack || `${ev?.filename || ''}:${ev?.lineno || ''}` }) } catch {}
})
window.addEventListener('unhandledrejection', (ev) => {
  const r = ev?.reason
  try { api.techLogs.log({ level: 'error', module: 'ui', message: 'Promesa sin manejar: ' + (r?.message || r), detail: r?.stack || '' }) } catch {}
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
