import { parseTrackString, analyzeTrackParts } from './pipeline'
import { isSpotifyTrackUrl, resolveSpotifyUrl } from './oembed'

// Import orchestration: parse a pasted blob, resolve each line, analyze, and split results
// into mapped (plotted), warnings (version-mismatch flagged), and unresolved (shown on
// reconciliation).

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

// Analyze a single parsed entry → { track, warning? } | { unresolved }.
// _meta from analyzeTrackParts threads through here so callers get retry info.
async function processEntry(entry) {
  try {
    if (entry.type === 'unparseable') {
      return { unresolved: { originalText: entry.originalText, artist: '', title: '', reason: "couldn't read this line", triedVariations: 0 } }
    }

    let { artist, title } = entry
    let spotifyArtUrl = null
    if (entry.type === 'spotify') {
      const r = await resolveSpotifyUrl(entry.url)
      artist = r.artist
      title = r.title
      spotifyArtUrl = r.ogImage
      if (!artist || !title) throw new Error('could not resolve Spotify link')
    }

    const track = await analyzeTrackParts(artist, title, { spotifyArtUrl })

    // SoundNet misses are stored as 'unanalyzed' by the pipeline (it caught all variations).
    if (!track || track.status === 'unanalyzed') {
      return {
        unresolved: {
          originalText: entry.originalText,
          artist,
          title,
          reason: 'not found',
          // lastAttempt lets the reconciliation panel prefill the best variation attempted
          lastAttempt: {
            artist: track?._meta?.lastArtist ?? artist,
            title: track?._meta?.lastTitle ?? title,
          },
          triedVariations: track?._meta?.retriedCount ?? 0,
        },
      }
    }

    // Surface version mismatch warning so the reconciliation panel can flag it.
    const warning = track._meta?.versionWarning
      ? { originalText: entry.originalText, ...track._meta.versionWarning }
      : null

    return { track, warning }
  } catch (err) {
    return {
      unresolved: {
        originalText: entry.originalText,
        artist: entry.artist || '',
        title: entry.title || '',
        reason: err.message || 'failed',
        triedVariations: 0,
      },
    }
  }
}

// Run a full import. Calls onProgress({ current, total, name }) after each track.
// Returns { mapped, unresolved, warnings }.
//   mapped    — successfully analyzed track rows (includes version-warned tracks)
//   unresolved — tracks that couldn't be found after all variations
//   warnings   — subset of mapped tracks that had a duration-mismatch, with display data
//
// Processes entries in pairs (CONCURRENCY = 2) with a PAIR_DELAY gap between pairs.
export async function runImport(text, onProgress = () => {}) {
  const entries = parseInput(text)
  const total = entries.length
  const mapped = []
  const unresolved = []
  const warnings = []
  let done = 0

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const pair = entries.slice(i, i + CONCURRENCY)
    await Promise.all(
      pair.map(async (entry) => {
        const result = await processEntry(entry)
        if (result.track) {
          mapped.push(result.track)
          if (result.warning) warnings.push(result.warning)
        } else {
          unresolved.push(result.unresolved)
        }
        done += 1
        onProgress({ current: done, total, name: entry.title || entry.originalText })
      }),
    )
    if (i + CONCURRENCY < entries.length) await sleep(PAIR_DELAY)
  }

  return { mapped, unresolved, warnings }
}

// Re-analyze a single edited unresolved entry. Returns the track row on success, else null.
export async function retryUnresolved(artist, title) {
  const track = await analyzeTrackParts(artist, title)
  if (!track || track.status === 'unanalyzed') return null
  return track
}
