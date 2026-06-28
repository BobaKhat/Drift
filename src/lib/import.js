import { parseTrackString, analyzeTrackParts } from './pipeline'
import { isSpotifyTrackUrl, resolveSpotifyUrl } from './oembed'

// Import orchestration: parse a pasted blob, resolve each line, analyze, and split results
// into mapped (plotted) vs unresolved (shown on reconciliation).

// Bounded concurrency: process 2 entries at a time with a 300ms gap between pairs. This lets
// two slow SoundNet round-trips overlap (≈halving wall-clock vs strictly sequential) while
// staying well under Spotify/SoundNet throttle thresholds — the per-service pacing gates in
// oembed.js/soundnet.js still space the actual requests, so a pair never truly fires at once.
const CONCURRENCY = 2
const PAIR_DELAY = 300

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// One entry per non-empty line, tagged by detected format.
export function parseInput(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      if (isSpotifyTrackUrl(line)) return { type: 'spotify', url: line, originalText: line }
      try {
        const { artist, title } = parseTrackString(line)
        return { type: 'text', artist, title, originalText: line }
      } catch {
        return { type: 'unparseable', originalText: line }
      }
    })
}

// Analyze a single parsed entry → either a mapped track row or an unresolved record.
async function processEntry(entry) {
  try {
    if (entry.type === 'unparseable') {
      return { unresolved: { originalText: entry.originalText, artist: '', title: '', reason: "couldn't read this line" } }
    }

    let { artist, title } = entry
    if (entry.type === 'spotify') {
      const r = await resolveSpotifyUrl(entry.url)
      artist = r.artist
      title = r.title
      if (!artist || !title) throw new Error('could not resolve Spotify link')
    }

    const track = await analyzeTrackParts(artist, title)
    // SoundNet misses are stored as 'unanalyzed' by the pipeline (it caught the error key).
    if (!track || track.status === 'unanalyzed') {
      return { unresolved: { originalText: entry.originalText, artist, title, reason: 'not found' } }
    }
    return { track }
  } catch (err) {
    return {
      unresolved: {
        originalText: entry.originalText,
        artist: entry.artist || '',
        title: entry.title || '',
        reason: err.message || 'failed',
      },
    }
  }
}

// Run a full import. Calls onProgress({ current, total, name }) after each track.
// Returns { mapped: trackRows[], unresolved: [{ originalText, artist, title, reason }] }.
//
// Processes entries in pairs (CONCURRENCY = 2) with a PAIR_DELAY gap between pairs. Capping
// at 2 keeps us under the throttle threshold that broke the old 5-wide bursts, while the
// overlap roughly halves import time versus strictly sequential.
export async function runImport(text, onProgress = () => {}) {
  const entries = parseInput(text)
  const total = entries.length
  const mapped = []
  const unresolved = []
  let done = 0

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const pair = entries.slice(i, i + CONCURRENCY)
    await Promise.all(
      pair.map(async (entry) => {
        const result = await processEntry(entry)
        if (result.track) mapped.push(result.track)
        else unresolved.push(result.unresolved)
        done += 1
        onProgress({ current: done, total, name: entry.title || entry.originalText })
      }),
    )
    if (i + CONCURRENCY < entries.length) await sleep(PAIR_DELAY)
  }

  return { mapped, unresolved }
}

// Re-analyze a single edited unresolved entry. Returns the track row on success, else null.
export async function retryUnresolved(artist, title) {
  const track = await analyzeTrackParts(artist, title)
  if (!track || track.status === 'unanalyzed') return null
  return track
}
