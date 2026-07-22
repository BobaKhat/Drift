// iTunes Search API — free, no auth, browser CORS supported
// Replace 100x100 with 600x600 in returned URL for high-res art.

// Returns the best-match track { albumArtUrl, trackName, artistName } or null.
// trackName/artistName are the REAL matched metadata — used to corroborate SoundNet's
// fuzzy match (see src/lib/match.js).
export async function searchItunes(artist, title) {
  const term = encodeURIComponent(`${artist} ${title}`)
  const res = await fetch(`/api/itunes/search?term=${term}&entity=song&limit=1`)
  if (!res.ok) return null
  const data = await res.json()
  const r = data.results?.[0]
  if (!r) return null
  return {
    albumArtUrl: r.artworkUrl100 ? r.artworkUrl100.replace('100x100bb', '600x600bb') : null,
    trackName: r.trackName ?? null,
    artistName: r.artistName ?? null,
    durationMs: r.trackTimeMillis ?? null,
    previewUrl: r.previewUrl ?? null, // 30-second AAC preview (Slice 13 playback)
  }
}

// —— Album-art query cleaning ————————————————————————————————————————————————————————
// Art lookups (iTunes + Deezer) want the barest "first-artist title": extra artists and
// mix/version tags are the main cause of misses. This is intentionally separate from the
// corroboration search above, which keeps the full metadata to match SoundNet's result.
function firstArtist(artist) {
  return (artist || '').split(',')[0].trim()
}

function cleanTitle(title) {
  return (title || '')
    .replace(/[([][^)\]]*[)\]]/g, ' ')                       // drop (…) and […]
    .replace(/\b(extended mix|original mix|remix|edit)\b/gi, ' ') // drop version tags
    .replace(/\s-\s.*$/, ' ')                                // drop "- " and everything after
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// Bare "<firstArtist> <cleanTitle>" query used for both the iTunes and Deezer art lookups.
export function buildArtQuery(artist, title) {
  return `${firstArtist(artist)} ${cleanTitle(title)}`.trim()
}

async function itunesArtForQuery(query) {
  try {
    const res = await fetch(`/api/itunes/search?term=${encodeURIComponent(query)}&entity=song&limit=1`)
    if (!res.ok) return null
    const data = await res.json()
    const r = data.results?.[0]
    return r?.artworkUrl100 ? r.artworkUrl100.replace('100x100bb', '600x600bb') : null
  } catch {
    return null
  }
}

// Deezer public search (via the /api/deezer dev proxy). data[0].album.cover_medium is 300x300.
async function deezerArtForQuery(query) {
  try {
    const res = await fetch(`/api/deezer/search?q=${encodeURIComponent(query)}`)
    if (!res.ok) return null
    const data = await res.json()
    return data.data?.[0]?.album?.cover_medium ?? null
  } catch {
    return null
  }
}

// Album art for a track: clean the query, try iTunes, then fall back to Deezer. Returns a URL
// or null (caller shows the music-note placeholder + orange fallback glow).
export async function getAlbumArt(artist, title) {
  const query = buildArtQuery(artist, title)
  return (await itunesArtForQuery(query)) ?? (await deezerArtForQuery(query))
}

// —— 30-second preview URLs (Slice 13) ————————————————————————————————————————————————
// Same cleaned-query lookup as album art, but pulling the preview stream instead: iTunes
// `previewUrl` (AAC) first, then Deezer's `preview` (MP3). Both send Access-Control-Allow-Origin: *,
// so they play cross-origin and feed the Web Audio analyser. Returns a URL or null (no preview).
//
// ACCURACY: a bare "artist title" query with limit=1 grabs whatever iTunes ranks first, which is
// frequently the wrong song by a different artist (e.g. "John Summit Lights Go Out" → a Jauz
// track). Instead we pull limit=10 and pick the best result by scoring each candidate against the
// EXPECTED artist(s)+title, cross-checking duration, and verifying at least one artist actually
// matches. No preview is better than a wrong preview — if nothing survives, we return null and the
// deck greys out the play button.

// Split an artist string into individual names for matching: "A, B & C feat. D" →
// ["a","b","c","d"] (lowercased). Handles commas, ampersands, and common feature markers.
function splitArtistNames(artist) {
  return (artist || '')
    .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bx\b|\bvs\.?\b|\band\b/i)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

// Title lowercased and stripped of parentheticals/brackets, for loose containment checks
// (so "Lights Go Out (Extended Mix)" still matches an iTunes "Lights Go Out").
function normalizeTitleForMatch(title) {
  return (title || '')
    .replace(/[([][^)\]]*[)\]]/g, ' ') // drop (…) and […]
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toLowerCase()
}

// —— Version-word filter (whitelist-aware) ——————————————————————————————————————————————————————————
// A result is a DIFFERENT release from the one searched when its trackName carries a version marker
// (remix, edit, cover, …). But legitimate EDM originals are routinely listed as "(Original Mix)" /
// "(Extended Mix)" — the canonical release, not a derivative — so those (and bare "Original"/
// "Extended") are WHITELISTED: stripped from the name BEFORE the check. Any version word that survives
// the strip means a genuinely different version → reject.
const VERSION_WHITELIST = /\b(original mix|extended mix|original|extended)\b/gi
const VERSION_WORDS =
  /\b(remix|bootleg|cover|slowed|reverb|sped up|acoustic|nightcore|hardstyle|vip|dub|radio|edit|instrumental|mixed|mix|version)\b/i

// True when a trackName (or the search query) names a rejectable alternate version. Strip the
// whitelisted "(Original/Extended Mix)" markers first, THEN test for any remaining version word.
//   "No Room For A Saint (Extended Mix)"    → strip "Extended Mix" → no version word → NOT rejected
//   "The Less I Know The Better (Club Edit)" → "Edit" remains       → rejected
function isRejectedVersion(text) {
  return VERSION_WORDS.test((text || '').replace(VERSION_WHITELIST, ' '))
}

// Score one iTunes result against the expected artist(s) + title.
//   +2 for each expected-artist name found (case-insensitive, partial) in result.artistName
//   +3 if the expected title appears in result.trackName (both stripped of parentheticals)
// Returns { score, artistMatches } — artistMatches drives the final artist verification.
function scoreItunesResult(result, expectedArtists, expectedTitle) {
  const artistName = (result.artistName || '').toLowerCase()
  const trackName = normalizeTitleForMatch(result.trackName)
  let score = 0
  let artistMatches = 0
  for (const name of expectedArtists) {
    if (artistName.includes(name)) {
      score += 2
      artistMatches++
    }
  }
  if (expectedTitle && trackName.includes(expectedTitle)) score += 3
  return { score, artistMatches }
}

// Pick the best iTunes result (or null). When the user's query asks for the ORIGINAL (no version
// word), every candidate whose trackName is a remix/edit/version is hard-removed from the pool BEFORE
// scoring — a remix must never win just because the original isn't in iTunes' top 10 (common for
// heavily-remixed tracks). If the query itself contains a version word, the filter is skipped and all
// candidates score normally. Whatever survives is ranked by score, ties broken by higher trackId
// (usually the more recent release). We then scan best-first and return the first candidate that
// passes BOTH verifications:
//   • artist  — at least one expected artist name appears (zero → reject, wrong artist entirely)
//   • duration — within 20s of the SoundNet duration when both are known (reject a different
//                version/song). Rejected candidates fall through to the next best.
// An empty survivor pool → null → placeholder art + disabled playback (correct behavior).
function pickBestItunesResult(results, artist, title, expectedDurationSec) {
  const expectedArtists = splitArtistNames(artist)
  const expectedTitle = normalizeTitleForMatch(title)
  const queryWantsVersion = isRejectedVersion(`${artist} ${title}`)
  // Check the RAW trackName — version markers usually live in parentheticals.
  const candidates = queryWantsVersion
    ? results
    : results.filter((r) => !isRejectedVersion(r.trackName))
  const ranked = candidates
    .map((r) => ({ r, ...scoreItunesResult(r, expectedArtists, expectedTitle) }))
    .sort((a, b) => b.score - a.score || (b.r.trackId || 0) - (a.r.trackId || 0))

  for (const { r, artistMatches } of ranked) {
    if (artistMatches === 0) continue // final artist verification — no artist overlap, reject
    if (expectedDurationSec != null && r.trackTimeMillis != null) {
      const deltaSec = Math.abs(r.trackTimeMillis / 1000 - expectedDurationSec)
      if (deltaSec > 20) continue // duration cross-check — different version/song, try next best
    }
    return r
  }
  return null
}

// Fetch up to 10 iTunes song results for a query (empty array on error/miss).
async function itunesPreviewResults(query) {
  try {
    const res = await fetch(`/api/itunes/search?term=${encodeURIComponent(query)}&entity=song&limit=10`)
    if (!res.ok) return []
    const data = await res.json()
    return data.results ?? []
  } catch {
    return []
  }
}

// Verified Deezer fallback (used when iTunes verification finds nothing). Deezer's structured query
// syntax — artist:"…" track:"…" — is far more precise than iTunes' freetext, so it often surfaces an
// original that iTunes buried under covers/remixes. Applies the SAME verification as iTunes:
//   • version pre-filter — drop remix/edit/etc. titles unless the query itself asks for a version
//   • artist  — result.artist.name must contain an expected artist name (case-insensitive partial)
//   • duration — within 20s of the SoundNet duration when both are known (Deezer durations are in
//                SECONDS, not ms)
// Returns the first result that passes all three, or null.
async function verifiedDeezerLookup(artist, title, expectedDurationSec) {
  let data
  try {
    const q = `artist:"${artist}" track:"${title}"`
    const res = await fetch(`/api/deezer/search?q=${encodeURIComponent(q)}&limit=5`)
    if (!res.ok) return null
    data = await res.json()
  } catch {
    return null
  }

  const results = data?.data ?? []
  const expectedArtists = splitArtistNames(artist)
  const queryWantsVersion = isRejectedVersion(`${artist} ${title}`)
  const candidates = queryWantsVersion
    ? results
    : results.filter((r) => !isRejectedVersion(r.title))

  for (const r of candidates) {
    const deezerArtist = (r.artist?.name || '').toLowerCase()
    if (!expectedArtists.some((name) => deezerArtist.includes(name))) continue // wrong artist, reject
    if (expectedDurationSec != null && r.duration != null) {
      if (Math.abs(r.duration - expectedDurationSec) > 20) continue // different version/song, try next
    }
    return r
  }
  return null
}

// Fetch iTunes candidates for a track and pick the single best VERIFIED result. Cleans the query
// (adding album when known — a more specific query yields better results), pulls the top 10 song
// results, and selects the best match that passes artist + duration verification. Returns
// { results, best }: the raw candidate list (used to distinguish "no coverage" from "coverage but
// nothing verified") plus that best result, or null when none survive / iTunes has no coverage.
async function verifiedItunesLookup(artist, title, { album = null, duration = null } = {}) {
  const base = buildArtQuery(artist, title)
  const query = album ? `${base} ${album}` : base

  let results = await itunesPreviewResults(query)
  // Album may over-constrain (or be wrong) and zero out the results — retry the bare query.
  if (results.length === 0 && album) results = await itunesPreviewResults(base)

  const best = results.length > 0 ? pickBestItunesResult(results, artist, title, duration) : null
  return { results, best }
}

// Verified match for a track: album art AND preview always come from the SAME verified result, so
// they can never disagree (Decision — art must be tied to the verified preview, never a loose top
// hit). iTunes is tried first; a verified iTunes hit supplies both from its own fields. When iTunes
// verification finds nothing — zero coverage, OR (common for heavily-remixed tracks) a top 10 that's
// all covers/remixes the verifier rejects — we fall back to a precise, structured Deezer search under
// the same verification. A verified Deezer hit supplies both cover_xl/cover_big art and its MP3
// preview. If Deezer also fails, BOTH are null: placeholder art + a greyed-out play button.
export async function getVerifiedItunesMatch(artist, title, { album = null, duration = null } = {}) {
  const { best } = await verifiedItunesLookup(artist, title, { album, duration })
  if (best) {
    return {
      albumArtUrl: best.artworkUrl100 ? best.artworkUrl100.replace('100x100bb', '600x600bb') : null,
      previewUrl: best.previewUrl ?? null,
    }
  }

  // iTunes verification returned null → verified Deezer fallback (both art + preview, or null/null).
  const deezer = await verifiedDeezerLookup(artist, title, duration)
  const albumArtUrl =
    deezer?.album?.cover_xl ?? deezer?.album?.cover_big ?? deezer?.album?.cover_medium ?? null
  const previewUrl = deezer?.preview ?? null
  return { albumArtUrl, previewUrl }
}

// Preview URL for a track (lazy resolver in preview.js). Thin wrapper over getVerifiedItunesMatch —
// keeps the same verified-iTunes → Deezer-fallback → null behavior, but only the preview half.
export async function getPreviewUrl(artist, title, opts = {}) {
  const { previewUrl } = await getVerifiedItunesMatch(artist, title, opts)
  return previewUrl
}
