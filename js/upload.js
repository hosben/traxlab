import { supabase }     from './supabase.js'
import { analyzeAudio } from './analyzer.js'

const ACCEPTED_TYPES = [
  'audio/wav', 'audio/x-wav',
  'audio/aiff', 'audio/x-aiff',
  'audio/mpeg', 'audio/mp3',
  'audio/flac', 'audio/x-flac',
  'audio/ogg', 'audio/vorbis',
]
const ACCEPTED_EXT = ['.wav', '.aif', '.aiff', '.mp3', '.flac', '.ogg']

// ─── Init ────────────────────────────────────────────────────
export function initUpload({ onTrackAdded }) {
  const dropzone  = document.getElementById('dropzone')
  const fileInput = document.getElementById('file-input')

  fileInput.addEventListener('change', () => {
    handleFiles([...fileInput.files], onTrackAdded)
    fileInput.value = ''
  })

  dropzone.addEventListener('dragover', e => {
    e.preventDefault()
    dropzone.classList.add('drag-over')
  })

  dropzone.addEventListener('dragleave', e => {
    if (!dropzone.contains(e.relatedTarget)) dropzone.classList.remove('drag-over')
  })

  dropzone.addEventListener('drop', e => {
    e.preventDefault()
    dropzone.classList.remove('drag-over')
    handleFiles([...e.dataTransfer.files], onTrackAdded)
  })
}

// ─── Handle multiple files ───────────────────────────────────
async function handleFiles(files, onTrackAdded) {
  const valid = files.filter(isAccepted)
  if (!valid.length) {
    showGlobalError('Accepted formats: WAV, AIFF, MP3, FLAC, OGG.')
    return
  }
  await Promise.all(valid.map(file => uploadFile(file, onTrackAdded)))
}

// ─── Single file ─────────────────────────────────────────────
async function uploadFile(file, onTrackAdded) {
  console.log('[Traxlab] uploadFile:', file.name, file.size)

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) { console.warn('[Traxlab] no user'); return }

  const safeFilename = sanitizeFilename(file.name)
  const storagePath  = `${user.id}/${Date.now()}_${safeFilename}`
  const itemEl       = addQueueItem(file.name)

  // Read once — avoids concurrent reads of the same File handle
  setItemStatus(itemEl, 'progress', 'Reading…')
  let arrayBuffer
  try {
    arrayBuffer = await file.arrayBuffer()
    console.log('[Traxlab] read', arrayBuffer.byteLength, 'bytes')
  } catch (err) {
    setItemStatus(itemEl, 'error', 'Could not read file.')
    console.error('[Traxlab] arrayBuffer read failed:', err)
    return
  }

  // Upload and analyse in parallel using independent copies of the data
  setItemStatus(itemEl, 'progress', 'Uploading…')

  const blob = new Blob([arrayBuffer], { type: file.type || 'application/octet-stream' })

  const [uploadResult, analysis] = await Promise.all([
    supabase.storage.from('tracks').upload(storagePath, blob, { upsert: false }),
    analyzeAudio(arrayBuffer, msg => setItemStatus(itemEl, 'progress', msg))
      .catch(err => { console.error('[Traxlab] analysis error:', err); return null }),
  ])

  console.log('[Traxlab] analysis:', analysis?.bpm, analysis?.key, analysis?.duration)

  if (uploadResult.error) {
    setItemStatus(itemEl, 'error', uploadResult.error.message)
    console.error('[Traxlab] upload error:', uploadResult.error)
    return
  }

  setItemStatus(itemEl, 'progress', 'Saving…')

  const { data: track, error: dbError } = await supabase
    .from('tracks')
    .insert({
      user_id:          user.id,
      filename:         file.name,
      storage_path:     storagePath,
      duration_seconds: analysis?.duration ?? null,
      bpm:              analysis?.bpm      ?? null,
      key:              analysis?.key      ?? null,
      waveform:         analysis?.waveform ?? null,
    })
    .select()
    .single()

  if (dbError) {
    setItemStatus(itemEl, 'error', dbError.message)
    console.error('[Traxlab] db error:', dbError)
    return
  }

  console.log('[Traxlab] saved — bpm:', track.bpm, 'key:', track.key, 'dur:', track.duration_seconds)
  setItemStatus(itemEl, 'done')
  onTrackAdded(track)
}

// ─── Upload queue UI ─────────────────────────────────────────
function addQueueItem(filename) {
  const queue = document.getElementById('upload-queue')
  queue.classList.remove('hidden')

  const el = document.createElement('div')
  el.className = 'queue-item'
  el.innerHTML = `
    <span class="queue-name">${escapeHtml(filename)}</span>
    <span class="queue-status uploading">Uploading…</span>
  `
  queue.appendChild(el)
  return el
}

function setItemStatus(el, status, msg) {
  const statusEl = el.querySelector('.queue-status')

  if (status === 'done') {
    statusEl.textContent = 'Done'
    statusEl.className   = 'queue-status done'
    setTimeout(() => {
      el.remove()
      const queue = document.getElementById('upload-queue')
      if (!queue.children.length) queue.classList.add('hidden')
    }, 2000)
  } else if (status === 'error') {
    statusEl.textContent = msg || 'Error'
    statusEl.className   = 'queue-status error'
    setTimeout(() => {
      el.remove()
      const queue = document.getElementById('upload-queue')
      if (!queue.children.length) queue.classList.add('hidden')
    }, 5000)
  } else {
    statusEl.textContent = msg || '…'
    statusEl.className   = 'queue-status uploading'
  }
}

// ─── Helpers ─────────────────────────────────────────────────
function isAccepted(file) {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  return ACCEPTED_TYPES.includes(file.type) || ACCEPTED_EXT.includes(ext)
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._\-]/g, '_')
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function showGlobalError(msg) {
  const el = document.getElementById('library-error')
  el.textContent = msg
  setTimeout(() => { el.textContent = '' }, 4000)
}
