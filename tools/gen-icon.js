#!/usr/bin/env node
// Generates public/icon.ico — 256x256 pink D on dark bg
const fs   = require('fs')
const path = require('path')

const SIZE = 256
const BG   = { r: 13,  g: 13,  b: 13,  a: 255 }
const FG   = { r: 255, g: 61,  b: 127, a: 255 }

// --- rasterise a filled circle ---
function inEllipse(x, y, cx, cy, rx, ry) {
  return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1
}

// Build BGRA pixel buffer
const pixels = Buffer.alloc(SIZE * SIZE * 4)

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4
    let fg = false

    // Letter "D" geometry (centred, occupies ~60% of canvas)
    const margin = Math.round(SIZE * 0.18)
    const lx = margin                     // left edge of D
    const rx = SIZE - margin              // right edge of D
    const ty = margin                     // top
    const by = SIZE - margin              // bottom
    const stem = Math.round(SIZE * 0.12)  // stroke width
    const cx   = lx + stem / 2            // vertical bar centre x
    const cy   = (ty + by) / 2            // vertical bar centre y
    const w    = rx - lx                  // bounding width
    const h    = by - ty                  // bounding height

    // vertical bar
    if (x >= lx && x <= lx + stem && y >= ty && y <= by) fg = true

    // curved part — outer half-ellipse minus inner half-ellipse
    const outerRx = w
    const outerRy = h / 2
    const innerRx = w - stem
    const innerRy = h / 2 - stem

    if (!fg && x >= lx) {
      const inOuter = inEllipse(x, y, lx, cy, outerRx, outerRy)
      const inInner = innerRx > 0 && innerRy > 0
                      ? inEllipse(x, y, lx + stem, cy, innerRx, innerRy)
                      : false
      if (inOuter && !inInner) fg = true
    }

    const c = fg ? FG : BG
    pixels[i + 0] = c.b
    pixels[i + 1] = c.g
    pixels[i + 2] = c.r
    pixels[i + 3] = c.a
  }
}

// --- build BITMAPINFOHEADER for 32-bit BGRA (height doubled for XOR+AND) ---
function bmpHeader(size) {
  const h = Buffer.alloc(40)
  h.writeUInt32LE(40, 0)           // biSize
  h.writeInt32LE(size, 4)          // biWidth
  h.writeInt32LE(size * 2, 8)      // biHeight (doubled)
  h.writeUInt16LE(1, 12)           // biPlanes
  h.writeUInt16LE(32, 14)          // biBitCount
  h.writeUInt32LE(0, 16)           // biCompression BI_RGB
  h.writeUInt32LE(size * size * 4, 20) // biSizeImage
  return h
}

// XOR data: rows bottom-to-top
const xorRows = []
for (let y = SIZE - 1; y >= 0; y--) {
  xorRows.push(pixels.slice(y * SIZE * 4, (y + 1) * SIZE * 4))
}
const xorData = Buffer.concat(xorRows)

// AND mask: all 0 (fully opaque) — (SIZE * SIZE / 8) bytes padded to 4-byte rows
const andRowBytes = Math.ceil(SIZE / 8)
const andRowPad   = (4 - andRowBytes % 4) % 4
const andData     = Buffer.alloc((andRowBytes + andRowPad) * SIZE, 0)

const header = bmpHeader(SIZE)
const imgData = Buffer.concat([header, xorData, andData])

// --- ICO file ---
// ICONDIR (6 bytes) + ICONDIRENTRY (16 bytes) + image data
const iconDir = Buffer.alloc(6)
iconDir.writeUInt16LE(0, 0)   // reserved
iconDir.writeUInt16LE(1, 2)   // type = 1 (ICO)
iconDir.writeUInt16LE(1, 4)   // count = 1

const dirEntry = Buffer.alloc(16)
dirEntry.writeUInt8(0, 0)                // width  (0 = 256)
dirEntry.writeUInt8(0, 1)                // height (0 = 256)
dirEntry.writeUInt8(0, 2)                // colorCount
dirEntry.writeUInt8(0, 3)                // reserved
dirEntry.writeUInt16LE(1, 4)             // planes
dirEntry.writeUInt16LE(32, 6)            // bitCount
dirEntry.writeUInt32LE(imgData.length, 8)// sizeInBytes
dirEntry.writeUInt32LE(22, 12)           // imageOffset (6 + 16)

const ico = Buffer.concat([iconDir, dirEntry, imgData])

const outPath = path.join(__dirname, '..', 'public', 'icon.ico')
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, ico)
console.log(`Written ${ico.length} bytes → ${outPath}`)
