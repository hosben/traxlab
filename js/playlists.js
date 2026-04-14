import { supabase } from './supabase.js'
import { setView }   from './library.js'

let playlists    = []
let activePlaylistId = null

// ─── Init ─────────────────────────────────────────────────────
export async function initPlaylists() {
  const { data } = await supabase
    .from('playlists')
    .select('*')
    .order('created_at', { ascending: true })

  playlists = data || []
  renderSidebar()

  document.getElementById('nav-library').addEventListener('click', goToLibrary)
  document.getElementById('new-playlist-btn').addEventListener('click', createPlaylist)

  // Expose to library.js track menu
  window.__showAddToPlaylist = showAddToPlaylistModal

  // Modal close
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal()
  })
  document.getElementById('modal-close-btn').addEventListener('click', closeModal)
}

// ─── Sidebar ─────────────────────────────────────────────────
function renderSidebar() {
  const nav = document.getElementById('playlist-nav')
  nav.innerHTML = ''

  playlists.forEach(pl => {
    const el = document.createElement('div')
    el.className   = 'sidebar-item playlist-item'
    el.dataset.id  = pl.id
    if (pl.id === activePlaylistId) el.classList.add('active')

    el.innerHTML = `
      <span class="sidebar-item-label">${esc(pl.name)}</span>
      <button class="sidebar-item-del" data-id="${pl.id}" title="Delete playlist">×</button>
    `
    el.querySelector('.sidebar-item-label').addEventListener('click', () => openPlaylist(pl))
    el.querySelector('.sidebar-item-del').addEventListener('click', e => {
      e.stopPropagation()
      deletePlaylist(pl.id)
    })
    nav.appendChild(el)
  })
}

// ─── Navigation ──────────────────────────────────────────────
function goToLibrary() {
  activePlaylistId = null
  document.getElementById('nav-library').classList.add('active')
  document.getElementById('view-title').textContent = 'Library'
  document.querySelectorAll('.playlist-item').forEach(el => el.classList.remove('active'))
  setView('library')
}

async function openPlaylist(pl) {
  activePlaylistId = pl.id

  document.getElementById('nav-library').classList.remove('active')
  document.getElementById('view-title').textContent = pl.name
  document.querySelectorAll('.playlist-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === pl.id)
  })

  const { data } = await supabase
    .from('playlist_tracks')
    .select('track_id')
    .eq('playlist_id', pl.id)
    .order('position', { ascending: true })

  setView(pl.id, (data || []).map(r => r.track_id))
}

// ─── CRUD ─────────────────────────────────────────────────────
function createPlaylist() {
  // Inline input in sidebar instead of prompt()
  const nav = document.getElementById('playlist-nav')

  // Don't open twice
  if (document.getElementById('new-playlist-input')) return

  const wrap = document.createElement('div')
  wrap.className = 'new-playlist-wrap'
  wrap.innerHTML = `<input id="new-playlist-input" class="new-playlist-input" type="text" placeholder="Playlist name…" maxlength="60" />`
  nav.prepend(wrap)

  const input = wrap.querySelector('input')
  input.focus()

  const commit = async () => {
    const name = input.value.trim()
    wrap.remove()
    if (!name) return

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase
      .from('playlists')
      .insert({ name, user_id: user.id })
      .select()
      .single()

    if (error) { console.error('[Traxlab] playlist insert error:', error); return }
    if (!data) return
    playlists.push(data)
    renderSidebar()
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  commit()
    if (e.key === 'Escape') wrap.remove()
  })
  input.addEventListener('blur', commit)
}

async function deletePlaylist(id) {
  if (!confirm('Delete this playlist?')) return
  await supabase.from('playlists').delete().eq('id', id)
  playlists = playlists.filter(p => p.id !== id)
  if (activePlaylistId === id) goToLibrary()
  else renderSidebar()
}

// ─── Add to playlist modal ────────────────────────────────────
let pendingTrackId = null

function showAddToPlaylistModal(trackId) {
  pendingTrackId = trackId
  const list = document.getElementById('modal-playlist-list')

  if (!playlists.length) {
    list.innerHTML = '<p class="modal-empty">No playlists yet — create one first.</p>'
  } else {
    list.innerHTML = playlists.map(pl => `
      <button class="modal-pl-btn" data-id="${pl.id}">${esc(pl.name)}</button>
    `).join('')

    list.querySelectorAll('.modal-pl-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        await addTrackToPlaylist(btn.dataset.id, pendingTrackId)
        closeModal()
      })
    })
  }

  document.getElementById('modal-overlay').classList.remove('hidden')
}

async function addTrackToPlaylist(playlistId, trackId) {
  const { data } = await supabase
    .from('playlist_tracks')
    .select('position')
    .eq('playlist_id', playlistId)
    .order('position', { ascending: false })
    .limit(1)

  const position = data?.[0]?.position != null ? data[0].position + 1 : 0

  await supabase.from('playlist_tracks').upsert({
    playlist_id: playlistId,
    track_id:    trackId,
    position,
  })

  // Refresh if we're viewing this playlist
  if (activePlaylistId === playlistId) {
    const pl = playlists.find(p => p.id === playlistId)
    if (pl) openPlaylist(pl)
  }
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden')
  pendingTrackId = null
}

// ─── Helper ───────────────────────────────────────────────────
function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}
