import { supabase } from './supabase'
import { getAudioFeatures } from './soundnet'
import { searchItunes, getVerifiedItunesMatch } from './itunes'
import { titlesMatch, titleSimilarity } from './match'

// Parses "Artist – Title" or "Artist - Title" into { artist, title }
export function parseTrackString(input) {
  const match = input.match(/^(.+?)\s[–\-]\s(.+)$/)
  if (!match) throw new Error(`Cannot parse track: "${input}"`)
  return { artist: match[1].trim(), title: match[2].trim() }
}

// Parse a "Artist – Title" string, then analyze. Thin wrapper over analyzeTrackParts.
export async function analyzeTrack(trackString, opts = {}) {
  const { artist, title } = parseTrackString(trackString)
  return analyzeTrackParts(artist, title, opts)
}

// —— Query variation generators ——————————————————————————————————————————————————
// Each transform addresses a common SoundNet miss pattern. The two levers that consistently
// help are taking the primary artist (SoundNet expects one artist; Spotify oEmbed returns
// "Artist1, Artist2") and stripping version/collab noise off the title. Diacritic folding is a
// last resort only: the probe (scripts/probe-output.json) found SoundNet matches accented
// spellings FAST but stalls 42–45s on folded ones, so it sits in the final tier (Tier 5),
// fired only after every accented variation has already missed.

// Primary artist: the text before the first comma, in its original case. Nothing else is
// split off (no feat./&/slash handling) — a comma is the only reliable multi-artist delimiter
// Spotify emits, and over-splitting risks dropping a real part of a single artist's name.
function primaryArtist(artist) {
  return artist.split(',')[0].trim()
}

// Tier 3 title: drop a "(feat. …)" / "(ft. …)" / "(featuring …)" parenthetical (anywhere in the
// title), preserving case, diacritics, and any version suffix. Narrower than Tier 4 on purpose —
// it removes only the collaboration credit, not the mix/edit descriptor.
function stripFeat(title) {
  return title.replace(/\s*\((?:feat\.?|ft\.?|featuring)\b[^)]*\)/gi, '').trim()
}

// Tier 4 title: drop everything from the first " - " onward. This strips the trailing version
// descriptor DJ catalogs append after a hyphen — "Extended Mix", "Radio Edit", "Original Mix",
// "<Artist> Remix", etc. — leaving the base title. Case and diacritics are preserved.
function stripAfterDash(title) {
  return title.replace(/\s-\s.*$/, '').trim()
}

// Tier 5 artist: fold diacritics to ASCII. NFKD splits an accented character into its base letter
// plus a combining mark, then we remove the combining marks (Unicode range U+0300–U+036F), so
// "Rebūke" → "Rebuke", "Tiësto" → "Tiesto". Last-resort only (see the probe note above).
function stripDiacritics(str) {
  return str.normalize('NFKD').replace(/[̀-ͯ]/g, '')
}

// Ordered retry variations (Tiers 2–5; Tier 1 is the unmodified original, prepended in
// runCascade). Each label is a STABLE identifier persisted to tracks.resolved_via, so it names
// the transform, not a slot number. Deduplication against the original (and prior variants)
// happens in runCascade so identical queries never consume rate-limit budget.
//
//   Tier 2: primary artist + full title
//   Tier 3: primary artist + title with "(feat. …)" removed
//   Tier 4: primary artist + title with everything after " - " removed (version suffix)
//   Tier 5: primary artist with diacritics folded to ASCII + Tier 4 title — ONLY when folding
//           actually changes the artist string (see gate below).
function buildRetryVariations(artist, title) {
  const aPrimary = primaryArtist(artist)
  const tNoFeat  = stripFeat(title)
  const tNoDash  = stripAfterDash(title)     // Tier 4 title, reused by Tier 5
  const aFolded  = stripDiacritics(aPrimary)
  const variations = [
    { label: 'tier2_primary_artist',  artist: aPrimary, title            },
    { label: 'tier3_strip_feat',      artist: aPrimary, title: tNoFeat    },
    { label: 'tier4_strip_version',   artist: aPrimary, title: tNoDash    },
  ]
  // Tier 5 gate: only fold diacritics when doing so actually changes the primary artist string
  // (i.e. it contains non-ASCII characters that NFKD collapses — "Rebūke" → "Rebuke"). If folding
  // is a no-op the query would be byte-identical to Tier 4, so firing it buys nothing and — per the
  // probe note above — risks a 45s stall on the folded spelling. No diacritics → no Tier 5 → the
  // cascade ends at Tier 4 and the track is marked unresolved immediately.
  if (aFolded !== aPrimary) {
    variations.push({ label: 'tier5_fold_diacritics', artist: aFolded, title: tNoDash })
  }
  return variations
}

const RETRY_DELAY_MS = 300
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Cascade: try original (Tier 1) + up to 4 variations (Tiers 2–5), with iTunes corroboration at
// each SoundNet hit.
//
// Short-circuit policy: stop the moment SoundNet returns an accepted hit. Advance to the
// next variation on a "no exact match" signal — a genuine miss (200 + error body) OR a
// timeout (at the 6s threshold a timeout reliably means no exact match; see soundnet.js).
// A rate-limit, transport, or HTTP error IS transient: firing more variations only deepens
// the 30-second 429 penalty, so we halt the cascade and let the track go unresolved.
//
// Corroboration rules (per hit):
//   iTunes no result → accept (underground/niche track iTunes doesn't carry)
//   iTunes title matches → accept (corroborated)
//   iTunes title differs → reject this variation and continue to the next one
//
// Duration guard (Spotify imports only): if spotifyDuration is provided, every accepted hit
// is also checked against SoundNet's returned duration. Delta > 15s → reject and continue.
// This catches SoundNet returning a different version (e.g. extended mix) on the first try.
//
// Returns { features, itunes, usedArtist, usedTitle, retriedCount, variationIndex, resolvedVia,
// variations }. variationIndex is the 1-based index of the step that produced the accepted hit
// (null on failure) so per-variation hit rate can be measured. resolvedVia is that step's stable
// tier label (tier1_full … tier5_fold_diacritics; null on failure), persisted to
// tracks.resolved_via. variations is the ordered list of
// unique {artist, title} queries actually attempted (hover detail on unresolved rows).
// itunes is always resolved before return (used for album art even on failure).
// Does NOT touch Supabase — the caller owns caching so failed variants aren't stored.
//
// v1Only (import pass 1): run ONLY the unmodified original (Tier 1) and stop — no variation cascade.
// This is a gate on how many of the existing steps run, NOT a change to the Tier 2–5 variation logic
// or the acceptance/dedup rules below: a Tier 1 miss simply returns unresolved so pass 2 can retry
// it later with the full cascade. Everything else (corroboration, duration guard, self-verify) is
// identical whether one step runs or five.
//
// skipV1 (import pass 2): pass 1 already ran Tier 1 for every track and it missed, so re-running the
// identical query here would just burn a full timeout before reaching a variation that could help.
// Begin the cascade at Tier 2. Dedup is preserved: Tier 1's query string is pre-seeded into `tried`,
// so any later variation that collapses to the same query as Tier 1 is skipped rather than fired as
// a duplicate — exactly as if Tier 1 had run. Mutually exclusive with v1Only; the variation logic,
// acceptance, and dedup rules are untouched.
async function runCascade(artist, title, spotifyDuration = null, timeoutMs = undefined, v1Only = false, skipV1 = false, acceptVersion = false) {
  console.log(`[drift] [cascade] "${artist}" – "${title}"${v1Only ? ' (Tier 1 only)' : skipV1 ? ' (Tier 2+)' : ''}`)

  // iTunes starts immediately and runs in parallel with SoundNet calls.
  // We only await it when a SoundNet hit arrives — so parallel time is free.
  const itunesPromise = searchItunes(artist, title)
  let itunes = null
  let itunesSettled = false

  const resolveItunes = async () => {
    if (!itunesSettled) { itunes = await itunesPromise; itunesSettled = true }
    return itunes
  }

  // Full step list, each tagged with its fixed tier slot (1–5). Tier 1 is the unmodified original;
  // Tiers 2–5 are the variations. Pass 1 (v1Only) runs just Tier 1 — the fast exact-match probe.
  // Pass 2 (skipV1) begins at Tier 2 (Tier 1 already ran in pass 1) while still deduping later
  // variations against Tier 1's query.
  const v1Step = { slot: 1, label: 'tier1_full', artist, title }
  const variationSteps = buildRetryVariations(artist, title).map((v, i) => ({ slot: i + 2, ...v }))
  const steps = v1Only
    ? [v1Step]
    : skipV1
      ? variationSteps
      : [v1Step, ...variationSteps]

  const tried = new Set()
  const variations = []   // ordered unique {artist, title} actually queried — hover detail
  const firedSlots = []   // the tier-slot indices (1–5) that ran as distinct queries — for logs
  let retriedCount = 0
  // First SoundNet hit rejected purely by the duration guard, if any. When the whole cascade fails
  // this lets the caller tell "SoundNet had the track but at a different length" (→ a version
  // mismatch) apart from "SoundNet returned nothing at all" (→ no audio data). Searched-vs-matched
  // plus both durations, pre-formatted for the reconciliation panel.
  let durationReject = null

  // Pass 2 skips firing V1 but must still dedup against it: pre-seed V1's query so any later
  // variation that collapses to the same string is skipped, not re-fired as a duplicate.
  if (skipV1) tried.add(`${artist}|${title}`)

  for (const step of steps) {
    const index = step.slot   // fixed 1-based tier slot, logged on hit for per-tier hit rate
    const isOrig = step.slot === 1
    const key = `${step.artist}|${step.title}`
    const pad = step.label.padEnd(22)

    if (tried.has(key)) {
      // A duplicate query — e.g. Tier 3 (strip_feat) == Tier 2 (primary+full) when the title has
      // no "(feat. …)", Tier 4 (strip_version) == Tier 3 when there's no " - " suffix, or Tier 5
      // (fold_diacritics) == Tier 4 when the primary artist has no diacritics. Dedup and ADVANCE to
      // the next slot; this is NOT a halt, and any genuinely-different later variation still runs.
      // For a comma-containing artist, Tier 2 is always distinct from Tier 1, so the primary-artist
      // split is always attempted.
      console.log(`[drift]   ${pad} deduped (same query as an earlier variation) — advancing`)
      continue
    }
    tried.add(key)
    variations.push({ artist: step.artist, title: step.title })
    firedSlots.push(index)

    if (!isOrig) {
      retriedCount++
      await sleep(RETRY_DELAY_MS)
      console.log(`[drift]   ${pad} try   "${step.artist}" – "${step.title}"`)
    }

    // SoundNet lookup
    let features
    try {
      features = await getAudioFeatures(step.artist, step.title, { timeoutMs })
    } catch (err) {
      // "No exact match" — a genuine miss or a timeout — advances the cascade to the next
      // variation. Rate-limit / transport / HTTP errors are transient; queuing another
      // variation would just deepen a 429 penalty, so halt and leave the track unresolved.
      if (err.kind === 'miss' || err.kind === 'timeout') {
        console.log(`[drift]   ${pad} SoundNet ${err.kind} — next variation  (${err.message})`)
        continue
      }
      console.log(`[drift]   ${pad} SoundNet ${err.kind ?? 'error'} — halting cascade  (${err.message})`)
      break
    }

    // SoundNet hit — corroborate with iTunes before accepting
    await resolveItunes()
    const foundTitle = itunes?.trackName

    // User override ("Use this version"): accept the FIRST SoundNet hit as-is, skipping the duration
    // guard AND the iTunes corroboration below. The user has already seen exactly what SoundNet
    // matched (the version-mismatch row) and chosen to keep it, so second-guessing it would be wrong.
    if (acceptVersion) {
      console.log(`[drift]   ${pad} SoundNet hit — accepted by user override (Use this version) [variation ${index}]`)
      return { features, itunes, usedArtist: step.artist, usedTitle: step.title, retriedCount: isOrig ? 0 : retriedCount, variationIndex: index, resolvedVia: step.label, variations }
    }

    // Duration guard: reject any SoundNet result whose duration deviates by more than 15s from a
    // reference — it's a different version. Spotify's duration is the preferred reference; when the
    // import didn't supply one (spotifyDuration null), fall back to the resolved iTunes duration.
    // Same 15s threshold, same reject behavior regardless of source. When NEITHER reference is
    // available there's nothing to check against: accept the hit but mark it _unverifiedDuration
    // (underscore-prefixed so featuresToStore strips it — internal flag, never written to the DB).
    const snDur = features.duration
    const itunesDur = itunes?.durationMs != null ? itunes.durationMs / 1000 : null
    const refDur = spotifyDuration ?? itunesDur
    const refSource = spotifyDuration != null ? 'Spotify' : itunesDur != null ? 'iTunes' : null
    if (refDur != null) {
      if (snDur != null && Math.abs(snDur - refDur) > 15) {
        console.log(`[drift]   ${pad} rejected (duration mismatch: ${refSource} ${fmtDuration(refDur)} vs SoundNet ${fmtDuration(snDur)})`)
        // Remember the first duration-guard rejection so a cascade that never lands can be reported
        // as a version mismatch rather than a plain miss. "Matched" prefers SoundNet's own returned
        // metadata, falling back to the query we sent.
        if (!durationReject) {
          durationReject = {
            searchedArtist: artist,
            searchedTitle: title,
            matchedArtist: features._matchedArtist ?? step.artist,
            matchedTitle: features._matchedTitle ?? step.title,
            soundnetDurationFmt: fmtDuration(snDur),
            referenceDurationFmt: fmtDuration(refDur),
            referenceSource: refSource,
          }
        }
        continue
      }
      console.log(`[drift]   ${pad} duration reference: ${refSource} ${fmtDuration(refDur)}`)
    } else {
      console.log(`[drift]   ${pad} duration unverified (no Spotify or iTunes reference) — accepting`)
      features._unverifiedDuration = true
    }

    if (foundTitle == null) {
      // No iTunes coverage — self-verify before accepting. Compare SoundNet's matched
      // metadata (or the sent query as fallback) against the original request. Catches
      // cases where SoundNet's fuzzy engine matched a completely unrelated track.
      const svArtist = features._matchedArtist ?? step.artist
      const svTitle  = features._matchedTitle  ?? step.title
      const artistOk = artist.toLowerCase().includes(svArtist.toLowerCase()) ||
                       svArtist.toLowerCase().includes(artist.toLowerCase())
      const titleOk  = titlesMatch(title, svTitle)
      if (artistOk && titleOk) {
        console.log(`[drift]   ${pad} SoundNet hit, iTunes no coverage, self-verified → accepted [hit variation ${index}]`)
        return { features, itunes, usedArtist: step.artist, usedTitle: step.title, retriedCount: isOrig ? 0 : retriedCount, variationIndex: index, resolvedVia: step.label, variations }
      }
      console.log(`[drift]   ${pad} SoundNet hit, iTunes no coverage, SoundNet mismatch → rejected`)
      continue
    }

    if (titlesMatch(title, foundTitle)) {
      console.log(`[drift]   ${pad} SoundNet hit, iTunes confirmed "${foundTitle}" → accepted [hit variation ${index}]`)
      return { features, itunes, usedArtist: step.artist, usedTitle: step.title, retriedCount: isOrig ? 0 : retriedCount, variationIndex: index, resolvedVia: step.label, variations }
    }

    // iTunes found a different song — but if the overlap is zero (completely unrelated song,
    // not a partial miss), check whether we sent SoundNet the exact requested title and got
    // back a real result with duration. Zero iTunes overlap + exact SoundNet query = iTunes
    // search is wrong, not SoundNet. Accept and log so it's auditable.
    const itunesOverlap = titleSimilarity(title, foundTitle)
    const sentExactTitle = titleSimilarity(title, step.title) >= 1.0
    if (itunesOverlap === 0 && sentExactTitle && features.duration != null) {
      console.log(`[drift]   ${pad} SoundNet hit, iTunes "${foundTitle}" zero overlap with "${title}", SoundNet query exact → accepted (iTunes search mismatch, SoundNet query exact) [hit variation ${index}]`)
      return { features, itunes, usedArtist: step.artist, usedTitle: step.title, retriedCount: isOrig ? 0 : retriedCount, variationIndex: index, resolvedVia: step.label, variations }
    }

    console.log(`[drift]   ${pad} SoundNet hit, iTunes "${foundTitle}" ≠ "${title}" (overlap ${itunesOverlap.toFixed(2)}) → rejected, next variation`)
  }

  // All steps exhausted without an accepted hit
  await resolveItunes()
  // Report DISTINCT queries actually attempted, out of the 5 tier slots — so a comma track whose
  // later tiers collapse into earlier slots still shows the primary split was tried, and a
  // comma+suffix track that reaches Tier 5 reports it. In pass 2 (skipV1), Tier 1 isn't counted; a
  // track whose every variation dedups to Tier 1 fires nothing here (firedSlots empty) → unresolved.
  const firedLabel = firedSlots.length ? `tier${firedSlots.join(', tier')}` : 'none'
  console.log(
    `[drift]   attempted ${variations.length} distinct quer${variations.length === 1 ? 'y' : 'ies'} of 5 tier slots (fired ${firedLabel}), none accepted → unresolved`,
  )
  return { features: null, itunes, usedArtist: artist, usedTitle: title, retriedCount, variationIndex: null, resolvedVia: null, variations, durationReject }
}

// Format seconds as M:SS for duration display
function fmtDuration(sec) {
  if (sec == null) return '?'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Escape SQL-LIKE metacharacters so a title containing % or _ (e.g. "50%") is matched literally by
// the ilike lookups below instead of being read as a wildcard — which would let one song's cache
// entry masquerade as another. Backslash is escaped first (it's ILIKE's default escape char).
function likeEscape(s) {
  return s.replace(/[\\%_]/g, '\\$&')
}

// Normalized cache lookup — case- and whitespace-insensitive to MATCH the DB's unique index on
// (lower(trim(artist)), lower(trim(name))). ilike gives case-insensitivity; trim() on the input
// mirrors the index's trim (stored values keep their display casing on purpose, so "Take Me to
// Church" and "Take Me To Church" resolve to the SAME row). Shared by the initial cache check and
// the insert-conflict recovery path so both agree with the index. .limit(1) tolerates any legacy
// duplicate rows that predate the index.
async function findCachedTrack(artist, title) {
  const { data: rows } = await supabase
    .from('tracks')
    .select('*')
    .ilike('artist', likeEscape(artist.trim()))
    .ilike('name', likeEscape(title.trim()))
    .limit(1)
  return rows?.[0] ?? null
}

// Core pipeline: cache check → SoundNet cascade → iTunes art+corroboration → Supabase upsert.
// Takes already-resolved artist/title so callers that resolved a Spotify URL (or have
// demo data) can reuse the same caching/dedup path without re-parsing a string.
//
// forceRefresh (per-track Retry / "Use this version"): skip the cache short-circuit and always run
// the cascade, then UPDATE the existing row in place. Bulk import leaves it false so cached hits
// stay fast. Cache hits otherwise require usable features (see the usableCache check below).
//
// Returns the Supabase row augmented with _meta: { versionWarning, retriedCount,
// variationIndex, resolvedVia, variations, durationReject } for the reconciliation layer. _meta is
// NOT stored in the DB (but resolved_via IS a real column on the row itself).
export async function analyzeTrackParts(artist, title, { delayMs = 0, spotifyArtUrl = null, spotifyDuration = null, timeoutMs, v1Only = false, skipV1 = false, acceptVersion = false, forceRefresh = false } = {}) {
  // Look up any existing row. Normalized (lower+trim) to match the unique index, so a
  // case/whitespace variant of an already-imported song reuses the same row instead of duplicating.
  // We ALWAYS fetch it (even under forceRefresh) so a re-run UPDATEs that row in place rather than
  // inserting a duplicate — see the update-vs-insert branch below.
  const cached = await findCachedTrack(artist, title)

  // Cache HIT only when the row carries USABLE features. A stored MISS must never short-circuit:
  //   • status 'unanalyzed'      — the pipeline's marker for "SoundNet returned nothing"
  //   • null bpm or null energy  — the two core fields a real SoundNet hit always includes; a row
  //                                missing either was never truly analyzed, whatever its status says
  // Either case falls through to the full tier cascade so the track gets a real lookup. forceRefresh
  // (per-track Retry / "Use this version") bypasses the cache unconditionally and re-runs.
  const usableCache =
    cached && cached.status !== 'unanalyzed' && cached.bpm != null && cached.energy != null
  if (!forceRefresh && usableCache) {
    console.log('[drift] cache hit:', cached.artist, '–', cached.name)
    return cached
  }
  if (forceRefresh && cached) {
    console.log('[drift] forced refresh — bypassing cache, re-running cascade for:', cached.artist, '–', cached.name)
  }

  // Stagger SoundNet calls to stay within rate limits — delay only on cache miss.
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))

  // Cascade handles SoundNet (original + variations) and iTunes corroboration together.
  // iTunes runs in parallel inside runCascade; result is always resolved before return.
  const cascade = await runCascade(artist, title, spotifyDuration, timeoutMs, v1Only, skipV1, acceptVersion)
  const { itunes } = cascade
  const features = cascade.features  // null if all variations failed/rejected
  // _matchedTitle/_matchedArtist are self-verification fields used inside runCascade only.
  // Strip them before writing to Supabase — they aren't DB columns.
  const featuresToStore = features
    ? Object.fromEntries(Object.entries(features).filter(([k]) => !k.startsWith('_')))
    : {}

  // Version flag (track-level, non-blocking): a hit accepted on a TITLE-ALTERING variation (Tier 3–5)
  // rather than the original — a stripped feat./version suffix, and/or folded diacritics — may be a
  // different cut (radio edit, extended mix, solo vs collab, etc.), so flag it for the user to verify;
  // the song still plots. Tier 2 is deliberately NOT flagged: it only splits the primary artist off a
  // multi-artist string (title untouched), which is almost always the exact same track, and with
  // automatic Pass 2 flagging every Tier-2 hit would flood the panel. resolved_via still records the
  // tier for provenance. A duration mismatch
  // (SoundNet vs iTunes >15s) is folded in as extra evidence when present, but is no longer REQUIRED
  // to raise the flag — the variation match itself is the trigger now.
  let versionWarning = null
  if (features && cascade.variationIndex > 2) {
    const soundnetDur = features.duration
    const itunesDur = itunes?.durationMs != null ? itunes.durationMs / 1000 : null
    const durationMismatch = soundnetDur != null && itunesDur != null && Math.abs(soundnetDur - itunesDur) > 15
    versionWarning = {
      message: 'Matched a different version — verify this is correct',
      variationIndex: cascade.variationIndex, // which tier slot hit (2–5) — audit/debug context
      resolvedVia: cascade.resolvedVia,       // the winning tier's stable label — audit/debug context
      // What was searched (the original request) vs. what SoundNet matched (the variation query).
      originalArtist: artist,
      originalTitle: title,
      matchedQuery: { artist: cascade.usedArtist, title: cascade.usedTitle },
      // Duration detail only when the two sources actually disagree — keeps the card's duration line
      // meaningful (a pure variation match with matching durations shows no duration figures).
      ...(durationMismatch
        ? {
            soundnetDuration: soundnetDur,
            itunesDuration: itunesDur,
            soundnetDurationFmt: fmtDuration(soundnetDur),
            itunesDurationFmt: fmtDuration(itunesDur),
          }
        : {}),
    }
    console.warn(
      `[drift] version flag: matched on tier ${cascade.variationIndex} (${cascade.resolvedVia}) — searched "${artist} – ${title}", ` +
        `SoundNet matched "${cascade.usedArtist} – ${cascade.usedTitle}"` +
        (durationMismatch ? ` (iTunes ${fmtDuration(itunesDur)} vs SoundNet ${fmtDuration(soundnetDur)})` : ''),
    )
  }

  // Album art + 30-second preview (Slice 13) both come from ONE verified iTunes result — the match
  // that passes artist/title/duration verification (limit=10, see getVerifiedItunesMatch). Tying them
  // together means art and preview can never disagree: if the best candidate fails the duration check
  // and nothing else verifies, BOTH are null (no cover for a rejected preview).
  const { albumArtUrl: verifiedArt, previewUrl: verifiedPreview } = await getVerifiedItunesMatch(
    artist,
    title,
    { album: cached?.album ?? null, duration: features?.duration ?? null },
  )

  // Art: the verified iTunes/Deezer cover, then a trustworthy Spotify-provided cover, then any cached
  // art. No loose limit=1 fallback — a wrong-result cover is worse than the placeholder. Uses
  // truthiness (not ??) so an empty-string art never wins over a real fallback. null → placeholder.
  let resolvedArt = null
  if (verifiedArt) resolvedArt = verifiedArt
  else if (spotifyArtUrl) resolvedArt = spotifyArtUrl
  else if (cached?.album_art_url) resolvedArt = cached.album_art_url

  // Preview: the verified iTunes/Deezer URL, then any cached URL. null → play button greyed out.
  const resolvedPreview = verifiedPreview ?? cached?.preview_url ?? null

  const track = {
    name: title,
    artist,
    album_art_url: resolvedArt,
    preview_url: resolvedPreview,
    ...(features ? featuresToStore : {}),
    // Which cascade tier resolved this track (tier1_full … tier5_fold_diacritics). Cached on the
    // row so we can see which query variant SoundNet actually matched. Only set on a hit.
    ...(features ? { resolved_via: cascade.resolvedVia } : {}),
    source: 'soundnet',
    analyzed_at: new Date().toISOString(),
    status: features ? (features.status ?? 'analyzed') : 'unanalyzed',
    // Persisted override flag: set only when the user hit "Use this version" and a hit was accepted,
    // recording that they knowingly kept a match the duration guard would have rejected. NOT
    // underscore-prefixed, so it survives featuresToStore and is written to the DB (needs a
    // `user_accepted_version boolean` column on `tracks`).
    ...(acceptVersion && features ? { user_accepted_version: true } : {}),
  }

  // UPDATE existing row if one already exists (avoids duplicate inserts on retry).
  let savedRow
  if (cached) {
    const { data, error } = await supabase
      .from('tracks')
      .update(track)
      .eq('id', cached.id)
      .select()
      .single()
    if (error) throw new Error(`Supabase update failed: ${error.message}`)
    console.log('[drift] updated track id:', data.id)
    savedRow = data
  } else {
    const { data, error } = await supabase
      .from('tracks')
      .insert(track)
      .select()
      .single()
    if (error) {
      // The unique index on (lower(trim(artist)), lower(trim(name))) rejects a duplicate with
      // 23505. That means a concurrent import — or a case/whitespace variant that raced past the
      // cache lookup above — already inserted this song. Recover by returning the row that won the
      // race instead of failing the import. (A functional/expression index can't be a PostgREST
      // .upsert onConflict target, so we insert-then-recover rather than ON CONFLICT DO UPDATE.)
      if (error.code === '23505') {
        const existing = await findCachedTrack(artist, title)
        if (!existing) throw new Error(`Supabase insert conflicted but no existing row found: ${error.message}`)
        console.log('[drift] insert conflict, reusing existing track id:', existing.id)
        savedRow = existing
      } else {
        throw new Error(`Supabase insert failed: ${error.message}`)
      }
    } else {
      console.log('[drift] cached track id:', data.id)
      savedRow = data
    }
  }

  // Attach reconciliation metadata — not stored in Supabase.
  return {
    ...savedRow,
    _meta: {
      versionWarning,
      retriedCount: cascade.retriedCount,
      variationIndex: cascade.variationIndex,
      resolvedVia: cascade.resolvedVia,
      variations: cascade.variations,
      // Present only on a failed cascade where a SoundNet hit existed but every hit was rejected by
      // the duration guard — lets the reconciliation panel show "Found a different version" (searched
      // vs matched + both durations) instead of the plain "no audio data" line.
      durationReject: cascade.durationReject ?? null,
    },
  }
}
