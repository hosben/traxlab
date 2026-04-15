// Extract cover art and text tags from ID3v2 headers (MP3)
// Exports: extractArtwork (artwork thumbnail), extractTags (title / artist / label)

// ─── Text tags ────────────────────────────────────────────────
export function extractTags(arrayBuffer) {
  try {
    return parseTextFrames(new Uint8Array(arrayBuffer))
  } catch {
    return {}
  }
}

function parseTextFrames(b) {
  if (b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return {}
  const ver = b[3]
  if (ver < 3) return {}

  const tagSize = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) |
                  ((b[8] & 0x7f) <<  7) |  (b[9] & 0x7f)
  let pos = 10
  const end = Math.min(10 + tagSize, b.length)
  const found = {}
  const WANT = { TIT2: 'title', TPE1: 'artist', TPUB: 'label' }

  while (pos + 10 <= end) {
    const id = String.fromCharCode(b[pos], b[pos+1], b[pos+2], b[pos+3])
    if (id === '\0\0\0\0') break

    const sz = ver >= 4
      ? ((b[pos+4]&0x7f)<<21)|((b[pos+5]&0x7f)<<14)|((b[pos+6]&0x7f)<<7)|(b[pos+7]&0x7f)
      : (b[pos+4]<<24)|(b[pos+5]<<16)|(b[pos+6]<<8)|b[pos+7]

    if (sz <= 0 || pos + 10 + sz > end) break
    pos += 10

    if (WANT[id]) found[WANT[id]] = decodeTextFrame(b, pos, pos + sz)
    pos += sz
  }
  return found
}

function decodeTextFrame(b, start, end) {
  if (start >= end) return null
  const enc  = b[start]
  const data = b.slice(start + 1, end)
  try {
    const str = enc === 0 ? latin1(data, 0, data.length)
              : enc === 1 ? new TextDecoder('utf-16').decode(data)
              : enc === 2 ? new TextDecoder('utf-16be').decode(data)
              :              new TextDecoder('utf-8').decode(data)
    return str.replace(/\0/g, '').trim() || null
  } catch { return null }
}

// Extract cover art from ID3v2 tags (MP3) and resize to a small thumbnail

export async function extractArtwork(arrayBuffer) {
  try {
    const pic = findAPICFrame(new Uint8Array(arrayBuffer))
    if (!pic) return null
    return await resizeThumbnail(pic.dataUrl, 80)
  } catch {
    return null
  }
}

// ─── ID3v2 APIC parser ────────────────────────────────────────
function findAPICFrame(b) {
  // Must start with "ID3"
  if (b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return null

  const ver = b[3]
  if (ver < 3) return null // only v2.3+

  // Syncsafe tag size
  const tagSize = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) |
                  ((b[8] & 0x7f) <<  7) |  (b[9] & 0x7f)

  let pos = 10
  const end = Math.min(10 + tagSize, b.length)

  while (pos + 10 <= end) {
    const id = String.fromCharCode(b[pos], b[pos+1], b[pos+2], b[pos+3])

    // Frame size: syncsafe in v2.4, big-endian int in v2.3
    const sz = ver >= 4
      ? ((b[pos+4]&0x7f)<<21) | ((b[pos+5]&0x7f)<<14) | ((b[pos+6]&0x7f)<<7) | (b[pos+7]&0x7f)
      : (b[pos+4]<<24) | (b[pos+5]<<16) | (b[pos+6]<<8) | b[pos+7]

    if (sz <= 0 || pos + 10 + sz > end) break
    pos += 10

    if (id === 'APIC') {
      const pic = parseAPIC(b, pos, pos + sz)
      if (pic) return pic
    }

    pos += sz
  }

  return null
}

function parseAPIC(b, start, end) {
  if (start + 4 > end) return null

  const encoding = b[start]
  let p = start + 1

  // Read MIME type (Latin-1, null-terminated)
  const mimeStart = p
  while (p < end && b[p] !== 0) p++
  const mime = latin1(b, mimeStart, p) || 'image/jpeg'
  if (p >= end) return null
  p++ // skip null

  if (p >= end) return null
  p++ // skip picture type byte

  // Skip description (encoding-aware null terminator)
  if (encoding === 1 || encoding === 2) {
    // UTF-16: double null
    while (p + 1 < end && !(b[p] === 0 && b[p + 1] === 0)) p++
    p += 2
  } else {
    // Latin-1 / UTF-8: single null
    while (p < end && b[p] !== 0) p++
    p++
  }

  if (p >= end) return null

  const picData = b.slice(p, end)
  const format  = mime.includes('png') ? 'image/png' : 'image/jpeg'

  return { dataUrl: `data:${format};base64,${toBase64(picData)}` }
}

function latin1(b, start, end) {
  let s = ''
  for (let i = start; i < end; i++) s += String.fromCharCode(b[i])
  return s
}

// Chunked btoa — avoids stack overflow for large images
function toBase64(bytes) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192))
  }
  return btoa(bin)
}

// ─── Resize to thumbnail via canvas ──────────────────────────
function resizeThumbnail(dataUrl, size) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d')

      // Cover fill — scale to fill, center-crop
      const scale = size / Math.min(img.width, img.height)
      const w = img.width  * scale
      const h = img.height * scale
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)

      resolve(canvas.toDataURL('image/jpeg', 0.75))
    }
    img.onerror = () => resolve(dataUrl) // fallback: use original
    img.src = dataUrl
  })
}
