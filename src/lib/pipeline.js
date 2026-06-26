import { supabase } from './supabase'
import { getAudioFeatures } from './soundnet'
import { getAlbumArt } from './itunes'

// Parses "Artist – Title" or "Artist - Title" into { artist, title }
export function parseTrackString(input) {
  const match = input.match(/^(.+?)\s[–\-]\s(.+)$/)
  if (!match) throw new Error(`Cannot parse track: "${input}"`)
  return { artist: match[1].trim(), title: match[2].trim() }
}

export async function analyzeTrack(trackString) {
  const { artist, title } = parseTrackString(trackString)

  // Return cached result if available (.limit(1) tolerates duplicate rows gracefully)
  const { data: rows } = await supabase
    .from('tracks')
    .select('*')
    .eq('artist', artist)
    .eq('name', title)
    .limit(1)

  const cached = rows?.[0] ?? null

  if (cached) {
    console.log('[drift] cache hit:', cached.artist, '–', cached.name)
    return cached
  }

  console.log('[drift] analyzing:', artist, '–', title)

  // Fetch album art regardless; attempt SoundNet but degrade gracefully on failure
  const [featuresResult, albumArtUrl] = await Promise.all([
    getAudioFeatures(artist, title).catch((err) => {
      console.warn('[drift] SoundNet failed, storing unanalyzed:', err.message)
      return null
    }),
    getAlbumArt(artist, title),
  ])

  const track = {
    name: title,
    artist,
    album_art_url: albumArtUrl,
    ...(featuresResult ?? {}),
    source: 'soundnet',
    analyzed_at: new Date().toISOString(),
    status: featuresResult ? (featuresResult.status ?? 'analyzed') : 'unanalyzed',
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
