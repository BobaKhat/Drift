import { useEffect, useState } from 'react'
import { artColorCache, colorThief, pickAccentColor, ART_FALLBACK } from './TrackNode'

// Shared album-art accent colour hook (Slice 12 #4, moved out of DeckPanel in Slice 14 so the
// visualizer can use it too). Reuses the map's cached album-art colour (identical to the ambient
// glow); on a cache miss it extracts once from a hidden CORS image. Returns 'r, g, b' (0–255
// components) or null when no vivid colour is available.

export function parseRgbTriple(v) {
  const m = typeof v === 'string' && /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(v)
  return m ? `${m[1]}, ${m[2]}, ${m[3]}` : null
}

export function useAlbumColor(url) {
  const [rgb, setRgb] = useState(() => (url ? parseRgbTriple(artColorCache.get(url)) : null))
  useEffect(() => {
    if (!url) { setRgb(null); return }
    const cached = artColorCache.get(url)
    const parsed = parseRgbTriple(cached)
    if (parsed) { setRgb(parsed); return }
    if (cached === ART_FALLBACK) { setRgb(null); return } // already extracted → nothing vivid
    let cancelled = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (cancelled) return
      try {
        const { best } = pickAccentColor(colorThief.getPalette(img, 5))
        if (best) {
          artColorCache.set(url, `rgb(${best.r}, ${best.g}, ${best.b})`)
          setRgb(`${best.r}, ${best.g}, ${best.b}`)
        } else {
          artColorCache.set(url, ART_FALLBACK)
          setRgb(null)
        }
      } catch { if (!cancelled) setRgb(null) }
    }
    img.onerror = () => { if (!cancelled) setRgb(null) }
    img.src = url
    return () => { cancelled = true }
  }, [url])
  return rgb // 'r, g, b' or null
}
