import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { applyAppearance, readAppearance } from './lib/appearance'

// Aplica las últimas preferencias de apariencia antes del primer render (sin flash).
// Al loguear, AuthContext reaplica las del usuario que corresponda.
applyAppearance(readAppearance())

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
