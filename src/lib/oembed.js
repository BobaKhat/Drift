import { createPacer } from './rateLimit'

// Resolves a pasted Spotify track URL to { artist, title }, proxied through /api/spotify
// (see vite.config.js) to dodge browser CORS.
//
// Approach: fetch the lightweight EMBED endpoint (open.spotify.com/embed/track/{id}, ~10KB)
// and read the structured JSON Spotify ships in its <script id="__NEXT_DATA__"> blob. This is
// far more reliable than scraping the full track page's Open Graph tags:
//   - the embed payload is ~15x smaller and purpose-built to be fetched
//   - artist/title come from real JSON (entity.name + entity.artists[]), not regex over HTML,
//     so multi-artist tracks, remixes, umlauts and apostrophes all parse correctly
//   - Spotify's plain oEmbed JSON is NOT usable here: it returns only the title, no artist.
//
// Requests are paced AND the importer calls this strictly sequentially, so no burst can occur.
const pace = createPacer(250)

// Tolerant of Spotify's localized share links (open.spotify.com/intl-de/track/…),
// http or https, and the ?si= share token that "Copy link" appends.
const TRACK_URL = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]+)/i

export function isSpotifyTrackUrl(line) {
  return TRACK_URL.test(line.trim())
}

// Pull { artist, title, ogImage, duration } out of the embed page's __NEXT_DATA__ JSON.
// ogImage is the og:image URL from the same HTML — no extra fetch needed.
// duration is in seconds (Spotify stores it as milliseconds in the entity payload).
function parseEmbed(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s)
  if (!m) throw new Error('embed payload missing (throttled?)')

  const entity = JSON.parse(m[1])?.props?.pageProps?.state?.data?.entity
  const title = entity?.name || entity?.title || ''
  const artist =
    (entity?.artists || []).map((a) => a?.name).filter(Boolean).join(', ') ||
    entity?.subtitle ||
    ''

  // og:image attribute order varies — handle both orderings
  const ogMatch =
    html.match(/<meta\s[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/) ??
    html.match(/<meta\s[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/)
  const ogImage = ogMatch?.[1] ?? null

  // Spotify stores duration in milliseconds on the entity object
  const durationMs = entity?.duration ?? entity?.duration_ms ?? null
  const duration = durationMs != null ? Math.round(durationMs / 1000) : null

  return { artist, title, ogImage, duration }
}

// Spotify's embed endpoint intermittently hangs or returns a 504 from behind our proxy. A plain
// fetch has no deadline, so a hung request would block the whole (sequential) import forever instead
// of failing over to a retry. Abort each attempt after this long so a stall becomes a caught error.
const EMBED_TIMEOUT_MS = 6000

// Single embed fetch with a hard timeout — an abort (stall) rejects with an AbortError, which the
// retry loop treats the same as a 504/HTTP error.
async function fetchEmbed(id) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS)
  try {
    return await fetch(`/api/spotify/embed/track/${id}`, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function resolveSpotifyUrl(url) {
  const id = url.match(TRACK_URL)?.[1]
  if (!id) throw new Error(`Not a Spotify track URL: ${url}`)

  // Retry rather than dropping the track into the unresolved bucket when the embed request fails
  // transiently: a 504 (gateway timeout), a request that stalls past EMBED_TIMEOUT_MS (AbortError),
  // a 429 throttle, or a throttled/partial body. Wait 1s between attempts before giving up.
  let lastErr
  for (let attempt = 1; attempt <= 3; attempt++) {
    await pace()
    try {
      const res = await fetchEmbed(id)
      if (res.status === 429) throw new Error('Spotify throttled (429)')
      if (!res.ok) throw new Error(`Spotify embed HTTP ${res.status}`)

      const { artist, title, ogImage, duration } = parseEmbed(await res.text())
      if (!artist || !title) throw new Error('could not resolve Spotify link')
      console.log(`[oembed] resolved: artist="${artist}" title="${title}" duration=${duration ?? 'null'} ogImage=${ogImage ?? 'null'}`)
      return { artist, title, ogImage, duration }
    } catch (err) {
      lastErr = err.name === 'AbortError' ? new Error(`Spotify embed timed out (>${EMBED_TIMEOUT_MS}ms)`) : err
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000))
    }
  }
  throw lastErr
}
