import { supabase }        from './supabase.js'
import { initPlayer, playerOpenTrack } from './player.js'

// ─── State ────────────────────────────────────────────────────
const state = {
  allTracks:     [],
  view:          'library', // 'library' | playlist-id
  playlistIds:   [],        // track ids in current playlist view
  search:        '',
  sort:          { field: 'created_at', dir: 'desc' },
  tagFilter:     null,
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
  state.view       = view
  state.playlistIds = playlistIds
  state.search     = ''
  state.tagFilter  = null
  document.getElementById('search-input').value = ''
  updateTagFilterBadge()
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
    tracks = tracks.filter(t => t.tags?.includes(state.tagFilter))
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
    return
  }
  empty.classList.add('hidden')
  tracks.forEach(t => list.appendChild(buildRow(t)))
}

function buildRow(track) {
  const row  = document.createElement('div')
  row.className  = 'track-row'
  row.dataset.id = track.id

  const bpm  = track.bpm             ? track.bpm.toFixed(1)          : '—'
  const key  = track.key             ?? '—'
  const dur  = track.duration_seconds ? formatDur(track.duration_seconds) : '—'
  const tags = track.tags || []

  row.innerHTML = `
    <span class="track-name" title="${esc(track.filename)}">${esc(track.filename)}</span>
    <span class="track-dur">${dur}</span>
    <span class="track-bpm">${bpm}</span>
    <span class="track-key">${esc(key)}</span>
    <div class="track-tags">
      ${tags.map(tag => `
        <span class="tag${state.tagFilter === tag ? ' tag-active' : ''}" data-tag="${esc(tag)}">
          ${esc(tag)}<button class="tag-x" data-id="${track.id}" data-tag="${esc(tag)}">×</button>
        </span>`).join('')}
      <button class="tag-add" data-id="${track.id}">+</button>
    </div>
    <button class="track-menu-btn" data-id="${track.id}">⋯</button>
  `

  // Click row → open player (ignore clicks on interactive children)
  row.addEventListener('click', e => {
    if (e.target.closest('.track-tags, .track-menu-btn, .tag-x, .tag-add, .tag-input')) return
    playerOpenTrack(track)
  })

  // Tag chip → filter
  row.querySelectorAll('.tag').forEach(chip => {
    chip.addEventListener('click', e => {
      if (e.target.classList.contains('tag-x')) return
      const tag = chip.dataset.tag
      state.tagFilter = state.tagFilter === tag ? null : tag
      updateTagFilterBadge()
      render()
    })
  })

  // Remove tag
  row.querySelectorAll('.tag-x').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation()
      applyTagUpdate(btn.dataset.id, (btn.dataset.tag), 'remove')
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
function openTagInput(trackId, container) {
  document.querySelectorAll('.tag-input-wrap').forEach(el => el.remove())
  const wrap  = document.createElement('span')
  wrap.className = 'tag-input-wrap'
  const input = document.createElement('input')
  input.className   = 'tag-input'
  input.type        = 'text'
  input.placeholder = 'tag…'
  input.maxLength   = 30
  wrap.appendChild(input)
  container.appendChild(wrap)
  input.focus()

  const commit = () => {
    const val = input.value.trim().toLowerCase().replace(/\s+/g, '-')
    wrap.remove()
    if (val) applyTagUpdate(trackId, val, 'add')
  }
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  commit()
    if (e.key === 'Escape') wrap.remove()
  })
  input.addEventListener('blur', commit)
}

async function applyTagUpdate(trackId, tag, action) {
  const track = state.allTracks.find(t => t.id === trackId)
  if (!track) return

  const current = track.tags || []
  const updated = action === 'add'
    ? [...new Set([...current, tag])]
    : current.filter(t => t !== tag)

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
