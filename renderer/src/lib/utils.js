import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(val) {
  if (val == null) return '$0,00'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(val)
}

// SQLite CURRENT_TIMESTAMP stores UTC as 'YYYY-MM-DD HH:MM:SS' without timezone suffix.
// Appending 'Z' ensures JS treats it as UTC so toLocaleString converts to local time correctly.
function fixUtcStr(str) {
  if (!str || typeof str !== 'string') return str
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(str)) return str.replace(' ', 'T') + 'Z'
  return str
}

export function formatDate(str) {
  if (!str) return '-'
  return new Date(fixUtcStr(str)).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function formatDateTime(str) {
  if (!str) return '-'
  return new Date(fixUtcStr(str)).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function debounce(fn, ms = 300) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}
