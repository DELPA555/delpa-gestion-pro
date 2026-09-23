import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'

const ACCENT = '#e91e8c'

// Cache del flag tooltips_enabled (default: activado). Settings dispara 'tooltips:changed'.
let cache = null
async function ensureEnabled() {
  if (cache === null) {
    try { const v = await api.settings.get('tooltips_enabled'); cache = v !== '0' } catch { cache = true }
  }
  return cache
}

// Tooltip informativo. Uso: <Tooltip text="..."><button>…</button></Tooltip>
export default function Tooltip({ text, children, side = 'top' }) {
  const [enabled, setEnabled] = useState(cache === null ? true : cache)
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
  const timer = useRef(null)

  useEffect(() => {
    let alive = true
    ensureEnabled().then((v) => { if (alive) setEnabled(v) })
    const onChange = (e) => setEnabled(!!e.detail)
    window.addEventListener('tooltips:changed', onChange)
    return () => { alive = false; window.removeEventListener('tooltips:changed', onChange); clearTimeout(timer.current) }
  }, [])

  const enter = () => {
    if (!enabled || !text) return
    timer.current = setTimeout(() => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setPos({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom })
      setShow(true)
    }, 800)
  }
  const leave = () => { clearTimeout(timer.current); setShow(false) }

  const below = side === 'bottom'

  return (
    <span ref={ref} onMouseEnter={enter} onMouseLeave={leave} onClick={leave} style={{ display: 'contents' }}>
      {children}
      {show && pos && (
        <div style={{
          position: 'fixed', left: pos.x, top: below ? pos.bottom + 10 : pos.top - 10,
          transform: `translate(-50%, ${below ? '0' : '-100%'})`,
          zIndex: 100001, maxWidth: 260, pointerEvents: 'none',
          background: '#181818', border: `1px solid ${ACCENT}`, borderRadius: 8,
          padding: '6px 10px', color: '#fff', fontSize: 12, lineHeight: 1.35,
          boxShadow: '0 6px 20px rgba(0,0,0,.5)',
        }}>
          {text}
          <span style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%) rotate(45deg)',
            [below ? 'top' : 'bottom']: -5, width: 8, height: 8,
            background: '#181818', borderRight: `1px solid ${ACCENT}`, borderBottom: `1px solid ${ACCENT}`,
            ...(below ? { borderRight: 'none', borderBottom: 'none', borderLeft: `1px solid ${ACCENT}`, borderTop: `1px solid ${ACCENT}` } : {}),
          }} />
        </div>
      )}
    </span>
  )
}
