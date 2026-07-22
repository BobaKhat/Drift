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

// Pick the best iTunes result (or null). Candidates are ranked by score, ties broken by higher
// trackId (usually the more recent release). We then scan best-first and return the first candidate
// that passes BOTH verifications:
//   • artist  — at least one expected artist name appears (zero → reject, wrong artist entirely)
//   • duration — within 20s of the SoundNet duration when both are known (reject a different
//                version/song). Rejected candidates fall through to the next best.
function pickBestItunesResult(results, artist, title, expectedDurationSec) {
  const expectedArtists = splitArtistNames(artist)
  const expectedTitle = normalizeTitleForMatch(title)
  const ranked = results
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

async function deezerPreviewForQuery(query) {
  try {
    const res = await fetch(`/api/deezer/search?q=${encodeURIComponent(query)}`)
    if (!res.ok) return null
    const data = await res.json()
    return data.data?.[0]?.preview ?? null
  } catch {
    return null
  }
}

// Preview URL for a track. Cleans the query (adding album when known — a more specific query yields
// better results), pulls the top 10 iTunes song results, and selects the best verified match. When
// iTunes returns candidates but none survive verification, we return null (no preview beats a wrong
// one). Deezer is used only when iTunes carries nothing at all for the query — a genuine absence,
// not a mismatch — since Deezer's loose top-hit has the same wrong-song failure mode.
export async function getPreviewUrl(artist, title, { album = null, duration = null } = {}) {
  const base = buildArtQuery(artist, title)
  const query = album ? `${base} ${album}` : base

  let results = await itunesPreviewResults(query)
  // Album may over-constrain (or be wrong) and zero out the results — retry the bare query.
  if (results.length === 0 && album) results = await itunesPreviewResults(base)

  if (results.length > 0) {
    const best = pickBestItunesResult(results, artist, title, duration)
    return best?.previewUrl ?? null // candidates existed but none verified → no preview
  }
  // iTunes has no coverage for this query → Deezer fallback (genuinely absent, not a mismatch).
  return await deezerPreviewForQuery(base)
}
