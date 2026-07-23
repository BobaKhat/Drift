// Production replacement for the Vite dev proxy's `/api/soundnet` entry (see vite.config.js).
//
// Unlike the iTunes/Deezer/Spotify proxies — which are pure URL forwards handled by vercel.json
// rewrites — SoundNet (track-analysis.p.rapidapi.com) requires RapidAPI auth HEADERS on every
// request. A vercel.json rewrite can only rewrite the URL, it cannot inject request headers, so
// SoundNet needs a real serverless function (as soundnet.js:23 notes). This forwards the request to
// RapidAPI with the key attached server-side, so the key never has to travel with the client fetch.
//
// The client calls `/api/soundnet/pktx/analysis?artist=…&song=…`; this catch-all forwards the
// sub-path + query string unchanged to https://track-analysis.p.rapidapi.com/… .

const RAPIDAPI_HOST = 'track-analysis.p.rapidapi.com'

export default async function handler(req, res) {
  const key = process.env.RAPIDAPI_KEY || process.env.VITE_RAPIDAPI_KEY
  if (!key) {
    res.status(500).json({ error: 'RAPIDAPI_KEY (or VITE_RAPIDAPI_KEY) is not set in the Vercel project env' })
    return
  }

  // Strip the /api/soundnet mount prefix, keep the sub-path AND the query string. Parsed via URL so
  // path + search are handled cleanly regardless of how req.url is presented.
  const { pathname, search } = new URL(req.url, `https://${RAPIDAPI_HOST}`)
  const suffix = pathname.replace(/^\/api\/soundnet/, '')
  const target = `https://${RAPIDAPI_HOST}${suffix}${search}`

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
