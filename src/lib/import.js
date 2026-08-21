import { parseTrackString, analyzeTrackParts } from './pipeline'
import { isSpotifyTrackUrl, resolveSpotifyUrl } from './oembed'

// Import orchestration: parse a pasted blob, resolve each line, analyze, and split results
// into mapped (plotted), warnings (version-mismatch flagged), and unresolved (shown on
// reconciliation).

// Serial processing: one entry at a time with a 300ms gap between them. Concurrency was
// dropped from 4 to 1 after finding SoundNet degrades under concurrent load — overlapping
// round-trips pushed exact-match responses past the SoundNet timeout, misclassifying real
// hits as "no exact match". Running serially keeps each lookup on an uncontended connection.
const CONCURRENCY = 1
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
  // `kind` splits the unresolved reasons so the UI can tell a transient URL-resolution
  // failure apart from a genuine SoundNet miss (both used to collapse into "couldn't be found"):
  //   'url'         — Spotify oEmbed couldn't resolve the link (transient: throttle/timeout/504)
  //   'nodata'      — resolved fine, but SoundNet has no audio data for it (genuine miss)
  //   'unparseable' — the pasted line isn't a URL or "Artist – Title"
  try {
    if (entry.type === 'unparseable') {
      return { unresolved: { originalText: entry.originalText, artist: '', title: '', kind: 'unparseable', reason: "couldn't read this line", triedVariations: 0 } }
    }

    let { artist, title } = entry
    let spotifyArtUrl = null
    let spotifyDuration = null
    if (entry.type === 'spotify') {
      // oEmbed resolution is its own failure mode (transient) — surface it as kind 'url',
      // not as a SoundNet miss, so the retry copy and reconciliation summary stay accurate.
      let r
      try {
        r = await resolveSpotifyUrl(entry.url)
      } catch {
        return { unresolved: { originalText: entry.originalText, artist: '', title: '', kind: 'url', reason: "couldn't resolve URL", triedVariations: 0 } }
      }
      artist = r.artist
      title = r.title
      spotifyArtUrl = r.ogImage
      spotifyDuration = r.duration ?? null
      if (!artist || !title) {
        return { unresolved: { originalText: entry.originalText, artist: '', title: '', kind: 'url', reason: "couldn't resolve URL", triedVariations: 0 } }
      }
      console.log(`[import] spotifyArtUrl=${spotifyArtUrl ?? 'null'} spotifyDuration=${spotifyDuration ?? 'null'}`)
    }

    const track = await analyzeTrackParts(artist, title, { spotifyArtUrl, spotifyDuration })

    // SoundNet misses are stored as 'unanalyzed' by the pipeline (it caught all variations).
    if (!track || track.status === 'unanalyzed') {
      return {
        unresolved: {
          originalText: entry.originalText,
          artist,
          title,
          kind: 'nodata',
          reason: 'no audio data available',
          // The panel prefills with the ORIGINAL artist/title (above). The variation list is
          // carried through only as hover detail so the user can see what was already tried.
          variations: track?._meta?.variations ?? [],
          // Distinct queries actually attempted, including the original (up to 4). Counting the
          // distinct set — not retriedCount — means a comma track whose V3/V4 dedup away still
          // shows the primary-artist split was tried, and a V4-reaching track can report 4.
          triedVariations: track?._meta?.variations?.length ?? 0,
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
        kind: 'nodata',
        reason: err.message || 'no audio data available',
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
// Processes entries one at a time (CONCURRENCY = 1) with a PAIR_DELAY gap between them.
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
        // Display label for the loading card's current-track line: "Artist – Title" once parsed, else
        // the raw URL for a Spotify link that hasn't resolved (its artist/title aren't on the entry).
        // Label only — the import result, SoundNet lookups and current/total tracking are unaffected.
        const label = entry.artist && entry.title
          ? `${entry.artist} – ${entry.title}`
          : (entry.title || entry.originalText)
        onProgress({ current: done, total, name: label })
      }),
    )
    if (i + CONCURRENCY < entries.length) await sleep(PAIR_DELAY)
  }

  // Variation-hit distribution: which V-slot produced each accepted match, so per-variation
  // hit rate is readable straight from one log line. Cache hits return no _meta (they never
  // ran the cascade) and are tallied separately.
  const hitDist = { V1: 0, V2: 0, V3: 0, V4: 0 }
  let cachedHits = 0
  for (const t of mapped) {
    const vi = t._meta?.variationIndex
    if (vi >= 1 && vi <= 4) hitDist[`V${vi}`]++
    else cachedHits++
  }
  console.log(
    `[drift] import hit distribution — V1:${hitDist.V1} V2:${hitDist.V2} V3:${hitDist.V3} V4:${hitDist.V4} | cached:${cachedHits} | unresolved:${unresolved.length}`,
  )

  return { mapped, unresolved, warnings }
}

// Manual per-track Retry gets a much longer SoundNet deadline than the bulk import (which
// stays at SOUNDNET_TIMEOUT_MS). The user is re-fetching one track on purpose, so it's worth
// waiting out a slow SoundNet response rather than treating it as a timeout "no exact match".
const RETRY_TIMEOUT_MS = 45000

// Re-analyze a single edited unresolved entry. Returns the track row on success, else null.
export async function retryUnresolved(artist, title) {
  const track = await analyzeTrackParts(artist, title, { timeoutMs: RETRY_TIMEOUT_MS })
  if (!track || track.status === 'unanalyzed') return null
  return track
}
