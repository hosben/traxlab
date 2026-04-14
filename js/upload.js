import { supabase } from './supabase.js'

const ACCEPTED_TYPES = ['audio/wav', 'audio/x-wav', 'audio/aiff', 'audio/x-aiff', 'audio/x-caf']
const ACCEPTED_EXT   = ['.wav', '.aif', '.aiff']

// ─── Init ────────────────────────────────────────────────────
export function initUpload({ onTrackAdded }) {
  const dropzone  = document.getElementById('dropzone')
  const fileInput = document.getElementById('file-input')
  const pickBtn   = document.getElementById('pick-files-btn')

  pickBtn.addEventListener('click', () => fileInput.click())

  fileInput.addEventListener('change', () => {
    handleFiles([...fileInput.files], onTrackAdded)
    fileInput.value = ''
  })

  dropzone.addEventListener('dragover', e => {
    e.preventDefault()
    dropzone.classList.add('drag-over')
  })

  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'))

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
    showGlobalError('Only WAV and AIFF files are accepted.')
    return
  }

  for (const file of valid) {
    await uploadFile(file, onTrackAdded)
  }
}

// ─── Single file upload ──────────────────────────────────────
async function uploadFile(file, onTrackAdded) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  const safeFilename  = sanitizeFilename(file.name)
  const storagePath   = `${user.id}/${Date.now()}_${safeFilename}`

  const itemEl = addQueueItem(file.name)

  // Upload to Storage
  const { error: uploadError } = await supabase.storage
    .from('tracks')
    .upload(storagePath, file, { upsert: false })

  if (uploadError) {
    setItemStatus(itemEl, 'error', uploadError.message)
    return
  }

  // Register in DB
  const { data: track, error: dbError } = await supabase
    .from('tracks')
    .insert({
      user_id:      user.id,
      filename:     file.name,
      storage_path: storagePath,
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

  // Auto-remove after success
  return el
}

function setItemStatus(el, status, msg) {
  const statusEl = el.querySelector('.queue-status')
  if (status === 'done') {
    statusEl.textContent = 'Done'
    statusEl.className   = 'queue-status done'
    setTimeout(() => el.remove(), 2000)
  } else {
    statusEl.textContent = msg || 'Error'
    statusEl.className   = 'queue-status error'
    setTimeout(() => el.remove(), 5000)
  }

  const queue = document.getElementById('upload-queue')
  if (!queue.children.length) queue.classList.add('hidden')
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
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function showGlobalError(msg) {
  const el = document.getElementById('library-error')
  el.textContent = msg
  setTimeout(() => { el.textContent = '' }, 4000)
}
