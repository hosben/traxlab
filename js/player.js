import { supabase } from './supabase.js'

// ─── State ────────────────────────────────────────────────────
let audio        = new Audio()
let currentTrack = null
let waveform     = []
let getNeighbors = () => ({ prev: null, next: null }) // injected by library.js

// ─── Init ─────────────────────────────────────────────────────
export function initPlayer(neighborsCallback) {
  getNeighbors = neighborsCallback

  document.getElementById('player-play-pause').addEventListener('click', togglePlay)
  document.getElementById('player-prev').addEventListener('click', playPrev)
  document.getElementById('player-next').addEventListener('click', playNext)
  document.getElementById('player-close-btn').addEventListener('click', closePlayer)
  document.getElementById('player-waveform').addEventListener('click', seekByClick)

  audio.addEventListener('timeupdate', onTimeUpdate)
  audio.addEventListener('ended',      onEnded)
  audio.addEventListener('loadedmetadata', () => {
    setTimeDisplay(0, audio.duration)
  })
}

// ─── Open a track ─────────────────────────────────────────────
export async function openTrack(track) {
  if (currentTrack?.id === track.id) { togglePlay(); return }

  // Update active row highlight
  setActiveRow(track.id)

  currentTrack = track
  waveform     = track.waveform || []

  // UI metadata
  document.getElementById('player-name').textContent  = track.filename
  document.getElementById('player-bpm').textContent   = track.bpm  ? `${Number(track.bpm).toFixed(1)} BPM` : ''
  document.getElementById('player-key').textContent   = track.key  ?? ''
  setTimeDisplay(0, track.duration_seconds || 0)
  drawWaveform(0)

  // Reveal player
  document.getElementById('player-panel').classList.remove('hidden')
  document.getElementById('app-screen').classList.add('has-player')

  // Fetch signed URL (valid 1h)
  setPlayIcon(false)
  const { data, error } = await supabase.storage
    .from('tracks')
    .createSignedUrl(track.storage_path, 3600)

  if (error || !data?.signedUrl) {
    console.error('[Traxlab] signed URL error:', error)
    return
  }

  audio.pause()
  audio.src = data.signedUrl
  audio.load()
  audio.play().then(() => setPlayIcon(true)).catch(console.error)
}

// ─── Controls ─────────────────────────────────────────────────
function togglePlay() {
  if (!audio.src) return
  if (audio.paused) {
    audio.play().then(() => setPlayIcon(true)).catch(console.error)
  } else {
    audio.pause()
    setPlayIcon(false)
  }
}

function playPrev() {
  const { prev } = getNeighbors(currentTrack?.id)
  if (prev) openTrack(prev)
}

function playNext() {
  const { next } = getNeighbors(currentTrack?.id)
  if (next) openTrack(next)
}

function closePlayer() {
  audio.pause()
  audio.src = ''
  currentTrack = null
  document.getElementById('player-panel').classList.add('hidden')
  document.getElementById('app-screen').classList.remove('has-player')
  setActiveRow(null)
}

function onEnded() {
  setPlayIcon(false)
  playNext()
}

// ─── Seek ─────────────────────────────────────────────────────
function seekByClick(e) {
  if (!audio.duration) return
  const rect = e.currentTarget.getBoundingClientRect()
  const ratio = (e.clientX - rect.left) / rect.width
  audio.currentTime = ratio * audio.duration
}

// ─── Progress ─────────────────────────────────────────────────
function onTimeUpdate() {
  const progress = audio.duration ? audio.currentTime / audio.duration : 0
  setTimeDisplay(audio.currentTime, audio.duration)
  drawWaveform(progress)
}

// ─── Waveform canvas ─────────────────────────────────────────
function drawWaveform(progress) {
  const canvas = document.getElementById('player-waveform')
  const ctx    = canvas.getContext('2d')
  const W      = canvas.offsetWidth
  const H      = canvas.offsetHeight

  if (!W || !H) return
  canvas.width  = W
  canvas.height = H

  if (!waveform.length) {
    // Empty state
    ctx.fillStyle = 'var(--border)'
    ctx.fillRect(0, H / 2 - 1, W, 2)
    return
  }

  const n        = waveform.length
  const barW     = W / n
  const progX    = progress * W
  const midY     = H / 2

  for (let i = 0; i < n; i++) {
    const x   = i * barW
    const amp = waveform[i]
    const h   = Math.max(2, amp * H * 0.85)

    ctx.fillStyle = x < progX ? '#7c6af7' : '#2e2e38'
    ctx.fillRect(x + 0.5, midY - h / 2, Math.max(1, barW - 1), h)
  }

  // Playhead line
  if (progress > 0) {
    ctx.fillStyle = '#c4beff'
    ctx.fillRect(progX - 1, 0, 2, H)
  }
}

// ─── UI helpers ──────────────────────────────────────────────
function setPlayIcon(playing) {
  const btn = document.getElementById('player-play-pause')
  btn.innerHTML = playing
    ? `<svg viewBox="0 0 20 20" fill="currentColor"><rect x="5" y="3" width="3" height="14" rx="1"/><rect x="12" y="3" width="3" height="14" rx="1"/></svg>`
    : `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.84Z"/></svg>`
}

function setTimeDisplay(current, total) {
  document.getElementById('player-time').textContent     = formatTime(current)
  document.getElementById('player-duration').textContent = formatTime(total)
}

function setActiveRow(trackId) {
  document.querySelectorAll('.track-row').forEach(r => {
    r.classList.toggle('playing', r.dataset.id === trackId)
  })
}

function formatTime(s) {
  if (!s || isNaN(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}

// ─── Expose for library.js ────────────────────────────────────
export { openTrack as playerOpenTrack }
