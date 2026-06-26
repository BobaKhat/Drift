import { supabase } from './supabase'
import { getAudioFeatures } from './soundnet'
import { getAlbumArt } from './itunes'

// Parses "Artist – Title" or "Artist - Title" into { artist, title }
export function parseTrackString(input) {
  const match = input.match(/^(.+?)\s[–\-]\s(.+)$/)
  if (!match) throw new Error(`Cannot parse track: "${input}"`)
  return { artist: match[1].trim(), title: match[2].trim() }
}

export async function analyzeTrack(trackString, { delayMs = 0 } = {}) {
  const { artist, title } = parseTrackString(trackString)

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

  console.log('[drift] analyzing:', artist, '–', title)

  // Reuse existing album art if we already stored it; otherwise fetch.
  const [soundnetResult, albumArtUrl] = await Promise.all([
    getAudioFeatures(artist, title).catch((err) => {
      console.warn('[drift] SoundNet failed, storing unanalyzed:', err.message)
      return null
    }),
    cached?.album_art_url
      ? Promise.resolve(cached.album_art_url)
      : getAlbumArt(artist, title),
  ])

  const track = {
    name: title,
    artist,
    album_art_url: cached?.album_art_url ?? albumArtUrl,
    ...(soundnetResult ?? {}),
    source: 'soundnet',
    analyzed_at: new Date().toISOString(),
    status: soundnetResult ? (soundnetResult.status ?? 'analyzed') : 'unanalyzed',
  }

  // UPDATE existing row if one already exists (avoids duplicate inserts on retry).
  if (cached) {
    const { data, error } = await supabase
      .from('tracks')
      .update(track)
      .eq('id', cached.id)
      .select()
      .single()
    if (error) throw new Error(`Supabase update failed: ${error.message}`)
    console.log('[drift] updated track id:', data.id)
    return data
  }

  const { data, error } = await supabase
    .from('tracks')
    .insert(track)
    .select()
    .single()

  if (error) throw new Error(`Supabase insert failed: ${error.message}`)

  console.log('[drift] cached track id:', data.id)
  return data
}
