import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Building2, Palette, Package, Users, CheckCircle } from 'lucide-react'
import { api } from '../lib/api'

const inputCls = 'bg-[#111] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white focus:border-accent outline-none transition-colors w-full'
const labelCls = 'text-xs text-zinc-500 uppercase tracking-wider mb-1.5 block'

const STEPS = [
  { label: 'Tu negocio', Icon: Building2 },
  { label: 'Talles', Icon: Package },
  { label: 'Categorías', Icon: Palette },
  { label: 'Pagos', Icon: Users },
  { label: 'Listo', Icon: CheckCircle },
]

const DEFAULT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '36', '37', '38', '39', '40', '41', '42']
const DEFAULT_CATS = ['Remeras', 'Pantalones', 'Vestidos', 'Accesorios', 'Calzado']
const DEFAULT_PAYMENTS = ['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'MercadoPago']

export default function SetupWizard({ children }) {
  const [show, setShow] = useState(false)
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [bizName, setBizName] = useState('')
  const [bizAddress, setBizAddress] = useState('')
  const [bizPhone, setBizPhone] = useState('')
  const [sizes, setSizes] = useState(DEFAULT_SIZES)
  const [sizeInput, setSizeInput] = useState('')
  const [cats, setCats] = useState(DEFAULT_CATS)
  const [catInput, setCatInput] = useState('')
  const [payments, setPayments] = useState(DEFAULT_PAYMENTS)
  const [payInput, setPayInput] = useState('')

  useEffect(() => {
    api.settings.get('wizard_completed').then(v => {
      if (v !== '1') setShow(true)
    }).catch(() => {})
  }, [])

  const finish = async () => {
    setSaving(true)
    try {
      await Promise.all([
        bizName && api.settings.set('business_name', bizName),
        bizAddress && api.settings.set('business_address', bizAddress),
        bizPhone && api.settings.set('business_phone', bizPhone),
        api.settings.set('custom_sizes', JSON.stringify(sizes)),
        api.settings.set('custom_categories', JSON.stringify(cats)),
        api.settings.set('custom_payment_methods', JSON.stringify(payments)),
        api.settings.set('wizard_completed', '1'),
      ].filter(Boolean))
      setStep(4)
    } catch {} finally { setSaving(false) }
  }

  const close = () => setShow(false)

  const addTag = (val, list, setter, inputSetter) => {
    const v = val.trim()
    if (!v || list.includes(v)) { inputSetter(''); return }
    setter(p => [...p, v])
    inputSetter('')
  }

  const removeTag = (val, list, setter) => setter(list.filter(x => x !== val))

  if (!show) return children

  return (
    <>
      {children}
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80">
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          className="bg-[#0e0e0e] border border-[#2a2a2a] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden"
        >
          {/* Steps bar */}
          <div className="flex border-b border-[#1e1e1e]">
            {STEPS.map((s, i) => (
              <div key={i} className={`flex-1 flex flex-col items-center py-3 text-[10px] transition-colors ${i === step ? 'text-accent border-b-2 border-accent' : i < step ? 'text-zinc-500' : 'text-zinc-700'}`}>
                <s.Icon size={13} className="mb-0.5" />
                {s.label}
              </div>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {step === 0 && (
              <motion.div key="s0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="p-6 space-y-4">
                <div>
                  <h2 className="text-white font-bold text-lg mb-1">¡Bienvenido a DELPA Gestión PRO!</h2>
                  <p className="text-zinc-500 text-sm">Configuremos tu negocio en unos pasos rápidos.</p>
                </div>
                <div>
                  <label className={labelCls}>Nombre del negocio *</label>
                  <input value={bizName} onChange={e => setBizName(e.target.value)} placeholder="Ej: Mi Tienda" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Dirección</label>
                  <input value={bizAddress} onChange={e => setBizAddress(e.target.value)} placeholder="Av. Corrientes 1234, CABA" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Teléfono</label>
                  <input value={bizPhone} onChange={e => setBizPhone(e.target.value)} placeholder="+54 11 1234-5678" className={inputCls} />
                </div>
                <button onClick={() => setStep(1)} disabled={!bizName.trim()}
                  className="no-drag w-full py-3 rounded-xl bg-accent text-black font-semibold text-sm disabled:opacity-40 hover:bg-accent/90 transition-colors">
                  Siguiente →
                </button>
              </motion.div>
            )}

            {step === 1 && (
              <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="p-6 space-y-4">
                <div>
                  <h2 className="text-white font-bold text-lg mb-1">Talles</h2>
                  <p className="text-zinc-500 text-sm">Personalizá los talles que manejás. Podés cambiarlos después.</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {sizes.map(s => (
                    <span key={s} className="flex items-center gap-1 bg-accent/15 text-accent border border-accent/30 text-xs px-2.5 py-1 rounded-full">
                      {s}
                      <button onClick={() => removeTag(s, sizes, setSizes)} className="no-drag text-accent/60 hover:text-red-400">×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={sizeInput} onChange={e => setSizeInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addTag(sizeInput, sizes, setSizes, setSizeInput)}
                    placeholder="Agregar talle..." className={`${inputCls} flex-1`} />
                  <button onClick={() => addTag(sizeInput, sizes, setSizes, setSizeInput)}
                    className="no-drag px-4 py-2 rounded-lg bg-accent/20 text-accent text-sm hover:bg-accent/30 transition-colors">+</button>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setStep(0)} className="no-drag flex-1 py-2.5 rounded-xl border border-[#2a2a2a] text-zinc-400 text-sm hover:text-white transition-colors">← Atrás</button>
                  <button onClick={() => setStep(2)} className="no-drag flex-1 py-2.5 rounded-xl bg-accent text-black font-semibold text-sm hover:bg-accent/90 transition-colors">Siguiente →</button>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="s2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="p-6 space-y-4">
                <div>
                  <h2 className="text-white font-bold text-lg mb-1">Categorías</h2>
                  <p className="text-zinc-500 text-sm">Tipos de productos que vendés.</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {cats.map(c => (
                    <span key={c} className="flex items-center gap-1 bg-blue-500/15 text-blue-400 border border-blue-500/30 text-xs px-2.5 py-1 rounded-full">
                      {c}
                      <button onClick={() => removeTag(c, cats, setCats)} className="no-drag text-blue-400/60 hover:text-red-400">×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={catInput} onChange={e => setCatInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addTag(catInput, cats, setCats, setCatInput)}
                    placeholder="Agregar categoría..." className={`${inputCls} flex-1`} />
                  <button onClick={() => addTag(catInput, cats, setCats, setCatInput)}
                    className="no-drag px-4 py-2 rounded-lg bg-blue-500/20 text-blue-400 text-sm hover:bg-blue-500/30 transition-colors">+</button>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setStep(1)} className="no-drag flex-1 py-2.5 rounded-xl border border-[#2a2a2a] text-zinc-400 text-sm hover:text-white transition-colors">← Atrás</button>
                  <button onClick={() => setStep(3)} className="no-drag flex-1 py-2.5 rounded-xl bg-accent text-black font-semibold text-sm hover:bg-accent/90 transition-colors">Siguiente →</button>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div key="s3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="p-6 space-y-4">
                <div>
                  <h2 className="text-white font-bold text-lg mb-1">Medios de pago</h2>
                  <p className="text-zinc-500 text-sm">¿Qué formas de pago aceptás?</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {payments.map(p => (
                    <span key={p} className="flex items-center gap-1 bg-amber-500/15 text-amber-400 border border-amber-500/30 text-xs px-2.5 py-1 rounded-full">
                      {p}
                      <button onClick={() => removeTag(p, payments, setPayments)} className="no-drag text-amber-400/60 hover:text-red-400">×</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={payInput} onChange={e => setPayInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addTag(payInput, payments, setPayments, setPayInput)}
                    placeholder="Agregar medio de pago..." className={`${inputCls} flex-1`} />
                  <button onClick={() => addTag(payInput, payments, setPayments, setPayInput)}
                    className="no-drag px-4 py-2 rounded-lg bg-amber-500/20 text-amber-400 text-sm hover:bg-amber-500/30 transition-colors">+</button>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setStep(2)} className="no-drag flex-1 py-2.5 rounded-xl border border-[#2a2a2a] text-zinc-400 text-sm hover:text-white transition-colors">← Atrás</button>
                  <button onClick={finish} disabled={saving}
                    className="no-drag flex-1 py-2.5 rounded-xl bg-accent text-black font-semibold text-sm hover:bg-accent/90 transition-colors disabled:opacity-50">
                    {saving ? 'Guardando...' : 'Finalizar ✓'}
                  </button>
                </div>
              </motion.div>
            )}

            {step === 4 && (
              <motion.div key="s4" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-8 text-center space-y-4">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}>
                  <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center mx-auto">
                    <CheckCircle size={32} className="text-accent" />
                  </div>
                </motion.div>
                <div>
                  <h2 className="text-white font-bold text-xl mb-2">¡Todo listo!</h2>
                  <p className="text-zinc-400 text-sm">Tu negocio está configurado. Podés ajustar todo esto en Configuración cuando quieras.</p>
                </div>
                <button onClick={close}
                  className="no-drag w-full py-3 rounded-xl bg-accent text-black font-semibold text-sm hover:bg-accent/90 transition-colors">
                  Empezar a usar DELPA
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </>
  )
}
