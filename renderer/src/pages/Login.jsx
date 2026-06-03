import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { LogIn, Eye, EyeOff, AlertCircle } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/lib/api'

export default function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [rememberUser, setRememberUser] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [bizName, setBizName] = useState('DELPA')

  useEffect(() => {
    api.settings.get('business_name').then(n => { if (n) setBizName(n) }).catch(() => {})
    // Pre-fill last username
    api.auth.lastUser().then(r => {
      if (r?.username) { setUsername(r.username); setRememberUser(true) }
    }).catch(() => {})
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password) { setError('Ingresá usuario y contraseña'); return }
    setLoading(true)
    setError('')
    try {
      const res = await login(username.trim(), password)
      if (res.ok) {
        api.auth.lastUser(rememberUser ? username.trim() : '').catch(() => {})
      } else {
        setError(res.error || 'Error al iniciar sesión')
      }
    } catch {
      setError('Error de conexión')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen w-screen bg-surface flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-sm"
      >
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto mb-4">
            <LogIn size={24} className="text-accent" />
          </div>
          <h1 className="text-xl font-bold text-white">{bizName}</h1>
          <p className="text-sm text-zinc-500 mt-1">Gestión PRO — Iniciar sesión</p>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-xl">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1">Usuario</label>
              <input
                className="input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 no-drag"
                placeholder="admin"
                value={username}
                onChange={e => { setUsername(e.target.value); setError('') }}
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 uppercase tracking-wider mb-1">Contraseña</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  className="input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 no-drag pr-10"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError('') }}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 no-drag"
                >
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="rememberUser"
                type="checkbox"
                checked={rememberUser}
                onChange={e => setRememberUser(e.target.checked)}
                className="no-drag w-3.5 h-3.5 accent-[color:var(--color-accent)]"
              />
              <label htmlFor="rememberUser" className="text-xs text-zinc-500 cursor-pointer select-none">
                Recordar usuario
              </label>
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400">
                <AlertCircle size={13} />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-2.5 rounded-lg text-sm font-semibold no-drag"
            >
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-zinc-700 mt-6">DELPA Gestión PRO</p>
      </motion.div>
    </div>
  )
}
