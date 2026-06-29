import { createPacer } from './rateLimit'

// "-11 dB" → -11, bare number passthrough, null on failure
function parseLoudness(raw) {
  if (raw == null) return null
  if (typeof raw === 'number') return raw
  const n = parseFloat(String(raw))
  return isNaN(n) ? null : n
}

// "6:20" → 380, "1:04:12" → 3852, bare number passthrough, null on failure
function parseDuration(raw) {
  if (raw == null) return null
  if (typeof raw === 'number') return raw
  const parts = String(raw).split(':').map(Number)
  if (parts.some(isNaN)) return null
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}

// SoundNet via RapidAPI (track-analysis.p.rapidapi.com)
// Vite dev proxy at /api/soundnet strips CORS. For production, add a Vercel Function.
// CRITICAL: SoundNet returns HTTP 200 on misses — check for `error` key in body.

// SoundNet rate-limits bursts (≥6 concurrent → HTTP 429), so pace every attempt to
// ≥220ms apart (~4.5/sec, just under the 5/sec ceiling). See rateLimit.js for why.
const pace = createPacer(220)

async function fetchWithRetry(url, retries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    await pace()
    const res = await fetch(url)
    if (res.status === 429) {
      if (attempt === retries) throw new Error('SoundNet rate limit hit — wait 30s and try again')
      await new Promise((r) => setTimeout(r, delayMs * attempt))
      continue
    }
    if (!res.ok) throw new Error(`SoundNet HTTP ${res.status}`)
    return res
  }
}

export async function getAudioFeatures(artist, title) {
  const params = new URLSearchParams({ artist, song: title })
  const url = `/api/soundnet/pktx/analysis?${params}`

  // Log both the decoded form (readable) and the raw encoded query string (exact wire format)
  console.log(`[soundnet] artist="${artist}" | song="${title}"`)
  console.log(`[soundnet] encoded query string: ${params.toString()}`)
  console.log(`[soundnet] → GET ${url}`)

  const res = await fetchWithRetry(url)

  const data = await res.json()

  // Full response body so we can compare against RapidAPI test UI output
  console.log(`[soundnet] full response body:`, JSON.stringify(data, null, 2))

  if (data.error) throw new Error(`SoundNet miss: ${data.error}`)

  // Normalize field names from SoundNet response to Drift schema:
  //   tempo → bpm  |  happiness → mood (valence)
  const missing = []
  const pick = (key, val) => {
    if (val == null) missing.push(key)
    return val ?? null
  }

  return {
    bpm:              pick('bpm',             data.tempo),
    energy:           pick('energy',          data.energy),
    mood:             pick('mood',            data.happiness),
    danceability:     pick('danceability',    data.danceability),
    acousticness:     pick('acousticness',    data.acousticness),
    instrumentalness: pick('instrumentalness',data.instrumentalness),
    speechiness:      pick('speechiness',     data.speechiness),
    loudness:         pick('loudness',        parseLoudness(data.loudness)),
    liveness:         pick('liveness',        data.liveness),
    key:              pick('key',             data.key),
    camelot:          pick('camelot',         data.camelot),
    duration:         parseDuration(data.duration),
    popularity:       data.popularity ?? null,
    missing_features: missing.length ? missing : null,
    status:           missing.length ? 'partial' : 'analyzed',
    // Matched metadata SoundNet may return alongside features.
    // Used for self-verification when iTunes has no coverage.
    // Null when the API doesn't include these fields — callers fall back to the sent query.
    _matchedTitle:  data.title ?? data.song_title ?? data.track_title ?? null,
    _matchedArtist: data.artist ?? data.artist_name ?? data.author ?? null,
  }
}
