import { useEffect, useRef } from 'react'
import { useStoreApi, ViewportPortal } from '@xyflow/react'

// —— Density nebula ————————————————————————————————————————————————————————————————————————————
// Ambient gas showing where the library piles up. Every song contributes one very faint radial
// falloff and nothing else: where songs cluster the falloffs overlap and sum into visible glow,
// where a song sits alone its contribution is barely there. That's the whole mechanism — no binning,
// no density estimator, no legend. It's atmosphere, not a readout, and it must never read as one: it
// takes no pointer events, carries no scale, and sits under every node on the map.

// The one colour knob. Warm white, so the cloud lands on the same side of neutral as the album art
// and the accents instead of reading as cold grey fog over them.
const NEBULA_COLOR = '255, 235, 210'
const NEBULA_BASE_OPACITY = 0.035 // per-song contribution, at a library of NEBULA_REF_COUNT songs
const NEBULA_REF_COUNT = 30       // the library size the base is tuned against
const NEBULA_RADIUS = 400         // canvas units — reach of a single song's cloud
const [NR, NG, NB] = NEBULA_COLOR.split(',').map(Number)

// The per-song contribution has to fall as the library grows, or the cloud's peak climbs past the one
// hard limit on this map: AXIS_COLOR (0.08). The rule is set in DriftMap's grid comment — the crosshair
// is the map's only real information, and no backdrop may reach it. At a flat 0.035 the peak crosses
// that around ~100 songs and hits ~0.19 by 500.
//
// It falls as 1/sqrt(n), NOT 1/n. Songs spread over the canvas as a library grows, so overlap deepens
// far slower than the count does: the peak measures ~n^0.33, not ~n. Normalising by n therefore
// over-corrects by roughly 3×, and it's not a subtle miss — it holds TOTAL ink constant (which is
// arithmetically exact) by spreading the same light over more clouds, so the peak collapses: measured,
// a 150-song library lands at a 4/255 on-screen lift and a 600-song one at 2/255, i.e. nothing. sqrt
// splits the two: peak stays in a 0.041–0.073 band from 30 songs to 600 — always under the ceiling,
// never invisible (~10/255 at any size). Total ink then grows gently with n, which is the right thing
// to trade away: nobody perceives total ink, they perceive whether a cluster glows.
//
// max() rather than a plain ratio so a small library is never boosted ABOVE the base — under the
// reference count the clouds barely overlap and 0.035 is already the intended per-song strength.
const nebulaOpacity = (songCount) =>
  NEBULA_BASE_OPACITY * Math.sqrt(NEBULA_REF_COUNT / Math.max(songCount, NEBULA_REF_COUNT))

// The field is built at 1/8 canvas resolution and stretched back up by CSS. That isn't only a perf
// dodge: the map opens at ~0.15 zoom (computeMinZoom fits the whole axis box to the card), so 1/8 of
// canvas space lands almost exactly 1:1 on screen at the default view — i.e. the cloud is authored at
// the resolution it's actually looked at, which is also what keeps the dither below intact rather
// than smeared by the upscale. Nothing in the field has an edge sharper than a 400-unit falloff, so
// the stretch costs nothing visible while the draw costs 1/64 of the pixels.
const RES = 1 / 8

// —— Why the field is summed by hand rather than with createRadialGradient ——————————————————————
// Because dither has to land BEFORE quantisation, and the canvas gradient API quantises for you.
//
// At the reference library size a song's whole falloff spans alpha 8.9 → 0 — nine 8-bit levels — so a
// canvas-drawn cloud rasterises as ~9 concentric plateaus. Dithering that bitmap afterwards achieves
// nothing: the pixel already reads 7, the 6.7 it came from is gone, and ±0.5 of jitter on an integer
// rounds back to the same integer. Post-quantisation dither is noise, not dither.
//
// Nine levels is the BEST case, and only at 30 songs. nebulaOpacity scales the per-song contribution
// down as the library grows — by 600 songs it is 0.0078, a two-level falloff — so the bigger the
// library, the more of the cloud's shape lives in fractions of an 8-bit level that a canvas gradient
// would simply round away. Accumulating in float and dithering once at the end is what keeps a large
// library's gas smooth instead of posterised; this architecture earns more as the library grows, not
// less. (For reference: at the old flat 0.018 the falloff had five levels and the plateaus were
// plainly visible to the eye.)
//
// So the field accumulates in float — the same sum 'lighter' used to do, at full precision and with
// no clipping until the end — and the one quantisation to 8-bit gets the Bayer offset added first.
// A true 3.67 then lands on 4 for ~67% of pixels and 3 for the rest, and the eye integrates the ramp
// back out of the mixture. The blur is gone for the same reason: ctx.filter runs per draw op, so it
// quantises along with the draw, and blurring AFTER the dither would average the dither straight back
// out and hand the plateaus back. Dither and ctx.filter are mutually exclusive here; this is the one
// that addresses the banding rather than the resolution.

// Falloff shape: smoothstep, flat at both ends (f'(0) = f'(1) = 0). Linear — what a two-stop
// createRadialGradient gives — kinks where it hits zero and leaves a faint ring at the cloud's rim,
// which is the artifact the old blur was there to soften. Curving the falloff removes it at the
// source for free. It tracks linear closely (identical at the half-radius), so NEBULA_RADIUS still
// means what it always did.
const falloff = (t) => 1 - 3 * t * t + 2 * t * t * t

// Ordered 4×4 Bayer threshold matrix, normalised to ±0.5 of ONE 8-bit alpha level — exactly one
// quantisation step wide, so it can tip a value across its nearest boundary and never further. At
// that amplitude the 4-pixel period is far too fine and too faint to read as texture; it only ever
// shows up as the plateau edges dissolving. Ordered rather than random on purpose: blue-noise-ish
// jitter would shimmer between redraws, and a fixed matrix keeps a still map perfectly still.
const BAYER_4X4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
const DITHER = BAYER_4X4.map((v) => (v + 0.5) / 16 - 0.5)

// Density is a zoomed-OUT read, and this curve exists to fight the geometry that works against that.
// The clouds live in CANVAS space, so their screen footprint grows with zoom while their peak alpha —
// baked into the bitmap — does not. Hold opacity flat across the circle band and the cloud therefore
// gets LOUDER as you zoom in: measured, it covers 12.3% of the card at overview and 21.6% by zoom
// 0.45, reading as ~1.5× the on-screen ink. That put the nebula at its strongest in the pill band and
// its weakest at the overview, which is exactly backwards — the overview is the only place the
// overlaps resolve into density at all. So the fade now starts AT the overview and runs the whole way
// down, trading opacity away as fast as the footprint grows.
//
// It starts at minZoom rather than a constant because "the overview" isn't a fixed number: it's
// whatever computeMinZoom fits the axis box to, ~0.15 on a laptop but ~0.37 on a 4K panel. Any
// hardcoded start sits somewhere inside that spread and opens a big display already part-faded —
// the same bug the original `zoom > 0.3` gate had. Anchored to minZoom, the map is at full strength
// the instant it loads on every display, by construction.
//
// Worth knowing: there is no headroom to BOOST the overview. Opacity saturates at 1 and the overview
// was already sitting there, so this curve can only take away above it. If the cloud needs to be
// brighter at overview itself, that's NEBULA_BASE_OPACITY — the bitmap — not this.
const FADE_END = 0.8 // gone from here up — mid pill band, well clear of card tier (ZOOM_CARD = 1.5)
const zoomFade = (zoom, overview) => {
  if (zoom <= overview) return 1 // at or below the fit — the map can't zoom out past this
  if (zoom >= FADE_END) return 0
  // Only reachable when overview < zoom < FADE_END, so the denominator is always positive.
  return 1 - (zoom - overview) / (FADE_END - overview)
}

// A preset change slides every song to a new position over ~500ms. Redrawing the field on each frame
// of that would be dozens of full repaints to animate something nobody is watching, so the cloud
// crossfades instead: drop out, redraw at the new positions while invisible, come back. Out is
// quicker than in, so the stale cloud is gone well before the songs have settled and the new one
// arrives behind them rather than racing them. Toggling flow mode rides the same crossfade.
const FADE_OUT_MS = 200
const FADE_IN_MS = 400

// `songPositions` is the canvas-space centres of the songs that should GIVE OFF gas — already
// filtered by the caller (flow mode narrows it to the chain), so this component never needs to know
// what a chain is. Node origin is [0.5, 0.5], so a node's position IS its centre. The array's
// identity is the redraw trigger, so it must come from a memo that changes only when the set or the
// positions do — never from the live `nodes` array, which churns on hover, selection and dimming.
export default function NebulaLayer({ songPositions, width, height }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const store = useStoreApi()

  // Zoom fade rides the wrapper; the breath rides the middle element (CSS-only, see index.css); the
  // preset crossfade rides the canvas. One opacity per element, multiplied by the browser, so no
  // effect ever has to know another's current value. The split into separate ELEMENTS is what makes
  // that safe: a CSS animation outranks an inline style, so hanging the breath on either element the
  // JS writes to would silently seize the property (measured: style.opacity='0' computes to ~1.0
  // under a running opacity animation).
  //
  // Subscribing to the store directly (rather than useOnViewportChange, which holds a single handler
  // that AxisLayer owns) and writing style straight out, so this never re-renders React. Guarded to
  // a 2dp change, which also means panning — zoom unchanged — costs one comparison and no write.
  useEffect(() => {
    let last = -1
    const apply = () => {
      // minZoom rides the same store as the transform, so the overview anchor is always the live one
      // — a resize recomputes it (DriftMap's setMinZoom) and the next read just picks it up.
      const { transform, minZoom } = store.getState()
      const o = Math.round(zoomFade(transform[2], minZoom) * 100) / 100
      if (o === last) return
      last = o
      const el = wrapRef.current
      if (!el) return
      el.style.opacity = String(o)
      // Drop the layer out of compositing entirely once invisible — at canvas size it is a big one.
      el.style.visibility = o === 0 ? 'hidden' : 'visible'
    }
    apply()
    return store.subscribe(apply)
  }, [store])

  const hasDrawn = useRef(false)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !(width > 0) || !(height > 0)) return

    const draw = () => {
      const w = Math.max(1, Math.round(width * RES))
      const h = Math.max(1, Math.round(height * RES))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      const ctx = canvas.getContext('2d')

      // Pass 1 — sum every song's falloff into one float field, in 0–255 alpha units. Each song only
      // touches its own bounding box, so this is O(songs × radius²) and independent of canvas size.
      const field = new Float32Array(w * h)
      const r = NEBULA_RADIUS * RES
      const r2 = r * r
      // Normalised by the number of EMITTERS, which is what actually drives the accumulation — so flow
      // mode (which hands us only the chain) correctly gets full per-song strength off a short chain
      // rather than a whole library's worth of suppression.
      const peak = nebulaOpacity(songPositions.length) * 255
      for (const p of songPositions) {
        const cx = p.x * RES
        const cy = p.y * RES
        const x0 = Math.max(0, Math.floor(cx - r))
        const x1 = Math.min(w - 1, Math.ceil(cx + r))
        const y0 = Math.max(0, Math.floor(cy - r))
        const y1 = Math.min(h - 1, Math.ceil(cy + r))
        for (let y = y0; y <= y1; y++) {
          const dy = y - cy
          const row = y * w
          for (let x = x0; x <= x1; x++) {
            const dx = x - cx
            const d2 = dx * dx + dy * dy
            if (d2 >= r2) continue // outside the cloud — leave this pixel at exactly 0
            field[row + x] += peak * falloff(Math.sqrt(d2) / r)
          }
        }
      }

      // Pass 2 — offset by the Bayer threshold, then quantise, once. Pixels no song reached are still
      // exactly 0 and are skipped outright: the dither can only ever move a pixel that already had
      // gas on it, so the empty map stays perfectly black instead of picking up a speckle haze.
      // createImageData is zero-filled and putImageData REPLACES (never blends), so the untouched
      // pixels land as transparent black with no clear needed.
      const img = ctx.createImageData(w, h)
      const out = img.data
      for (let y = 0; y < h; y++) {
        const row = y * w
        const brow = (y & 3) * 4
        for (let x = 0; x < w; x++) {
          const a = field[row + x]
          if (a <= 0) continue
          const q = Math.round(a + DITHER[brow + (x & 3)])
          if (q <= 0) continue
          const o = (row + x) * 4
          out[o] = NR
          out[o + 1] = NG
          out[o + 2] = NB
          out[o + 3] = q < 255 ? q : 255
        }
      }
      ctx.putImageData(img, 0, 0)
    }

    // First paint has no stale cloud to clear, so it skips the fade-out and just arrives. The rAF is
    // what gives the transition a frame at opacity 0 to start from.
    if (!hasDrawn.current) {
      hasDrawn.current = true
      draw()
      canvas.style.transition = `opacity ${FADE_IN_MS}ms ease-out`
      const raf = requestAnimationFrame(() => { canvas.style.opacity = '1' })
      return () => cancelAnimationFrame(raf)
    }

    canvas.style.transition = `opacity ${FADE_OUT_MS}ms ease-in`
    canvas.style.opacity = '0'
    const t = setTimeout(() => {
      draw()
      canvas.style.transition = `opacity ${FADE_IN_MS}ms ease-out`
      canvas.style.opacity = '1'
    }, FADE_OUT_MS)
    return () => clearTimeout(t)
  }, [songPositions, width, height])

  return (
    <ViewportPortal>
      <div
        ref={wrapRef}
        style={{ position: 'absolute', left: 0, top: 0, width, height, pointerEvents: 'none' }}
      >
        {/* Breath — CSS-only, and deliberately an element of its own that nothing else writes to. */}
        <div className="drift-nebula-breath" style={{ width: '100%', height: '100%' }}>
          <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%', opacity: 0 }} />
        </div>
      </div>
    </ViewportPortal>
  )
}
