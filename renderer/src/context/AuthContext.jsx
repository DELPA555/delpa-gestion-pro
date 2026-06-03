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

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
