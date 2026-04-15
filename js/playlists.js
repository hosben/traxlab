import { supabase } from './supabase.js?v=3'
import { setView }   from './library.js?v=3'

let playlists        = []
let activePlaylistId = null
let pendingDeleteId  = null

// ─── Init ─────────────────────────────────────────────────────
export async function initPlaylists() {
  const { data } = await supabase
    .from('playlists')
    .select('*')
    .order('created_at', { ascending: true })

  playlists = data || []
  renderSidebar()

  document.getElementById('nav-library').addEventListener('click', goToLibrary)
  document.getElementById('new-playlist-btn').addEventListener('click', showCreateForm)

  window.__showAddToPlaylist = showAddToPlaylistModal

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
    el.className  = 'sidebar-item playlist-item'
    el.dataset.id = pl.id
    if (pl.id === activePlaylistId) el.classList.add('active')

    if (pendingDeleteId === pl.id) {
      // Inline delete confirmation
      el.innerHTML = `
        <span class="sidebar-item-label del-confirm-text">Delete "${esc(pl.name)}"?</span>
        <span class="del-confirm-actions">
          <button class="del-yes" data-id="${pl.id}">Yes</button>
          <button class="del-no">No</button>
        </span>
      `
      el.querySelector('.del-yes').addEventListener('click', e => {
        e.stopPropagation(); confirmDelete(pl.id)
      })
      el.querySelector('.del-no').addEventListener('click', e => {
        e.stopPropagation(); pendingDeleteId = null; renderSidebar()
      })
    } else {
      el.innerHTML = `
        <span class="sidebar-item-label">${esc(pl.name)}</span>
        <button class="sidebar-item-del" data-id="${pl.id}" title="Delete">×</button>
      `
      el.querySelector('.sidebar-item-label').addEventListener('click', () => openPlaylist(pl))
      el.querySelector('.sidebar-item-del').addEventListener('click', e => {
        e.stopPropagation()
        pendingDeleteId = pl.id
        renderSidebar()
      })
    }

    nav.appendChild(el)
  })
}

// ─── Create form (inline in sidebar) ─────────────────────────
function showCreateForm() {
  // Toggle: if already open, close it
  const existing = document.getElementById('create-playlist-form')
  if (existing) { existing.remove(); return }

  const form = document.createElement('div')
  form.id        = 'create-playlist-form'
  form.className = 'create-playlist-form'
  form.innerHTML = `
    <input
      id="new-playlist-input"
      class="new-playlist-input"
      type="text"
      placeholder="Playlist name…"
      maxlength="60"
      autocomplete="off"
    />
    <p class="form-error hidden"></p>
    <div class="create-playlist-actions">
      <button class="btn-create-confirm">Create</button>
      <button class="btn-create-cancel">Cancel</button>
    </div>
  `

  document.getElementById('playlist-nav').before(form)

  const input = form.querySelector('#new-playlist-input')
  input.focus()

  form.querySelector('.btn-create-confirm').addEventListener('click', () => submitCreate(input))
  form.querySelector('.btn-create-cancel').addEventListener('click', () => form.remove())
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  submitCreate(input)
    if (e.key === 'Escape') form.remove()
  })
}

async function submitCreate(input) {
  const name = input.value.trim()
  if (!name) { input.focus(); return }

  const form    = document.getElementById('create-playlist-form')
  const btn     = form?.querySelector('.btn-create-confirm')
  const errEl   = form?.querySelector('.form-error')

  if (btn) { btn.disabled = true; btn.textContent = '…' }

  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser()
    console.log('[Traxlab] createPlaylist user:', user?.id, authErr)

    if (!user) {
      showFormError(errEl, 'Not authenticated.')
      if (btn) { btn.disabled = false; btn.textContent = 'Create' }
      return
    }

    const { data, error } = await supabase
      .from('playlists')
      .insert({ name, user_id: user.id })
      .select()
      .single()

    console.log('[Traxlab] playlist insert result:', data, error)

    if (error) {
      showFormError(errEl, error.message)
      if (btn) { btn.disabled = false; btn.textContent = 'Create' }
      return
    }

    form?.remove()
    playlists.push(data)
    renderSidebar()

  } catch (err) {
    console.error('[Traxlab] playlist create exception:', err)
    showFormError(errEl, 'Unexpected error.')
    if (btn) { btn.disabled = false; btn.textContent = 'Create' }
  }
}

function showFormError(el, msg) {
  if (!el) return
  el.textContent = msg
  el.classList.remove('hidden')
}

// ─── Delete ───────────────────────────────────────────────────
async function confirmDelete(id) {
  await supabase.from('playlists').delete().eq('id', id)
  playlists = playlists.filter(p => p.id !== id)
  pendingDeleteId = null
  if (activePlaylistId === id) goToLibrary()
  else renderSidebar()
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

// ─── Add to playlist modal ────────────────────────────────────
let pendingTrackIds = []

function showAddToPlaylistModal(trackIds) {
  // Accept single ID or array
  pendingTrackIds = Array.isArray(trackIds) ? trackIds : [trackIds]

  const list  = document.getElementById('modal-playlist-list')
  const count = pendingTrackIds.length
  const label = count > 1 ? `${count} tracks` : '1 track'

  document.querySelector('#modal-overlay .modal-header h3').textContent =
    count > 1 ? `Add ${label} to playlist` : 'Add to playlist'

  if (!playlists.length) {
    list.innerHTML = '<p class="modal-empty">No playlists yet — create one first.</p>'
  } else {
    list.innerHTML = playlists.map(pl =>
      `<button class="modal-pl-btn" data-id="${pl.id}">${esc(pl.name)}</button>`
    ).join('')

    list.querySelectorAll('.modal-pl-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true
        btn.textContent = 'Adding…'
        await addTracksToPlaylist(btn.dataset.id, pendingTrackIds)
        closeModal()
      })
    })
  }

  document.getElementById('modal-overlay').classList.remove('hidden')
}

async function addTracksToPlaylist(playlistId, trackIds) {
  const { data } = await supabase
    .from('playlist_tracks')
    .select('position')
    .eq('playlist_id', playlistId)
    .order('position', { ascending: false })
    .limit(1)

  let position = data?.[0]?.position != null ? data[0].position + 1 : 0

  // Batch upsert all tracks at once
  const rows = trackIds.map((id, i) => ({
    playlist_id: playlistId,
    track_id:    id,
    position:    position + i,
  }))

  await supabase.from('playlist_tracks').upsert(rows)

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
