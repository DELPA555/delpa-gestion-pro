import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import QRCodeLib from 'qrcode'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Building2, Ruler, Tag, CreditCard, X, Plus, Cloud, RefreshCw, Unlink, Upload, Users, Percent, Mail, ShieldCheck, CheckCircle, AlertCircle, Store, ArrowLeftRight, UserCog, Eye, EyeOff, Trash2, Edit3, ShieldAlert, Gift, Copy, QrCode, Printer, FileText, DollarSign, Send, Lock, FolderOpen, ArrowUpCircle, ExternalLink, Download } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import PageHeader from '@/components/shared/PageHeader'

const TAB_GROUPS = [
  {
    label: 'General',
    items: [
      { id: 'business',     label: 'Negocio',      Icon: Building2 },
      { id: 'sizes',        label: 'Talles',        Icon: Ruler },
      { id: 'categories',   label: 'Categorías',   Icon: Tag },
      { id: 'sellers',      label: 'Vendedoras',    Icon: Users },
      { id: 'usuarios',     label: 'Usuarios',      Icon: UserCog },
    ],
  },
  {
    label: 'Comercial',
    items: [
      { id: 'surcharges',   label: 'Recargos',      Icon: Percent },
      { id: 'fidelizacion', label: 'Fidelización',  Icon: Gift },
      { id: 'gastosfijos',  label: 'Gastos Fijos',  Icon: DollarSign },
    ],
  },
  {
    label: 'Integraciones',
    items: [
      { id: 'email',        label: 'Email',         Icon: Mail },
      { id: 'afip',         label: 'AFIP',          Icon: ShieldCheck },
      { id: 'tiendanube',   label: 'Tienda Nube',   Icon: Store },
      { id: 'mercadopago',  label: 'Mercado Pago',  Icon: QrCode },
      { id: 'payments',     label: 'Pagos & Drive', Icon: CreditCard },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { id: 'licencia',          label: 'Licencia',        Icon: ShieldAlert },
      { id: 'actualizaciones',   label: 'Actualizaciones', Icon: ArrowUpCircle },
    ],
  },
]

const inputCls = 'input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag'
const labelCls = 'text-xs text-zinc-500 uppercase tracking-wider mb-1 block'

function TagList({ items, onRemove, onAdd, placeholder = 'Agregar...' }) {
  const [val, setVal] = useState('')
  const add = () => {
    const v = val.trim()
    if (!v || items.includes(v)) return
    onAdd(v)
    setVal('')
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {items.map(item => (
          <span key={item} className="flex items-center gap-1 bg-white/[0.06] border border-border rounded-full px-3 py-1 text-xs text-zinc-300">
            {item}
            <button onClick={() => onRemove(item)} className="text-zinc-500 hover:text-red-400 ml-1 no-drag"><X size={11} /></button>
          </span>
        ))}
        {items.length === 0 && <span className="text-xs text-zinc-600">Sin elementos personalizados</span>}
      </div>
      <div className="flex gap-2">
        <input
          className={`${inputCls} flex-1`}
          value={val}
          onChange={e => setVal(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()}
          placeholder={placeholder}
        />
        <button onClick={add} className="btn-primary px-3 py-2 rounded-lg text-sm no-drag flex items-center gap-1">
          <Plus size={13} />
        </button>
      </div>
    </div>
  )
}

const DEFAULT_SURCHARGES = {
  'Tarjeta Débito': 0,
  'Tarjeta Crédito 1 cuota': 0,
  'Tarjeta Crédito 3 cuotas': 10,
  'Tarjeta Crédito 6 cuotas': 18,
  'Tarjeta Crédito 12 cuotas': 30,
  'Tarjeta Crédito 18 cuotas': 45,
  'Tarjeta Crédito 24 cuotas': 60,
}

function getSyncAge(lastSync) {
  if (!lastSync) return null
  const diffMs = Date.now() - new Date(lastSync).getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const formatted = new Date(lastSync).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false })
  const label = diffMin < 1
    ? 'Hace menos de 1 min'
    : diffMin < 60
    ? `Hace ${diffMin} min`
    : `Hace ${Math.floor(diffMin / 60)}h ${diffMin % 60}min`
  if (diffMin < 15) return { color: 'text-green-400', dot: 'bg-green-400', label, formatted }
  if (diffMin < 60) return { color: 'text-amber-400', dot: 'bg-amber-400', label, formatted }
  return { color: 'text-red-400', dot: 'bg-red-400', label, formatted }
}

// ── Backup cifrado ─────────────────────────────────────────────────────────────

function BackupSection() {
  const [password,   setPassword]   = useState('')
  const [restorePwd, setRestorePwd] = useState('')
  const [showPwd,    setShowPwd]    = useState(false)
  const [creating,   setCreating]   = useState(false)
  const [restoring,  setRestoring]  = useState(false)
  const fi = 'input-field bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white no-drag'

  const createBackup = async () => {
    if (password.length < 6) return toast.error('La contraseña debe tener al menos 6 caracteres')
    setCreating(true)
    try {
      const res = await api.backup.create(password)
      if (res?.ok) {
        setPassword('')
        toast.success(`Backup creado: ${res.filePath?.split('\\').pop() || 'backup.delpa'}`)
      } else if (!res) {
        // cancelled
      }
    } catch (e) {
      toast.error(e.message || 'Error al crear backup')
    } finally { setCreating(false) }
  }

  const restoreBackup = async () => {
    if (!restorePwd) return toast.error('Ingresá la contraseña del backup')
    if (!confirm('⚠ ATENCIÓN: Esta acción reemplazará TODOS los datos actuales con los del backup. La app se reiniciará automáticamente. ¿Confirmás?')) return
    setRestoring(true)
    try {
      const res = await api.backup.restore(restorePwd)
      if (res?.ok) {
        toast.success('Backup restaurado. Reiniciando...')
        setRestorePwd('')
      }
    } catch (e) {
      toast.error(e.message || 'Error al restaurar backup')
    } finally { setRestoring(false) }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-1">
          <Lock size={14} className="text-accent" /> Backup de seguridad cifrado
        </h3>
        <p className="text-xs text-zinc-500">Guardá un backup cifrado en tu equipo. No requiere internet. Usá una contraseña segura que puedas recordar.</p>
      </div>

      {/* Crear */}
      <div className="p-4 bg-surface border border-border rounded-xl space-y-3">
        <h4 className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
          <Lock size={11} /> Crear backup cifrado
        </h4>
        <p className="text-[11px] text-zinc-600">El archivo se guarda en el escritorio como <code className="text-accent">DELPA-backup-FECHA.delpa</code></p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showPwd ? 'text' : 'password'}
              placeholder="Contraseña (mín. 6 caracteres)"
              className={`${fi} pr-9 w-full`}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createBackup()}
            />
            <button type="button" onClick={() => setShowPwd(v => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 no-drag">
              {showPwd ? <EyeOff size={14}/> : <Eye size={14}/>}
            </button>
          </div>
          <button onClick={createBackup} disabled={creating || password.length < 6}
            className="no-drag btn-primary flex items-center gap-2 px-4 py-2 text-sm rounded-lg disabled:opacity-50 shrink-0">
            <FolderOpen size={13}/>{creating ? 'Creando...' : 'Crear backup'}
          </button>
        </div>
      </div>

      {/* Restaurar */}
      <div className="p-4 bg-surface border border-red-500/20 rounded-xl space-y-3">
        <h4 className="text-xs font-semibold text-red-400 flex items-center gap-1.5">
          <AlertCircle size={11} /> Restaurar backup cifrado
        </h4>
        <p className="text-[11px] text-zinc-600">⚠ Esto reemplaza TODOS los datos actuales. La app se reiniciará automáticamente.</p>
        <div className="flex gap-2">
          <input
            type="password"
            placeholder="Contraseña del backup"
            className={`${fi} flex-1`}
            value={restorePwd}
            onChange={e => setRestorePwd(e.target.value)}
          />
          <button onClick={restoreBackup} disabled={restoring || !restorePwd}
            className="no-drag flex items-center gap-2 px-4 py-2 text-sm border border-red-500/30 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50 shrink-0">
            <Upload size={13}/>{restoring ? 'Restaurando...' : 'Restaurar'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Settings() {
  const [tab, setTab] = useState('business')
  const [form, setForm] = useState({ business_name: '', business_address: '', business_phone: '', business_cuit: '', business_logo: '', business_instagram: '', business_facebook: '', business_whatsapp: '', business_website: '', business_hours: '', birthday_message: '', current_sucursal_id: '' })
  const [sizes, setSizes] = useState([])
  const [categories, setCategories] = useState([])
  const [categorySizeGroups, setCategorySizeGroups] = useState({})
  const [paymentMethods, setPaymentMethods] = useState([])
  const [sellers, setSellers] = useState([])
  const [surcharges, setSurcharges] = useState(DEFAULT_SURCHARGES)
  const [emailForm, setEmailForm] = useState({ email_smtp: 'smtp.gmail.com', email_port: '587', email_user: '', email_from: '', email_pass: '', email_to: '' })
  const [emailTesting, setEmailTesting] = useState(false)
  const [gdStatus, setGdStatus] = useState({ connected: false, email: null, lastBackupAt: null, notConfigured: false })
  const [gdLoading, setGdLoading] = useState(false)
  const [sucursales, setSucursales] = useState([])
  const [afipForm, setAfipForm] = useState({ afip_env: 'testing', afip_punto_venta: '1', afip_cond_fiscal: 'RI', mono_categoria: 'C', iva_alicuota: '21' })
  const [afipStatus, setAfipStatus] = useState(null)
  const [afipTesting, setAfipTesting] = useState(false)
  const [afipSaving, setAfipSaving] = useState(false)
  const [saving, setSaving] = useState(false)

  // Mercado Pago
  const [mpToken, setMpToken] = useState('')
  const [mpSandbox, setMpSandbox] = useState(false)
  const [mpStatus, setMpStatus] = useState(null)
  const [mpTesting, setMpTesting] = useState(false)
  const [mpSaving, setMpSaving] = useState(false)
  const [mpPosName, setMpPosName] = useState('')
  const [mpPosData, setMpPosData] = useState(null)
  const [mpCreatingPos, setMpCreatingPos] = useState(false)
  const [mpQrImageUrl, setMpQrImageUrl] = useState(null)
  const [mpQrPdfUrl, setMpQrPdfUrl] = useState(null)
  const [mpPosExternalId, setMpPosExternalId] = useState('')
  const [mpSavingExternalId, setMpSavingExternalId] = useState(false)
  const [mpLinking, setMpLinking] = useState(false)

  // Tienda Nube
  const [tnStatus, setTnStatus] = useState({ connected: false })
  const [tnLoading, setTnLoading] = useState(false)
  const [tnSyncResult, setTnSyncResult] = useState(null)
  const [tnCustomerSync, setTnCustomerSync] = useState(null) // { total, created, updated, done }
  const [tnCustomerSyncing, setTnCustomerSyncing] = useState(false)
  const logoRef = useRef()

  // Usuarios
  const [users, setUsers] = useState([])
  const [userForm, setUserForm] = useState({ username: '', password: '', role: 'vendedor', seller_name: '' })
  const [userShowPw, setUserShowPw] = useState(false)
  const [userEditing, setUserEditing] = useState(null)
  const [userNewPw, setUserNewPw] = useState('')
  const [userSaving, setUserSaving] = useState(false)
  const [sellerNewName, setSellerNewName] = useState('')
  const [sellerNewRate, setSellerNewRate] = useState(0)

  // Fidelización
  const [pointsForm, setPointsForm] = useState({ points_enabled: '0', points_per_pesos: '1000', point_value: '100', points_min_redeem: '5' })
  const [pointsSaving, setPointsSaving] = useState(false)

  // Fixed costs
  const [fixedCosts, setFixedCosts] = useState([])
  const [fcForm, setFcForm] = useState({ name: '', amount: '', category: 'General' })
  const [fcSaving, setFcSaving] = useState(false)
  const [weeklySending, setWeeklySending] = useState(false)

  // Barcode scanner
  const [barcodeScanner, setBarcodeScanner] = useState(false)



  // Licencia
  const [licenseInfo, setLicenseInfo] = useState(null)
  const [licenseCode, setLicenseCode] = useState('')
  const [licenseActivating, setLicenseActivating] = useState(false)
  const [licenseCopied, setLicenseCopied] = useState(false)

  const load = useCallback(async () => {
    try {
      const all = await api.settings.getAll()
      setForm({
        business_name:        all.business_name        || '',
        business_address:     all.business_address     || '',
        business_phone:       all.business_phone       || '',
        business_cuit:        all.business_cuit        || '',
        business_logo:        all.business_logo        || '',
        business_instagram:   all.business_instagram   || '',
        business_facebook:    all.business_facebook    || '',
        business_whatsapp:    all.business_whatsapp    || '',
        business_website:     all.business_website     || '',
        business_hours:       all.business_hours       || '',
        birthday_message:     all.birthday_message     || 'Feliz cumple [nombre]! 🎁 Pasate por el local, te tenemos un regalo especial 🎉',
        current_sucursal_id:  all.current_sucursal_id  || '',
      })
      api.sucursales.list().then(setSucursales).catch(() => {})
      setSizes(JSON.parse(all.custom_sizes || '[]'))
      setCategories(JSON.parse(all.custom_categories || '[]'))
      try { setCategorySizeGroups(JSON.parse(all.category_size_groups || '{}')) } catch {}
      setPaymentMethods(JSON.parse(all.custom_payment_methods || '[]'))
      try { setSurcharges({ ...DEFAULT_SURCHARGES, ...JSON.parse(all.surcharges_json || '{}') }) } catch {}
      api.sellers.list().then(setSellers).catch(() => {})
      setPointsForm({
        points_enabled:   all.points_enabled   || '0',
        points_per_pesos: all.points_per_pesos || '1000',
        point_value:      all.point_value      || '100',
        points_min_redeem: all.points_min_redeem || '5',
      })
      setEmailForm({
        email_smtp: all.email_smtp || 'smtp.gmail.com',
        email_port: all.email_port || '587',
        email_user: all.email_user || '',
        email_from: all.email_from || '',
        email_pass: all.email_pass || '',
        email_to:   all.email_to   || '',
      })
      setAfipForm({
        afip_env:           all.afip_env           || 'testing',
        afip_punto_venta:   all.afip_punto_venta   || '1',
        afip_cond_fiscal:   all.afip_cond_fiscal   || 'RI',
        mono_categoria:     all.mono_categoria     || 'C',
        iva_alicuota:       all.iva_alicuota       || '21',
      })
      setBarcodeScanner(all.barcode_scanner === '1')
    } catch {}
  }, [])

  const loadGd = useCallback(async () => {
    try { setGdStatus(await api.googledrive.status()) } catch {}
  }, [])

  const loadMp = useCallback(async () => {
    try {
      const cfg = await api.mp.getConfig()
      setMpToken(cfg.token || '')
      setMpSandbox(cfg.sandbox || false)
      setMpPosExternalId(cfg.external_id || 'petalogestion')
      if (cfg.external_id || cfg.pos_id) {
        setMpPosData(cfg)
        setMpPosName(cfg.pos_name || '')
        if (cfg.qr_image) setMpQrImageUrl(cfg.qr_image)
        if (cfg.qr_pdf)   setMpQrPdfUrl(cfg.qr_pdf)
      }
    } catch {}
  }, [])

  const loadTn = useCallback(async () => {
    try { setTnStatus(await api.tn.status()) } catch {}
  }, [])

  const loadAfipStatus = useCallback(async () => {
    try { setAfipStatus(await api.afip.status()) } catch {}
  }, [])

  const loadUsers = useCallback(async () => {
    try { setUsers(await api.auth.users.list()) } catch {}
  }, [])

  const loadLicense = useCallback(async () => {
    try { setLicenseInfo(await api.license.status()) } catch {}
  }, [])

  const loadFixedCosts = useCallback(async () => {
    try { setFixedCosts(await api.fixedcosts.list()) } catch {}
  }, [])

  const saveAfip = async () => {
    setAfipSaving(true)
    try {
      await Promise.all(Object.entries(afipForm).map(([k, v]) => api.settings.set(k, v)))
      toast.success('Configuración AFIP guardada')
      loadAfipStatus()
    } catch { toast.error('Error al guardar') }
    finally { setAfipSaving(false) }
  }

  const testAfipConexion = async () => {
    setAfipTesting(true)
    try {
      const res = await api.afip.testConexion()
      if (res.ok) {
        toast.success(`Conexión AFIP OK · Ambiente: ${res.env} · AppServer: ${res.appServer}`)
        setAfipStatus(s => ({ ...s, connected: true }))
      } else {
        toast.error(`Error AFIP: ${res.error}`)
        setAfipStatus(s => ({ ...s, connected: false }))
      }
    } catch (e) { toast.error(e.message) }
    finally { setAfipTesting(false) }
  }

  const [, setTick] = useState(0)

  useEffect(() => {
    load()
    loadGd()
    loadAfipStatus()
    loadTn()
    loadMp()
    loadUsers()
    loadLicense()
    loadFixedCosts()
    const unsubGd = window.electron.on('sync:status', () => { loadGd(); setGdLoading(false) })
    const unsubTn = window.electron.on('tn:status', (s) => setTnStatus(s || { connected: false }))
    const unsubTnCustomer = window.electron.on('tn:customerSyncProgress', (p) => setTnCustomerSync(p))
    // Tick every 60s so sync-age color refreshes without a new event from main
    const ticker = setInterval(() => setTick(t => t + 1), 60 * 1000)
    return () => { unsubGd(); unsubTn(); unsubTnCustomer(); clearInterval(ticker) }
  }, [load, loadGd, loadTn, loadMp, loadUsers, loadLicense, loadFixedCosts])

  const saveBusiness = async () => {
    setSaving(true)
    try {
      await Promise.all(Object.entries(form).map(([k, v]) => api.settings.set(k, v)))
      toast.success('Datos del negocio guardados')
    } catch { toast.error('Error al guardar') }
    finally { setSaving(false) }
  }

  const saveArray = async (key, arr) => {
    try { await api.settings.set(key, JSON.stringify(arr)); toast.success('Guardado') }
    catch { toast.error('Error al guardar') }
  }

  const saveSurcharges = async (obj) => {
    try { await api.settings.set('surcharges_json', JSON.stringify(obj)); toast.success('Recargos guardados') }
    catch { toast.error('Error al guardar') }
  }

  const savePoints = async () => {
    setPointsSaving(true)
    try {
      await Promise.all(Object.entries(pointsForm).map(([k, v]) => api.settings.set(k, v)))
      toast.success('Configuración de fidelización guardada')
    } catch { toast.error('Error al guardar') }
    finally { setPointsSaving(false) }
  }

  const handleLicenseActivate = async () => {
    if (!licenseCode.trim()) return toast.error('Ingresá el código de licencia')
    setLicenseActivating(true)
    try {
      const res = await api.license.activate(licenseCode)
      if (res.ok) {
        toast.success('Licencia activada correctamente')
        setLicenseCode('')
        loadLicense()
        window.dispatchEvent(new CustomEvent('license:updated'))
      } else toast.error(res.error || 'Código inválido')
    } catch (e) { toast.error(e.message || 'Error') }
    finally { setLicenseActivating(false) }
  }

  const addSeller = async () => {
    const name = sellerNewName.trim()
    if (!name || sellers.some(s => s.name === name)) return
    try {
      await api.sellers.add({ name, commission_rate: Number(sellerNewRate) || 0 })
      const updated = await api.sellers.list()
      setSellers(updated)
      setSellerNewName('')
      setSellerNewRate(0)
      toast.success('Vendedora agregada')
    } catch (e) { toast.error(e.message || 'Error al agregar') }
  }

  const saveEmail = async () => {
    setSaving(true)
    try {
      await Promise.all(Object.entries(emailForm).map(([k, v]) => api.settings.set(k, v)))
      toast.success('Configuración de email guardada')
    } catch { toast.error('Error al guardar') }
    finally { setSaving(false) }
  }

  const testEmail = async () => {
    if (!emailForm.email_to) return toast.error('Completá el email destinatario primero')
    if (!emailForm.email_user && !emailForm.email_from) return toast.error('Completá el usuario de Gmail primero')
    if (!emailForm.email_pass) return toast.error('Completá la contraseña de aplicación primero')
    setEmailTesting(true)
    try {
      await saveEmail()
      const res = await api.email.test()
      if (res?.ok) toast.success(`Email de prueba enviado a ${emailForm.email_to}`)
      else toast.error(`Error: ${res?.error || 'Error desconocido'}`)
    } catch (e) { toast.error(e.message || 'Error al enviar') }
    finally { setEmailTesting(false) }
  }

  const handleLogo = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setForm(p => ({ ...p, business_logo: ev.target.result }))
    reader.readAsDataURL(file)
  }

  const handleGdAuth = async () => {
    setGdLoading(true)
    try {
      await api.googledrive.auth()
      await loadGd()
      toast.success('Google Drive conectado')
    } catch (e) {
      toast.error(e.message || 'Error al conectar')
      setGdLoading(false)
    }
  }

  const handleGdBackup = async () => {
    setGdLoading(true)
    try {
      const res = await api.googledrive.backup()
      if (res?.error === 'session_expired') {
        loadGd()
        toast.error('Sesión de Google Drive expirada. Reconectá tu cuenta.')
      } else {
        toast.success('Backup completado')
      }
    } catch (e) {
      toast.error(e.message || 'Error en backup')
      setGdLoading(false)
    }
  }

  const handleGdDisconnect = async () => {
    try {
      await api.googledrive.disconnect()
      setGdStatus({ connected: false, email: null, lastBackupAt: null })
      toast.success('Desconectado de Google Drive')
    } catch { toast.error('Error') }
  }

  const handleTnConnect = async () => {
    setTnLoading(true)
    setTnSyncResult(null)
    try {
      const res = await api.tn.connect()
      if (res.ok) { toast.success('Tienda Nube conectada'); loadTn() }
      else toast.error(res.error || 'Error al conectar')
    } catch (e) { toast.error(e.message || 'Error al conectar') }
    finally { setTnLoading(false) }
  }

  const handleTnDisconnect = async () => {
    try {
      await api.tn.disconnect()
      setTnStatus({ connected: false })
      toast.success('Tienda Nube desconectada')
    } catch { toast.error('Error') }
  }

  const handleTnSync = async () => {
    setTnLoading(true)
    setTnSyncResult(null)
    try {
      const res = await api.tn.syncAll()
      setTnSyncResult(res)
      if (res.ok) toast.success(`Sincronizado: ${res.pushed} productos, ${res.stockSynced} stocks`)
      else toast.error('Error en sincronización')
    } catch (e) { toast.error(e.message || 'Error') }
    finally { setTnLoading(false); loadTn() }
  }

  const handleTnSyncStock = async () => {
    setTnLoading(true)
    try {
      const res = await api.tn.syncStock()
      if (res.ok) toast.success(`Stock sincronizado: ${res.synced} variantes`)
      else toast.error('Error al sincronizar stock')
    } catch (e) { toast.error(e.message || 'Error') }
    finally { setTnLoading(false) }
  }

  const handleTnSyncCustomers = async () => {
    setTnCustomerSyncing(true)
    setTnCustomerSync(null)
    try {
      const res = await api.tn.syncCustomers()
      if (res.ok) {
        setTnCustomerSync({ ...res, done: true })
        toast.success(`Clientes importados: ${res.created} nuevos, ${res.updated} actualizados`)
      } else {
        toast.error(res.error || 'Error al importar clientes')
      }
    } catch (e) { toast.error(e.message || 'Error') }
    finally { setTnCustomerSyncing(false) }
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
      className="p-6"
    >
      <PageHeader title="Configuración" subtitle="Personalizá el sistema a tu negocio" />

      <div className="flex gap-6 mt-6">
        {/* ── Nav lateral ── */}
        <aside className="w-44 shrink-0 space-y-5">
          {TAB_GROUPS.map(group => (
            <div key={group.label}>
              <p className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider mb-1.5 px-2">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={cn(
                      'no-drag w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-colors text-left border-l-2',
                      tab === id
                        ? 'bg-accent/10 border-accent text-accent font-semibold'
                        : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04] border-transparent'
                    )}
                  >
                    <Icon size={13} strokeWidth={tab === id ? 2.2 : 1.8} />
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </aside>

        {/* ── Contenido ── */}
        <div className="flex-1 min-w-0">

      {/* ── Tab: Negocio ── */}
      {tab === 'business' && (
        <div className="max-w-lg space-y-4">
          <div>
            <label className={labelCls}>Nombre del negocio</label>
            <input className={inputCls} value={form.business_name} onChange={e => f('business_name', e.target.value)} placeholder="Ej: Mi Tienda" />
          </div>
          <div>
            <label className={labelCls}>Dirección</label>
            <input className={inputCls} value={form.business_address} onChange={e => f('business_address', e.target.value)} placeholder="Av. Siempre Viva 123" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Teléfono</label>
              <input className={inputCls} value={form.business_phone} onChange={e => f('business_phone', e.target.value)} placeholder="+54 9 11 ..." />
            </div>
            <div>
              <label className={labelCls}>CUIT</label>
              <input className={inputCls} value={form.business_cuit} onChange={e => f('business_cuit', e.target.value)} placeholder="20-12345678-9" />
            </div>
          </div>

          {/* Datos de contacto (aparecen en tickets, facturas, emails y PDFs) */}
          <div className="pt-2 border-t border-border/60">
            <p className="text-xs font-medium text-zinc-400 mb-3">Contacto y redes (se muestran en el pie de tickets, facturas, emails y PDFs)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Instagram</label>
                <input className={inputCls} value={form.business_instagram} onChange={e => f('business_instagram', e.target.value)} placeholder="@petalorosa" />
              </div>
              <div>
                <label className={labelCls}>Facebook</label>
                <input className={inputCls} value={form.business_facebook} onChange={e => f('business_facebook', e.target.value)} placeholder="/petalorosa o link" />
              </div>
              <div>
                <label className={labelCls}>WhatsApp de contacto</label>
                <input className={inputCls} value={form.business_whatsapp} onChange={e => f('business_whatsapp', e.target.value)} placeholder="+54 9 223 555-1234" />
              </div>
              <div>
                <label className={labelCls}>Sitio web</label>
                <input className={inputCls} value={form.business_website} onChange={e => f('business_website', e.target.value)} placeholder="www.misitio.com" />
              </div>
            </div>
            <div className="mt-3">
              <label className={labelCls}>Horarios de atención</label>
              <input className={inputCls} value={form.business_hours} onChange={e => f('business_hours', e.target.value)} placeholder="Lun a Vie 9 a 19hs · Sáb 9 a 13hs" />
            </div>
          </div>

          {/* Sucursal actual */}
          {sucursales.length > 0 && (
            <div>
              <label className={labelCls}>Sucursal de este equipo</label>
              <select className={inputCls} value={form.current_sucursal_id} onChange={e => f('current_sucursal_id', e.target.value)}>
                <option value="">Sin asignar</option>
                {sucursales.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
              </select>
              <p className="text-xs text-zinc-600 mt-1">Identifica las ventas de este equipo con la sucursal seleccionada.</p>
            </div>
          )}

          {/* Logo */}
          <div>
            <label className={labelCls}>Logo del negocio</label>
            <div className="flex items-center gap-3">
              {form.business_logo && (
                <img src={form.business_logo} alt="logo" className="h-12 w-auto object-contain bg-white/5 rounded-lg p-1 border border-border" />
              )}
              <input ref={logoRef} type="file" accept="image/*" onChange={handleLogo} className="hidden" />
              <button
                onClick={() => logoRef.current?.click()}
                className="no-drag flex items-center gap-2 px-4 py-2 text-sm border border-border rounded-lg text-zinc-400 hover:text-white hover:border-accent transition-colors"
              >
                <Upload size={13} /> {form.business_logo ? 'Cambiar logo' : 'Subir logo'}
              </button>
              {form.business_logo && (
                <button onClick={() => f('business_logo', '')} className="no-drag text-xs text-zinc-600 hover:text-red-400">Quitar</button>
              )}
            </div>
          </div>

          {/* Birthday message */}
          <div>
            <label className={labelCls}>Mensaje de cumpleaños (WhatsApp)</label>
            <textarea
              className={`${inputCls} resize-none`}
              rows={3}
              value={form.birthday_message}
              onChange={e => f('birthday_message', e.target.value)}
              placeholder="Feliz cumple [nombre]! 🎁"
            />
            <p className="text-xs text-zinc-600 mt-1">Usá <code className="bg-white/[0.06] px-1 rounded">[nombre]</code> para personalizar con el nombre de la clienta.</p>
          </div>

          {/* Barcode scanner toggle */}
          <div className="flex items-center justify-between p-3 bg-surface border border-border rounded-xl">
            <div>
              <p className="text-sm font-medium text-white">Lector de código de barras en ventas</p>
              <p className="text-xs text-zinc-500 mt-0.5">Detecta automáticamente el escaneo y agrega el producto al carrito</p>
            </div>
            <button
              onClick={async () => {
                const next = !barcodeScanner
                setBarcodeScanner(next)
                await api.settings.set('barcode_scanner', next ? '1' : '0')
                toast.success(next ? 'Lector de barras activado' : 'Lector de barras desactivado')
              }}
              className={cn(
                'no-drag relative w-11 h-6 rounded-full transition-colors shrink-0',
                barcodeScanner ? 'bg-accent' : 'bg-zinc-700'
              )}
            >
              <span className={cn(
                'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow',
                barcodeScanner ? 'translate-x-5' : 'translate-x-1'
              )} />
            </button>
          </div>

          <div className="pt-2">
            <button onClick={saveBusiness} disabled={saving} className="btn-primary no-drag px-5 py-2 rounded-lg text-sm">
              {saving ? 'Guardando...' : 'Guardar datos'}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab: Talles ── */}
      {tab === 'sizes' && (
        <div className="max-w-lg">
          <p className="text-sm text-zinc-500 mb-4">Estos talles se agregan a los predeterminados (34–50, XS–XXL, Calzado 25–48) en el módulo de Productos.</p>
          <TagList
            items={sizes}
            placeholder="Ej: 4XL, 56, XXXL..."
            onAdd={v => { const next = [...sizes, v]; setSizes(next); saveArray('custom_sizes', next) }}
            onRemove={v => { const next = sizes.filter(s => s !== v); setSizes(next); saveArray('custom_sizes', next) }}
          />
        </div>
      )}

      {/* ── Tab: Categorías ── */}
      {tab === 'categories' && (
        <div className="max-w-lg space-y-6">
          <div>
            <p className="text-sm text-zinc-500 mb-4">Categorías personalizadas para filtrar productos.</p>
            <TagList
              items={categories}
              placeholder="Ej: Ropa interior, Accesorios..."
              onAdd={v => { const next = [...categories, v]; setCategories(next); saveArray('custom_categories', next) }}
              onRemove={v => { const next = categories.filter(c => c !== v); setCategories(next); saveArray('custom_categories', next) }}
            />
          </div>
          <div className="border-t border-border pt-5">
            <h3 className="text-sm font-medium text-white mb-1">Talles por categoría</h3>
            <p className="text-xs text-zinc-500 mb-4">Al crear un producto, al seleccionar la categoría se pre-cargan los talles correspondientes.</p>
            <div className="space-y-2">
              {['Jeans','Camisas','Remeras','Buzos','Camperas','Pantalones','Shorts','Ropa interior','Accesorios','Calzado','Otros',...categories].filter((c,i,a)=>a.indexOf(c)===i).map(cat => (
                <div key={cat} className="flex items-center gap-3">
                  <span className="flex-1 text-sm text-zinc-300">{cat}</span>
                  <select
                    className="bg-[#0a0a0a] border border-border rounded-lg px-3 py-1.5 text-sm text-white no-drag"
                    value={categorySizeGroups[cat] || ''}
                    onChange={e => {
                      const next = { ...categorySizeGroups, [cat]: e.target.value || undefined }
                      if (!e.target.value) delete next[cat]
                      setCategorySizeGroups(next)
                      api.settings.set('category_size_groups', JSON.stringify(next)).catch(() => {})
                    }}
                  >
                    <option value="">Sin preselección</option>
                    <option value="numeric">Numérico (34–50)</option>
                    <option value="clothing">Talle (XS–XXL)</option>
                    <option value="american">Americano (28–60)</option>
                    <option value="shoe">Calzado (25–48)</option>
                    <option value="mixed">Ambos</option>
                    <option value="none">Ninguno</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Vendedoras ── */}
      {tab === 'sellers' && (
        <div className="max-w-lg space-y-4">
          <p className="text-sm text-zinc-500">Registrá las vendedoras y sus comisiones. El % se usa en Reportes → Comisiones.</p>
          <div className="space-y-2">
            {sellers.map((s) => (
              <div key={s.id} className="flex items-center gap-3 bg-card border border-border rounded-lg px-4 py-2.5">
                <span className="flex-1 text-sm text-white">{s.name}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min="0" max="100" step="0.1"
                    defaultValue={s.commission_rate}
                    onBlur={async e => {
                      const rate = Number(e.target.value)
                      try {
                        await api.sellers.update(s.id, { name: s.name, commission_rate: rate })
                        setSellers(prev => prev.map(x => x.id === s.id ? { ...x, commission_rate: rate } : x))
                        toast.success('Comisión actualizada')
                      } catch { toast.error('Error al guardar') }
                    }}
                    className="w-20 bg-surface border border-border rounded-lg px-2 py-1 text-sm text-white text-center no-drag"
                  />
                  <span className="text-zinc-500 text-sm">%</span>
                </div>
                <button
                  onClick={async () => {
                    try {
                      await api.sellers.delete(s.id)
                      setSellers(prev => prev.filter(x => x.id !== s.id))
                      toast.success('Vendedora eliminada')
                    } catch { toast.error('Error al eliminar') }
                  }}
                  className="no-drag p-1 text-zinc-500 hover:text-red-400 transition-colors"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            {sellers.length === 0 && <p className="text-xs text-zinc-600">Sin vendedoras registradas</p>}
          </div>

          <div className="flex gap-2 items-end pt-2 border-t border-border">
            <div className="flex-1">
              <label className={labelCls}>Nombre</label>
              <input
                className={inputCls} value={sellerNewName}
                onChange={e => setSellerNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addSeller()}
                placeholder="Ej: María..."
              />
            </div>
            <div>
              <label className={labelCls}>Comisión %</label>
              <input
                type="number" min="0" max="100" step="0.1"
                className={`${inputCls} w-24`}
                value={sellerNewRate}
                onChange={e => setSellerNewRate(e.target.value)}
              />
            </div>
            <button onClick={addSeller} className="btn-primary no-drag px-3 py-2 rounded-lg text-sm flex items-center gap-1">
              <Plus size={13} />
            </button>
          </div>

        </div>
      )}

      {/* ── Tab: Recargos ── */}
      {tab === 'surcharges' && (
        <div className="max-w-lg space-y-3">
          <p className="text-sm text-zinc-500 mb-4">Configurá el porcentaje de recargo por medio de pago y cantidad de cuotas. Se aplica automáticamente en cada venta.</p>
          {Object.entries(surcharges).map(([key, rate]) => (
            <div key={key} className="flex items-center gap-3">
              <span className="flex-1 text-sm text-zinc-300">{key}</span>
              <div className="flex items-center gap-2">
                <input
                  type="number" min="0" max="100" step="0.5"
                  value={rate}
                  onChange={e => {
                    const next = { ...surcharges, [key]: Number(e.target.value) }
                    setSurcharges(next)
                  }}
                  className="w-20 bg-[#0a0a0a] border border-border rounded-lg px-3 py-1.5 text-sm text-white text-center no-drag"
                />
                <span className="text-zinc-500 text-sm">%</span>
              </div>
            </div>
          ))}
          <div className="pt-3">
            <button onClick={() => saveSurcharges(surcharges)} className="btn-primary no-drag px-5 py-2 rounded-lg text-sm">Guardar recargos</button>
          </div>
        </div>
      )}

      {/* ── Tab: Email ── */}
      {tab === 'email' && (
        <div className="max-w-lg space-y-5">
          <p className="text-sm text-zinc-500">Al cerrar la caja se enviará automáticamente un resumen por email. También podés enviarlo manualmente desde el módulo de Caja.</p>

          {/* Instrucciones Gmail */}
          <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl space-y-2">
            <p className="text-xs font-semibold text-blue-300 uppercase tracking-wider">Configuración para Gmail</p>
            <p className="text-xs text-blue-400 leading-relaxed">
              Para Gmail necesitás una <strong>Contraseña de Aplicación</strong> (no la contraseña normal de tu cuenta).
            </p>
            <ol className="text-xs text-blue-400 space-y-0.5 list-decimal list-inside leading-relaxed">
              <li>Activá la <strong>verificación en dos pasos</strong> en <span className="font-mono bg-blue-500/10 px-1 rounded">myaccount.google.com → Seguridad</span></li>
              <li>En esa misma página buscá <strong>Contraseñas de aplicaciones</strong></li>
              <li>Generá una nueva para "DELPA" → copiá las 16 letras que te da Google</li>
              <li>Pegá esas 16 letras en el campo "Contraseña de aplicación" de abajo</li>
            </ol>
          </div>

          {/* Destinatario */}
          <div>
            <label className={labelCls}>Email destinatario <span className="text-red-400">*</span></label>
            <input type="email" className={inputCls}
              value={emailForm.email_to}
              onChange={e => setEmailForm(f => ({ ...f, email_to: e.target.value }))}
              placeholder="donde-llegan-los-reportes@gmail.com" />
            <p className="text-xs text-zinc-600 mt-1">A esta dirección llegan los resúmenes de caja.</p>
          </div>

          {/* Usuario + remitente */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Usuario Gmail <span className="text-red-400">*</span></label>
              <input type="email" className={inputCls}
                value={emailForm.email_user}
                onChange={e => setEmailForm(f => ({ ...f, email_user: e.target.value }))}
                placeholder="tucuenta@gmail.com" />
              <p className="text-xs text-zinc-600 mt-1">Tu cuenta de Gmail para autenticación.</p>
            </div>
            <div>
              <label className={labelCls}>Nombre remitente</label>
              <input className={inputCls}
                value={emailForm.email_from}
                onChange={e => setEmailForm(f => ({ ...f, email_from: e.target.value }))}
                placeholder="tucuenta@gmail.com" />
              <p className="text-xs text-zinc-600 mt-1">Puede ser igual al usuario.</p>
            </div>
          </div>

          {/* Contraseña */}
          <div>
            <label className={labelCls}>Contraseña de aplicación <span className="text-red-400">*</span></label>
            <input type="password" className={inputCls}
              value={emailForm.email_pass}
              onChange={e => setEmailForm(f => ({ ...f, email_pass: e.target.value }))}
              placeholder="16 letras generadas por Google (sin espacios)" />
          </div>

          {/* SMTP avanzado */}
          <details className="group">
            <summary className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300 select-none">
              Configuración avanzada SMTP (solo si no usás Gmail)
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Servidor SMTP</label>
                <input className={inputCls}
                  value={emailForm.email_smtp}
                  onChange={e => setEmailForm(f => ({ ...f, email_smtp: e.target.value }))}
                  placeholder="smtp.gmail.com" />
              </div>
              <div>
                <label className={labelCls}>Puerto</label>
                <input className={inputCls}
                  value={emailForm.email_port}
                  onChange={e => setEmailForm(f => ({ ...f, email_port: e.target.value }))}
                  placeholder="587" />
              </div>
            </div>
          </details>

          {/* Buttons */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={testEmail}
              disabled={emailTesting || saving}
              className="no-drag flex items-center gap-2 px-4 py-2 text-sm border border-border rounded-lg text-zinc-300 hover:text-white hover:border-accent transition-colors disabled:opacity-50"
            >
              <Mail size={13} className={emailTesting ? 'animate-pulse' : ''} />
              {emailTesting ? 'Enviando prueba...' : 'Probar envío'}
            </button>
            <button onClick={saveEmail} disabled={saving} className="btn-primary no-drag px-5 py-2 rounded-lg text-sm disabled:opacity-50">
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab: AFIP ── */}
      {tab === 'afip' && (
        <div className="max-w-lg space-y-6">
          {/* Status banner */}
          <div className={`flex items-center gap-3 p-4 rounded-xl border ${afipStatus?.connected ? 'bg-green-500/10 border-green-500/20' : 'bg-zinc-800/50 border-border'}`}>
            {afipStatus?.connected
              ? <CheckCircle size={18} className="text-green-400 shrink-0" />
              : <AlertCircle size={18} className="text-zinc-500 shrink-0" />
            }
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${afipStatus?.connected ? 'text-green-300' : 'text-zinc-400'}`}>
                {afipStatus?.connected ? 'Autenticado con AFIP' : 'No autenticado'}
              </p>
              {afipStatus?.connected && afipStatus.expiresAt && (
                <p className="text-xs text-green-500/70 mt-0.5">
                  TA válido hasta: {new Date(afipStatus.expiresAt).toLocaleString('es-AR')}
                </p>
              )}
              {!afipStatus?.connected && (
                <p className="text-xs text-zinc-600 mt-0.5">Usá "Probar conexión" para autenticarte</p>
              )}
            </div>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${afipStatus?.env === 'production' ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-blue-500/10 border-blue-500/30 text-blue-400'}`}>
              {afipStatus?.env === 'production' ? 'Producción' : 'Testing'}
            </span>
          </div>

          {/* Ambiente */}
          <div>
            <label className={labelCls}>Ambiente AFIP</label>
            <select
              className={inputCls}
              value={afipForm.afip_env}
              onChange={e => setAfipForm(p => ({ ...p, afip_env: e.target.value }))}
            >
              <option value="testing">Testing (homologación)</option>
              <option value="production">Producción</option>
            </select>
            <p className="text-xs text-zinc-600 mt-1">Usá Testing para pruebas. Cambiá a Producción solo cuando tengas el certificado de producción.</p>
          </div>

          {/* Punto de venta */}
          <div>
            <label className={labelCls}>Punto de venta</label>
            <input
              type="number"
              min="1"
              className={inputCls}
              value={afipForm.afip_punto_venta}
              onChange={e => setAfipForm(p => ({ ...p, afip_punto_venta: e.target.value }))}
              placeholder="1"
            />
            <p className="text-xs text-zinc-600 mt-1">Número de punto de venta habilitado en AFIP (generalmente 1 o 2).</p>
          </div>

          {/* Condición fiscal / Régimen */}
          <div>
            <label className={labelCls}>Régimen fiscal</label>
            <select
              className={inputCls}
              value={afipForm.afip_cond_fiscal}
              onChange={e => setAfipForm(p => ({ ...p, afip_cond_fiscal: e.target.value }))}
            >
              <option value="MONO">Monotributista (emite Factura C)</option>
              <option value="RI">Responsable Inscripto (emite A y B)</option>
            </select>
          </div>

          {/* Monotributo — categoría */}
          {afipForm.afip_cond_fiscal === 'MONO' && (
            <div className="p-4 bg-surface border border-border rounded-xl space-y-3">
              <p className="text-xs font-semibold text-zinc-300">Configuración Monotributo</p>
              <div>
                <label className={labelCls}>Categoría actual</label>
                <select className={inputCls} value={afipForm.mono_categoria}
                  onChange={e => setAfipForm(p => ({ ...p, mono_categoria: e.target.value }))}>
                  {[
                    ['A', '$2.960.000'], ['B', '$4.440.000'], ['C', '$6.210.000'],
                    ['D', '$8.520.000'], ['E', '$10.720.000'], ['F', '$13.420.000'],
                    ['G', '$16.870.000'], ['H', '$21.885.000'], ['I', '$26.260.000'],
                    ['J', '$31.260.000'], ['K', '$36.760.000'],
                  ].map(([cat, lim]) => (
                    <option key={cat} value={cat}>Categoría {cat} — límite anual {lim}</option>
                  ))}
                </select>
                <p className="text-xs text-zinc-600 mt-1">
                  Límite mensual: ${(({'A':2960000,'B':4440000,'C':6210000,'D':8520000,'E':10720000,'F':13420000,'G':16870000,'H':21885000,'I':26260000,'J':31260000,'K':36760000}[afipForm.mono_categoria]??6210000)/12).toLocaleString('es-AR',{maximumFractionDigits:0})}
                </p>
              </div>
            </div>
          )}

          {/* Responsable Inscripto — alícuota IVA */}
          {afipForm.afip_cond_fiscal === 'RI' && (
            <div className="p-4 bg-surface border border-border rounded-xl space-y-3">
              <p className="text-xs font-semibold text-zinc-300">Configuración Responsable Inscripto</p>
              <div>
                <label className={labelCls}>Alícuota de IVA (%)</label>
                <select className={inputCls} value={afipForm.iva_alicuota}
                  onChange={e => setAfipForm(p => ({ ...p, iva_alicuota: e.target.value }))}>
                  <option value="21">21% (alícuota general)</option>
                  <option value="10.5">10.5% (alícuota diferencial)</option>
                  <option value="27">27% (servicios públicos)</option>
                </select>
              </div>
            </div>
          )}

          {/* Info certificado */}
          <div className="p-3 bg-white/[0.03] border border-border rounded-xl text-xs text-zinc-500 space-y-1">
            <p className="text-zinc-400 font-medium">Certificado digital</p>
            <p>CUIT: <span className="text-zinc-300 font-mono">27-43667294-8</span></p>
            <p>Cert: <span className="text-zinc-300 font-mono">main/delpa.crt.crt</span></p>
            <p>Key: <span className="text-zinc-300 font-mono">main/delpa.key</span></p>
            <p className="text-zinc-600 pt-1">Los archivos de certificado se incluyen automáticamente en el build.</p>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={testAfipConexion}
              disabled={afipTesting}
              className="no-drag flex items-center gap-2 px-4 py-2 text-sm border border-border rounded-lg text-zinc-300 hover:text-white hover:border-accent transition-colors disabled:opacity-50"
            >
              <ShieldCheck size={13} className={afipTesting ? 'animate-pulse' : ''} />
              {afipTesting ? 'Probando...' : 'Probar conexión'}
            </button>
            <button
              onClick={saveAfip}
              disabled={afipSaving}
              className="btn-primary no-drag px-5 py-2 rounded-lg text-sm disabled:opacity-50"
            >
              {afipSaving ? 'Guardando...' : 'Guardar configuración AFIP'}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab: Tienda Nube ── */}
      {tab === 'tiendanube' && (
        <div className="max-w-lg space-y-6">
          <div className={`flex items-center gap-3 p-4 rounded-xl border ${tnStatus.connected ? 'bg-green-500/10 border-green-500/20' : 'bg-zinc-800/50 border-border'}`}>
            <Store size={18} className={tnStatus.connected ? 'text-green-400' : 'text-zinc-500'} />
            <div className="flex-1">
              <p className={`text-sm font-medium ${tnStatus.connected ? 'text-green-300' : 'text-zinc-400'}`}>
                {tnStatus.connected ? `Conectado a ${tnStatus.domain || 'Tienda Nube'}` : 'No conectado'}
              </p>
              {tnStatus.lastSync ? (() => {
                const sync = getSyncAge(tnStatus.lastSync)
                return sync ? (
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${sync.dot}`} />
                    <p className={`text-xs ${sync.color}`}>
                      {sync.label} · {sync.formatted}
                    </p>
                  </div>
                ) : null
              })() : (
                tnStatus.connected && (
                  <p className="text-xs text-zinc-600 mt-0.5">Sin sincronizar aún</p>
                )
              )}
            </div>
          </div>

          {!tnStatus.connected ? (
            <div className="space-y-4">
              <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-400 space-y-2">
                <p className="font-semibold uppercase tracking-wider">Cómo conectar</p>
                <ol className="list-decimal list-inside space-y-1 leading-relaxed">
                  <li>Hacé click en "Conectar Tienda Nube"</li>
                  <li>Se abrirá el navegador con la pantalla de autorización de Tienda Nube</li>
                  <li>Autorizá la app DELPA Gestión PRO</li>
                  <li>El sistema detecta la autorización automáticamente</li>
                </ol>
              </div>
              <button onClick={handleTnConnect} disabled={tnLoading}
                className="btn-primary no-drag flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm disabled:opacity-50">
                <Store size={15} className={tnLoading ? 'animate-pulse' : ''} />
                {tnLoading ? 'Esperando autorización...' : 'Conectar Tienda Nube'}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button onClick={handleTnSync} disabled={tnLoading}
                  className="btn-primary no-drag flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm disabled:opacity-50">
                  <ArrowLeftRight size={14} className={tnLoading ? 'animate-spin' : ''} />
                  {tnLoading ? 'Sincronizando...' : 'Sincronizar todo'}
                </button>
                <button onClick={handleTnSyncStock} disabled={tnLoading}
                  className="no-drag flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm border border-border text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-50">
                  <RefreshCw size={14} />
                  Solo stock
                </button>
              </div>

              {/* Customer import */}
              <div className="space-y-2">
                <button onClick={handleTnSyncCustomers} disabled={tnCustomerSyncing || tnLoading}
                  className="no-drag w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm border border-border text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-50">
                  <Users size={14} className={tnCustomerSyncing ? 'animate-pulse' : ''} />
                  {tnCustomerSyncing
                    ? `Importando clientes${tnCustomerSync ? ` (${tnCustomerSync.total})...` : '...'}`
                    : 'Importar todos los clientes'}
                </button>
                {tnCustomerSync?.done && (
                  <p className="text-xs text-green-400 text-center">
                    {tnCustomerSync.created} nuevos · {tnCustomerSync.updated} ya existían · {tnCustomerSync.total} total
                  </p>
                )}
              </div>

              {tnSyncResult && (
                <div className={`p-3 rounded-xl text-xs border ${tnSyncResult.errors?.length > 0 ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-green-500/10 border-green-500/20 text-green-400'}`}>
                  <p className="font-medium mb-1">Resultado</p>
                  <p>{tnSyncResult.pushed} productos · {tnSyncResult.stockSynced} stocks actualizados</p>
                  {tnSyncResult.errors?.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer">{tnSyncResult.errors.length} errores</summary>
                      <ul className="mt-1 space-y-0.5 opacity-80">{tnSyncResult.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                    </details>
                  )}
                </div>
              )}

              <div className="p-3 bg-white/[0.03] border border-border rounded-xl text-xs text-zinc-500 space-y-1">
                <p className="font-medium text-zinc-400">Info</p>
                <p>ID tienda: <span className="text-zinc-300 font-mono">{tnStatus.storeId}</span></p>
                <p>Dominio: <span className="text-zinc-300">{tnStatus.domain}</span></p>
                <p>Conectado: <span className="text-zinc-300">{tnStatus.connectedAt ? new Date(tnStatus.connectedAt).toLocaleDateString('es-AR') : '—'}</span></p>
              </div>

              <button onClick={handleTnDisconnect}
                className="no-drag flex items-center gap-2 px-4 py-2 text-sm border border-red-500/20 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors">
                <Unlink size={13} /> Desconectar Tienda Nube
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Mercado Pago ── */}
      {tab === 'mercadopago' && (
        <div className="max-w-lg space-y-6">

          {/* ── Sección 1: Conexión ── */}
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">1 · Credenciales</p>

            {mpStatus && (
              <div className={`flex items-center gap-3 p-3 rounded-lg border mb-3 ${mpStatus.ok ? 'bg-green-500/10 border-green-500/20' : 'bg-red-500/10 border-red-500/20'}`}>
                {mpStatus.ok
                  ? <CheckCircle size={15} className="text-green-400 shrink-0" />
                  : <AlertCircle size={15} className="text-red-400 shrink-0" />}
                <div>
                  {mpStatus.ok
                    ? <p className="text-sm text-green-400">Conectado · {mpStatus.name || mpStatus.email}</p>
                    : <p className="text-sm text-red-400">{mpStatus.error}</p>}
                  {mpStatus.ok && mpStatus.email && <p className="text-xs text-zinc-500">{mpStatus.email}</p>}
                </div>
              </div>
            )}

            {/* Sandbox toggle */}
            <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-border mb-3">
              <div>
                <p className="text-sm text-zinc-300 font-medium">{mpSandbox ? 'Modo prueba (Sandbox)' : 'Modo producción'}</p>
                <p className="text-xs text-zinc-600 mt-0.5">{mpSandbox ? 'Usar token TEST-... de sandbox' : 'Usar token APP_USR-... de producción'}</p>
              </div>
              <button
                onClick={async () => {
                  const next = !mpSandbox
                  setMpSandbox(next)
                  setMpPosData(null); setMpQrImageUrl(null); setMpQrPdfUrl(null)
                  await api.mp.saveConfig({ sandbox: next })
                  toast.success(next ? 'Modo prueba activado — usá un token TEST-...' : 'Modo producción activado — usá un token APP_USR-...')
                }}
                className={`no-drag relative w-11 h-6 rounded-full transition-colors ${mpSandbox ? 'bg-amber-500' : 'bg-accent'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${mpSandbox ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            <div className="space-y-2 mb-3">
              <label className={labelCls}>{mpSandbox ? 'Access Token de prueba (TEST-...)' : 'Access Token de producción (APP_USR-...)'}</label>
              <input
                className={inputCls}
                type="password"
                value={mpToken}
                onChange={e => { setMpToken(e.target.value); setMpStatus(null) }}
                placeholder={mpSandbox ? 'TEST-...' : 'APP_USR-...'}
              />
              {/* Token/mode mismatch warning */}
              {mpToken && mpSandbox  && !mpToken.startsWith('TEST-')    && <p className="text-xs text-amber-400">⚠ Modo prueba activado pero el token no empieza con TEST-</p>}
              {mpToken && !mpSandbox && !mpToken.startsWith('APP_USR-') && <p className="text-xs text-amber-400">⚠ Modo producción activado pero el token no empieza con APP_USR-</p>}
              <p className="text-xs text-zinc-600">
                mercadopago.com.ar/developers → Tu app → Credenciales {mpSandbox ? 'de prueba' : 'de producción'} → Access Token
              </p>
            </div>

            <div className="flex gap-2 flex-wrap">
              <button
                onClick={async () => {
                  if (!mpToken.trim()) return toast.error('Ingresá el Access Token primero')
                  setMpSaving(true)
                  try { await api.mp.saveConfig({ token: mpToken.trim(), sandbox: mpSandbox }); toast.success('Token guardado') }
                  catch { toast.error('Error al guardar') }
                  finally { setMpSaving(false) }
                }}
                disabled={mpSaving}
                className="btn-primary no-drag px-4 py-2 rounded-lg text-sm disabled:opacity-40"
              >
                {mpSaving ? 'Guardando...' : 'Guardar token'}
              </button>
              <button
                onClick={async () => {
                  if (!mpToken.trim()) return toast.error('Ingresá el Access Token primero')
                  setMpTesting(true); setMpStatus(null)
                  try {
                    await api.mp.saveConfig({ token: mpToken.trim(), sandbox: mpSandbox })
                    const res = await api.mp.testConnection({ token: mpToken.trim() })
                    setMpStatus(res)
                    if (res.ok) toast.success(`Conexión exitosa · ${res.name || res.email}`)
                    else toast.error(res.error || 'Error de conexión')
                  } catch (e) { toast.error(e.message || 'Error') }
                  finally { setMpTesting(false) }
                }}
                disabled={mpTesting}
                className="no-drag px-4 py-2 rounded-lg text-sm border border-border hover:bg-white/5 text-zinc-300 disabled:opacity-40 transition-colors"
              >
                {mpTesting ? 'Probando...' : 'Probar conexión'}
              </button>
              {mpToken && (
                <button
                  onClick={async () => {
                    setMpToken(''); setMpStatus(null)
                    await api.mp.saveConfig({ token: '' })
                    toast.success('Token eliminado')
                  }}
                  className="no-drag px-3 py-2 rounded-lg text-sm text-zinc-500 hover:text-red-400 transition-colors"
                  title="Desconectar"
                >
                  <Unlink size={14} />
                </button>
              )}
            </div>
          </div>

          <div className="border-t border-border" />

          {/* ── Sección 2: Punto de venta + QR ── */}
          <div>
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">2 · Punto de venta (QR fijo)</p>

            {mpPosData?.external_id ? (
              /* ── POS ya configurado ── */
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <CheckCircle size={15} className="text-green-400 shrink-0" />
                  <div>
                    <p className="text-sm text-green-400 font-medium">✓ Punto de venta configurado</p>
                    <p className="text-xs text-zinc-500 font-mono">
                      External ID: {mpPosData.external_id}
                      {mpPosData.pos_id ? ` · POS ID: ${mpPosData.pos_id}` : ''}
                    </p>
                  </div>
                </div>

                {/* Editable External POS ID */}
                <div>
                  <label className={labelCls}>External ID del POS</label>
                  <div className="flex gap-2">
                    <input
                      className={`${inputCls} font-mono`}
                      value={mpPosExternalId}
                      onChange={e => setMpPosExternalId(e.target.value)}
                      placeholder="petalogestion"
                    />
                    <button
                      disabled={mpSavingExternalId || !mpPosExternalId.trim()}
                      onClick={async () => {
                        setMpSavingExternalId(true)
                        try {
                          // Verifica el token y persiste user_id, pos_id y el QR del POS
                          const res = await api.mp.linkExistingPos({ posExternalId: mpPosExternalId.trim() })
                          if (!res.ok) return toast.error(res.error || 'No se pudo vincular el POS')
                          setMpPosData(res)
                          if (res.qr_image) setMpQrImageUrl(res.qr_image)
                          if (res.qr_pdf)   setMpQrPdfUrl(res.qr_pdf)
                          toast.success('Punto de venta vinculado y verificado')
                        } catch (e) { toast.error(e.message || 'Error') }
                        finally { setMpSavingExternalId(false) }
                      }}
                      className="no-drag btn-primary px-4 py-2 rounded-lg text-sm whitespace-nowrap disabled:opacity-50"
                    >
                      {mpSavingExternalId ? 'Verificando…' : 'Guardar y verificar'}
                    </button>
                  </div>
                  <p className="text-xs text-zinc-600 mt-1">Debe coincidir exactamente con el External ID del POS en tu cuenta de Mercado Pago.</p>
                </div>

                {mpQrImageUrl && (
                  <div className="flex flex-col items-center gap-3 p-4 bg-white rounded-xl">
                    <img src={mpQrImageUrl} alt="QR Mercado Pago" className="w-48 h-48 object-contain" />
                    <p className="text-xs text-black/60 text-center">{mpPosData.pos_name || 'Caja principal'}</p>
                  </div>
                )}

                <div className="flex gap-2 flex-wrap">
                  {mpQrImageUrl && (
                    <button
                      onClick={() => {
                        const bizName = form.business_name || 'DELPA'
                        const w = window.open('', '_blank', 'width=440,height=560')
                        w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>QR ${bizName}</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;text-align:center;padding:28px;background:#fff}
h2{font-size:20px;font-weight:bold;margin-bottom:4px}
.sub{color:#444;font-size:13px;margin:4px 0 10px}
img{width:280px;height:280px;display:block;margin:0 auto 10px;object-fit:contain}
.tip{color:#888;font-size:11px}
@media print{@page{size:A6;margin:4mm}}</style>
</head><body>
<h2>${bizName}</h2>
<p class="sub">Escanéame para pagar</p>
<img src="${mpQrImageUrl}" alt="QR Mercado Pago">
<p class="tip">${mpPosData.pos_name || 'Punto de venta'} · Mercado Pago</p>
<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),1000)}<\/script>
</body></html>`)
                        w.document.close()
                      }}
                      className="btn-primary no-drag flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
                    >
                      <Printer size={14} /> Imprimir QR
                    </button>
                  )}
                  {mpQrPdfUrl && (
                    <button
                      onClick={() => api.shell.openExternal(mpQrPdfUrl)}
                      className="no-drag flex items-center gap-2 px-4 py-2 rounded-lg text-sm border border-border text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
                    >
                      <FileText size={14} /> Ver PDF para imprimir
                    </button>
                  )}
                  <button
                    onClick={() => { setMpPosData(null); setMpQrImageUrl(null); setMpQrPdfUrl(null); setMpPosName('') }}
                    className="no-drag px-4 py-2 rounded-lg text-sm border border-border text-zinc-500 hover:text-red-400 hover:border-red-500/40 transition-colors"
                  >
                    Reconfigurar
                  </button>
                </div>
              </div>
            ) : (
              /* ── Formulario de configuración ── */
              <div className="space-y-3">
                <p className="text-xs text-zinc-500">
                  DELPA creará la sucursal y el punto de venta en tu cuenta de Mercado Pago automáticamente. El QR generado es fijo — imprimilo en el mostrador. Cada vez que cobres con MP QR, DELPA cargará el monto exacto automáticamente.
                </p>
                <div>
                  <label className={labelCls}>Nombre del local</label>
                  <input
                    className={inputCls}
                    value={mpPosName}
                    onChange={e => setMpPosName(e.target.value)}
                    placeholder="Ej: Petalo Rosa"
                  />
                  <p className="text-xs text-zinc-600 mt-1">Se usará como nombre de la sucursal en Mercado Pago.</p>
                </div>
                <button
                  onClick={async () => {
                    if (!mpToken.trim()) return toast.error('Guardá el Access Token primero')
                    setMpCreatingPos(true)
                    try {
                      const res = await api.mp.createPos({ posName: mpPosName.trim() || 'Mi Local' })
                      if (!res.ok) return toast.error(res.error || 'Error al configurar punto de venta')
                      setMpPosData(res)
                      if (res.qr_image) setMpQrImageUrl(res.qr_image)
                      if (res.qr_pdf)   setMpQrPdfUrl(res.qr_pdf)
                      toast.success('Punto de venta configurado correctamente')
                    } catch (e) { toast.error(e.message || 'Error') }
                    finally { setMpCreatingPos(false) }
                  }}
                  disabled={mpCreatingPos || !mpToken}
                  className="btn-primary no-drag flex items-center gap-2 px-4 py-2 rounded-lg text-sm disabled:opacity-40"
                >
                  <QrCode size={14} />
                  {mpCreatingPos ? 'Configurando... (puede tardar unos segundos)' : 'Configurar punto de venta'}
                </button>
                {!mpToken && <p className="text-xs text-amber-500">Guardá el Access Token antes de continuar.</p>}

                {/* Alternativa: vincular un POS ya existente en la cuenta MP */}
                <div className="border-t border-border pt-3 mt-1 space-y-2">
                  <p className="text-xs text-zinc-500">¿Ya tenés un punto de venta creado en Mercado Pago? Vinculalo por su External ID (no crea uno nuevo).</p>
                  <div className="flex gap-2">
                    <input
                      className={`${inputCls} font-mono`}
                      value={mpPosExternalId}
                      onChange={e => setMpPosExternalId(e.target.value)}
                      placeholder="petalogestion"
                    />
                    <button
                      disabled={mpLinking || !mpToken || !mpPosExternalId.trim()}
                      onClick={async () => {
                        setMpLinking(true)
                        try {
                          const res = await api.mp.linkExistingPos({ posExternalId: mpPosExternalId.trim() })
                          if (!res.ok) return toast.error(res.error || 'No se pudo vincular el POS')
                          setMpPosData(res)
                          if (res.qr_image) setMpQrImageUrl(res.qr_image)
                          if (res.qr_pdf)   setMpQrPdfUrl(res.qr_pdf)
                          toast.success('Punto de venta vinculado correctamente')
                        } catch (e) { toast.error(e.message || 'Error') }
                        finally { setMpLinking(false) }
                      }}
                      className="no-drag flex items-center gap-2 px-4 py-2 rounded-lg text-sm border border-border text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors whitespace-nowrap disabled:opacity-40"
                    >
                      {mpLinking ? 'Vinculando…' : 'Vincular POS existente'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-border pt-4 space-y-2">
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">¿Cómo funciona?</p>
            <ol className="text-xs text-zinc-500 space-y-1.5 list-decimal list-inside">
              <li>Guardá el Access Token de producción y probá la conexión.</li>
              <li>Creá el punto de venta e imprimí el QR en el mostrador.</li>
              <li>En Ventas seleccioná <span className="text-zinc-300">"Mercado Pago QR"</span> → INGRESAR.</li>
              <li>DELPA carga el monto exacto en el QR automáticamente.</li>
              <li>El cliente escanea y paga — el sistema confirma solo.</li>
            </ol>
          </div>
        </div>
      )}

      {/* ── Tab: Usuarios ── */}
      {tab === 'usuarios' && (
        <div className="max-w-2xl space-y-6">
          {/* User list */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-medium text-white">Usuarios del sistema</h3>
              <button
                onClick={() => { setUserEditing(null); setUserForm({ username: '', password: '', role: 'vendedor', seller_name: '' }); setUserShowPw(false) }}
                className="btn-primary no-drag flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm"
              >
                <Plus size={13} /> Nuevo usuario
              </button>
            </div>
            <div className="divide-y divide-border">
              {users.length === 0 ? (
                <div className="py-8 text-center text-zinc-600 text-sm">Sin usuarios registrados</div>
              ) : users.map(u => (
                <div key={u.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white font-medium">{u.username}</span>
                      <span className={cn('text-xs px-2 py-0.5 rounded-full border',
                        u.role === 'admin'
                          ? 'bg-accent/10 border-accent/30 text-accent'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400')}>
                        {u.role === 'admin' ? 'Admin' : 'Vendedor'}
                      </span>
                      {!u.active && <span className="text-xs text-red-400">Inactivo</span>}
                    </div>
                    {u.seller_name && <p className="text-xs text-zinc-500 mt-0.5">Vendedora: {u.seller_name}</p>}
                  </div>
                  <button
                    onClick={() => {
                      setUserEditing(u)
                      setUserForm({ username: u.username, password: '', role: u.role, seller_name: u.seller_name || '' })
                      setUserNewPw('')
                      setUserShowPw(false)
                    }}
                    className="no-drag p-2 text-zinc-500 hover:text-zinc-200 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <Edit3 size={13} />
                  </button>
                  <button
                    onClick={async () => {
                      if (!window.confirm(`¿Eliminar usuario "${u.username}"?`)) return
                      try {
                        const res = await api.auth.users.delete(u.id)
                        if (res.ok) { toast.success('Usuario eliminado'); loadUsers() }
                        else toast.error(res.error || 'Error al eliminar')
                      } catch (e) { toast.error(e.message) }
                    }}
                    className="no-drag p-2 text-zinc-500 hover:text-red-400 rounded-lg hover:bg-red-500/5 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Create / Edit form */}
          <div className="bg-card border border-border rounded-xl p-5 space-y-4">
            <h3 className="text-sm font-medium text-white">
              {userEditing ? `Editar: ${userEditing.username}` : 'Crear usuario'}
            </h3>

            {!userEditing && (
              <div>
                <label className={labelCls}>Nombre de usuario</label>
                <input
                  className={inputCls}
                  value={userForm.username}
                  onChange={e => setUserForm(f => ({ ...f, username: e.target.value }))}
                  placeholder="Ej: maria"
                  autoComplete="off"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Rol</label>
                <select className={inputCls} value={userForm.role} onChange={e => setUserForm(f => ({ ...f, role: e.target.value }))}>
                  <option value="vendedor">Vendedor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Vendedora asociada</label>
                <select className={inputCls} value={userForm.seller_name} onChange={e => setUserForm(f => ({ ...f, seller_name: e.target.value }))}>
                  <option value="">Sin asignar</option>
                  {sellers.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
              </div>
            </div>

            {!userEditing && (
              <div>
                <label className={labelCls}>Contraseña</label>
                <div className="relative">
                  <input
                    type={userShowPw ? 'text' : 'password'}
                    className={`${inputCls} pr-10`}
                    value={userForm.password}
                    onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setUserShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 no-drag">
                    {userShowPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                onClick={async () => {
                  if (userSaving) return
                  setUserSaving(true)
                  try {
                    let res
                    if (userEditing) {
                      res = await api.auth.users.update(userEditing.id, { role: userForm.role, seller_name: userForm.seller_name })
                    } else {
                      if (!userForm.username.trim()) { toast.error('Ingresá un nombre de usuario'); return }
                      if (!userForm.password) { toast.error('Ingresá una contraseña'); return }
                      res = await api.auth.users.create(userForm)
                    }
                    if (res.ok) {
                      toast.success(userEditing ? 'Usuario actualizado' : 'Usuario creado')
                      setUserEditing(null)
                      setUserForm({ username: '', password: '', role: 'vendedor', seller_name: '' })
                      loadUsers()
                    } else toast.error(res.error || 'Error')
                  } catch (e) { toast.error(e.message) }
                  finally { setUserSaving(false) }
                }}
                disabled={userSaving}
                className="btn-primary no-drag px-5 py-2 rounded-lg text-sm disabled:opacity-50"
              >
                {userSaving ? 'Guardando...' : userEditing ? 'Actualizar' : 'Crear usuario'}
              </button>
              {userEditing && (
                <button
                  onClick={() => { setUserEditing(null); setUserForm({ username: '', password: '', role: 'vendedor', seller_name: '' }) }}
                  className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5"
                >
                  Cancelar
                </button>
              )}
            </div>

            {/* Change password (only when editing) */}
            {userEditing && (
              <div className="border-t border-border pt-4 space-y-3">
                <h4 className="text-xs text-zinc-500 uppercase tracking-wider">Cambiar contraseña</h4>
                <div className="relative">
                  <input
                    type={userShowPw ? 'text' : 'password'}
                    className={`${inputCls} pr-10`}
                    value={userNewPw}
                    onChange={e => setUserNewPw(e.target.value)}
                    placeholder="Nueva contraseña..."
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setUserShowPw(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 no-drag">
                    {userShowPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <button
                  onClick={async () => {
                    if (!userNewPw.trim()) return toast.error('Ingresá la nueva contraseña')
                    try {
                      const res = await api.auth.users.changePassword(userEditing.id, userNewPw)
                      if (res.ok) { toast.success('Contraseña actualizada'); setUserNewPw('') }
                      else toast.error(res.error || 'Error')
                    } catch (e) { toast.error(e.message) }
                  }}
                  className="no-drag flex items-center gap-2 px-4 py-2 text-sm border border-border rounded-lg text-zinc-400 hover:text-white hover:border-accent transition-colors"
                >
                  Actualizar contraseña
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Pagos & Drive ── */}
      {tab === 'payments' && (
        <div className="max-w-lg space-y-8">
          {/* Payment methods */}
          <div>
            <h3 className="text-sm font-medium text-white mb-1">Medios de pago personalizados</h3>
            <p className="text-xs text-zinc-500 mb-4">Se agregan a los predeterminados (Efectivo, Transferencia, etc.)</p>
            <TagList
              items={paymentMethods}
              placeholder="Ej: Cripto, Cheque..."
              onAdd={v => { const next = [...paymentMethods, v]; setPaymentMethods(next); saveArray('custom_payment_methods', next) }}
              onRemove={v => { const next = paymentMethods.filter(p => p !== v); setPaymentMethods(next); saveArray('custom_payment_methods', next) }}
            />
          </div>

          {/* Google Drive */}
          <div className="border-t border-border pt-6">
            <h3 className="text-sm font-medium text-white mb-1 flex items-center gap-2">
              <Cloud size={15} className={gdStatus.connected ? 'text-accent' : gdStatus.tokenInvalid ? 'text-red-400' : 'text-zinc-500'} />
              Google Drive Backup
            </h3>

            {gdStatus.notConfigured ? (
              <div className="mt-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-sm text-amber-400">
                <p className="font-medium mb-1">Credenciales no configuradas</p>
                <p className="text-xs text-amber-500/80">Completá CLIENT_ID y CLIENT_SECRET en <code className="bg-black/30 px-1 rounded">main/ipc/googledrive.js</code> con las credenciales de tu proyecto en Google Cloud Console.</p>
              </div>
            ) : gdStatus.tokenInvalid ? (
              <div className="mt-3 space-y-3">
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
                  <AlertCircle size={15} className="text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-red-300">Sesión expirada o permisos insuficientes</p>
                    <p className="text-xs text-red-400/80 mt-0.5">El token de Google Drive expiró, fue revocado, o no tiene los permisos necesarios para subir archivos. Reconectá tu cuenta para continuar.</p>
                  </div>
                </div>
                <button
                  onClick={async () => {
                    await api.googledrive.clearTokens().catch(() => {})
                    handleGdAuth()
                  }}
                  disabled={gdLoading}
                  className="no-drag flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
                >
                  <Cloud size={13} />
                  {gdLoading ? 'Abriendo navegador...' : 'Reconectar Google Drive'}
                </button>
              </div>
            ) : gdStatus.connected ? (
              <div className="mt-3 space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Cloud size={14} className="text-accent" />
                  <span className="text-zinc-300">{gdStatus.email}</span>
                  <span className="text-xs text-zinc-600 ml-auto">
                    {gdStatus.lastBackupAt
                      ? `Último backup: ${new Date(gdStatus.lastBackupAt).toLocaleString('es-AR')}`
                      : 'Sin backups aún'}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleGdBackup}
                    disabled={gdLoading}
                    className="btn-primary no-drag flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
                  >
                    <RefreshCw size={13} className={gdLoading ? 'animate-spin' : ''} />
                    {gdLoading ? 'Sincronizando...' : 'Sincronizar ahora'}
                  </button>
                  <button
                    onClick={handleGdDisconnect}
                    className="no-drag flex items-center gap-2 px-4 py-2 text-sm border border-border rounded-lg text-zinc-500 hover:text-red-400 hover:border-red-500/30 transition-colors"
                  >
                    <Unlink size={13} /> Desconectar
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-zinc-500">Conectá tu cuenta de Google para hacer backups automáticos de la base de datos a Google Drive.</p>
                <button
                  onClick={handleGdAuth}
                  disabled={gdLoading}
                  className="btn-primary no-drag flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
                >
                  <Cloud size={13} />
                  {gdLoading ? 'Abriendo navegador...' : 'Conectar Google Drive'}
                </button>
              </div>
            )}
          </div>

          {/* ── Backup cifrado ── */}
          <BackupSection />

        </div>
      )}

      {/* ── Tab: Fidelización ── */}
      {tab === 'fidelizacion' && (
        <div className="max-w-lg space-y-6">
          <p className="text-sm text-zinc-500">Configurá el sistema de puntos para premiar a tus clientas frecuentes.</p>

          {/* Enable toggle */}
          <div className="flex items-center justify-between bg-card border border-border rounded-xl px-4 py-3">
            <div>
              <p className="text-sm text-white font-medium">Sistema de puntos</p>
              <p className="text-xs text-zinc-500 mt-0.5">Sumar puntos automáticamente en cada venta con cliente</p>
            </div>
            <button
              onClick={() => setPointsForm(p => ({ ...p, points_enabled: p.points_enabled === '1' ? '0' : '1' }))}
              className={cn('no-drag relative w-10 h-5 rounded-full transition-colors',
                pointsForm.points_enabled === '1' ? 'bg-accent' : 'bg-zinc-700')}
            >
              <span className={cn('absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow',
                pointsForm.points_enabled === '1' ? 'translate-x-5' : 'translate-x-0.5')} />
            </button>
          </div>

          <div className={cn('space-y-4', pointsForm.points_enabled !== '1' && 'opacity-50 pointer-events-none')}>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Pesos por 1 punto</label>
                <input
                  type="number" min="1" className={inputCls}
                  value={pointsForm.points_per_pesos}
                  onChange={e => setPointsForm(p => ({ ...p, points_per_pesos: e.target.value }))}
                />
                <p className="text-[10px] text-zinc-600 mt-0.5">Ej: 1000 = cada $1000 suma 1 punto</p>
              </div>
              <div>
                <label className={labelCls}>Valor del punto ($)</label>
                <input
                  type="number" min="1" className={inputCls}
                  value={pointsForm.point_value}
                  onChange={e => setPointsForm(p => ({ ...p, point_value: e.target.value }))}
                />
                <p className="text-[10px] text-zinc-600 mt-0.5">Ej: 100 = 1 punto = $100 de dto.</p>
              </div>
              <div>
                <label className={labelCls}>Puntos mínimos canje</label>
                <input
                  type="number" min="1" className={inputCls}
                  value={pointsForm.points_min_redeem}
                  onChange={e => setPointsForm(p => ({ ...p, points_min_redeem: e.target.value }))}
                />
                <p className="text-[10px] text-zinc-600 mt-0.5">Puntos mínimos para canjear</p>
              </div>
            </div>

            {/* Preview */}
            {pointsForm.points_enabled === '1' && (
              <div className="p-3 bg-accent/5 border border-accent/20 rounded-xl text-xs text-zinc-400 space-y-1">
                <p className="text-accent font-medium">Vista previa del programa</p>
                <p>• Cada ${Number(pointsForm.points_per_pesos).toLocaleString()} de compra = 1 punto</p>
                <p>• 1 punto = ${Number(pointsForm.point_value).toLocaleString()} de descuento</p>
                <p>• Mínimo para canjear: {pointsForm.points_min_redeem} puntos</p>
                <p>• Con {pointsForm.points_min_redeem} puntos la clienta obtiene ${(Number(pointsForm.points_min_redeem) * Number(pointsForm.point_value)).toLocaleString()} de descuento</p>
              </div>
            )}
          </div>

          <button onClick={savePoints} disabled={pointsSaving} className="btn-primary no-drag px-5 py-2 rounded-lg text-sm">
            {pointsSaving ? 'Guardando...' : 'Guardar configuración'}
          </button>
        </div>
      )}

      {/* ── Tab: Gastos Fijos ── */}
      {tab === 'gastosfijos' && (
        <div className="max-w-lg space-y-5">
          <div>
            <p className="text-sm text-zinc-500">Registrá los gastos fijos mensuales para calcular la rentabilidad real del negocio.</p>
            <p className="text-xs text-zinc-600 mt-1">Total activo: <span className="text-accent font-semibold">
              {new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(fixedCosts.filter(c => c.active).reduce((s, c) => s + c.amount, 0))}
            </span>/mes</p>
          </div>

          {/* List */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            {fixedCosts.length === 0 ? (
              <div className="py-8 text-center text-zinc-600 text-sm">Sin gastos fijos registrados</div>
            ) : fixedCosts.map(cost => (
              <div key={cost.id} className={`flex items-center gap-3 px-4 py-3 border-b border-border/50 last:border-0 ${!cost.active ? 'opacity-50' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white">{cost.name}</span>
                    <span className="text-[10px] bg-white/[0.06] border border-border px-2 py-0.5 rounded-full text-zinc-500">{cost.category}</span>
                  </div>
                  <p className="text-xs text-accent mt-0.5">{new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(cost.amount)}/mes</p>
                </div>
                <button
                  onClick={async () => {
                    await api.fixedcosts.update({ id: cost.id, name: cost.name, amount: cost.amount, category: cost.category, active: !cost.active })
                    loadFixedCosts()
                  }}
                  className={`no-drag text-xs px-2 py-1 rounded-lg border transition-colors ${cost.active ? 'border-border text-zinc-500 hover:text-zinc-200' : 'border-accent/30 text-accent/60 hover:text-accent'}`}
                >
                  {cost.active ? 'Pausar' : 'Activar'}
                </button>
                <button
                  onClick={async () => {
                    await api.fixedcosts.delete(cost.id)
                    loadFixedCosts()
                    toast.success('Gasto eliminado')
                  }}
                  className="no-drag p-1.5 text-zinc-600 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

          {/* Add form */}
          <div className="border-t border-border pt-4 space-y-3">
            <h4 className="text-xs text-zinc-500 uppercase tracking-wider">Agregar gasto fijo</h4>
            <div className="grid grid-cols-3 gap-2">
              <input value={fcForm.name} onChange={e => setFcForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Nombre" className={`${inputCls} col-span-2`} />
              <input value={fcForm.category} onChange={e => setFcForm(p => ({ ...p, category: e.target.value }))}
                placeholder="Categoría" className={inputCls} />
            </div>
            <div className="flex gap-2">
              <input type="number" min="0" value={fcForm.amount} onChange={e => setFcForm(p => ({ ...p, amount: e.target.value }))}
                placeholder="Monto mensual" className={`${inputCls} flex-1`} />
              <button
                onClick={async () => {
                  if (!fcForm.name || !fcForm.amount) return toast.error('Completá nombre y monto')
                  setFcSaving(true)
                  try {
                    await api.fixedcosts.create(fcForm)
                    setFcForm({ name: '', amount: '', category: 'General' })
                    loadFixedCosts()
                    toast.success('Gasto fijo agregado')
                  } catch { toast.error('Error') }
                  finally { setFcSaving(false) }
                }}
                disabled={fcSaving}
                className="btn-primary no-drag flex items-center gap-2 px-4 py-2 rounded-lg text-sm disabled:opacity-50"
              >
                <Plus size={13} /> Agregar
              </button>
            </div>
          </div>

          {/* Monthly goal */}
          <div className="border-t border-border pt-4 space-y-3">
            <h4 className="text-sm font-medium text-white mb-1">Meta de ventas mensual</h4>
            <div className="flex gap-2">
              <input
                type="number" min="0" placeholder="Ej: 500000"
                defaultValue=""
                id="monthly-goal-input"
                className={`${inputCls} flex-1`}
                onBlur={async e => {
                  const v = e.target.value
                  await api.settings.set('monthly_goal', v || '0')
                  toast.success('Meta actualizada')
                }}
              />
              <span className="flex items-center text-zinc-500 text-sm">$/mes</span>
            </div>
            <p className="text-xs text-zinc-600">Se muestra como barra de progreso en el Dashboard.</p>
          </div>

          {/* Weekly summary */}
          <div className="border-t border-border pt-4">
            <h4 className="text-sm font-medium text-white mb-1">Resumen semanal por email</h4>
            <p className="text-xs text-zinc-500 mb-3">Se envía automáticamente todos los lunes a las 8 AM al email configurado. También podés enviarlo ahora.</p>
            <button
              onClick={async () => {
                setWeeklySending(true)
                try {
                  const r = await api.weeklySummary.send()
                  if (r.ok) toast.success('Resumen enviado correctamente')
                  else toast.error(r.error || 'Error al enviar')
                } catch (e) { toast.error(e.message || 'Error') }
                finally { setWeeklySending(false) }
              }}
              disabled={weeklySending}
              className="no-drag flex items-center gap-2 px-4 py-2 rounded-lg text-sm border border-border text-zinc-300 hover:text-white hover:border-accent transition-colors disabled:opacity-50"
            >
              <Send size={13} className={weeklySending ? 'animate-pulse' : ''} />
              {weeklySending ? 'Enviando...' : 'Enviar resumen ahora'}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab: Licencia ── */}
      {tab === 'licencia' && (
        <div className="max-w-lg space-y-6">
          {/* Status */}
          <div className={cn('p-4 rounded-xl border flex items-start gap-3',
            licenseInfo?.status === 'active'
              ? 'bg-green-500/10 border-green-500/20'
              : licenseInfo?.status === 'trial'
                ? 'bg-amber-500/10 border-amber-500/20'
                : 'bg-red-500/10 border-red-500/20')}>
            <ShieldAlert size={18} className={cn('shrink-0 mt-0.5',
              licenseInfo?.status === 'active' ? 'text-green-400' :
              licenseInfo?.status === 'trial'  ? 'text-amber-400' : 'text-red-400')} />
            <div className="flex-1">
              <p className={cn('text-sm font-medium',
                licenseInfo?.status === 'active' ? 'text-green-300' :
                licenseInfo?.status === 'trial'  ? 'text-amber-300' : 'text-red-300')}>
                {licenseInfo?.status === 'active' ? 'Licencia activa' :
                 licenseInfo?.status === 'trial'  ? `Período de prueba — ${licenseInfo.daysRemaining} días restantes` :
                 'Período de prueba vencido'}
              </p>
              {licenseInfo?.installedAt && (
                <p className="text-xs text-zinc-500 mt-1">
                  Instalado: {new Date(licenseInfo.installedAt).toLocaleDateString('es-AR')}
                </p>
              )}
            </div>
          </div>

          {/* Hardware ID */}
          <div>
            <label className={labelCls}>Hardware ID de esta PC</label>
            <div className="flex items-center gap-2 bg-[#0a0a0a] border border-border rounded-lg px-3 py-2.5">
              <code className="flex-1 text-xs text-zinc-300 font-mono break-all">{licenseInfo?.hardwareId || '—'}</code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(licenseInfo?.hardwareId || '').catch(() => {})
                  setLicenseCopied(true)
                  setTimeout(() => setLicenseCopied(false), 2000)
                }}
                className="no-drag shrink-0 text-zinc-500 hover:text-zinc-200 transition-colors"
              >
                {licenseCopied ? <CheckCircle size={14} className="text-accent" /> : <Copy size={14} />}
              </button>
            </div>
            <p className="text-xs text-zinc-600 mt-1">Enviá este ID a tu proveedor para obtener el código de activación.</p>
          </div>

          {/* Activation */}
          {licenseInfo?.status !== 'active' && (
            <div className="space-y-3">
              <label className={labelCls}>Código de activación</label>
              <input
                className={`${inputCls} font-mono tracking-widest`}
                placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                value={licenseCode}
                onChange={e => setLicenseCode(e.target.value.toUpperCase())}
              />
              <button
                onClick={handleLicenseActivate}
                disabled={licenseActivating}
                className="btn-primary no-drag px-5 py-2 rounded-lg text-sm"
              >
                {licenseActivating ? 'Verificando...' : 'Activar licencia'}
              </button>
            </div>
          )}

          <div className="p-3 bg-white/[0.03] border border-border rounded-xl text-xs text-zinc-500 space-y-1">
            <p className="text-zinc-400 font-medium">Generador de códigos (para administradores)</p>
            <p>Desde la terminal: <code className="bg-black/30 px-1 rounded">node tools/generate-license.js &lt;HARDWARE_ID&gt;</code></p>
            <p className="text-zinc-600">El generador usa el mismo algoritmo que la validación interna.</p>
          </div>
        </div>
      )}

      {/* ── Tab: Actualizaciones ── */}
      {tab === 'actualizaciones' && <TabActualizaciones inputCls={inputCls} />}

        </div>{/* end content */}
      </div>{/* end flex layout */}
    </motion.div>
  )
}

// ── Tab Actualizaciones ────────────────────────────────────────────────────────

function TabActualizaciones({ inputCls }) {
  const [currentVersion, setCurrentVersion] = useState('...')
  const [checking,  setChecking]  = useState(false)
  const [result,    setResult]    = useState(null)      // resultado de checkManual
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    api.updater.getCurrentVersion().then(v => setCurrentVersion(v)).catch(() => {})
  }, [])

  const checkNow = async () => {
    setChecking(true)
    setResult(null)
    try {
      const res = await api.updater.checkManual()
      setResult(res)
    } catch (e) {
      setResult({ ok: false, error: e.message || 'Error desconocido', currentVersion })
    } finally {
      setChecking(false)
    }
  }

  const doDownload = async () => {
    setDownloading(true)
    try {
      const r = await api.updater.downloadAndInstall()
      if (!r?.ok) toast.error(r?.error || 'Error al iniciar descarga')
      else toast.success('Descargando actualización...')
    } catch (e) {
      toast.error(e.message || 'Error')
    } finally {
      setDownloading(false) }
  }

  const openGitHub = () => {
    if (result?.releaseUrl) api.updater.openReleasePage(result.releaseUrl)
  }

  // Escuchar progreso de descarga del auto-updater
  const [downloadPct, setDownloadPct] = useState(null)
  useEffect(() => {
    const unsubProg = window.electron.on('updater:progress', ({ percent }) => setDownloadPct(Math.round(percent)))
    const unsubStat = window.electron.on('updater:status', ({ type }) => {
      if (type === 'downloaded') setDownloadPct(100)
    })
    return () => { unsubProg(); unsubStat() }
  }, [])

  return (
    <div className="max-w-md space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-white mb-1 flex items-center gap-2">
          <ArrowUpCircle size={15} className="text-accent" />
          Actualizaciones de DELPA
        </h3>
        <p className="text-xs text-zinc-500">
          Verificá si hay una nueva versión disponible y actualizá desde acá.
        </p>
      </div>

      {/* Versión actual */}
      <div className="p-4 bg-surface border border-border rounded-xl flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-500 mb-0.5">Versión instalada</p>
          <p className="text-lg font-bold text-white font-mono">v{currentVersion}</p>
        </div>
        <button
          onClick={checkNow}
          disabled={checking}
          className="no-drag flex items-center gap-2 px-4 py-2 text-sm border border-border rounded-lg text-zinc-300 hover:text-white hover:border-accent transition-colors disabled:opacity-50"
        >
          <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
          {checking ? 'Buscando...' : 'Buscar actualizaciones'}
        </button>
      </div>

      {/* Resultado de la verificación */}
      {result && (
        <div className={cn('p-4 rounded-xl border space-y-3', result.ok
          ? result.updateAvailable
            ? 'bg-accent/5 border-accent/30'
            : 'bg-green-500/5 border-green-500/20'
          : 'bg-red-500/5 border-red-500/20'
        )}>
          {!result.ok ? (
            <div className="flex items-center gap-2">
              <AlertCircle size={15} className="text-red-400 shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-300">No se pudo verificar</p>
                <p className="text-xs text-red-500 mt-0.5">{result.error}</p>
              </div>
            </div>
          ) : result.updateAvailable ? (
            <>
              <div className="flex items-center gap-2">
                <ArrowUpCircle size={15} className="text-accent shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">
                    Nueva versión disponible: <span className="text-accent font-bold">v{result.latestVersion}</span>
                  </p>
                  {result.publishedAt && (
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Publicada: {new Date(result.publishedAt).toLocaleDateString('es-AR')}
                    </p>
                  )}
                </div>
              </div>

              {/* Notas de la versión */}
              {result.releaseBody && (
                <div className="bg-black/20 rounded-lg p-3 max-h-40 overflow-y-auto">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Novedades</p>
                  <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed">
                    {result.releaseBody.slice(0, 800)}{result.releaseBody.length > 800 ? '...' : ''}
                  </pre>
                </div>
              )}

              {/* Barra de progreso de descarga */}
              {downloadPct !== null && (
                <div>
                  <div className="flex justify-between text-xs text-zinc-400 mb-1">
                    <span>Descargando...</span>
                    <span>{downloadPct}%</span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${downloadPct}%` }} />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={doDownload}
                  disabled={downloading || downloadPct !== null}
                  className="no-drag flex-1 btn-primary flex items-center justify-center gap-2 py-2 text-sm rounded-lg disabled:opacity-50"
                >
                  <Download size={14} />
                  {downloadPct !== null ? `Descargando ${downloadPct}%...` : downloading ? 'Iniciando...' : 'Actualizar ahora'}
                </button>
                <button
                  onClick={openGitHub}
                  className="no-drag flex items-center gap-1.5 px-3 py-2 text-sm border border-border rounded-lg text-zinc-400 hover:text-white transition-colors"
                >
                  <ExternalLink size={13} /> Ver en GitHub
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <CheckCircle size={15} className="text-green-400 shrink-0" />
              <div>
                <p className="text-sm font-medium text-green-300">DELPA está actualizado</p>
                <p className="text-xs text-zinc-500 mt-0.5">v{result.currentVersion} es la versión más reciente</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Info */}
      <div className="p-3 bg-white/[0.02] border border-border rounded-xl text-xs text-zinc-600 space-y-1">
        <p>Las actualizaciones se descargan automáticamente al iniciar DELPA cuando hay conexión a internet.</p>
        <p>Si la descarga automática no funciona, usá el botón <span className="text-zinc-400">"Actualizar ahora"</span> de arriba.</p>
      </div>
    </div>
  )
}
