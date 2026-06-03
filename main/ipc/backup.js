const { ipcMain, app, dialog } = require('electron')
const { getDB } = require('../../database/db')
const crypto = require('crypto')
const path   = require('path')
const fs     = require('fs')
const os     = require('os')

const DB_FILENAME = 'gestion.db'
const MAGIC = Buffer.from('DELPABACKUP01')  // 13-byte magic header

function dbPath() {
  return path.join(app.getPath('userData'), DB_FILENAME)
}

function deriveKey(password, salt) {
  return crypto.scryptSync(password, salt, 32) // 256-bit key
}

// ── Crear backup cifrado ──────────────────────────────────────────────────────
ipcMain.handle('backup:create', async (_, { password }) => {
  if (!password || password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres')

  const src = dbPath()
  if (!fs.existsSync(src)) throw new Error('No se encontró la base de datos')

  const stamp  = new Date().toISOString().slice(0, 10)
  const defName = `DELPA-backup-${stamp}.delpa`

  const { filePath } = await dialog.showSaveDialog({
    title:       'Guardar backup cifrado',
    defaultPath: path.join(os.homedir(), 'Desktop', defName),
    filters:     [{ name: 'Backup DELPA', extensions: ['delpa'] }],
  })
  if (!filePath) return { ok: false }

  try {
    const salt = crypto.randomBytes(16)
    const iv   = crypto.randomBytes(16)
    const key  = deriveKey(password, salt)

    // Leer DB
    const dbBuffer = fs.readFileSync(src)

    // Comprimir con gzip puro (Buffer)
    const zlib = require('zlib')
    const compressed = zlib.gzipSync(dbBuffer, { level: 6 })

    // Cifrar AES-256-CBC
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv)
    const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()])

    // Formato: MAGIC(13) + salt(16) + iv(16) + encrypted(...)
    const output = Buffer.concat([MAGIC, salt, iv, encrypted])
    fs.writeFileSync(filePath, output)

    return { ok: true, filePath, size: output.length }
  } catch (e) {
    throw new Error('Error al crear backup: ' + e.message)
  }
})

// ── Restaurar backup cifrado ──────────────────────────────────────────────────
ipcMain.handle('backup:restore', async (_, { password }) => {
  if (!password) throw new Error('Contraseña requerida')

  const { filePaths } = await dialog.showOpenDialog({
    title:       'Seleccionar backup cifrado',
    filters:     [{ name: 'Backup DELPA', extensions: ['delpa'] }],
    properties:  ['openFile'],
  })
  if (!filePaths?.length) return { ok: false }

  try {
    const input = fs.readFileSync(filePaths[0])

    // Verificar magic
    if (!input.slice(0, 13).equals(MAGIC)) {
      throw new Error('Archivo no válido — no es un backup de DELPA')
    }

    const salt      = input.slice(13, 29)
    const iv        = input.slice(29, 45)
    const encrypted = input.slice(45)
    const key       = deriveKey(password, salt)

    // Descifrar
    let compressed
    try {
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv)
      compressed = Buffer.concat([decipher.update(encrypted), decipher.final()])
    } catch {
      throw new Error('Contraseña incorrecta o archivo dañado')
    }

    // Descomprimir
    const zlib = require('zlib')
    const dbBuffer = zlib.gunzipSync(compressed)

    // Hacer backup de la DB actual antes de sobreescribir
    const dbSrc  = dbPath()
    const tmpBak = dbSrc + '.pre-restore-' + Date.now()
    if (fs.existsSync(dbSrc)) fs.copyFileSync(dbSrc, tmpBak)

    // Cerrar DB antes de sobreescribir
    try { getDB().close() } catch {}

    // Escribir nueva DB
    fs.writeFileSync(dbSrc, dbBuffer)

    // Relanzar app para que abra la DB restaurada
    setTimeout(() => { app.relaunch(); app.exit(0) }, 800)

    return { ok: true, size: dbBuffer.length }
  } catch (e) {
    throw new Error(e.message || 'Error al restaurar backup')
  }
})
