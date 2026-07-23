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

// —— Fuzzy title verification —————————————————————————————————————————————————————————————————————
// Normalize a title down to bare comparison words: lowercase, drop parentheticals/brackets
// (remaster/deluxe/feat tags), drop apostrophes WITHOUT a gap ("I'm" → "im"), turn every other
// punctuation mark into a space, then collapse. "Yes I'm Changing (Remastered)" → "yes im changing".
function normalizeTitleWords(title) {
  return (title || '')
    .toLowerCase()
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ') // drop (…) […] {…} — feat/remaster/deluxe tags
    .replace(/['’`]/g, '')                // apostrophes vanish with no gap: "i'm" → "im"
    .replace(/[^a-z0-9]+/g, ' ')          // any remaining punctuation (- . , : …) → space
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// Word-overlap similarity between the expected title and a candidate's trackName: the fraction of
// the SHORTER title's distinct words that also appear in the longer one. 1.0 = every word of the
// shorter title is present (exact, or the longer just adds a subtitle/remaster tag); 0.0 = a
// completely different song. Fails closed (0) when either side has no words.
//   "yes im changing" vs "yes im changing"          → 3/3 = 1.0
//   "yes im changing" vs "the moment"               → 0/2 = 0.0
//   "the less i know the better" vs (same)          → 5/5 = 1.0
function titleSimilarity(expectedTitle, resultTrackName) {
  const a = new Set(normalizeTitleWords(expectedTitle).split(' ').filter(Boolean))
  const b = new Set(normalizeTitleWords(resultTrackName).split(' ').filter(Boolean))
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  return shared / Math.min(a.size, b.size)
}

// A candidate must clear this word-overlap bar to count as the same song — at least half the shorter
// title's words must match. Passes slight variations, added subtitles, and remaster tags; rejects a
// different song by the same artist. HARD-required in both the iTunes and Deezer verifiers: an
// artist match alone is never sufficient (a wrong song by the right artist is as bad as the wrong
// artist).
const TITLE_SIMILARITY_MIN = 0.5
function titlesCorroborate(expectedTitle, resultTrackName) {
  return titleSimilarity(expectedTitle, resultTrackName) >= TITLE_SIMILARITY_MIN
}

// —— Version-word filter (whitelist-aware) ——————————————————————————————————————————————————————————
// A result is a DIFFERENT release from the one searched when its trackName carries a version marker
// (remix, edit, cover, …). But legitimate EDM originals are routinely listed as "(Original Mix)" /
// "(Extended Mix)" — the canonical release, not a derivative — so those (and bare "Original"/
// "Extended") are WHITELISTED: stripped from the name BEFORE the check. Any version word that survives
// the strip means a genuinely different version → reject.
const VERSION_WHITELIST = /\b(original mix|extended mix|radio edit|original|extended)\b/gi
const VERSION_WORDS =
  /\b(remix|bootleg|cover|slowed|reverb|sped up|acoustic|nightcore|hardstyle|vip|dub|radio|edit|instrumental|mixed|mix|version)\b/i

// True when a trackName (or the search query) names a rejectable alternate version. Strip the
// whitelisted "(Original/Extended Mix)" markers first, THEN test for any remaining version word.
//   "No Room For A Saint (Extended Mix)"    → strip "Extended Mix" → no version word → NOT rejected
//   "The Less I Know The Better (Club Edit)" → "Edit" remains       → rejected
function isRejectedVersion(text) {
  return VERSION_WORDS.test((text || '').replace(VERSION_WHITELIST, ' '))
}

// —— Compilation / "Various Artists" penalty ————————————————————————————————————————————————————————
// Artist + title can both match while the art is still wrong: a "2010s Hits" or "Techno Tuesday
// Vol. 3" compilation carries generic playlist artwork, not the original release's cover. This is a
// SOFT penalty (score -4), not a hard reject — a compilation still wins when it's the only result
// with the right artist, but a genuine original alongside it now outranks it.
const COMPILATION_KEYWORDS = [
  'hits', 'best of', 'greatest', 'compilation', 'vol.', 'volume', 'playlist',
  'mix tape', 'mixtape', 'anthems', 'essentials', 'rewind', 'sessions', 'presents', 'collection',
]
function hasCompilationKeyword(name) {
  const lower = (name || '').toLowerCase()
  return COMPILATION_KEYWORDS.some((kw) => lower.includes(kw))
}

// iTunes: "Various Artists" collections, a compilation-keyword collectionName, or a suspiciously
// large trackCount (a normal album runs 8-16 tracks; compilations tend to run 20+).
function isCompilationRelease({ collectionArtistName, collectionName, trackCount } = {}) {
  return (
    (collectionArtistName || '').toLowerCase() === 'various artists' ||
    hasCompilationKeyword(collectionName) ||
    (trackCount ?? 0) >= 20
  )
}

// Deezer: no collectionArtistName equivalent, so just the album title keywords + track count.
function isDeezerCompilationAlbum(result) {
  return hasCompilationKeyword(result.album?.title) || (result.album?.nb_tracks ?? 0) >= 20
}

// Score one iTunes result against the expected artist(s) + title.
//   +2 for each expected-artist name found (case-insensitive, partial) in result.artistName
//   +3 if the title corroborates (word-overlap similarity ≥ 0.5 — see titlesCorroborate)
//   -4 if the result looks like a compilation/"Various Artists" release (see isCompilationRelease)
// Returns { score, artistMatches, titleMatch } — artistMatches AND titleMatch are BOTH hard-required
// by the final verification (a right-artist/wrong-song +2 result must not win).
function scoreItunesResult(result, expectedArtists, expectedTitle) {
  const artistName = (result.artistName || '').toLowerCase()
  let score = 0
  let artistMatches = 0
  for (const name of expectedArtists) {
    if (artistName.includes(name)) {
      score += 2
      artistMatches++
    }
  }
  const titleMatch = titlesCorroborate(expectedTitle, result.trackName)
  if (titleMatch) score += 3
  if (isCompilationRelease(result)) score -= 4
  return { score, artistMatches, titleMatch }
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

  for (const { r, artistMatches, titleMatch } of ranked) {
    if (artistMatches === 0) continue // artist verification — no artist overlap, reject wrong artist
    if (!titleMatch) continue // title verification — right artist but wrong song, reject (try next best)
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
//   • title   — word-overlap similarity ≥ 0.5 vs the expected title (see titlesCorroborate); right
//               artist but wrong song is rejected
//   • duration — within 20s of the SoundNet duration when both are known (Deezer durations are in
//                SECONDS, not ms)
// Returns the first result that passes all four, or null.
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

  // Soft compilation penalty (see isDeezerCompilationAlbum): rank non-compilation candidates first,
  // stable-sorted so ties keep Deezer's original relevance order. A compilation still wins below if
  // it's the only candidate that passes the artist + duration checks.
  const deezerScore = (r) => (isDeezerCompilationAlbum(r) ? -4 : 0)
  const ranked = [...candidates].sort((a, b) => deezerScore(b) - deezerScore(a))

  for (const r of ranked) {
    const deezerArtist = (r.artist?.name || '').toLowerCase()
    if (!expectedArtists.some((name) => deezerArtist.includes(name))) continue // wrong artist, reject
    if (!titlesCorroborate(title, r.title)) continue // right artist but wrong song, reject; try next
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
