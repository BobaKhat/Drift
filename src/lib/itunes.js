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
async function itunesPreviewForQuery(query) {
  try {
    const res = await fetch(`/api/itunes/search?term=${encodeURIComponent(query)}&entity=song&limit=1`)
    if (!res.ok) return null
    const data = await res.json()
    return data.results?.[0]?.previewUrl ?? null
  } catch {
    return null
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

// Preview URL for a track: clean the query, try iTunes, then fall back to Deezer.
export async function getPreviewUrl(artist, title) {
  const query = buildArtQuery(artist, title)
  return (await itunesPreviewForQuery(query)) ?? (await deezerPreviewForQuery(query))
}
