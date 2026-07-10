// Single shared HTMLAudioElement for 30-second preview playback (Slice 13, Decision #76). One element
// for the whole app — the library is 160+ songs, so a per-song <audio> is out of the question. On the
// first play it also lazily builds a Web Audio graph (AudioContext → MediaElementSource → AnalyserNode
// → destination) so Slice 14's visualizer / VU meter / BPM matrix can read frequency + amplitude data
// without touching this pipeline. Nothing reads `analyser` yet — it's wired up as prep only.
//
// iTunes and Deezer previews both send `Access-Control-Allow-Origin: *`, so crossOrigin='anonymous'
// is safe (playback isn't blocked) and keeps the analyser un-muted (a tainted stream reads as zeros).

let el = null
let ctx = null
let sourceNode = null
let analyser = null

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
    analyser.fftSize = 2048
    sourceNode.connect(analyser)
    analyser.connect(ctx.destination)
  } catch {
    /* graph is Slice 14 prep only — never block playback on it */
  }
}

export const audioEngine = {
  // —— Slice 14 hooks (unused for now) ——
  get analyser() { return analyser },
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
