import { parseTrackString, analyzeTrackParts } from './pipeline'
import { isSpotifyTrackUrl, resolveSpotifyUrl } from './oembed'

// Import orchestration: parse a pasted blob, resolve each line, analyze, and split results
// into mapped (plotted), warnings (version-mismatch flagged), and unresolved (shown on
// reconciliation).

// Two-pass import (diagnostic finding: SoundNet's exact-match path returns in <1s, but its
// fallback search takes 45–60s and sometimes returns real hits — a diacritic-stripped query
// came back valid at 56s. A single-pass 10s timeout threw those away).
//
//   Pass 1 (fast)       — every track, V1 (original artist+title) only, no cascade. A short
//                         10s SoundNet timeout, concurrency 3. Hits render on the map as they
//                         land; when it finishes the map is fully interactive.
//   Pass 2 (background) — only the pass-1 misses. V2–V4 cascade (V1 already ran in pass 1 and
//                         missed, so re-firing it just burns a full timeout) with a 60s timeout,
//                         concurrency 3. These lookups idle-wait on SoundNet's slow fallback path
//                         rather than doing local work, so running 3 at once doesn't meaningfully
//                         raise the request rate against the shared pacer. Runs after pass 1 without
//                         blocking the UI; each hit appears on the map.
//
// The pacer (PAIR_DELAY, the gap between scheduled units of work) is shared by both passes and
// unchanged from the previous single-pass serial import.
const PASS1_CONCURRENCY = 3
const PASS1_TIMEOUT_MS = 10000
const PASS2_CONCURRENCY = 3
// The long timeout lets SoundNet's slow fallback search run to completion.
const PASS2_TIMEOUT_MS = 60000
const PAIR_DELAY = 300

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Display label for the loading readout: "Artist – Title" once parsed, else the raw URL for a
// Spotify link that hasn't resolved (its artist/title aren't on the entry yet).
const labelFor = (entry) =>
  entry.artist && entry.title ? `${entry.artist} – ${entry.title}` : (entry.title || entry.originalText)

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
// opts.timeoutMs / opts.v1Only / opts.skipV1 pick the pass behaviour: pass 1 runs V1-only on a short
// timeout, pass 2 runs the V2–V4 cascade (skipV1) on a long one. Both share this same resolution path.
async function processEntry(entry, { timeoutMs, v1Only = false, skipV1 = false } = {}) {
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

    const track = await analyzeTrackParts(artist, title, { spotifyArtUrl, spotifyDuration, timeoutMs, v1Only, skipV1 })

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

// —— Pass 1: fast V1-only sweep ————————————————————————————————————————————————————————————
// Every parsed entry, V1 (original artist+title) only, on the short 10s SoundNet timeout, at
// concurrency 3. Hits stream out through onTrack the moment they resolve so the caller can plot
// them on the map as they land; onProgress reports {current,total,name} after each entry.
//
// Returns { mapped, warnings, misses, unresolved }:
//   mapped     — track rows that resolved on V1 (already emitted via onTrack)
//   warnings   — version-mismatch warnings among those hits
//   misses     — pass-1 misses eligible for the pass-2 cascade: entries whose SoundNet lookup
//                genuinely found no exact match (kind 'nodata'). Each is { entry, unresolved }.
//   unresolved — pass-1 misses NOT worth retrying with a cascade — an unparseable line or a
//                Spotify link whose oEmbed never resolved (kind 'unparseable' | 'url'). These go
//                straight to the final reconciliation list; the cascade can't help them.
export async function runImportPass1(text, { onTrack = () => {}, onProgress = () => {} } = {}) {
  const entries = parseInput(text)
  const total = entries.length
  const mapped = []
  const warnings = []
  const misses = []      // { entry, unresolved } — kind 'nodata', fed to pass 2
  const unresolved = []  // kind 'url' | 'unparseable' — terminal, straight to reconciliation
  let done = 0

  for (let i = 0; i < entries.length; i += PASS1_CONCURRENCY) {
    const batch = entries.slice(i, i + PASS1_CONCURRENCY)
    await Promise.all(
      batch.map(async (entry) => {
        const result = await processEntry(entry, { timeoutMs: PASS1_TIMEOUT_MS, v1Only: true })
        if (result.track) {
          mapped.push(result.track)
          if (result.warning) warnings.push(result.warning)
          onTrack(result.track)
        } else if (result.unresolved.kind === 'nodata') {
          misses.push({ entry, unresolved: result.unresolved })
        } else {
          unresolved.push(result.unresolved)
        }
        done += 1
        onProgress({ current: done, total, name: labelFor(entry) })
      }),
    )
    if (i + PASS1_CONCURRENCY < entries.length) await sleep(PAIR_DELAY)
  }

  console.log(`[drift] import pass 1 (V1 only) — hits:${mapped.length} / ${total} | retry-queue:${misses.length} | terminal:${unresolved.length}`)
  return { mapped, warnings, misses, unresolved }
}

// —— Pass 2: background cascade over the pass-1 misses ——————————————————————————————————————
// Only the pass-1 'nodata' misses, re-run through the V2–V4 cascade (skipV1: V1 already ran and
// missed in pass 1) on the long 60s timeout, at concurrency 3 (PASS2_CONCURRENCY). Each of these
// lookups spends its time idle-waiting on SoundNet's slow fallback path, so running a few at once
// doesn't meaningfully raise the request rate against the shared PAIR_DELAY pacer. Each resolved
// track streams out through onTrack for the map's entrance animation.
//
// Cancellation: pass 2 stops as soon as `signal` aborts (the user navigated away). We stop
// scheduling new batches and drop any result that lands after the abort — no in-flight state is
// persisted or resumed. A lookup already in flight can't be cancelled mid-request (its own timeout
// bounds it), but its result is simply discarded rather than plotted.
//
// Returns { mapped, warnings, unresolved, aborted }. unresolved holds the misses that still
// failed the full cascade (terminal — surfaced in reconciliation).
export async function runImportPass2(misses, { onTrack = () => {}, onProgress = () => {}, signal } = {}) {
  const startedAt = Date.now()
  const total = misses.length
  const mapped = []
  const warnings = []
  const unresolved = []
  let done = 0

  for (let i = 0; i < misses.length; i += PASS2_CONCURRENCY) {
    if (signal?.aborted) break
    const batch = misses.slice(i, i + PASS2_CONCURRENCY)
    await Promise.all(
      batch.map(async ({ entry }) => {
        if (signal?.aborted) return
        const result = await processEntry(entry, { timeoutMs: PASS2_TIMEOUT_MS, v1Only: false, skipV1: true })
        // A result that arrives after the user left is thrown away — pass 2 has stopped.
        if (signal?.aborted) return
        if (result.track) {
          mapped.push(result.track)
          if (result.warning) warnings.push(result.warning)
          onTrack(result.track)
        } else {
          unresolved.push(result.unresolved)
        }
        done += 1
        onProgress({ current: done, total, remaining: total - done, name: labelFor(entry) })
      }),
    )
    // Pacer between pass-2 batches. Skip the trailing wait after the last batch.
    if (i + PASS2_CONCURRENCY < misses.length && !signal?.aborted) await sleep(PAIR_DELAY)
  }

  // Which V-slot produced each pass-2 hit — the cascade earns its keep here (V2–V4), unlike pass 1
  // which only ever fires V1. Cache hits (no _meta) are tallied apart.
  const hitDist = { V1: 0, V2: 0, V3: 0, V4: 0 }
  let cachedHits = 0
  for (const t of mapped) {
    const vi = t._meta?.variationIndex
    if (vi >= 1 && vi <= 4) hitDist[`V${vi}`]++
    else cachedHits++
  }
  // Wall-clock duration so the concurrency/skip-V1 speedup is measurable against the hit counts.
  const elapsedMs = Date.now() - startedAt
  console.log(
    `[drift] import pass 2 (V2+ cascade, concurrency ${PASS2_CONCURRENCY}) — hits:${mapped.length} / ${total} retried` +
      ` | V1:${hitDist.V1} V2:${hitDist.V2} V3:${hitDist.V3} V4:${hitDist.V4} cached:${cachedHits}` +
      ` | still-unresolved:${unresolved.length} | ${(elapsedMs / 1000).toFixed(1)}s${signal?.aborted ? ' | ABORTED' : ''}`,
  )
  return { mapped, warnings, unresolved, aborted: signal?.aborted ?? false }
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
