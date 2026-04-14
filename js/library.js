import { supabase } from './supabase.js'

// ─── Init ────────────────────────────────────────────────────
export async function initLibrary() {
  await loadTracks()
}

export function addTrackToList(track) {
  const list  = document.getElementById('track-list')
  const empty = document.getElementById('library-empty')

  empty.classList.add('hidden')
  list.prepend(buildTrackRow(track))
}

// ─── Load tracks from DB ─────────────────────────────────────
async function loadTracks() {
  const { data: tracks, error } = await supabase
    .from('tracks')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    document.getElementById('library-error').textContent = error.message
    return
  }

  const list  = document.getElementById('track-list')
  const empty = document.getElementById('library-empty')

  if (!tracks.length) {
    empty.classList.remove('hidden')
    return
  }

  empty.classList.add('hidden')
  list.innerHTML = ''
  tracks.forEach(t => list.appendChild(buildTrackRow(t)))
}

// ─── Row builder ─────────────────────────────────────────────
function buildTrackRow(track) {
  const row = document.createElement('div')
  row.className   = 'track-row'
  row.dataset.id  = track.id

  const bpm = track.bpm   ? `${Math.round(track.bpm)} BPM` : '—'
  const key = track.key   ?? '—'
  const dur = track.duration_seconds ? formatDuration(track.duration_seconds) : '—'

  row.innerHTML = `
    <span class="track-name">${escapeHtml(track.filename)}</span>
    <span class="track-meta">${dur}</span>
    <span class="track-meta">${bpm}</span>
    <span class="track-meta">${key}</span>
  `
  return row
}

// ─── Helpers ─────────────────────────────────────────────────
function formatDuration(secs) {
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}
