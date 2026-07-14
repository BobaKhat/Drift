// Single shared HTMLAudioElement for 30-second preview playback (Slice 13, Decision #76). One element
// for the whole app — the library is 160+ songs, so a per-song <audio> is out of the question. On the
// first play it also lazily builds a Web Audio graph (AudioContext → MediaElementSource → AnalyserNode
// → destination) so the Slice 14 visualizer / VU meter can read frequency + amplitude data without
// touching this pipeline (DeckVisualizer + MeterTile poll `analyser` in their rAF loops).
//
// iTunes and Deezer previews both send `Access-Control-Allow-Origin: *`, so crossOrigin='anonymous'
// is safe (playback isn't blocked) and keeps the analyser un-muted (a tainted stream reads as zeros).

let el = null
let ctx = null
let sourceNode = null
let analyser = null
let meterAnalyser = null

const listeners = new Set()
let onEnded = null
let onError = null

// Broadcast snapshot — coarse state only (id / playing / duration). currentTime is intentionally NOT
// here: it changes ~60×/s and would thrash every subscriber. The disc reads it directly via a rAF
// loop calling getCurrentTime(), synced to the audio element (Slice 13 progress ring + counter).
let snap = { trackId: null, playing: false, duration: 0 }

function emit(patch) {
  snap = { ...snap, ...patch }
  listeners.forEach((fn) => fn(snap))
}

function ensureEl() {
  if (el) return el
  el = new Audio()
  el.preload = 'auto'
  el.crossOrigin = 'anonymous' // must be set before any src for CORS to apply
  el.addEventListener('play', () => emit({ playing: true }))
  el.addEventListener('pause', () => emit({ playing: false }))
  el.addEventListener('durationchange', () =>
    emit({ duration: Number.isFinite(el.duration) ? el.duration : 0 }),
  )
  el.addEventListener('ended', () => { emit({ playing: false }); onEnded?.(snap.trackId) })
  el.addEventListener('error', () => { onError?.(snap.trackId) })
  return el
}

// Build the Web Audio graph once, on the first play (must follow a user gesture so the context can
// start). Guarded because createMediaElementSource can be called only once per element. Optional —
// if anything throws, playback continues without the graph.
function ensureGraph() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return }
  try {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    ctx = new AC()
    sourceNode = ctx.createMediaElementSource(el)
    analyser = ctx.createAnalyser()
    // 256 → 128 bins. The visualizer maps bin ranges 0-4 / 4-12 / 12-30 / 30-60 to its four arms;
    // small FFT = fast, per-hit response. MeterTile adapts (it allocates off frequencyBinCount).
    analyser.fftSize = 256
    // Default 0.8 smears kick transients across ~10 frames; 0.15 is very snappy so the Slice 14
    // visualizer/VU see individual drum hits, not envelopes (they do their own smoothing on top).
    analyser.smoothingTimeConstant = 0.15
    sourceNode.connect(analyser)
    analyser.connect(ctx.destination)

    // Second, high-resolution analyser dedicated to MeterTile's kick-band pulse. The 256-point FFT
    // above is ~172Hz per bin, which collapses the whole 20–170Hz kick band into bin 0 — and bin 0
    // also carries the sustained bassline, so on a compressed master it pins near 255 and the meter
    // saturates. 2048 → ~21.5Hz per bin, so the kick band resolves across bins ~1–7 and a transient
    // can be told apart from a droning sub.
    //
    // It hangs off the SAME source as a parallel tap and is deliberately NOT connected to
    // ctx.destination: the existing analyser is already in the output path (source → analyser →
    // destination), and connecting this one too would sum a second copy of the signal into the output
    // (audibly doubling it). An AnalyserNode is a pass-through that still reads its input with no
    // downstream connection, so a dangling tap is exactly right here.
    meterAnalyser = ctx.createAnalyser()
    meterAnalyser.fftSize = 2048
    // Looser than the visualizer's 0.15 (kick transients would flicker the bar) but far tighter than
    // the 0.8 default (which would smear them into a flat envelope — the thing we're trying to escape).
    meterAnalyser.smoothingTimeConstant = 0.3
    sourceNode.connect(meterAnalyser)
  } catch {
    /* graph is Slice 14 prep only — never block playback on it */
  }
}

export const audioEngine = {
  // —— Slice 14 hooks (visualizer + VU meter) ——
  get analyser() { return analyser },              // 256-pt, fast — DeckVisualizer
  get meterAnalyser() { return meterAnalyser },    // 2048-pt, high-res — MeterTile's kick band
  get audioContext() { return ctx },

  // —— State reads ——
  get currentTrackId() { return snap.trackId },
  getSnapshot() { return snap },
  getCurrentTime() { return el ? el.currentTime : 0 },
  getDuration() { return el && Number.isFinite(el.duration) ? el.duration : 0 },

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
  setOnEnded(fn) { onEnded = fn },
  setOnError(fn) { onError = fn },

  // Load (only if it's a different track/url) and play. Setting src resets currentTime to 0, so
  // switching songs starts the new preview from the top. Resuming the same track just re-plays.
  play(trackId, url) {
    ensureEl()
    ensureGraph()
    if (snap.trackId !== trackId || (url && el.src !== url)) {
      el.src = url
      emit({ trackId, duration: 0 })
    }
    const p = el.play()
    if (p && p.catch) p.catch(() => {}) // autoplay/interrupt rejections are non-fatal
  },

  pause() { if (el) el.pause() },

  // Resume the already-loaded element (the play/pause toggle uses this when the same track is paused).
  resume() {
    if (el && el.src) { const p = el.play(); if (p && p.catch) p.catch(() => {}) }
  },

  // Full stop + reset (preview ended with no next song, or the deck closed).
  stop() {
    if (el) { el.pause(); try { el.currentTime = 0 } catch { /* not loaded yet */ } }
    emit({ trackId: null, playing: false, duration: 0 })
  },
}
