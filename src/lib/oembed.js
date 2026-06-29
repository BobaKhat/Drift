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

// Pull { artist, title, ogImage } out of the embed page's __NEXT_DATA__ JSON.
// ogImage is the og:image URL from the same HTML — no extra fetch needed.
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

  return { artist, title, ogImage }
}

export async function resolveSpotifyUrl(url) {
  const id = url.match(TRACK_URL)?.[1]
  if (!id) throw new Error(`Not a Spotify track URL: ${url}`)

  // Retry with backoff if a throttled/partial response slips through, rather than dropping
  // the track into the unresolved bucket.
  let lastErr
  for (let attempt = 1; attempt <= 3; attempt++) {
    await pace()
    try {
      const res = await fetch(`/api/spotify/embed/track/${id}`)
      if (res.status === 429) throw new Error('Spotify throttled (429)')
      if (!res.ok) throw new Error(`Spotify embed HTTP ${res.status}`)

      const { artist, title, ogImage } = parseEmbed(await res.text())
      if (!artist || !title) throw new Error('could not resolve Spotify link')
      return { artist, title, ogImage }
    } catch (err) {
      lastErr = err
      if (attempt < 3) await new Promise((r) => setTimeout(r, 800 * attempt))
    }
  }
  throw lastErr
}
