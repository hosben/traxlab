import { supabase } from './supabase.js?v=3'

// ─── State ────────────────────────────────────────────────────
let audio        = new Audio()
let currentTrack = null
let waveform     = []
let pitchPct     = 0
let pitchRange   = 6        // active range in % (±6, ±10, ±16, ±100)
let collapsed    = false
let timeMode     = 'elapsed' // 'elapsed' | 'remaining' | 'total'
let getNeighbors = () => ({ prev: null, next: null })

const PITCH_RANGES = [6, 10, 16, 100]
const PITCH_STEP   = 0.5   // % per +/− button click

// ─── Init ─────────────────────────────────────────────────────
export function initPlayer(neighborsCallback) {
  getNeighbors = neighborsCallback

  document.getElementById('player-play-pause').addEventListener('click', togglePlay)
  document.getElementById('player-collapse-btn').addEventListener('click', toggleCollapse)
  document.getElementById('player-waveform').addEventListener('click', seekByClick)
  document.getElementById('player-progress-strip').addEventListener('click', seekByMiniClick)
  document.getElementById('player-time-toggle').addEventListener('click', cycleTimeMode)

  // Pitch slider
  const slider = document.getElementById('pitch-slider')
  slider.addEventListener('input', () => applyPitch(parseFloat(slider.value)))
  slider.addEventListener('dblclick', resetPitch)
  document.getElementById('pitch-reset-btn').addEventListener('click', resetPitch)
  document.getElementById('pitch-range-btn').addEventListener('click', cycleRange)
  document.getElementById('pitch-down-btn').addEventListener('click', () => stepPitch(-PITCH_STEP))
  document.getElementById('pitch-up-btn').addEventListener('click',   () => stepPitch(+PITCH_STEP))

  setPitchFill(0)

  audio.addEventListener('timeupdate', onTimeUpdate)
  audio.addEventListener('ended',      onEnded)
  audio.addEventListener('loadedmetadata', () => updateTimeDisplay())

  // Redraw waveform on theme change (catches paused state)
  new MutationObserver(() => {
    const progress = audio.duration ? audio.currentTime / audio.duration : 0
    drawWaveform(progress)
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
}

// ─── Open a track ─────────────────────────────────────────────
export async function openTrack(track) {
  if (currentTrack?.id === track.id) { togglePlay(); return }

  setActiveRow(track.id)

  currentTrack = track
  resetPitch()
  waveform = track.waveform || []

  // Metadata
  const displayName = track.title || track.filename
  document.getElementById('player-name').textContent      = displayName
  document.getElementById('player-mini-name').textContent = displayName
  document.getElementById('player-artist').textContent    = track.artist ?? ''
  document.getElementById('player-bpm').textContent       = track.bpm ? `${Number(track.bpm).toFixed(1)} BPM` : ''
  document.getElementById('player-key').textContent       = track.key  ?? ''

  // Artwork
  const artEl = document.getElementById('player-artwork')
  if (track.artwork) {
    artEl.innerHTML = `<img src="${track.artwork}" alt="artwork">`
  } else {
    artEl.innerHTML = `<svg class="player-art-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M18 3a1 1 0 0 0-1.196-.98l-10 2A1 1 0 0 0 6 5v9.114A4.369 4.369 0 0 0 5 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0 0 15 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z"/></svg>`
  }

  updateTimeDisplay()
  drawWaveform(0)

  document.getElementById('player-panel').classList.remove('hidden')
  document.getElementById('app-screen').classList.add('has-player')

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

function playNext() {
  const { next } = getNeighbors(currentTrack?.id)
  if (next) openTrack(next)
}

function toggleCollapse() {
  collapsed = !collapsed
  const panel = document.getElementById('player-panel')
  panel.classList.toggle('collapsed', collapsed)
  const btn = document.getElementById('player-collapse-btn')
  btn.innerHTML = collapsed
    ? `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5L10 7.5L15 12.5"/></svg>`
    : `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7.5L10 12.5L15 7.5"/></svg>`
}

function onEnded() {
  setPlayIcon(false)
  playNext()
}

// ─── Seek ─────────────────────────────────────────────────────
function seekByClick(e) {
  if (!audio.duration) return
  const rect = e.currentTarget.getBoundingClientRect()
  audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration
}

function seekByMiniClick(e) {
  if (!audio.duration) return
  const rect = e.currentTarget.getBoundingClientRect()
  audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration
}

// ─── Progress ─────────────────────────────────────────────────
function onTimeUpdate() {
  const progress = audio.duration ? audio.currentTime / audio.duration : 0
  updateTimeDisplay()
  drawWaveform(progress)
  document.getElementById('player-progress-fill').style.width = `${progress * 100}%`
}

// ─── Time display ─────────────────────────────────────────────
function cycleTimeMode() {
  const modes = ['elapsed', 'remaining', 'total']
  timeMode = modes[(modes.indexOf(timeMode) + 1) % modes.length]
  updateTimeDisplay()
}

function updateTimeDisplay() {
  const cur = audio.currentTime || 0
  const dur = audio.duration || currentTrack?.duration_seconds || 0
  const valEl  = document.getElementById('player-time')
  const modeEl = document.getElementById('player-time-mode')
  if (!valEl) return

  if (timeMode === 'elapsed') {
    valEl.textContent  = formatTime(cur)
    modeEl.textContent = 'elapsed'
  } else if (timeMode === 'remaining') {
    valEl.textContent  = dur ? `−${formatTime(dur - cur)}` : '0:00'
    modeEl.textContent = 'remain'
  } else {
    valEl.textContent  = formatTime(dur)
    modeEl.textContent = 'total'
  }
}

// ─── Waveform canvas ─────────────────────────────────────────
function themeColor(prop) {
  return getComputedStyle(document.documentElement).getPropertyValue(prop).trim()
}

function drawWaveform(progress) {
  const canvas = document.getElementById('player-waveform')
  const ctx    = canvas.getContext('2d')
  const W      = canvas.offsetWidth
  const H      = canvas.offsetHeight

  if (!W || !H) return
  canvas.width  = W
  canvas.height = H

  const colorPlayed   = themeColor('--accent')
  const colorUnplayed = themeColor('--border')
  const colorPlayhead = themeColor('--accent-h')

  if (!waveform.length) {
    ctx.fillStyle = colorUnplayed
    ctx.fillRect(0, H / 2 - 1, W, 2)
    return
  }

  const n     = waveform.length
  const barW  = W / n
  const progX = progress * W
  const midY  = H / 2

  for (let i = 0; i < n; i++) {
    const x   = i * barW
    const amp = waveform[i]
    const h   = Math.max(2, amp * H * 0.85)
    ctx.fillStyle = x < progX ? colorPlayed : colorUnplayed
    ctx.fillRect(x + 0.5, midY - h / 2, Math.max(1, barW - 1), h)
  }

  if (progress > 0) {
    ctx.fillStyle = colorPlayhead
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

function setActiveRow(trackId) {
  document.querySelectorAll('.track-row').forEach(r => {
    r.classList.toggle('playing', r.dataset.id === trackId)
  })
}

function formatTime(s) {
  if (!s || isNaN(s)) return '0:00'
  const m   = Math.floor(s / 60)
  const sec = Math.floor(s % 60).toString().padStart(2, '0')
  return `${m}:${sec}`
}

// ─── Pitch ────────────────────────────────────────────────────
function cycleRange() {
  const idx = PITCH_RANGES.indexOf(pitchRange)
  pitchRange = PITCH_RANGES[(idx + 1) % PITCH_RANGES.length]

  const slider = document.getElementById('pitch-slider')
  slider.min = -pitchRange
  slider.max =  pitchRange

  const clamped = Math.max(-pitchRange, Math.min(pitchRange, pitchPct))
  if (clamped !== pitchPct) {
    slider.value = clamped
    applyPitch(clamped)
  } else {
    setPitchFill(pitchPct)
  }

  const label = pitchRange === 100 ? 'WIDE' : `±${pitchRange}%`
  document.getElementById('pitch-range-btn').textContent = label
}

function stepPitch(delta) {
  const slider  = document.getElementById('pitch-slider')
  const newVal  = Math.max(-pitchRange, Math.min(pitchRange, pitchPct + delta))
  slider.value  = newVal
  applyPitch(newVal)
}

function applyPitch(pct) {
  pitchPct = pct
  audio.playbackRate = 1 + pct / 100
  setPitchFill(pct)
  updateBpmDisplay()
}

function resetPitch() {
  pitchPct = 0
  audio.playbackRate = 1
  const slider = document.getElementById('pitch-slider')
  slider.value = 0
  setPitchFill(0)
  updateBpmDisplay()
}

function setPitchFill(pct) {
  const slider = document.getElementById('pitch-slider')
  const btn    = document.getElementById('pitch-reset-btn')
  const min    = parseFloat(slider.min)
  const max    = parseFloat(slider.max)
  const range  = max - min

  const centerPct = ((0 - min) / range) * 100
  const valuePct  = ((pct - min) / range) * 100
  const left  = Math.min(centerPct, valuePct)
  const right = 100 - Math.max(centerPct, valuePct)

  slider.style.setProperty('--fill-left',  `${left}%`)
  slider.style.setProperty('--fill-right', `${right}%`)

  const sign = pct > 0 ? '+' : ''
  const dec  = Math.abs(pct) >= 10 ? 0 : 1
  btn.textContent = pct === 0 ? '0%' : `${sign}${pct.toFixed(dec)}%`
  btn.classList.toggle('pitch-reset--active', pct !== 0)
}

function updateBpmDisplay() {
  if (!currentTrack?.bpm) return
  const shifted = currentTrack.bpm * (1 + pitchPct / 100)
  document.getElementById('player-bpm').textContent =
    pitchPct === 0
      ? `${Number(currentTrack.bpm).toFixed(1)} BPM`
      : `${shifted.toFixed(1)} BPM`
}

// ─── Expose for library.js ────────────────────────────────────
export { openTrack as playerOpenTrack }
