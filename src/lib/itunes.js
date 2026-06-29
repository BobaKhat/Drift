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
  }
}

export async function getAlbumArt(artist, title) {
  return (await searchItunes(artist, title))?.albumArtUrl ?? null
}
