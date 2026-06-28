import { supabase } from './supabase'
import { getAudioFeatures } from './soundnet'
import { searchItunes } from './itunes'
import { titlesMatch } from './match'

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

// Core pipeline: cache check → SoundNet (on miss) → iTunes art → Supabase upsert.
// Takes already-resolved artist/title so callers that resolved a Spotify URL (or have
// demo data) can reuse the same caching/dedup path without re-parsing a string.
export async function analyzeTrackParts(artist, title, { delayMs = 0 } = {}) {
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

  // Fetch SoundNet features + the iTunes match in parallel. iTunes gives us the REAL matched
  // track title, which we use both for album art and to corroborate SoundNet's result.
  const [soundnetResult, itunes] = await Promise.all([
    getAudioFeatures(artist, title).catch((err) => {
      console.warn('[drift] SoundNet failed, storing unanalyzed:', err.message)
      return null
    }),
    searchItunes(artist, title),
  ])

  // Mismatch guard: SoundNet fuzzy-matches on artist and returns SOME track even for a fake or
  // misspelled title ("ODESZA – Dumbo" → a real ODESZA track). iTunes is far stricter, so if it
  // can't corroborate the title (no result, or words barely overlap), reject the SoundNet match
  // and route the track to the unresolved bucket instead of accepting a wrong song.
  let features = soundnetResult
  if (features) {
    const foundTitle = itunes?.trackName
    if (!titlesMatch(title, foundTitle)) {
      console.warn(
        `[drift] rejected fuzzy match: requested "${title}" but iTunes found "${foundTitle ?? '(no result)'}"`,
      )
      features = null
    }
  }

  const track = {
    name: title,
    artist,
    album_art_url: itunes?.albumArtUrl ?? cached?.album_art_url ?? null,
    ...(features ?? {}),
    source: 'soundnet',
    analyzed_at: new Date().toISOString(),
    status: features ? (features.status ?? 'analyzed') : 'unanalyzed',
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
