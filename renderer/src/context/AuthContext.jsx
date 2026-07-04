import { createContext, useContext, useState, useEffect } from 'react'
import { api } from '@/lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined) // undefined = loading
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.auth.session()
      .then(u => { setUser(u || null); setLoading(false) })
      .catch(() => { setUser(null); setLoading(false) })
  }, [])

  const login = async (username, password) => {
    const res = await api.auth.login({ username, password })
    if (res.ok) setUser(res.user)
    return res
  }

  const logout = async () => {
    await api.auth.logout()
    setUser(null)
  }

  // Timer de inactividad: solo si "Mantener sesión activa" está apagado.
  // Cualquier actividad del usuario reinicia el reloj; al vencer, cierra sesión.
  useEffect(() => {
    if (!user) return
    let timer = null
    let removeListeners = () => {}
    let active = true
    api.settings.getAll().then(cfg => {
      if (!active) return
      if ((cfg.keep_session_active ?? '1') === '1') return // nunca expira
      const timeoutMs = (parseInt(cfg.session_timeout_minutes || '480', 10) || 480) * 60000
      let lastTouch = 0
      const reset = () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => { logout() }, timeoutMs)
        const now = Date.now()
        if (now - lastTouch > 30000) { lastTouch = now; api.auth.touch().catch(() => {}) }
      }
      const evts = ['mousedown', 'keydown', 'wheel', 'touchstart']
      evts.forEach(e => window.addEventListener(e, reset, { passive: true }))
      removeListeners = () => evts.forEach(e => window.removeEventListener(e, reset))
      reset()
    }).catch(() => {})
    return () => { active = false; removeListeners(); if (timer) clearTimeout(timer) }
  }, [user])

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
