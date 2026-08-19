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
// ≥350ms apart (~2.85/sec, comfortable headroom under the 5/sec ceiling). The earlier
// 250ms/~4-per-sec spacing left too little slack under batch load and kept tripping the
// 30-second 429 penalty. See rateLimit.js for why.
const pace = createPacer(350)

// Errors carry a `kind` so the cascade can decide whether to advance to the next variation
// or halt. Two kinds mean "no exact match for this query" and ADVANCE the cascade:
//   'miss'    → SoundNet returned 200 with an error body (track not in catalog)
//   'timeout' → request aborted at SOUNDNET_TIMEOUT_MS. At the tightened 6s threshold a
//               timeout is a reliable "no exact match" signal, not a stall to wait out:
//               exact matches return in under 4s, while fallback searches grind for 42–45s
//               before failing anyway (see scripts/probe-output.json). Advancing beats
//               waiting on a search that won't resolve.
// The remaining kinds are genuinely transient and HALT the cascade — firing more variations
// would only deepen an in-progress 429 penalty:
//   'rate-limit' → HTTP 429 after all retries
//   'transport'  → network/fetch failure
//   'http'       → other non-OK HTTP status
function soundnetError(message, kind) {
  const err = new Error(message)
  err.kind = kind
  return err
}

// A plain fetch has no deadline: behind our proxy SoundNet can stall a connection open
// indefinitely. Abort each attempt after this long so a stall becomes a caught error the
// cascade can act on. Set just above the ~4s ceiling for exact matches and well below the
// 42–45s a fallback search burns before failing — so a timeout here reliably means
// "no exact match" rather than a transient stall. See scripts/probe-output.json.
const SOUNDNET_TIMEOUT_MS = 6000

async function fetchWithTimeout(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SOUNDNET_TIMEOUT_MS)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchWithRetry(url, retries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    await pace()
    let res
    try {
      res = await fetchWithTimeout(url)
    } catch (err) {
      // A timeout (AbortError) now means "no exact match" (see kind docs above), so don't
      // spend retries re-firing the same query — surface it at once and let the cascade
      // advance to the next variation.
      if (err.name === 'AbortError') {
        throw soundnetError(`SoundNet timed out (>${SOUNDNET_TIMEOUT_MS}ms)`, 'timeout')
      }
      // Genuine transport error — transient. Each attempt is bounded by SOUNDNET_TIMEOUT_MS,
      // so retrying can never hang indefinitely. Back off and retry; give up after the last.
      if (attempt === retries) {
        throw soundnetError(`SoundNet fetch failed: ${err.message}`, 'transport')
      }
      await new Promise((r) => setTimeout(r, delayMs * attempt))
      continue
    }
    if (res.status === 429) {
      if (attempt === retries) throw soundnetError('SoundNet rate limit hit — wait 30s and try again', 'rate-limit')
      await new Promise((r) => setTimeout(r, delayMs * attempt))
      continue
    }
    if (!res.ok) throw soundnetError(`SoundNet HTTP ${res.status}`, 'http')
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

  if (data.error) throw soundnetError(`SoundNet miss: ${data.error}`, 'miss')

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
