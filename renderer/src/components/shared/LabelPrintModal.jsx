import { useState, useEffect, useRef, useMemo } from 'react'
import { X, Printer, Tag } from 'lucide-react'
import JsBarcode from 'jsbarcode'

const fmtPrice = v => new Intl.NumberFormat('es-AR').format(Math.round(Number(v) || 0))

// width:2 = mínimo recomendado para impresión confiable de EAN-13
function genSVG(value, barHeight = 60, fontSize = 8) {
  if (!value) return ''
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const isEAN = String(value).length === 13 && /^\d+$/.test(String(value))
    JsBarcode(svg, String(value), {
      format: isEAN ? 'EAN13' : 'CODE128',
      width: 2,
      height: barHeight,
      displayValue: true,
      fontSize,
      margin: 2,
      background: '#ffffff',
      lineColor: '#000000',
    })
    return new XMLSerializer().serializeToString(svg)
  } catch { return '' }
}

// Build label array from a product + per-size selection map { size: qty }
export function buildLabels(product, sizeSelections) {
  const labels = []
  for (const s of (product.sizes || [])) {
    const qty = sizeSelections?.[s.size]
    if (!qty || qty <= 0) continue
    const barcode = s.size_barcode || product.barcode || ''
    for (let i = 0; i < qty; i++) {
      labels.push({ name: product.name, price: product.price, size: s.size, barcode, color: product.color || '' })
    }
  }
  return labels
}

// Build labels for multiple products using each size's own barcode and stock as qty
export function buildBulkLabels(products) {
  return products.flatMap(p =>
    (p.sizes || []).flatMap(s => {
      const qty = Math.max(0, Number(s.stock) || 0)
      if (!qty) return []
      const barcode = s.size_barcode || p.barcode || ''
      return Array(qty).fill(null).map(() => ({
        name: p.name, price: p.price, size: s.size, barcode, color: p.color || '',
      }))
    })
  )
}

export function printA4(labels) {
  const cols = 5

  // displayValue:false → toda la altura del SVG va a las barras (texto se muestra en la celda)
  function genSVGA4(value) {
    if (!value) return ''
    try {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      const isEAN = String(value).length === 13 && /^\d+$/.test(String(value))
      JsBarcode(svg, String(value), {
        format: isEAN ? 'EAN13' : 'CODE128',
        width: 2,
        height: 55,
        displayValue: false,
        margin: 2,
        background: '#ffffff',
        lineColor: '#000000',
      })
      return new XMLSerializer().serializeToString(svg)
    } catch { return '' }
  }

  const cells = labels.map(l => {
    const p2 = fmtPrice(Number(l.price) / 1.21)
    const svgStr = l.barcode ? genSVGA4(l.barcode) : ''
    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    // Orden: barcode → nombre → talle → precio c/IVA → precio s/IVA
    return `<td>` +
      (svgStr ? `<div class="bc">${svgStr}</div>` : '') +
      `<div class="n">${esc(l.name)}</div>` +
      `<div class="d">T.${esc(l.size)}</div>` +
      `<div class="pr">$${fmtPrice(l.price)}</div>` +
      `<div class="si">s/IVA $${p2}</div>` +
      `</td>`
  })

  const rem = labels.length % cols
  if (rem > 0) for (let i = 0; i < cols - rem; i++) cells.push('<td></td>')
  const rows = []
  for (let i = 0; i < cells.length; i += cols) rows.push(`<tr>${cells.slice(i, i + cols).join('')}</tr>`)

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>Etiquetas A4</title>
<style>
@page{size:A4 portrait;margin:9.8mm 4.8mm 0mm 4.8mm}
*{box-sizing:border-box;margin:0;padding:0}
html{zoom:1}
body{-webkit-print-color-adjust:exact;print-color-adjust:exact}
table{width:203mm;border-collapse:collapse;table-layout:fixed}
td{width:40.6mm;height:21.2mm;padding:0 1.25mm;vertical-align:middle;text-align:center;border:none;overflow:hidden;font-family:'Times New Roman',serif}
.n{font-size:7pt;font-weight:bold;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:38mm}
.d{font-size:6pt;line-height:1.2;color:#333}
.pr{font-size:8pt;font-weight:bold;line-height:1.2}
.si{font-size:6pt;line-height:1.2;color:#333}
.bc{width:36mm;max-width:36mm;margin:0 auto;overflow:hidden;display:flex;justify-content:center}
.bc svg{height:8mm !important;width:auto !important;max-width:36mm}
</style>
</head>
<body>
<table><tbody>${rows.join('')}</tbody></table>
<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),900)}<\/script>
</body>
</html>`

  const w = window.open('', '_blank', 'width=900,height=700')
  w.document.write(html)
  w.document.close()
}

export function printBrother(labels) {
  const divs = labels.map((l, i) => {
    const p2 = fmtPrice(Number(l.price) / 1.21)
    const svgStr = l.barcode ? genSVG(l.barcode, 90, 10) : ''
    return `<div class="e"${i === labels.length - 1 ? ' style="page-break-after:auto"' : ''}>
${svgStr ? `<div class="bc">${svgStr}</div>` : ''}
<p class="n">${l.name}</p>
<p class="d">Talle: ${l.size}</p>
<p class="pr">$${fmtPrice(l.price)}</p>
<p class="siva">s/IVA: $${p2}</p>
</div>`
  }).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiquetas Brother</title>
<style>
@page{size:62mm 29mm;margin:1.5mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif}
.e{width:59mm;height:26mm;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;page-break-after:always;overflow:hidden;gap:0}
.bc{max-width:55mm;width:55mm;display:flex;justify-content:center;overflow:hidden}
.bc svg{width:55mm !important;height:auto !important;max-height:17mm}
.n{font-size:11pt;font-weight:bold;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:58mm}
.d{font-size:10pt;line-height:1.1}
.pr{font-size:12pt;font-weight:bold;line-height:1.15}
.siva{font-size:10pt;color:#333;line-height:1.1}
</style></head><body>
${divs}
<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),900)}<\/script>
</body></html>`

  const w = window.open('', '_blank', 'width=440,height=300')
  w.document.write(html)
  w.document.close()
}

export function useBarcodePreview(value) {
  const ref = useRef()
  useEffect(() => {
    if (!ref.current) return
    if (!value) { ref.current.innerHTML = ''; return }
    try {
      const isEAN = String(value).length === 13 && /^\d+$/.test(String(value))
      JsBarcode(ref.current, String(value), {
        format: isEAN ? 'EAN13' : 'CODE128',
        width: 2, height: 50, displayValue: true, fontSize: 11, margin: 4,
        background: 'transparent', lineColor: '#ffffff',
      })
    } catch { ref.current.innerHTML = '' }
  }, [value])
  return ref
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export default function LabelPrintModal({ open, onClose, product }) {
  // selections: { [size]: { checked: bool, qty: number } }
  const [selections, setSelections] = useState({})

  const sizes = useMemo(() => product?.sizes || [], [product])

  // Reset when product changes
  useEffect(() => {
    if (!product) return
    const init = {}
    for (const s of (product.sizes || [])) {
      init[s.size] = { checked: true, qty: Math.max(0, Number(s.stock) || 0) }
    }
    setSelections(init)
  }, [product])

  if (!open || !product) return null

  const totalLabels = sizes.reduce((acc, s) => {
    const sel = selections[s.size]
    return acc + (sel?.checked ? (sel.qty || 0) : 0)
  }, 0)

  const selectAll = () => setSelections(prev => {
    const next = {}
    for (const s of sizes) next[s.size] = { ...prev[s.size], checked: true }
    return next
  })

  const deselectAll = () => setSelections(prev => {
    const next = {}
    for (const s of sizes) next[s.size] = { ...prev[s.size], checked: false }
    return next
  })

  const toggleSize = (size) => setSelections(prev => ({
    ...prev,
    [size]: { ...prev[size], checked: !prev[size]?.checked },
  }))

  const setQty = (size, qty) => setSelections(prev => ({
    ...prev,
    [size]: { ...prev[size], qty: Math.max(0, Number(qty) || 0) },
  }))

  const getLabels = () => {
    const sizeMap = {}
    for (const [size, sel] of Object.entries(selections)) {
      if (sel.checked && sel.qty > 0) sizeMap[size] = sel.qty
    }
    return buildLabels(product, sizeMap)
  }

  const handlePrint = (type) => {
    const labels = getLabels()
    if (labels.length === 0) return
    if (type === 'brother') printBrother(labels)
    else printA4(labels)
  }

  const inputCls = 'bg-[#0a0a0a] border border-border rounded px-2 py-1 text-sm text-white focus:border-accent outline-none transition-colors no-drag w-16 text-center'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70">
      <div className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Tag size={16} className="text-accent" />
            <h3 className="font-semibold text-white text-sm">Imprimir etiquetas</h3>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors no-drag">
            <X size={16} />
          </button>
        </div>

        {/* Product info */}
        <div className="px-5 pt-4 shrink-0">
          <div className="p-3 bg-surface rounded-xl border border-border">
            <p className="text-sm font-medium text-white truncate">{product.name}</p>
            <p className="text-xs text-accent mt-0.5">${fmtPrice(product.price)}</p>
          </div>
        </div>

        {/* Size selection */}
        <div className="px-5 pt-3 shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Talles</span>
            <div className="flex gap-3">
              <button onClick={selectAll} className="text-xs text-accent hover:text-accent/80 transition-colors no-drag">Todos</button>
              <button onClick={deselectAll} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors no-drag">Ninguno</button>
            </div>
          </div>
        </div>

        {/* Scrollable size list */}
        <div className="overflow-y-auto flex-1 px-5 pb-2">
          <div className="space-y-1.5">
            {sizes.length === 0 && (
              <p className="text-xs text-zinc-600 text-center py-4">Sin talles cargados</p>
            )}
            {sizes.map(s => {
              const sel = selections[s.size] || { checked: false, qty: 0 }
              const barcode = s.size_barcode || product.barcode || ''
              return (
                <div
                  key={s.size}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${sel.checked ? 'bg-accent/5 border-accent/20' : 'border-border bg-surface/50'}`}
                >
                  <input
                    type="checkbox"
                    checked={sel.checked}
                    onChange={() => toggleSize(s.size)}
                    className="accent-[#00c853] w-4 h-4 shrink-0 no-drag cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-white">T.{s.size}</span>
                    <span className="text-xs text-zinc-500 ml-2">stock: {s.stock}</span>
                    {barcode && (
                      <span className="text-xs text-zinc-600 ml-2 font-mono">{barcode}</span>
                    )}
                  </div>
                  <input
                    type="number"
                    min="0"
                    max="9999"
                    value={sel.qty}
                    onChange={e => setQty(s.size, e.target.value)}
                    disabled={!sel.checked}
                    className={`${inputCls} disabled:opacity-40`}
                  />
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border shrink-0 space-y-2">
          <p className="text-xs text-zinc-500 text-center mb-2">
            Se imprimirán <span className="text-white font-semibold">{totalLabels}</span> etiqueta{totalLabels !== 1 ? 's' : ''}
            {totalLabels > 65 ? ` · ${Math.ceil(totalLabels / 65)} pág. A4` : ''}
          </p>
          <button
            onClick={() => handlePrint('brother')}
            disabled={totalLabels === 0}
            className="no-drag w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-accent text-black font-semibold text-sm hover:bg-accent/90 transition-colors disabled:opacity-40"
          >
            <Printer size={15} />
            Impresora etiquetas (Brother QL)
          </button>
          <button
            onClick={() => handlePrint('a4')}
            disabled={totalLabels === 0}
            className="no-drag w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-border text-zinc-300 text-sm hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-40"
          >
            <Printer size={15} />
            Hoja A4 (65 etiquetas)
          </button>
        </div>
      </div>
    </div>
  )
}
