import { supabase }        from './supabase.js?v=3'
import { initPlayer, playerOpenTrack } from './player.js?v=4'

// ─── State ────────────────────────────────────────────────────
const state = {
  allTracks:     [],
  view:          'library', // 'library' | playlist-id
  playlistIds:   [],        // track ids in current playlist view
  search:        '',
  sort:          { field: 'created_at', dir: 'desc' },
  tagFilter:     null,     // name only (no color)
  selected:      new Set(), // selected track ids
}

// ─── Tag helpers ──────────────────────────────────────────────
// Tags are stored as "name::color" or just "name" (legacy)
function parseTag(raw) {
  const i = raw.lastIndexOf('::')
  if (i === -1) return { name: raw, color: null }
  return { name: raw.slice(0, i), color: raw.slice(i + 2) }
}

function buildRaw(name, color) {
  return color ? `${name}::${color}` : name
}

// ─── Init ─────────────────────────────────────────────────────
export async function initLibrary() {
  const { data, error } = await supabase
    .from('tracks')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) { showError(error.message); return }
  state.allTracks = data || []

  setupSearch()
  setupSort()
  setupSelectionBar()
  render()

  initPlayer(getNeighbors)
}

function getNeighbors(trackId) {
  const tracks = getVisible()
  const idx    = tracks.findIndex(t => t.id === trackId)
  return {
    prev: idx > 0               ? tracks[idx - 1] : null,
    next: idx < tracks.length-1 ? tracks[idx + 1] : null,
  }
}

// ─── View switching (called by playlists.js) ──────────────────
export function setView(view, playlistIds = []) {
  state.view        = view
  state.playlistIds = playlistIds
  state.search      = ''
  state.tagFilter   = null
  state.selected.clear()
  document.getElementById('search-input').value = ''
  updateTagFilterBadge()
  updateSelectionBar()
  render()
}

// ─── Called after a new upload ────────────────────────────────
export function addTrackToList(track) {
  state.allTracks = [track, ...state.allTracks.filter(t => t.id !== track.id)]
  if (state.view === 'library') render()
}

// ─── Filter + sort ────────────────────────────────────────────
function getVisible() {
  let tracks = state.view === 'library'
    ? state.allTracks
    : state.playlistIds.map(id => state.allTracks.find(t => t.id === id)).filter(Boolean)

  if (state.search) {
    const q = state.search.toLowerCase()
    tracks = tracks.filter(t => t.filename.toLowerCase().includes(q))
  }

  if (state.tagFilter) {
    tracks = tracks.filter(t =>
      (t.tags || []).some(raw => parseTag(raw).name === state.tagFilter)
    )
  }

  const { field, dir } = state.sort
  return [...tracks].sort((a, b) => {
    const av = a[field] ?? (typeof a[field] === 'number' ? -Infinity : '')
    const bv = b[field] ?? (typeof b[field] === 'number' ? -Infinity : '')
    const cmp = typeof av === 'number' && typeof bv === 'number'
      ? av - bv
      : String(av).localeCompare(String(bv))
    return dir === 'asc' ? cmp : -cmp
  })
}

// ─── Render ───────────────────────────────────────────────────
function render() {
  const list  = document.getElementById('track-list')
  const empty = document.getElementById('library-empty')
  const tracks = getVisible()

  list.innerHTML = ''

  if (!tracks.length) {
    empty.classList.remove('hidden')
    updateSelectionBar()
    return
  }
  empty.classList.add('hidden')
  tracks.forEach(t => list.appendChild(buildRow(t)))
  updateSelectionBar()
}

function buildRow(track) {
  const row  = document.createElement('div')
  row.className  = 'track-row'
  row.dataset.id = track.id

  const bpm  = track.bpm             ? track.bpm.toFixed(1)          : '—'
  const key  = track.key             ?? '—'
  const dur  = track.duration_seconds ? formatDur(track.duration_seconds) : '—'
  const tags = track.tags || []

  const artworkHTML = track.artwork
    ? `<img class="track-artwork" src="${track.artwork}" alt="" />`
    : `<div class="track-artwork-placeholder">
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M18 3a1 1 0 0 0-1.196-.98l-10 2A1 1 0 0 0 6 5v9.114A4.369 4.369 0 0 0 5 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0 0 15 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z"/>
        </svg>
      </div>`

  const isSelected = state.selected.has(track.id)

  row.innerHTML = `
    <div class="track-art-cell">
      ${artworkHTML}
      <label class="track-cb-wrap${isSelected ? ' track-cb-visible' : ''}">
        <input type="checkbox" class="track-checkbox" ${isSelected ? 'checked' : ''} />
      </label>
    </div>
    <span class="track-name" title="${esc(track.filename)}">${esc(track.filename)}</span>
    <span class="track-dur">${dur}</span>
    <span class="track-bpm">${bpm}</span>
    <span class="track-key">${esc(key)}</span>
    <div class="track-tags">
      ${tags.map(raw => {
        const { name, color } = parseTag(raw)
        const isActive = state.tagFilter === name
        const colorClass = color ? ` tag-color-${color}` : ''
        const activeClass = isActive ? ' tag-active' : ''
        return `<span class="tag${colorClass}${activeClass}" data-tag="${esc(name)}" data-raw="${esc(raw)}">
          ${esc(name)}<button class="tag-x" data-id="${track.id}" data-raw="${esc(raw)}">×</button>
        </span>`
      }).join('')}
      <button class="tag-add" data-id="${track.id}">+</button>
    </div>
    <button class="track-menu-btn" data-id="${track.id}">⋯</button>
  `

  // Click row → open player (ignore interactive children)
  row.addEventListener('click', e => {
    if (e.target.closest('.track-tags, .track-menu-btn, .tag-x, .tag-add, .tag-input, .track-art-cell')) return
    playerOpenTrack(track)
  })

  // Checkbox → toggle selection
  const cb = row.querySelector('.track-checkbox')
  const cbWrap = row.querySelector('.track-cb-wrap')
  cb.addEventListener('change', () => {
    if (cb.checked) {
      state.selected.add(track.id)
      cbWrap.classList.add('track-cb-visible')
    } else {
      state.selected.delete(track.id)
      cbWrap.classList.remove('track-cb-visible')
    }
    updateSelectionBar()
  })

  // Tag chip → filter by name
  row.querySelectorAll('.tag').forEach(chip => {
    chip.addEventListener('click', e => {
      if (e.target.classList.contains('tag-x')) return
      const name = chip.dataset.tag
      state.tagFilter = state.tagFilter === name ? null : name
      updateTagFilterBadge()
      render()
    })
  })

  // Remove tag (use raw for exact match)
  row.querySelectorAll('.tag-x').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      applyTagUpdate(btn.dataset.id, btn.dataset.raw, 'remove')
    })
  })

  // Add tag
  row.querySelector('.tag-add').addEventListener('click', e => {
    e.stopPropagation()
    openTagInput(track.id, row.querySelector('.track-tags'))
  })

  // Menu
  row.querySelector('.track-menu-btn').addEventListener('click', e => {
    e.stopPropagation()
    openMenu(track.id, e.currentTarget)
  })

  return row
}

// ─── Tag input ────────────────────────────────────────────────
const TAG_COLORS = {
  blue:   '#4a9eff',
  yellow: '#f5c842',
  red:    '#e05a5a',
  purple: '#9b7df0',
  green:  '#4aaa78',
  pink:   '#e878ab',
}

function openTagInput(trackId, container) {
  document.querySelectorAll('.tag-input-wrap').forEach(el => el.remove())

  const wrap  = document.createElement('span')
  wrap.className = 'tag-input-wrap'

  const input = document.createElement('input')
  input.className   = 'tag-input'
  input.type        = 'text'
  input.placeholder = 'tag…'
  input.maxLength   = 30

  // Color picker
  let selectedColor = null
  const picker = document.createElement('div')
  picker.className = 'tag-color-picker'

  Object.entries(TAG_COLORS).forEach(([name, hex]) => {
    const dot = document.createElement('button')
    dot.type = 'button'
    dot.className = 'color-dot'
    dot.dataset.color = name
    dot.style.background = hex
    dot.title = name
    // mousedown+preventDefault keeps focus in input
    dot.addEventListener('mousedown', e => {
      e.preventDefault()
      selectedColor = selectedColor === name ? null : name
      picker.querySelectorAll('.color-dot').forEach(d =>
        d.classList.toggle('color-dot-active', d.dataset.color === selectedColor)
      )
    })
    picker.appendChild(dot)
  })

  wrap.appendChild(input)
  wrap.appendChild(picker)
  container.appendChild(wrap)
  input.focus()

  const commit = () => {
    const val = input.value.trim().toLowerCase().replace(/\s+/g, '-')
    wrap.remove()
    document.removeEventListener('click', dismiss)
    if (val) applyTagUpdate(trackId, buildRaw(val, selectedColor), 'add')
  }

  const dismiss = e => {
    if (wrap.parentNode && !wrap.contains(e.target)) {
      wrap.remove()
      document.removeEventListener('click', dismiss)
    }
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); commit() }
    if (e.key === 'Escape') { wrap.remove(); document.removeEventListener('click', dismiss) }
  })

  setTimeout(() => document.addEventListener('click', dismiss), 0)
}

async function applyTagUpdate(trackId, rawValue, action) {
  const track = state.allTracks.find(t => t.id === trackId)
  if (!track) return

  const current = track.tags || []
  let updated
  if (action === 'add') {
    // Replace any existing tag with same name (allows re-coloring)
    const newName = parseTag(rawValue).name
    updated = [...current.filter(r => parseTag(r).name !== newName), rawValue]
  } else {
    // Remove exact raw match
    updated = current.filter(r => r !== rawValue)
  }

  const { error } = await supabase
    .from('tracks').update({ tags: updated }).eq('id', trackId)

  if (error) { showError(error.message); return }
  track.tags = updated
  render()
}

// ─── Track menu ───────────────────────────────────────────────
let _menu = null

function openMenu(trackId, btn) {
  _menu?.remove()

  const menu = document.createElement('div')
  menu.className = 'track-menu'
  menu.innerHTML = `
    <button class="menu-item" data-action="playlist">Add to playlist</button>
    <button class="menu-item menu-danger" data-action="delete">Delete</button>
  `
  document.body.appendChild(menu)
  _menu = menu

  const r = btn.getBoundingClientRect()
  menu.style.top = `${r.bottom + window.scrollY + 4}px`
  requestAnimationFrame(() => {
    menu.style.left = `${r.right - menu.offsetWidth}px`
  })

  menu.querySelector('[data-action="playlist"]').onclick = () => {
    menu.remove(); _menu = null
    window.__showAddToPlaylist?.(trackId)
  }
  menu.querySelector('[data-action="delete"]').onclick = () => {
    menu.remove(); _menu = null
    deleteTrack(trackId)
  }

  const dismiss = e => {
    if (!menu.contains(e.target)) { menu.remove(); _menu = null }
  }
  setTimeout(() => document.addEventListener('click', dismiss, { once: true }), 0)
}

// ─── Delete ───────────────────────────────────────────────────
async function deleteTrack(trackId) {
  const track = state.allTracks.find(t => t.id === trackId)
  if (!track) return
  if (!confirm(`Delete "${track.filename}"?`)) return

  await supabase.storage.from('tracks').remove([track.storage_path])
  await supabase.from('tracks').delete().eq('id', trackId)

  state.allTracks = state.allTracks.filter(t => t.id !== trackId)
  render()
}

// ─── Selection bar ────────────────────────────────────────────
function setupSelectionBar() {
  document.getElementById('selection-playlist-btn').addEventListener('click', () => {
    if (state.selected.size) window.__showAddToPlaylist?.([...state.selected])
  })
  document.getElementById('selection-clear-btn').addEventListener('click', () => {
    state.selected.clear()
    render()
  })
}

function updateSelectionBar() {
  const bar   = document.getElementById('selection-bar')
  const count = state.selected.size
  if (count > 0) {
    bar.classList.remove('hidden')
    document.getElementById('selection-count').textContent =
      `${count} track${count === 1 ? '' : 's'} selected`
  } else {
    bar.classList.add('hidden')
  }
}

// ─── Search ───────────────────────────────────────────────────
function setupSearch() {
  const input = document.getElementById('search-input')
  let t
  input.addEventListener('input', () => {
    clearTimeout(t)
    t = setTimeout(() => { state.search = input.value.trim(); render() }, 150)
  })
}

// ─── Sort ─────────────────────────────────────────────────────
function setupSort() {
  document.querySelectorAll('.sortable').forEach(el => {
    el.addEventListener('click', () => {
      const f = el.dataset.sort
      state.sort = {
        field: f,
        dir: state.sort.field === f && state.sort.dir === 'asc' ? 'desc' : 'asc',
      }
      if (f === 'created_at' && state.sort.field !== 'created_at') state.sort.dir = 'desc'
      updateSortUI()
      render()
    })
  })
  updateSortUI()
}

function updateSortUI() {
  document.querySelectorAll('.sortable').forEach(el => {
    const on = el.dataset.sort === state.sort.field
    el.classList.toggle('sort-active', on)
    el.dataset.dir = on ? state.sort.dir : ''
  })
}

function updateTagFilterBadge() {
  const badge = document.getElementById('tag-filter-badge')
  if (state.tagFilter) {
    badge.textContent = `# ${state.tagFilter}`
    badge.classList.remove('hidden')
  } else {
    badge.classList.add('hidden')
  }
}

// ─── Helpers ─────────────────────────────────────────────────
function formatDur(s) {
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function showError(msg) {
  const el = document.getElementById('library-error')
  el.textContent = msg
  setTimeout(() => { el.textContent = '' }, 5000)
}
