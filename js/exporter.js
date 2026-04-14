import { supabase } from './supabase.js'

// ─── Public API ───────────────────────────────────────────────
export async function exportRekordbox() {
  const btn = document.getElementById('export-btn')
  btn.disabled    = true
  btn.textContent = 'Exporting…'

  try {
    const [tracksRes, playlistsRes, ptRes] = await Promise.all([
      supabase.from('tracks').select('*').order('filename', { ascending: true }),
      supabase.from('playlists').select('*').order('name', { ascending: true }),
      supabase.from('playlist_tracks').select('*').order('position', { ascending: true }),
    ])

    const tracks    = tracksRes.data    || []
    const playlists = playlistsRes.data || []
    const ptRows    = ptRes.data        || []

    // playlist_id → ordered track_id array
    const plMap = {}
    ptRows.forEach(row => {
      if (!plMap[row.playlist_id]) plMap[row.playlist_id] = []
      plMap[row.playlist_id].push(row.track_id)
    })

    const xml = buildXML(tracks, playlists, plMap)
    download(xml, 'traxlab-rekordbox.xml')
  } finally {
    btn.disabled    = false
    btn.textContent = 'Export XML'
  }
}

// ─── XML builder ─────────────────────────────────────────────
function buildXML(tracks, playlists, plMap) {
  // Assign sequential numeric IDs (Rekordbox requires integers)
  const idMap = new Map()
  tracks.forEach((t, i) => idMap.set(t.id, i + 1))

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DJ_PLAYLISTS Version="1.0.0">',
    '  <PRODUCT Name="rekordbox" Version="6.0.0" Company="AlphaTheta"/>',
    `  <COLLECTION Entries="${tracks.length}">`,
    ...tracks.map(t => trackElement(t, idMap.get(t.id))),
    '  </COLLECTION>',
    '  <PLAYLISTS>',
    `    <NODE Type="0" Name="ROOT" Count="${playlists.length + 1}">`,
  ]

  // "All Tracks" node
  lines.push(
    `      <NODE Type="1" Name="Traxlab Library" KeyType="0" Entries="${tracks.length}">`,
    ...tracks.map(t => `        <TRACK Key="${idMap.get(t.id)}"/>`),
    '      </NODE>',
  )

  // User playlists
  playlists.forEach(pl => {
    const ids = (plMap[pl.id] || [])
      .map(tid => idMap.get(tid))
      .filter(Boolean)

    lines.push(
      `      <NODE Type="1" Name="${xa(pl.name)}" KeyType="0" Entries="${ids.length}">`,
      ...ids.map(id => `        <TRACK Key="${id}"/>`),
      '      </NODE>',
    )
  })

  lines.push(
    '    </NODE>',
    '  </PLAYLISTS>',
    '</DJ_PLAYLISTS>',
  )

  return lines.join('\n')
}

function trackElement(track, numId) {
  const name     = track.filename.replace(/\.[^.]+$/, '')
  const ext      = (track.filename.split('.').pop() || 'wav').toUpperCase()
  const kind     = kindFromExt(ext)
  const duration = Math.round(track.duration_seconds || 0)
  const bpm      = track.bpm ? Number(track.bpm).toFixed(2) : '0.00'
  const key      = toRekordboxKey(track.key || '')
  const date     = (track.created_at || '').slice(0, 10)

  // Rekordbox resolves Location as a local path — user places files in ~/Traxlab/
  const location = `file://localhost/Traxlab/${encodeURIComponent(track.filename)}`

  const attrs = attrStr({
    TrackID:    numId,
    Name:       xa(name),
    Artist:     '',
    Composer:   '',
    Album:      '',
    Grouping:   '',
    Genre:      '',
    Kind:       kind,
    Size:       0,
    TotalTime:  duration,
    DiscNumber: 0,
    TrackNumber:0,
    Year:       '',
    AverageBpm: bpm,
    DateAdded:  date,
    BitRate:    0,
    SampleRate: 44100,
    Comments:   '',
    PlayCount:  0,
    Rating:     0,
    Location:   location,
    Remixer:    '',
    Tonality:   xa(key),
    Label:      '',
    Mix:        '',
  })

  if (track.bpm) {
    return [
      `    <TRACK ${attrs}>`,
      `      <TEMPO Inizio="0.000" Bpm="${bpm}" Metro="4/4" Battito="1"/>`,
      `    </TRACK>`,
    ].join('\n')
  }

  return `    <TRACK ${attrs}/>`
}

// ─── Helpers ──────────────────────────────────────────────────

// Map our key notation to Rekordbox Tonality
const KEY_MAP = {
  'C':  'C',  'Cm':  'Cm',
  'C#': 'Db', 'C#m': 'Dbm',
  'D':  'D',  'Dm':  'Dm',
  'D#': 'Eb', 'D#m': 'Ebm',
  'E':  'E',  'Em':  'Em',
  'F':  'F',  'Fm':  'Fm',
  'F#': 'F#', 'F#m': 'F#m',
  'G':  'G',  'Gm':  'Gm',
  'G#': 'Ab', 'G#m': 'Abm',
  'A':  'A',  'Am':  'Am',
  'A#': 'Bb', 'A#m': 'Bbm',
  'B':  'B',  'Bm':  'Bm',
}

function toRekordboxKey(key) {
  return KEY_MAP[key] ?? key
}

function kindFromExt(ext) {
  const map = { WAV: 'WAV File', MP3: 'MP3 File', AIF: 'AIFF File',
                AIFF: 'AIFF File', FLAC: 'FLAC File', OGG: 'OGG File' }
  return map[ext] || 'Unknown File'
}

function attrStr(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ')
}

// XML attribute escaping
function xa(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function download(content, filename) {
  const blob = new Blob([content], { type: 'application/xml' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
