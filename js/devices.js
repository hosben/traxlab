import { getXMLContent } from './exporter.js'

let _dirHandle = null

// ─── Init ────────────────────────────────────────────────────
export function initDevices() {
  renderDevices()
}

// ─── Render ──────────────────────────────────────────────────
function renderDevices() {
  const display = document.getElementById('devices-display')
  if (!display) return

  if (!('showDirectoryPicker' in window)) {
    display.innerHTML = `<p class="device-hint">Device export requires Chrome or Edge.</p>`
    return
  }

  if (_dirHandle) {
    display.innerHTML = `
      <div class="device-connected">
        <div class="device-info">
          <svg class="device-icon" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M2 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6Zm14 5H4a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2Zm-1 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/>
          </svg>
          <span class="device-name" title="${esc(_dirHandle.name)}">${esc(_dirHandle.name)}</span>
        </div>
        <div class="device-actions">
          <button id="device-export-btn" class="btn-device-export">Export XML</button>
          <button id="device-disconnect-btn" class="btn-device-disconnect" title="Disconnect">×</button>
        </div>
      </div>
    `
    document.getElementById('device-export-btn').addEventListener('click', exportToDevice)
    document.getElementById('device-disconnect-btn').addEventListener('click', () => {
      _dirHandle = null
      renderDevices()
    })
  } else {
    display.innerHTML = `
      <button id="device-connect-btn" class="btn-device-connect">
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M2 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6Zm14 5H4a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1a2 2 0 0 0-2-2Zm-1 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/>
        </svg>
        Connect device
      </button>
    `
    document.getElementById('device-connect-btn').addEventListener('click', connectDevice)
  }
}

// ─── Connect ─────────────────────────────────────────────────
async function connectDevice() {
  try {
    _dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
    renderDevices()
  } catch (e) {
    if (e.name !== 'AbortError') console.error('[Traxlab] showDirectoryPicker:', e)
  }
}

// ─── Export to device ────────────────────────────────────────
async function exportToDevice() {
  const btn = document.getElementById('device-export-btn')
  if (!btn || !_dirHandle) return

  btn.disabled    = true
  btn.textContent = 'Exporting…'

  try {
    const xml = await getXMLContent()

    const fileHandle = await _dirHandle.getFileHandle('traxlab-rekordbox.xml', { create: true })
    const writable   = await fileHandle.createWritable()
    await writable.write(xml)
    await writable.close()

    btn.textContent = 'Exported!'
    setTimeout(() => { btn.disabled = false; btn.textContent = 'Export XML' }, 2000)
  } catch (e) {
    console.error('[Traxlab] exportToDevice:', e)
    btn.disabled    = false
    btn.textContent = 'Export XML'
  }
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
