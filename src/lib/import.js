import { parseTrackString, analyzeTrackParts } from './pipeline'
import { isSpotifyTrackUrl, resolveSpotifyUrl } from './oembed'

// Import orchestration: parse a pasted blob, resolve each line, analyze, and split results
// into mapped (plotted), warnings (version-mismatch flagged), and unresolved (shown on
// reconciliation).

// Two automatic passes. Pass 1 (runImport): every track, tier 1 (original artist+title) only, no
// cascade — a short 10s SoundNet timeout, concurrency 3; hits render on the map as they land. Pass 2
// (runImportPass2): the tier 2-5 cascade over every Pass-1 miss, on the SAME concurrency + timeout
// profile, hits plotting in place as they resolve while the user keeps exploring. Anything still
// unresolved after Pass 2 goes to the reconciliation panel; the per-track Retry (retryUnresolved)
// remains a manual escape hatch. PAIR_DELAY is the pacer gap between scheduled units.
const SWEEP_CONCURRENCY = 3
const SWEEP_TIMEOUT_MS = 10000
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
      // A cascade that found a SoundNet hit but rejected every one on the duration guard is a
      // version mismatch ('version'), not an empty result ('nodata'). durationReject carries the
      // searched-vs-matched detail + both durations for the reconciliation panel.
      const dr = track?._meta?.durationReject ?? null
      return {
        unresolved: {
          originalText: entry.originalText,
          artist,
          title,
          kind: dr ? 'version' : 'nodata',
          reason: dr ? 'found a different version' : 'no audio data available',
          // The panel prefills with the ORIGINAL artist/title (above). The variation list is
          // carried through only as hover detail so the user can see what was already tried.
          variations: track?._meta?.variations ?? [],
          // Distinct queries actually attempted, including the original (up to 4). Counting the
          // distinct set — not retriedCount — means a comma track whose V3/V4 dedup away still
          // shows the primary-artist split was tried, and a V4-reaching track can report 4.
          triedVariations: track?._meta?.variations?.length ?? 0,
          // Version-mismatch detail (kind 'version' only): searched vs matched, both durations.
          ...(dr
            ? {
                searchedArtist: dr.searchedArtist,
                searchedTitle: dr.searchedTitle,
                matchedArtist: dr.matchedArtist,
                matchedTitle: dr.matchedTitle,
                soundnetDurationFmt: dr.soundnetDurationFmt,
                referenceDurationFmt: dr.referenceDurationFmt,
                referenceSource: dr.referenceSource,
              }
            : {}),
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

// —— Fast V1-only import sweep ————————————————————————————————————————————————————————————
// Every parsed entry, V1 (original artist+title) only, on the short 10s SoundNet timeout, at
// concurrency 3. Hits stream out through onTrack the moment they resolve so the caller can plot
// them on the map as they land; onProgress reports {current,total,name} after each entry.
//
// Returns { mapped, warnings, unresolved }:
//   mapped     — track rows that resolved on V1 (already emitted via onTrack)
//   warnings   — version-mismatch warnings among those hits
//   unresolved — every entry that didn't resolve on tier 1, handed to runImportPass2 for the
//                automatic tier 2-5 pass: a genuine SoundNet miss (kind 'nodata'), a duration-guard
//                rejection (kind 'version'), an unparseable line ('unparseable'), or an unresolved
//                Spotify link ('url'). Pass 2 re-attempts the nodata/version ones; url/unparseable
//                pass straight through to the reconciliation panel (recoverable via per-track Retry).
export async function runImport(text, { onTrack = () => {}, onProgress = () => {} } = {}) {
  const entries = parseInput(text)
  const total = entries.length
  const mapped = []
  const warnings = []
  const unresolved = []
  let done = 0

  for (let i = 0; i < entries.length; i += SWEEP_CONCURRENCY) {
    const batch = entries.slice(i, i + SWEEP_CONCURRENCY)
    await Promise.all(
      batch.map(async (entry) => {
        const result = await processEntry(entry, { timeoutMs: SWEEP_TIMEOUT_MS, v1Only: true })
        if (result.track) {
          mapped.push(result.track)
          if (result.warning) warnings.push(result.warning)
          onTrack(result.track)
        } else {
          unresolved.push(result.unresolved)
        }
        done += 1
        onProgress({ current: done, total, name: labelFor(entry) })
      }),
    )
    if (i + SWEEP_CONCURRENCY < entries.length) await sleep(PAIR_DELAY)
  }

  console.log(`[drift] import (tier 1 only) — hits:${mapped.length} / ${total} | unresolved:${unresolved.length}`)
  return { mapped, warnings, unresolved }
}

// —— Automatic Pass 2: tier 2-5 cascade over Pass-1 misses ————————————————————————————————————
// Runs after the Pass-1 sweep, over the entries that missed tier 1. Same background profile as Pass 1
// (concurrency SWEEP_CONCURRENCY, per-request SWEEP_TIMEOUT_MS), but each entry goes through
// processEntry with skipV1:true so ONLY tiers 2-5 fire — tier 1 already ran and missed in Pass 1, and
// skipV1 dedups it out of the cascade. Hits stream through onTrack so the map fills in place while the
// user explores. The stored Pass-1 miss is an 'unanalyzed' row, so analyzeTrackParts' cache check
// falls through and the cascade genuinely re-runs (no forceRefresh needed); resolved rows UPDATE in
// place, never insert or delete.
//
// Only genuine SoundNet misses are re-attempted — kind 'nodata' (no audio data) and 'version' (a hit
// the duration guard rejected), both of which carry a resolved artist/title the cascade can vary.
// 'url' (Spotify oEmbed never yielded an artist/title) and 'unparseable' can't be helped by tier
// variation, so they pass through untouched in `skipped`.
//
// Returns { resolved, stillUnresolved, skipped, warnings, attempted }:
//   resolved        — count newly resolved by tiers 2-5 (already emitted via onTrack)
//   stillUnresolved — targets tiers 2-5 also couldn't resolve
//   skipped         — url/unparseable entries never attempted (pass straight through)
//   warnings        — version-mismatch warnings among the Pass-2 hits (a tier 2+ hit always raises one)
export async function runImportPass2(unresolved, { onTrack = () => {}, onProgress = () => {} } = {}) {
  const isTarget = (u) => (u.kind === 'nodata' || u.kind === 'version') && u.artist && u.title
  const targets = unresolved.filter(isTarget)
  const skipped = unresolved.filter((u) => !isTarget(u))
  const total = targets.length
  const stillUnresolved = []
  const warnings = []
  let done = 0

  for (let i = 0; i < targets.length; i += SWEEP_CONCURRENCY) {
    const batch = targets.slice(i, i + SWEEP_CONCURRENCY)
    await Promise.all(
      batch.map(async (u) => {
        const entry = { type: 'text', artist: u.artist, title: u.title, originalText: u.originalText }
        const result = await processEntry(entry, { timeoutMs: SWEEP_TIMEOUT_MS, skipV1: true })
        if (result.track) {
          if (result.warning) warnings.push(result.warning)
          // onTrack carries the originalText so the caller can drop the row from the unresolved list.
          onTrack(result.track, u.originalText)
        } else {
          stillUnresolved.push(result.unresolved)
        }
        done += 1
        onProgress({ current: done, total, name: labelFor(entry) })
      }),
    )
    if (i + SWEEP_CONCURRENCY < targets.length) await sleep(PAIR_DELAY)
  }

  console.log(`[drift] import pass 2 (tiers 2-5) — resolved:${total - stillUnresolved.length} / ${total} | still unresolved:${stillUnresolved.length}`)
  return { resolved: total - stillUnresolved.length, stillUnresolved, skipped, warnings, attempted: total }
}

// Manual per-track Retry gets a much longer SoundNet deadline than the bulk import (which
// stays at SOUNDNET_TIMEOUT_MS). The user is re-fetching one track on purpose, so it's worth
// waiting out a slow SoundNet response rather than treating it as a timeout "no exact match".
const RETRY_TIMEOUT_MS = 45000

// Re-analyze a single unresolved entry through the FULL tier cascade (Tier 1 → 5). The user may have
// edited the artist/title before retrying, and the edit itself is often the fix — so Tier 1 must fire
// on whatever string they submit (skipping it would dedup an unedited-shaped query down to zero fired
// variations, e.g. a no-comma/no-suffix title). The tradeoff: an UNEDITED retry re-fires the Tier 1
// that already missed during import before reaching the variations, but the deliberate 45s manual
// deadline absorbs that.
//
// forceRefresh is REQUIRED here: the import stored this track's miss as an 'unanalyzed' row, and even
// once features exist a Retry must re-run rather than be served the stale cached row — otherwise
// Retry is a silent no-op. analyzeTrackParts still UPDATEs that row in place (no new row, no delete).
// Returns the track row on success, else null.
export async function retryUnresolved(artist, title) {
  const track = await analyzeTrackParts(artist, title, { timeoutMs: RETRY_TIMEOUT_MS, forceRefresh: true })
  if (!track || track.status === 'unanalyzed') return null
  return track
}

// "Use this version" (reconciliation, version rows only): re-run the lookup on the ORIGINAL artist/
// title with acceptVersion, which accepts the first SoundNet hit as-is — the same match the duration
// guard rejected — and stamps user_accepted_version on the stored row. Returns the analyzed track, or
// null if SoundNet returns nothing this time (transient miss).
export async function acceptVersion(artist, title) {
  const track = await analyzeTrackParts(artist, title, { timeoutMs: RETRY_TIMEOUT_MS, acceptVersion: true, forceRefresh: true })
  if (!track || track.status === 'unanalyzed') return null
  return track
}
