import { useState } from 'react'
import { motion } from 'framer-motion'
import { ShieldCheck, AlertCircle, Copy, Check } from 'lucide-react'
import { api } from '@/lib/api'

export default function ActivationScreen({ hardwareId, reason, onActivated }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleActivate = async (e) => {
    e.preventDefault()
    if (!code.trim()) { setError('Ingresá el código de activación'); return }
    setLoading(true)
    setError('')
    try {
      const res = await api.license.activate(code)
      if (res.ok) onActivated()
      else setError(res.error || 'Código inválido')
    } catch {
      setError('Error al verificar el código')
    } finally { setLoading(false) }
  }

  const copyHardwareId = () => {
    navigator.clipboard.writeText(hardwareId).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="h-screen w-screen bg-surface flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
            <ShieldCheck size={24} className="text-red-400" />
          </div>
          <h1 className="text-xl font-bold text-white">
            {reason === 'trial' ? 'Período de prueba vencido' : 'Licencia vencida'}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            {reason === 'trial'
              ? 'Para continuar usando DELPA Gestión PRO ingresá tu código de licencia'
              : 'Tu suscripción venció. Ingresá el nuevo código de activación para continuar'}
          </p>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 shadow-xl space-y-5">
          {/* Hardware ID */}
          <div>
            <label className="text-xs text-zinc-500 uppercase tracking-wider mb-2 block">
              Hardware ID de esta PC
            </label>
            <div className="flex items-center gap-2 bg-[#0a0a0a] border border-border rounded-lg px-3 py-2.5">
              <code className="flex-1 text-xs text-zinc-300 font-mono break-all">{hardwareId}</code>
              <button
                onClick={copyHardwareId}
                className="shrink-0 text-zinc-500 hover:text-zinc-200 transition-colors"
                title="Copiar Hardware ID"
              >
                {copied ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
              </button>
            </div>
            <p className="text-xs text-zinc-600 mt-1">
              Enviá este ID a tu proveedor para obtener el código de activación.
            </p>
          </div>

          {/* Activation code input */}
          <form onSubmit={handleActivate} className="space-y-4">
            <div>
              <label className="text-xs text-zinc-500 uppercase tracking-wider mb-1 block">
                Código de licencia
              </label>
              <input
                className="input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 font-mono tracking-widest no-drag"
                placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                value={code}
                onChange={e => { setCode(e.target.value.toUpperCase()); setError('') }}
                autoFocus
              />
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
              {loading ? 'Verificando...' : 'Activar licencia'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-zinc-700 mt-6">DELPA Gestión PRO · Licencia comercial</p>
      </motion.div>
    </div>
  )
}
