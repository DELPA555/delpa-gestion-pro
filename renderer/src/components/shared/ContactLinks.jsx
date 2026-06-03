import { MessageCircle, Mail } from 'lucide-react'
import { api } from '@/lib/api'

function waNumber(raw) {
  const digits = (raw || '').replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('549')) return digits
  if (digits.startsWith('54'))  return digits
  if (digits.startsWith('0'))   return '549' + digits.slice(1)
  return '549' + digits
}

export function PhoneLink({ phone, className = '' }) {
  if (!phone) return <span className="text-zinc-600">—</span>
  const num = waNumber(phone)
  if (!num) return <span className={`text-zinc-300 ${className}`}>{phone}</span>
  return (
    <button
      onClick={() => api.shell.openExternal(`https://wa.me/${num}`)}
      title={`WhatsApp ${num}`}
      className={`no-drag inline-flex items-center gap-1.5 text-zinc-300 hover:text-green-400 transition-colors group ${className}`}
    >
      <MessageCircle size={12} className="shrink-0 text-zinc-600 group-hover:text-green-400 transition-colors" />
      <span>{phone}</span>
    </button>
  )
}

export function EmailLink({ email, className = '' }) {
  if (!email) return <span className="text-zinc-600">—</span>
  return (
    <button
      onClick={() => api.shell.openExternal(`mailto:${email}`)}
      title={`Email: ${email}`}
      className={`no-drag inline-flex items-center gap-1.5 text-zinc-500 hover:text-blue-400 transition-colors group ${className}`}
    >
      <Mail size={11} className="shrink-0 text-zinc-600 group-hover:text-blue-400 transition-colors" />
      <span className="text-xs">{email}</span>
    </button>
  )
}
