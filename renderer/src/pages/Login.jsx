import { useState, useEffect } from 'react'
import { motion, useAnimationControls } from 'framer-motion'
import { Eye, EyeOff, AlertCircle, User, Lock, ArrowRight, Loader2, MessageCircle } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/lib/api'
import { SUPPORT, waLink, openExternal } from '@/lib/support'

const AR_TZ = 'America/Argentina/Buenos_Aires'

function greeting() {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: AR_TZ, hour: '2-digit', hour12: false }))
  if (h >= 6 && h < 12) return '🌅 Buenos días'
  if (h >= 12 && h < 19) return '☀️ Buenas tardes'
  return '🌙 Buenas noches'
}

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'D'
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase()
}

export default function Login() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [rememberUser, setRememberUser] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [bizName, setBizName] = useState('DELPA')
  // Visual-only (no afectan la autenticación)
  const [bizLogo, setBizLogo] = useState('')
  const [version, setVersion] = useState('')
  const [users, setUsers] = useState([])
  const [shakeKey, setShakeKey] = useState(0)
  const [success, setSuccess] = useState(false)
  const shakeControls = useAnimationControls()

  useEffect(() => {
    api.settings.getAll().then(all => {
      if (all?.business_name) setBizName(all.business_name)
      if (all?.business_logo) setBizLogo(all.business_logo)
    }).catch(() => {})
    // Pre-fill last username
    api.auth.lastUser().then(r => {
      if (r?.username) { setUsername(r.username); setRememberUser(true) }
    }).catch(() => {})
    api.updater.getCurrentVersion().then(v => setVersion(v)).catch(() => {})
    // Selector visual de usuarios (best-effort; no gatea el login)
    api.auth.users.list().then(list => {
      setUsers((list || []).filter(u => u.active !== 0))
    }).catch(() => {})
  }, [])

  // Shake al fallar (solo visual)
  useEffect(() => {
    if (shakeKey > 0) shakeControls.start({ x: [0, -10, 10, -8, 8, -4, 4, 0], transition: { duration: 0.35 } })
  }, [shakeKey, shakeControls])

  // Envuelve setError para disparar el shake sin cambiar la lógica de auth
  const showError = (msg) => { setError(msg); setShakeKey(k => k + 1) }

  const submit = async (e) => {
    e.preventDefault()
    if (!username.trim() || !password) { showError('Ingresá usuario y contraseña'); return }
    setLoading(true)
    setError('')
    try {
      const res = await login(username.trim(), password)
      if (res.ok) {
        api.auth.lastUser(rememberUser ? username.trim() : '').catch(() => {})
        setSuccess(true)
      } else {
        showError(res.error || 'Error al iniciar sesión')
      }
    } catch {
      showError('Error de conexión')
    } finally {
      setLoading(false)
    }
  }

  const hasName = bizName && bizName.trim() && bizName.trim().toUpperCase() !== 'DELPA'
  const heading = hasName ? `Bienvenida a ${bizName}` : 'DELPA Gestión PRO'
  const inputBase = 'input-field w-full bg-[#181818] rounded-[10px] pl-10 pr-3 py-3.5 text-sm text-white placeholder-zinc-600 no-drag transition-colors'
  const inputBorder = error ? 'border border-red-500/60' : 'border border-[#252525] focus:border-accent'

  return (
    <motion.div
      animate={{ opacity: success ? 0 : 1 }}
      transition={{ duration: 0.35 }}
      className="h-screen w-screen relative overflow-hidden flex flex-col items-center justify-center"
      style={{ background: '#0A0A0A', fontFamily: "'Space Grotesk', system-ui, sans-serif" }}
    >
      {/* Fondo: grid sutil animado */}
      <motion.div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(#252525 1px, transparent 1px), linear-gradient(90deg, #252525 1px, transparent 1px)',
          backgroundSize: '50px 50px',
          opacity: 0.3,
        }}
        animate={{ backgroundPosition: ['0px 0px', '50px 50px'] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'linear' }}
      />
      {/* Fondo: glow radial rosa muy sutil */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(233,30,140,0.05), transparent)' }}
      />

      {/* Saludo (fuera de la card) */}
      <motion.p
        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 0.7, y: 0 }} transition={{ duration: 0.5 }}
        className="relative z-10 text-white text-lg mb-5 text-center"
      >
        {greeting()}
      </motion.p>

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative z-10 w-[420px] max-w-[92vw]"
      >
        <motion.div
          animate={shakeControls}
          style={{ background: '#111111', boxShadow: '0 0 80px rgba(233,30,140,0.08)' }}
          className="border border-[#252525] rounded-[20px] p-12"
        >
          {/* Header */}
          <div className="text-center mb-7">
            {bizLogo ? (
              <img src={bizLogo} alt="logo" className="mx-auto mb-4 max-w-[120px] max-h-[80px] object-contain" />
            ) : (
              <div className="w-[60px] h-[60px] rounded-full bg-accent flex items-center justify-center mx-auto mb-4 shadow-lg shadow-accent/20">
                <span className="text-white text-2xl font-bold">{getInitials(bizName)}</span>
              </div>
            )}
            <h1 className="text-white font-bold" style={{ fontSize: '24px' }}>{heading}</h1>
            <p className="text-[#9CA3AF] mt-1" style={{ fontSize: '14px' }}>Ingresá tu contraseña para continuar</p>
            {version && (
              <span className="inline-block mt-3 text-[11px] text-zinc-500 bg-[#181818] border border-[#252525] rounded-full px-2.5 py-0.5">
                v{version}
              </span>
            )}
          </div>

          {/* Selector visual de usuarios (si hay más de uno) */}
          {users.length > 1 && (
            <div className="flex flex-wrap gap-2 mb-5 justify-center">
              {users.map(u => {
                const selected = username.trim().toLowerCase() === u.username.toLowerCase()
                return (
                  <button
                    key={u.id} type="button"
                    onClick={() => { setUsername(u.username); setError('') }}
                    className={`no-drag flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-colors ${
                      selected ? 'border-accent bg-accent/10 text-white' : 'border-[#252525] text-zinc-400 hover:border-accent/50'
                    }`}
                  >
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${selected ? 'bg-accent text-white' : 'bg-[#252525] text-zinc-300'}`}>
                      {getInitials(u.username)}
                    </span>
                    {u.username}
                  </button>
                )
              })}
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            {/* Usuario */}
            <div>
              <label className="block text-xs text-[#9CA3AF] uppercase tracking-wider mb-1.5">Usuario</label>
              <div className="relative">
                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  className={`${inputBase} ${inputBorder}`}
                  placeholder="admin"
                  value={username}
                  onChange={e => { setUsername(e.target.value); setError('') }}
                  autoComplete="username"
                />
              </div>
            </div>

            {/* Contraseña */}
            <div>
              <label className="block text-xs text-[#9CA3AF] uppercase tracking-wider mb-1.5">Contraseña</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type={showPw ? 'text' : 'password'}
                  className={`${inputBase} ${inputBorder} pr-10`}
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
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
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

            {/* Botón ingresar */}
            <motion.button
              type="submit"
              disabled={loading}
              whileTap={{ scale: 0.98 }}
              className="no-drag w-full h-[50px] rounded-xl text-white font-bold flex items-center justify-center gap-2 bg-accent hover:bg-[#9C1260] disabled:opacity-60 transition-colors"
              style={{ fontSize: '16px' }}
            >
              {loading ? (
                <><Loader2 size={18} className="animate-spin" /> Ingresando…</>
              ) : (
                <>Ingresar <ArrowRight size={18} /></>
              )}
            </motion.button>

            {/* Error */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs text-red-300 border border-red-500/30"
                style={{ background: 'rgba(239,68,68,0.1)' }}
              >
                <AlertCircle size={14} className="shrink-0" /> {error}
              </motion.div>
            )}
          </form>

          {/* Footer de la card */}
          <div className="mt-6 pt-4 border-t border-[#252525] text-center">
            <button
              type="button"
              onClick={() => openExternal(waLink('Hola, necesito ayuda con DELPA Gestión PRO'))}
              className="no-drag inline-flex items-center gap-1.5 text-[12px] text-zinc-600 hover:text-accent transition-colors"
            >
              ¿Necesitás ayuda? <MessageCircle size={12} /> {SUPPORT.phoneDisplay}
            </button>
          </div>
        </motion.div>
      </motion.div>

      {/* Fuera de la card */}
      <button
        type="button"
        onClick={() => openExternal(SUPPORT.webUrl)}
        className="relative z-10 mt-6 text-[11px] text-[#4B5563] hover:text-zinc-500 transition-colors no-drag"
      >
        DELPA Gestión PRO · {SUPPORT.web}
      </button>
    </motion.div>
  )
}
