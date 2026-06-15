import { useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Plus, FileText, Printer, ShieldCheck, AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { bizContactFooterHtml } from '@/lib/printFooter'
import { formatCurrency, formatDateTime, cn } from '@/lib/utils'
import Modal from '@/components/shared/Modal'
import Pagination from '@/components/shared/Pagination'
import PageHeader from '@/components/shared/PageHeader'
import SkeletonTable from '@/components/shared/SkeletonLoader'
import EmptyState from '@/components/shared/EmptyState'

const TYPES = ['B', 'A', 'C', 'Remito']

function printInvoice(inv, biz = {}) {
  const items = JSON.parse(inv.items_json || '[]')
  const bizName = biz.business_name || 'DELPA'
  const logoHtml = biz.business_logo ? `<img src="${biz.business_logo}" style="height:48px;object-fit:contain;margin-bottom:4px" alt="logo">` : ''
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  * { margin:0;padding:0;box-sizing:border-box; }
  body { font-family: Arial, sans-serif; font-size: 12px; padding: 16mm; max-width: 210mm; }
  h1 { font-size: 22px; } .right { text-align: right; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #ddd; padding: 6px 10px; }
  th { background: #f5f5f5; }
  .total { font-size: 16px; font-weight: bold; }
  @media print { @page { size: A4; margin: 15mm; } }
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
  <div>${logoHtml}<h1>${bizName}</h1>${biz.business_address ? `<p>${biz.business_address}</p>` : ''}${biz.business_phone ? `<p>Tel: ${biz.business_phone}</p>` : ''}${biz.business_cuit ? `<p>CUIT: ${biz.business_cuit}</p>` : ''}</div>
  <div class="right">
    <h2>Comprobante ${inv.type} N° ${inv.number}</h2>
    <p>${formatDateTime(inv.created_at)}</p>
  </div>
</div>
${inv.client_name ? `<div style="margin-bottom:12px;padding:8px;border:1px solid #ddd;border-radius:4px">
  <strong>Cliente:</strong> ${inv.client_name}
  ${inv.client_dni ? `· DNI ${inv.client_dni}` : ''}
  ${inv.client_address ? `· ${inv.client_address}` : ''}
</div>` : ''}
<table>
  <thead><tr><th>Descripción</th><th>Talle</th><th>Cant.</th><th class="right">P. Unit.</th><th class="right">Subtotal</th></tr></thead>
  <tbody>
    ${items.map(it => `<tr>
      <td>${it.productName || it.product_name || '—'}</td>
      <td>${it.size || '—'}</td>
      <td>${it.quantity || it.qty || 1}</td>
      <td class="right">${formatCurrency(it.unitPrice || it.unit_price || 0)}</td>
      <td class="right">${formatCurrency((it.unitPrice || it.unit_price || 0) * (it.quantity || it.qty || 1))}</td>
    </tr>`).join('')}
  </tbody>
</table>
<div class="right" style="margin-top:16px">
  <p class="total">TOTAL: ${formatCurrency(inv.total)}</p>
</div>
${inv.cae ? `
<div style="margin-top:24px;padding:8px 12px;border:1px solid #6c3;border-radius:4px;background:#f8fff0">
  <p style="font-weight:bold;font-size:11px;color:#396">COMPROBANTE ELECTRÓNICO AFIP/ARCA</p>
  <p style="font-size:11px">CAE: <strong>${inv.cae}</strong></p>
  ${inv.cae_fch_vto ? `<p style="font-size:11px">Vto. CAE: ${String(inv.cae_fch_vto).replace(/(\d{4})(\d{2})(\d{2})/, '$3/$2/$1')}</p>` : ''}
  ${inv.cbte_nro && inv.pto_venta ? `<p style="font-size:11px">N°: ${String(inv.pto_venta).padStart(4,'0')}-${String(inv.cbte_nro).padStart(8,'0')}</p>` : ''}
</div>` : `<p style="margin-top:24px;font-size:10px;color:#666">Comprobante interno — no válido como factura fiscal</p>`}
${bizContactFooterHtml(biz)}
</body></html>`
  const w = window.open('', '_blank', 'width=800,height=900')
  w.document.write(html)
  w.document.close()
  w.onload = () => { w.print(); setTimeout(() => w.close(), 800) }
}

export default function Invoices() {
  const [data, setData] = useState({ invoices: [], total: 0, pages: 1 })
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ saleId: '', type: 'B', clientName: '', clientDni: '', clientAddress: '', total: '', itemsJson: '[]' })
  const [biz, setBiz] = useState({})
  const [useAfip, setUseAfip] = useState(true)
  const [afipDocTipo, setAfipDocTipo] = useState(99)
  const [afipDocNro, setAfipDocNro] = useState('')
  const [caeing, setCaeing] = useState(false)
  const [caeError, setCaeError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { setData(await api.invoices.list({ page, limit: 25 })) }
    finally { setLoading(false) }
  }, [page])

  useEffect(() => { api.settings.getAll().then(setBiz).catch(() => {}) }, [])

  useEffect(() => { load() }, [load])

  const TIPO_CBTE = { A: 1, B: 6, C: 11 }
  const needsAfip = (type) => ['A', 'B', 'C'].includes(type)

  const save = async (forceNoAfip = false) => {
    if (!form.total || Number(form.total) <= 0) return toast.error('El monto es requerido')
    setSaving(true)
    setCaeError('')
    let afipData = null

    if (!forceNoAfip && useAfip && needsAfip(form.type)) {
      setCaeing(true)
      try {
        const res = await api.afip.generarCAE({
          tipoComprobante: TIPO_CBTE[form.type],
          docTipo: afipDocTipo,
          docNro: afipDocNro || '0',
          importe: Number(form.total),
        })
        if (res.ok) {
          afipData = res
        } else {
          setCaeError(res.error || 'Error de AFIP')
          setSaving(false); setCaeing(false)
          return
        }
      } catch (e) {
        setCaeError(e.message || 'Error al conectar con AFIP')
        setSaving(false); setCaeing(false)
        return
      } finally { setCaeing(false) }
    }

    try {
      const res = await api.invoices.create({
        ...form,
        total: Number(form.total),
        cae:       afipData?.cae       || '',
        caeFchVto: afipData?.caeFchVto || '',
        tipoCbte:  afipData?.tipoComprobante || 0,
        cbteNro:   afipData?.cbteNro   || 0,
        ptoVenta:  afipData?.ptoVenta  || 0,
      })
      const caeInfo = afipData?.cae ? ` · CAE ${afipData.cae.substring(0,8)}...` : ''
      toast.success(`Comprobante ${res.number} generado${caeInfo}`)
      setModal(false); load()
    } catch (e) { toast.error(e.message || 'Error') }
    finally { setSaving(false) }
  }

  const inputCls = 'input-field w-full bg-[#0a0a0a] border border-border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 no-drag'
  const labelCls = 'text-xs text-zinc-500 uppercase tracking-wider mb-1 block'
  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18 }}
      className="p-6"
    >
      <PageHeader title="Facturación" subtitle="Comprobantes tipo A/B/C y remitos (uso interno)"
        actions={<button onClick={() => { setModal(true); setCaeError(''); setUseAfip(true); setAfipDocTipo(99); setAfipDocNro(''); setForm({ saleId: '', type: 'B', clientName: '', clientDni: '', clientAddress: '', total: '', itemsJson: '[]' }) }} className="btn-primary no-drag flex items-center gap-2 text-sm px-4 py-2 rounded-lg"><Plus size={15} /> Nuevo comprobante</button>} />

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="grid text-[11px] text-zinc-500 uppercase px-4 py-2.5 border-b border-border bg-surface"
          style={{ gridTemplateColumns: '1fr 60px 60px 2fr 1fr auto' }}>
          <span>Número</span><span>Tipo</span><span>CAE</span><span>Cliente</span><span className="text-right">Total</span><span />
        </div>
        <div className="divide-y divide-border">
          {loading ? <SkeletonTable rows={5} cols={6} />
            : data.invoices.length === 0 ? (
              <EmptyState icon={FileText} title="Sin comprobantes generados" />
            ) : data.invoices.map(inv => (
              <div key={inv.id} className="row-alt grid items-center px-4 py-3 text-sm" style={{ gridTemplateColumns: '1fr 60px 60px 2fr 1fr auto' }}>
                <span className="text-white font-mono text-xs">{inv.number}</span>
                <span className="text-xs px-2 py-0.5 rounded bg-accent/10 text-accent w-fit">{inv.type}</span>
                <span>
                  {inv.cae
                    ? <span title={`CAE: ${inv.cae}`}><ShieldCheck size={13} className="text-violet-400" /></span>
                    : <span className="text-zinc-700 text-xs">—</span>
                  }
                </span>
                <span className="text-zinc-300">{inv.client_name || 'Sin cliente'}</span>
                <span className="text-right text-white font-medium tabular-nums">{formatCurrency(inv.total)}</span>
                <button onClick={() => printInvoice(inv, biz)} className="p-1.5 text-zinc-600 hover:text-accent rounded ml-2"><Printer size={13} /></button>
              </div>
            ))}
        </div>
        <Pagination page={page} pages={data.pages} total={data.total} limit={25} onChange={setPage} />
      </div>

      <Modal open={modal} onClose={() => !saving && setModal(false)} title="Nuevo comprobante" width="max-w-md">
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Tipo</label>
            <div className="flex gap-2">
              {TYPES.map(t => (
                <button key={t} onClick={() => { f('type', t); setCaeError('') }}
                  className={`px-4 py-1.5 rounded-lg text-sm border transition-colors ${form.type === t ? 'border-accent bg-accent/10 text-white' : 'border-border text-zinc-500 hover:text-zinc-200'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div><label className={labelCls}>N° de venta asociada (opcional)</label><input className={inputCls} value={form.saleId} onChange={e => f('saleId', e.target.value)} placeholder="ID de venta" /></div>
          <div><label className={labelCls}>Nombre del cliente</label><input className={inputCls} value={form.clientName} onChange={e => f('clientName', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>DNI</label><input className={inputCls} value={form.clientDni} onChange={e => f('clientDni', e.target.value)} /></div>
            <div><label className={labelCls}>Total $</label><input type="number" min="0" step="0.01" className={inputCls} value={form.total} onChange={e => f('total', e.target.value)} /></div>
          </div>
          <div><label className={labelCls}>Dirección</label><input className={inputCls} value={form.clientAddress} onChange={e => f('clientAddress', e.target.value)} /></div>

          {/* AFIP section */}
          {needsAfip(form.type) && (
            <div className="border-t border-border pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
                  <input type="checkbox" checked={useAfip} onChange={e => { setUseAfip(e.target.checked); setCaeError('') }}
                    className="rounded border-border" />
                  <ShieldCheck size={14} className="text-violet-400" />
                  Generar CAE con AFIP/ARCA
                </label>
              </div>
              {useAfip && (
                <div className="space-y-2 pl-4 border-l-2 border-violet-500/30">
                  <div>
                    <label className={labelCls}>Documento receptor</label>
                    <select className={inputCls} value={afipDocTipo} onChange={e => { setAfipDocTipo(Number(e.target.value)); setAfipDocNro('') }}>
                      <option value={99}>Consumidor Final</option>
                      <option value={96}>DNI</option>
                      <option value={80}>CUIT</option>
                    </select>
                  </div>
                  {afipDocTipo !== 99 && (
                    <input className={inputCls}
                      placeholder={afipDocTipo === 96 ? 'Número de DNI' : 'CUIT sin guiones'}
                      value={afipDocNro}
                      onChange={e => setAfipDocNro(e.target.value)} />
                  )}
                </div>
              )}
              {caeError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 space-y-1">
                  <p className="flex items-center gap-1.5 font-medium"><AlertCircle size={12} /> Error AFIP: {caeError}</p>
                  <button onClick={() => save(true)} className="text-amber-400 hover:text-amber-300 underline">
                    Guardar sin CAE (contingencia)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-border">
          <button onClick={() => setModal(false)} disabled={saving} className="px-4 py-2 text-sm text-zinc-400 hover:text-white rounded-lg hover:bg-white/5">Cancelar</button>
          <button onClick={() => save(false)} disabled={saving || caeing} className="btn-primary no-drag px-5 py-2 text-sm rounded-lg disabled:opacity-50 flex items-center gap-2">
            {(saving || caeing) && <ShieldCheck size={13} className="animate-pulse" />}
            {caeing ? 'Consultando AFIP...' : saving ? 'Guardando...' : needsAfip(form.type) && useAfip ? 'Generar con CAE' : 'Generar comprobante'}
          </button>
        </div>
      </Modal>
    </motion.div>
  )
}
