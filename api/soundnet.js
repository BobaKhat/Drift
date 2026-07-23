// Production replacement for the Vite dev proxy's `/api/soundnet` entry (see vite.config.js).
//
// Unlike the iTunes/Deezer/Spotify proxies — pure URL forwards handled by vercel.json rewrites —
// SoundNet (track-analysis.p.rapidapi.com) requires RapidAPI auth HEADERS on every request. A
// vercel.json rewrite can only rewrite the URL, it cannot inject request headers, so SoundNet needs
// a real serverless function. This forwards the request to RapidAPI with the key attached
// server-side, so the key never travels with the client fetch.
//
// ROUTING: the client calls `/api/soundnet/pktx/analysis?artist=…&song=…`. Bracket catch-all files
// (`api/soundnet/[...path].js`) are a Next.js/SvelteKit convention and are NOT honored on a plain
// Vite project — Vercel would route that file literally at `/api/soundnet/[...path]`, so the nested
// request 404s. Instead this is a flat function at `/api/soundnet`, and a vercel.json rewrite funnels
// `/api/soundnet/:path*` here, passing the sub-path as the `__path` query param and merging the
// original artist/song query. We reconstruct the upstream URL from that.
//
// HOST: it is `track-analysis.p.rapidapi.com`, NOT `soundnet3.p.rapidapi.com` (the latter returns
// HTTP 404 `{"message":"API doesn't exists"}`). Don't "fix" this to soundnet3.

const RAPIDAPI_HOST = 'track-analysis.p.rapidapi.com'

export default async function handler(req, res) {
  const key = process.env.RAPIDAPI_KEY || process.env.VITE_RAPIDAPI_KEY
  if (!key) {
    res.status(500).json({ error: 'RAPIDAPI_KEY (or VITE_RAPIDAPI_KEY) is not set in the Vercel project env' })
    return
  }

  // Pull the sub-path back out of the `__path` marker the rewrite injected, then drop the marker so
  // only the real upstream params (artist, song, …) remain in the forwarded query string.
  const url = new URL(req.url, `https://${RAPIDAPI_HOST}`)
  const subPath = (url.searchParams.get('__path') || '').replace(/^\/+/, '')
  url.searchParams.delete('__path')
  const suffix = subPath ? `/${subPath}` : ''
  const target = `https://${RAPIDAPI_HOST}${suffix}${url.search}`

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        'X-RapidAPI-Key': key,
        'X-RapidAPI-Host': RAPIDAPI_HOST,
      },
    })
    const body = await upstream.text()
    res.status(upstream.status)
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json')
    res.send(body)
  } catch (err) {
    res.status(502).json({ error: `SoundNet proxy failed: ${err.message}` })
  }
}
