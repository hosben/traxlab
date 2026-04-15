// Audio analysis — Web Audio API only, no external dependencies
// BPM: lowpass filter → onset energy → autocorrelation
// Key: Goertzel chroma → Krumhansl-Schmuckler correlation
// Waveform: RMS per block, normalised to 0-1

const WAVEFORM_POINTS  = 200
const MAX_BPM_DURATION = 60   // seconds used for BPM analysis
const MAX_KEY_DURATION = 30   // seconds used for key analysis
const KEY_SAMPLE_RATE  = 8000 // downsample target for key (saves CPU)

// ─── Public API ──────────────────────────────────────────────
// arrayBuffer: ArrayBuffer (already read by caller)
export async function analyzeAudio(arrayBuffer, onProgress) {
  onProgress?.('Decoding…', 10)

  // slice() creates a copy — decodeAudioData transfers (detaches) the buffer
  const audioBuffer = await new Promise((resolve, reject) => {
    const ctx = new AudioContext()
    ctx.decodeAudioData(
      arrayBuffer.slice(0),
      buf => { ctx.close(); resolve(buf) },
      err => { ctx.close(); reject(err ?? new Error('decodeAudioData failed')) }
    )
  })

  const duration = audioBuffer.duration
  console.log('[Traxlab] Decoded. Duration:', duration, 'SR:', audioBuffer.sampleRate)

  onProgress?.('Waveform…', 35)
  const waveform = extractWaveform(audioBuffer)
  console.log('[Traxlab] Waveform points:', waveform.length)

  onProgress?.('BPM…', 50)
  const bpm = await detectBPM(audioBuffer)
  console.log('[Traxlab] BPM:', bpm)

  onProgress?.('Key…', 80)
  const key = detectKey(audioBuffer)
  console.log('[Traxlab] Key:', key)

  return { duration, waveform, bpm, key }
}

// ─── Waveform (RMS per block) ─────────────────────────────────
function extractWaveform(audioBuffer) {
  const data      = audioBuffer.getChannelData(0)
  const blockSize = Math.floor(data.length / WAVEFORM_POINTS)
  const waveform  = new Array(WAVEFORM_POINTS)

  for (let i = 0; i < WAVEFORM_POINTS; i++) {
    let sum = 0
    const off = i * blockSize
    for (let j = 0; j < blockSize; j++) sum += data[off + j] ** 2
    waveform[i] = Math.sqrt(sum / blockSize)
  }

  const max = Math.max(...waveform)
  return max > 0 ? waveform.map(v => parseFloat((v / max).toFixed(4))) : waveform
}

// ─── BPM ──────────────────────────────────────────────────────
async function detectBPM(audioBuffer) {
  const sr         = audioBuffer.sampleRate
  const maxSamples = Math.floor(Math.min(audioBuffer.duration, MAX_BPM_DURATION) * sr)

  // Lowpass at 150 Hz to isolate kick/bass
  const offCtx = new OfflineAudioContext(1, maxSamples, sr)
  const src    = offCtx.createBufferSource()
  src.buffer   = audioBuffer

  const lp = offCtx.createBiquadFilter()
  lp.type  = 'lowpass'
  lp.frequency.value = 150
  lp.Q.value = 1

  src.connect(lp)
  lp.connect(offCtx.destination)
  src.start(0)

  const filtered = await offCtx.startRendering()
  const data     = filtered.getChannelData(0)

  // RMS energy per 10 ms frame
  const frameSize = Math.floor(sr * 0.01)
  const numFrames = Math.floor(data.length / frameSize)
  const energy    = new Float32Array(numFrames)

  for (let i = 0; i < numFrames; i++) {
    let e = 0
    const off = i * frameSize
    for (let j = 0; j < frameSize; j++) e += data[off + j] ** 2
    energy[i] = Math.sqrt(e / frameSize)
  }

  // Log-compressed onset strength — equalises weak and strong beats so
  // quieter hits aren't ignored and loud kicks don't dominate.
  const onsets = new Float32Array(numFrames)
  for (let i = 1; i < numFrames; i++) {
    const diff = Math.log1p(energy[i] * 1000) - Math.log1p(energy[i - 1] * 1000)
    onsets[i]  = Math.max(0, diff)
  }

  // Autocorrelation over 60–200 BPM
  const fps    = 100  // frames per second (1 / 0.01)
  const minLag = Math.floor(fps * 60 / 200)   // 30 → 200 BPM
  const maxLag = Math.floor(fps * 60 / 60)    // 100 → 60 BPM

  const ac = new Float32Array(maxLag + 1)
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0
    const n = onsets.length - lag
    for (let i = 0; i < n; i++) c += onsets[i] * onsets[i + lag]
    ac[lag] = c
  }

  // Harmonic-weighted score: for each candidate lag, also add the
  // correlation at 2× and 3× that lag (the sub-harmonics).
  // A true beat period shows up strongly at *all* its multiples, while
  // a half-tempo false positive only scores well at its own lag.
  // This directly fixes the common "128 BPM detected as 64 BPM" problem.
  const scores = new Float32Array(maxLag + 1)
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = ac[lag]
    if (lag * 2 <= maxLag) s += 0.5  * ac[lag * 2]
    if (lag * 3 <= maxLag) s += 0.25 * ac[lag * 3]
    scores[lag] = s
  }

  let bestLag = minLag
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    if (scores[lag] > scores[bestLag]) bestLag = lag
  }

  return Math.round((60 / (bestLag / fps)) * 10) / 10
}

// ─── Key (Krumhansl-Schmuckler) ───────────────────────────────

// Standard KS key profiles
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
const NOTES    = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function detectKey(audioBuffer) {
  const chroma = computeChroma(audioBuffer)

  let bestScore = -Infinity
  let bestLabel = 'C'

  for (let root = 0; root < 12; root++) {
    const rotated = rotateChroma(chroma, root)

    const majorCorr = pearson(rotated, KS_MAJOR)
    if (majorCorr > bestScore) {
      bestScore = majorCorr
      bestLabel = NOTES[root]          // e.g. "C", "F#"
    }

    const minorCorr = pearson(rotated, KS_MINOR)
    if (minorCorr > bestScore) {
      bestScore = minorCorr
      bestLabel = NOTES[root] + 'm'   // e.g. "Am", "C#m"
    }
  }

  return bestLabel
}

function computeChroma(audioBuffer) {
  const sourceSR   = audioBuffer.sampleRate
  const data       = audioBuffer.getChannelData(0)
  const step       = Math.max(1, Math.floor(sourceSR / KEY_SAMPLE_RATE))
  const maxSamples = Math.min(
    Math.floor(data.length / step),
    KEY_SAMPLE_RATE * MAX_KEY_DURATION
  )

  const samples = new Float32Array(maxSamples)
  for (let i = 0; i < maxSamples; i++) samples[i] = data[i * step]

  const chroma = new Float32Array(12)
  // C4 = 261.63 Hz; sum Goertzel magnitude across octaves 2–7
  for (let pc = 0; pc < 12; pc++) {
    for (let oct = 2; oct <= 7; oct++) {
      const freq = 261.63 * 2 ** ((pc + (oct - 4) * 12) / 12)
      if (freq < 80 || freq >= KEY_SAMPLE_RATE / 2) continue
      chroma[pc] += goertzel(samples, freq, KEY_SAMPLE_RATE)
    }
  }

  return chroma
}

// Goertzel algorithm: efficient single-frequency DFT magnitude
function goertzel(samples, freq, sr) {
  const omega = 2 * Math.PI * freq / sr
  const coeff = 2 * Math.cos(omega)
  let q1 = 0, q2 = 0

  for (let i = 0; i < samples.length; i++) {
    const q0 = coeff * q1 - q2 + samples[i]
    q2 = q1
    q1 = q0
  }

  return Math.sqrt(q1 * q1 + q2 * q2 - q1 * q2 * coeff)
}

function rotateChroma(chroma, steps) {
  const out = new Float32Array(12)
  for (let i = 0; i < 12; i++) out[i] = chroma[(i + steps) % 12]
  return out
}

function pearson(a, b) {
  const n = a.length
  let sA = 0, sB = 0, sAB = 0, sA2 = 0, sB2 = 0
  for (let i = 0; i < n; i++) {
    sA  += a[i]; sB  += b[i]
    sAB += a[i] * b[i]
    sA2 += a[i] ** 2; sB2 += b[i] ** 2
  }
  const num = n * sAB - sA * sB
  const den = Math.sqrt((n * sA2 - sA ** 2) * (n * sB2 - sB ** 2))
  return den === 0 ? 0 : num / den
}
