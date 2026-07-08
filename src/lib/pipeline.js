import { supabase } from './supabase'
import { getAudioFeatures } from './soundnet'
import { searchItunes, getAlbumArt } from './itunes'
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
// Each transform addresses a common SoundNet miss pattern.
//
// comma-split is distinct from strip-feat: Spotify oEmbed returns multi-artist tracks
// as "Artist1, Artist2" with NO "feat." indicator, so strip-feat leaves them unchanged.
// comma-split takes the first comma-delimited segment in its original case, which is what
// SoundNet expects (e.g. "Kayzo" not "kayzo, riot" or "kayzo").

function stripFeaturedArtist(artist) {
  return artist
    .replace(/\s*\b(feat\.?|ft\.?|featuring|with)\b\s+.*/i, '')
    .replace(/\s+[x&]\s+.*/i, '')
    .trim()
}

function stripParentheticals(title) {
  return title
    .replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// Splits on comma, semicolon, slash, or feat./ft. indicators and returns the first segment.
// Used for both comma-split (original case) and all-combined (lowercased) variations.
function firstArtistOnly(artist) {
  return artist
    .split(/\s*[,;\/]\s*|\s+(?:feat\.?|ft\.?|featuring|with|x|&)\s+/i)[0]
    .trim()
}

// Ordered retry variations, each with a label for console logging.
// Deduplication against the original (and prior variants) happens in runCascade
// so identical queries never consume rate-limit budget.
function buildRetryVariations(artist, title) {
  const aLow        = artist.toLowerCase()
  const tLow        = title.toLowerCase()
  const aStrip      = stripFeaturedArtist(artist)
  const tStrip      = stripParentheticals(title)
  const aParens     = stripParentheticals(artist)     // "Malaa (Alter Ego)" → "Malaa"
  const aFirst      = firstArtistOnly(artist)         // original case — critical for SoundNet
  const aFirstClean = stripParentheticals(aFirst)     // comma-split then strip parens: "Malaa (Alter Ego), ÆON:MODE" → "Malaa"
  const aFirstLow   = aFirst.toLowerCase()
  const tStripLow   = tStrip.toLowerCase()
  return [
    { label: 'lowercase',          artist: aLow,        title: tLow      },
    { label: 'strip-feat',         artist: aStrip,      title            },
    { label: 'strip-parens',       artist,              title: tStrip    },
    { label: 'strip-artist-parens',artist: aParens,     title            }, // Spotify disambiguation tags in artist e.g. "Malaa (Alter Ego)"
    { label: 'comma-split',        artist: aFirst,      title            },
    { label: 'comma-clean',        artist: aFirstClean, title            }, // comma-split + strip artist parens combined
    { label: 'comma-split+low',    artist: aFirstLow,   title: tLow      },
    { label: 'all-combined',       artist: aFirstLow,   title: tStripLow },
  ]
}

const RETRY_DELAY_MS = 300
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Cascade: try original + up to 8 variations, with iTunes corroboration at each SoundNet hit.
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
// Returns { features, itunes, usedArtist, usedTitle, retriedCount, lastArtist, lastTitle }.
// itunes is always resolved before return (used for album art even on failure).
// Does NOT touch Supabase — the caller owns caching so failed variants aren't stored.
async function runCascade(artist, title, spotifyDuration = null) {
  console.log(`[drift] [cascade] "${artist}" – "${title}"`)

  // iTunes starts immediately and runs in parallel with SoundNet calls.
  // We only await it when a SoundNet hit arrives — so parallel time is free.
  const itunesPromise = searchItunes(artist, title)
  let itunes = null
  let itunesSettled = false

  const resolveItunes = async () => {
    if (!itunesSettled) { itunes = await itunesPromise; itunesSettled = true }
    return itunes
  }

  // Full step list: original first, then named variations.
  const steps = [
    { label: 'orig',         artist,      title       },
    ...buildRetryVariations(artist, title),
  ]

  const tried = new Set()
  let lastArtist = artist
  let lastTitle = title
  let retriedCount = 0

  for (const step of steps) {
    const isOrig = step.label === 'orig'
    const key = `${step.artist}|${step.title}`
    const pad = step.label.padEnd(14)

    if (tried.has(key)) {
      console.log(`[drift]   ${pad} skip  (duplicate)`)
      continue
    }
    tried.add(key)

    if (!isOrig) {
      retriedCount++
      lastArtist = step.artist
      lastTitle = step.title
      await sleep(RETRY_DELAY_MS)
      console.log(`[drift]   ${pad} try   "${step.artist}" – "${step.title}"`)
    }

    // SoundNet lookup
    let features
    try {
      features = await getAudioFeatures(step.artist, step.title)
    } catch (err) {
      console.log(`[drift]   ${pad} SoundNet miss  (${err.message})`)
      continue
    }

    // SoundNet hit — corroborate with iTunes before accepting
    await resolveItunes()
    const foundTitle = itunes?.trackName

    // Duration guard: if we have a Spotify duration, reject any SoundNet result whose
    // duration deviates by more than 15 seconds — it's a different version.
    const snDur = features.duration
    if (spotifyDuration != null && snDur != null && Math.abs(snDur - spotifyDuration) > 15) {
      console.log(`[drift]   ${pad} rejected (duration mismatch: Spotify ${fmtDuration(spotifyDuration)} vs SoundNet ${fmtDuration(snDur)})`)
      continue
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
        console.log(`[drift]   ${pad} SoundNet hit, iTunes no coverage, self-verified → accepted`)
        return { features, itunes, usedArtist: step.artist, usedTitle: step.title, retriedCount: isOrig ? 0 : retriedCount, lastArtist: step.artist, lastTitle: step.title }
      }
      console.log(`[drift]   ${pad} SoundNet hit, iTunes no coverage, SoundNet mismatch → rejected`)
      continue
    }

    if (titlesMatch(title, foundTitle)) {
      console.log(`[drift]   ${pad} SoundNet hit, iTunes confirmed "${foundTitle}" → accepted`)
      return { features, itunes, usedArtist: step.artist, usedTitle: step.title, retriedCount: isOrig ? 0 : retriedCount, lastArtist: step.artist, lastTitle: step.title }
    }

    // iTunes found a different song — but if the overlap is zero (completely unrelated song,
    // not a partial miss), check whether we sent SoundNet the exact requested title and got
    // back a real result with duration. Zero iTunes overlap + exact SoundNet query = iTunes
    // search is wrong, not SoundNet. Accept and log so it's auditable.
    const itunesOverlap = titleSimilarity(title, foundTitle)
    const sentExactTitle = titleSimilarity(title, step.title) >= 1.0
    if (itunesOverlap === 0 && sentExactTitle && features.duration != null) {
      console.log(`[drift]   ${pad} SoundNet hit, iTunes "${foundTitle}" zero overlap with "${title}", SoundNet query exact → accepted (iTunes search mismatch, SoundNet query exact)`)
      return { features, itunes, usedArtist: step.artist, usedTitle: step.title, retriedCount: isOrig ? 0 : retriedCount, lastArtist: step.artist, lastTitle: step.title }
    }

    console.log(`[drift]   ${pad} SoundNet hit, iTunes "${foundTitle}" ≠ "${title}" (overlap ${itunesOverlap.toFixed(2)}) → rejected, next variation`)
  }

  // All steps exhausted without an accepted hit
  await resolveItunes()
  console.log(`[drift]   all ${retriedCount} unique variation(s) tried, none accepted → unresolved`)
  return { features: null, itunes, usedArtist: artist, usedTitle: title, retriedCount, lastArtist, lastTitle }
}

// Format seconds as M:SS for duration display
function fmtDuration(sec) {
  if (sec == null) return '?'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Core pipeline: cache check → SoundNet cascade → iTunes art+corroboration → Supabase upsert.
// Takes already-resolved artist/title so callers that resolved a Spotify URL (or have
// demo data) can reuse the same caching/dedup path without re-parsing a string.
//
// Returns the Supabase row augmented with _meta: { versionWarning, retriedCount,
// lastArtist, lastTitle } for the reconciliation layer. _meta is NOT stored in the DB.
export async function analyzeTrackParts(artist, title, { delayMs = 0, spotifyArtUrl = null, spotifyDuration = null } = {}) {
  // Return cached result if available (.limit(1) tolerates duplicate rows gracefully)
  const { data: rows } = await supabase
    .from('tracks')
    .select('*')
    .eq('artist', artist)
    .eq('name', title)
    .limit(1)

  const cached = rows?.[0] ?? null

  // Only trust the cache if analysis actually succeeded — unanalyzed records get retried.
  if (cached && cached.status !== 'unanalyzed') {
    console.log('[drift] cache hit:', cached.artist, '–', cached.name)
    return cached
  }

  // Stagger SoundNet calls to stay within rate limits — delay only on cache miss.
  if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))

  // Cascade handles SoundNet (original + variations) and iTunes corroboration together.
  // iTunes runs in parallel inside runCascade; result is always resolved before return.
  const cascade = await runCascade(artist, title, spotifyDuration)
  const { itunes } = cascade
  const features = cascade.features  // null if all variations failed/rejected
  // _matchedTitle/_matchedArtist are self-verification fields used inside runCascade only.
  // Strip them before writing to Supabase — they aren't DB columns.
  const featuresToStore = features
    ? Object.fromEntries(Object.entries(features).filter(([k]) => !k.startsWith('_')))
    : {}

  // Duration mismatch: variation succeeded + iTunes duration for original query differs >15s
  // → SoundNet likely matched a different version (radio edit, extended mix, etc.)
  let versionWarning = null
  if (features && cascade.retriedCount > 0) {
    const soundnetDur = features.duration
    const itunesDur = itunes?.durationMs != null ? itunes.durationMs / 1000 : null
    if (soundnetDur != null && itunesDur != null && Math.abs(soundnetDur - itunesDur) > 15) {
      versionWarning = {
        message: 'Matched a different version — verify this is correct',
        originalTitle: title,
        matchedQuery: { artist: cascade.usedArtist, title: cascade.usedTitle },
        soundnetDuration: soundnetDur,
        itunesDuration: itunesDur,
        soundnetDurationFmt: fmtDuration(soundnetDur),
        itunesDurationFmt: fmtDuration(itunesDur),
      }
      console.warn(
        `[drift] version mismatch: iTunes ${fmtDuration(itunesDur)} vs SoundNet ${fmtDuration(soundnetDur)}`,
      )
    }
  }

  // Album art resolution: the corroboration search's art (full-query iTunes hit) first, then a
  // Spotify-provided cover, then a dedicated cleaned-query lookup (iTunes → Deezer fallback) for the
  // over-stuffed queries that missed above, then any cached art. null → the music-note placeholder.
  const itunesArt = itunes?.albumArtUrl ?? null
  let resolvedArt = itunesArt ?? spotifyArtUrl ?? null
  if (!resolvedArt) resolvedArt = await getAlbumArt(artist, title)
  resolvedArt = resolvedArt ?? cached?.album_art_url ?? null

  const track = {
    name: title,
    artist,
    album_art_url: resolvedArt,
    ...(features ? featuresToStore : {}),
    source: 'soundnet',
    analyzed_at: new Date().toISOString(),
    status: features ? (features.status ?? 'analyzed') : 'unanalyzed',
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
    if (error) throw new Error(`Supabase insert failed: ${error.message}`)
    console.log('[drift] cached track id:', data.id)
    savedRow = data
  }

  // Attach reconciliation metadata — not stored in Supabase.
  return {
    ...savedRow,
    _meta: {
      versionWarning,
      retriedCount: cascade.retriedCount,
      lastArtist: cascade.lastArtist,
      lastTitle: cascade.lastTitle,
    },
  }
}
