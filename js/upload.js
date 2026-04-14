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
  // Process files concurrently
  await Promise.all(valid.map(file => uploadFile(file, onTrackAdded)))
}

// ─── Single file: upload + analyse in parallel ───────────────
async function uploadFile(file, onTrackAdded) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const safeFilename = sanitizeFilename(file.name)
  const storagePath  = `${user.id}/${Date.now()}_${safeFilename}`
  const itemEl       = addQueueItem(file.name)

  // Run upload and analysis in parallel
  const [uploadResult, analysis] = await Promise.all([
    supabase.storage.from('tracks').upload(storagePath, file, { upsert: false }),
    analyzeAudio(file, msg => setItemStatus(itemEl, 'progress', msg)).catch(err => {
      console.error('[Traxlab] Analysis failed:', err)
      return null
    }),
  ])

  if (uploadResult.error) {
    setItemStatus(itemEl, 'error', uploadResult.error.message)
    return
  }

  setItemStatus(itemEl, 'progress', 'Saving…')

  const { data: track, error: dbError } = await supabase
    .from('tracks')
    .insert({
      user_id:          user.id,
      filename:         file.name,
      storage_path:     storagePath,
      duration_seconds: analysis?.duration  ?? null,
      bpm:              analysis?.bpm       ?? null,
      key:              analysis?.key       ?? null,
      waveform:         analysis?.waveform  ?? null,
    })
    .select()
    .single()

  if (dbError) {
    setItemStatus(itemEl, 'error', dbError.message)
    return
  }

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
    // progress
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
