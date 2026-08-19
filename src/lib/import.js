import { parseTrackString, analyzeTrackParts } from './pipeline'
import { isSpotifyTrackUrl, resolveSpotifyUrl } from './oembed'

// Import orchestration: parse a pasted blob, resolve each line, analyze, and split results
// into mapped (plotted), warnings (version-mismatch flagged), and unresolved (shown on
// reconciliation).

// Bounded concurrency: process 4 entries at a time with a 300ms gap between batches. This lets
// four slow SoundNet round-trips overlap (keeping the pipeline filled instead of idling on
// network latency) while staying well under Spotify/SoundNet throttle thresholds — the
// per-service pacing gates in oembed.js/soundnet.js (SoundNet at 350ms) still space the actual
// requests, so a batch never truly fires at once and higher concurrency won't cause 429s.
const CONCURRENCY = 4
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

  return { mapped, unresolved, warnings }
}

// Re-analyze a single edited unresolved entry. Returns the track row on success, else null.
export async function retryUnresolved(artist, title) {
  const track = await analyzeTrackParts(artist, title)
  if (!track || track.status === 'unanalyzed') return null
  return track
}
