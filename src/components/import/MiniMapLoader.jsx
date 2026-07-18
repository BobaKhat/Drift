import { useEffect, useRef } from 'react'
import { RADIUS, FONT, NEO_RAIL_SURFACE } from './tokens'

// Purely decorative loading animation: a miniature Orion map where fake nodes fill in and then gently
// reshuffle, so the import screen reads as "your map is being built." No real track data, no progress —
// just a constellation. The furniture mirrors the live map so the loader reads as a real (tiny) map:
// the same 22px line grid on the map's own surface colour, a white crosshair with accent ticks (orange
// energy / purple mood), and the four labeled pole pills (Intense/Chill/Dark/Bright — the default Vibe
// axes). Each node is a real album cover clipped into a circle (drawn from the `artUrls` pool the parent
// supplies — the user's own library, falling back to demo covers), with a soft glow and a thin white
// border ring, matching the live map's circle-tier nodes. When no cover has loaded yet a node falls back
// to a filled palette colour so the animation never shows a hole.

const GRID_LINE = 'rgba(255,255,255,0.035)' // matches the live map's ruling colour
const GRID_SIZE = 22                         // same 22px on-screen spacing as the live map
const LINE_GRID = `linear-gradient(to right, ${GRID_LINE} 1px, transparent 1px), linear-gradient(to bottom, ${GRID_LINE} 1px, transparent 1px)`

// Axis furniture, mirrored from the live map (DriftMap): a white crosshair at value-50 on each axis,
// then two pill-capped accent ticks per axis at the song-band (PAD) edges, then labeled pole pills.
const AXIS_COLOR = 'rgba(255,255,255,0.12)'  // white crosshair — same as the live map, not orange
const AXIS_INSET_FRAC = 0.04                 // fraction of the container the crosshair holds off each edge
const AXIS_CLEAR = 12                        // keep node centres this far off the axis lines
// Pole-pill no-go zones. Each pill is a small rounded rect hanging inward from its axis end; nodes keep
// a rectangular clearance around the pill's actual footprint (its hang-inward body, not just the edge
// anchor) so none lands on, above, or hugging a pill. hw = per-label half-width, PILL_HH = half-height,
// PILL_MARGIN = gap held beyond the pill (covers the node radius + a comfortable buffer).
const PILL_HH = 12
const PILL_MARGIN = 22
const ACCENT1 = '#F27F37'                    // energy axis (Y) — orange, matches the live map's ticks/pills
const ACCENT2 = '#4B6AE5'                    // mood axis (X) — purple
// Tick positions, pulled inward from the live map's true PAD edges so they clear the (proportionally
// large) pole pills in this mini container — otherwise the pills, which sit on top, hide them.
const PAD_X = [0.19, 0.81]                    // where the purple mood ticks sit on the horizontal axis
const PAD_Y = [0.16, 0.84]                    // where the orange energy ticks sit on the vertical axis
const TICK_LEN = 12                          // tick length (perpendicular to its axis)
const TICK_W = 2.5                           // tick thickness, pill-capped
const POLE = { yHigh: 'Intense', yLow: 'Chill', xLow: 'Dark', xHigh: 'Bright' } // default Vibe preset labels

// Curated palette sampled from typical album art — warm oranges, deep purples, electric blues, muted
// pinks, teals. Each node picks one on creation (as "r, g, b" so it composes into rgba() strings).
const PALETTE = [
  '242, 127, 55',   // warm orange
  '255, 176, 59',   // amber
  '251, 146, 60',   // tangerine
  '138, 79, 255',   // deep purple
  '167, 139, 250',  // lavender
  '99, 102, 241',   // indigo
  '56, 189, 248',   // electric blue
  '45, 212, 191',   // teal
  '244, 114, 182',  // muted pink
  '236, 72, 153',   // magenta pink
]

const FILL_TARGET = 18                       // pool size Phase 1 fills up to (also the reduced-motion static count)
const MAX_NODES = 20                         // hard safety cap so the pool can never run away
const EDGE_PAD = 0.05                        // 5% inset for node placement
const MIN_DIST = 30                          // no two node centres closer than this
const NODE_R = 8                             // fixed 16px cover — every node is the same size

const IN_MS = 520                            // pop-in duration — slower, gentler bloom
const OUT_MS = 400                           // fade-out
const PAUSE_MS = 200                         // gap between a node leaving and its replacement arriving
const FILL_MIN = 250, FILL_MAX = 350         // Phase 1 spawn interval
const STEADY_MIN = 400, STEADY_MAX = 600     // Phase 2 interval between reshuffles
const DRIFT_AMP = 1.5                        // ambient float (px)
const TAU = Math.PI * 2

// Glow: each cover's halo is drawn as many stacked shadowed discs so it accumulates into a strong,
// clearly individual bloom. Passes × alpha set the intensity (fewer passes ⇒ softer glow).
const GLOW_BLUR = 16
const GLOW_ALPHA = 0.6
const GLOW_PASSES = 5

const rand = (a, b) => a + Math.random() * (b - a)
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

// Gentle single-overshoot ease-out — the node grows a hair past full size then settles, so it blooms in
// smoothly rather than snapping or jittering (a softened easeOutBack; smaller c1 = calmer overshoot).
function easeOutBack(x) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const c1 = 1.1
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2)
}

// Shrink an iTunes/mzstatic 600×600 artwork URL to a loader-appropriate size (nodes are ~16px, so a
// small thumbnail is plenty and much lighter). Non-matching URLs pass through untouched.
function thumbUrl(u) {
  return typeof u === 'string' ? u.replace('600x600bb', '160x160bb') : u
}

export default function MiniMapLoader({ height = 380, artUrls = [] }) {
  const canvasRef = useRef(null)
  // A stable key so the effect only re-runs when the actual set of covers changes, not on every render.
  const artKey = artUrls.join('|')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    // A tiny reusable offscreen canvas for sampling each cover's average colour (its glow tint).
    const sampler = document.createElement('canvas')
    sampler.width = sampler.height = 12
    const sctx = sampler.getContext('2d', { willReadFrequently: true })
    function sampleColor(img) {
      try {
        sctx.clearRect(0, 0, 12, 12)
        sctx.drawImage(img, 0, 0, 12, 12)
        const d = sctx.getImageData(0, 0, 12, 12).data
        let r = 0, g = 0, b = 0, n = 0
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++ }
        return `${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)}`
      } catch { return null } // canvas tainted (CORS refused) → keep the palette fallback tint
    }

    // Preload the cover pool as records { img, color }. The display image carries no CORS (so it always
    // draws — the main canvas never reads pixels back, so taint is harmless). A separate CORS "probe"
    // image of the same URL is used only to sample a per-cover glow colour; if CORS is refused it just
    // errors and the node keeps its palette-colour glow, with nothing visible lost.
    const images = artUrls.slice(0, 30).map((u) => {
      const rec = { img: new Image(), color: null }
      rec.img.decoding = 'async'
      rec.img.src = thumbUrl(u)

      const probe = new Image()
      probe.crossOrigin = 'anonymous'
      probe.decoding = 'async'
      probe.addEventListener('load', () => { rec.color = sampleColor(probe) })
      probe.src = thumbUrl(u)
      return rec
    })

    // Hand out covers without repetition so no two live nodes ever show the same album at once. A node
    // keeps its cover for life (relocating reuses the same one), so `used` only grows during the fill —
    // and the pool always has ≥ the node count, so every visible cover is distinct. If it were somehow
    // exhausted we fall back to a random one rather than leaving a node blank.
    const used = new Set()
    function pickArt() {
      if (!images.length) return null
      const free = images.filter((im) => !used.has(im))
      const chosen = free.length ? pick(free) : pick(images)
      used.add(chosen)
      return chosen
    }
    // Never ask for more distinct covers than exist (keeps every node unique when the pool is small).
    const fillTarget = images.length ? Math.min(FILL_TARGET, images.length) : FILL_TARGET
    const maxNodes = images.length ? Math.min(MAX_NODES, images.length) : MAX_NODES

    let W = 0, H = 0
    function resize() {
      const r = canvas.getBoundingClientRect()
      W = r.width; H = r.height
      canvas.width = Math.round(W * dpr)
      canvas.height = Math.round(H * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const nodes = []

    // The four pole-pill footprints as {cx, cy, hw} rects (half-height PILL_HH), each centred on the pill
    // BODY as it hangs inward from its axis end — so the clearance below covers the whole pill, not just
    // its outer edge. Half-widths are per label ("Intense" is the widest, "Dark" the narrowest).
    const pillZones = () => {
      const ix = W * AXIS_INSET_FRAC, iy = H * AXIS_INSET_FRAC
      return [
        { cx: W / 2, cy: iy + PILL_HH, hw: 42 },          // Intense (top)
        { cx: W / 2, cy: H - iy - PILL_HH, hw: 34 },       // Chill (bottom)
        { cx: ix + 30, cy: H / 2, hw: 30 },                // Dark (left)
        { cx: W - ix - 36, cy: H / 2, hw: 36 },            // Bright (right)
      ]
    }

    // A free spot: inside the 5% pad, clear of the axis lines and the pole pills, ≥ MIN_DIST from every
    // other node. `exclude` lets a relocating node ignore its own current position when hunting for one.
    function findSpot(exclude) {
      const zones = pillZones()
      for (let attempt = 0; attempt < 40; attempt++) {
        const x = rand(W * EDGE_PAD, W * (1 - EDGE_PAD))
        const y = rand(H * EDGE_PAD, H * (1 - EDGE_PAD))
        if (Math.abs(x - W / 2) < AXIS_CLEAR || Math.abs(y - H / 2) < AXIS_CLEAR) continue
        let ok = true
        for (const z of zones) {
          if (Math.abs(x - z.cx) < z.hw + PILL_MARGIN && Math.abs(y - z.cy) < PILL_HH + PILL_MARGIN) { ok = false; break }
        }
        if (!ok) continue
        for (const n of nodes) {
          if (n === exclude) continue
          if ((n.x - x) ** 2 + (n.y - y) ** 2 < MIN_DIST * MIN_DIST) { ok = false; break }
        }
        if (ok) return { x, y }
      }
      return null // container too crowded this tick
    }

    function makeNode(birth) {
      const spot = findSpot(null)
      if (!spot) return null // no room right now — skip, try again next spawn
      return {
        x: spot.x, y: spot.y, birth,
        state: 'alive', outStart: 0,
        r: NODE_R,
        color: pick(PALETTE),    // fallback glow tint until the cover's own colour is sampled
        art: pickArt(),          // the album cover record { img, color } this node carries for its whole life
        alpha: rand(0.75, 0.92),
        dwx: TAU / rand(4, 6), dpx: rand(0, TAU),
        dwy: TAU / rand(4, 6), dpy: rand(0, TAU),
      }
    }

    function spawn(birth) {
      if (nodes.length >= maxNodes) return
      const n = makeNode(birth)
      if (n) nodes.push(n)
    }

    const aliveNodes = () => nodes.filter((n) => n.state === 'alive')

    function drawAxes() {
      const ix = W * AXIS_INSET_FRAC, iy = H * AXIS_INSET_FRAC
      // White crosshair at value-50 on each axis (H/2 horizontal, W/2 vertical) — the live map's cross.
      ctx.strokeStyle = AXIS_COLOR
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(ix, H / 2); ctx.lineTo(W - ix, H / 2)
      ctx.moveTo(W / 2, iy); ctx.lineTo(W / 2, H - iy)
      ctx.stroke()

      // Pill-capped accent endpoint ticks at the song-band edges: X purple (mood), Y orange (energy).
      ctx.lineWidth = TICK_W
      ctx.lineCap = 'round'
      ctx.strokeStyle = ACCENT2
      for (const fx of PAD_X) {
        const x = W * fx
        ctx.beginPath(); ctx.moveTo(x, H / 2 - TICK_LEN / 2); ctx.lineTo(x, H / 2 + TICK_LEN / 2); ctx.stroke()
      }
      ctx.strokeStyle = ACCENT1
      for (const fy of PAD_Y) {
        const y = H * fy
        ctx.beginPath(); ctx.moveTo(W / 2 - TICK_LEN / 2, y); ctx.lineTo(W / 2 + TICK_LEN / 2, y); ctx.stroke()
      }
      ctx.lineCap = 'butt'
    }

    function drawNode(n, now, animate) {
      if (n.state === 'hidden') return // between fade-out and re-emergence: fully gone this frame
      let x = n.x, y = n.y
      if (animate) {
        const t = now / 1000
        x += Math.sin(t * n.dwx + n.dpx) * DRIFT_AMP
        y += Math.sin(t * n.dwy + n.dpy) * DRIFT_AMP
      }
      const age = now - n.birth
      const inT = animate ? Math.min(1, age / IN_MS) : 1
      const scale = animate ? easeOutBack(inT) : 1
      // Opacity blooms in a little ahead of the scale settling (smoother, no hard edge on arrival) and
      // multiplies with the fade-out when the node is leaving.
      const fadeIn = animate ? Math.min(1, age / (IN_MS * 0.65)) : 1
      const fadeOut = (animate && n.state === 'out') ? Math.max(0, 1 - (now - n.outStart) / OUT_MS) : 1
      const opacity = fadeIn * fadeOut
      const r = n.r * scale
      if (r <= 0.1 || opacity <= 0) return

      // Strong outer glow in this cover's OWN colour (sampled from its album art), matching how live nodes
      // glow with their art colour. Until the sample lands we fall back to the node's palette tint. The
      // halo is several stacked shadowed discs, so it reads as a bold individual bloom; when the cover
      // paints over the disc the halo still spills past the rim.
      const glow = (n.art && n.art.color) || n.color
      ctx.save()
      ctx.globalAlpha = opacity
      ctx.shadowColor = `rgba(${glow}, ${GLOW_ALPHA})`
      ctx.shadowBlur = GLOW_BLUR
      ctx.fillStyle = `rgba(${glow}, ${n.alpha})`
      for (let i = 0; i < GLOW_PASSES; i++) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill() }
      ctx.restore()

      // The album cover, clipped into the circle. Covers are square, so a 2r box fills the disc exactly.
      // Until the image decodes we leave the tinted disc above showing, so a node never reads as empty.
      const img = n.art && n.art.img
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.save()
        ctx.globalAlpha = opacity
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.closePath(); ctx.clip()
        ctx.drawImage(img, x - r, y - r, r * 2, r * 2)
        ctx.restore()
      }

      // Thin white border ring — matches the live map's circle nodes. Drawn glow-free.
      ctx.save()
      ctx.globalAlpha = opacity
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke()
      ctx.restore()
    }

    // Reduced motion: ~18 static nodes, no animation. Draw once, then redraw as covers decode so the
    // constellation still ends up showing real art rather than the colour fallbacks.
    if (reduce) {
      for (let i = 0; i < fillTarget; i++) spawn(0)
      const paint = () => {
        ctx.clearRect(0, 0, W, H)
        drawAxes()
        for (const n of nodes) drawNode(n, 0, false)
      }
      paint()
      for (const rec of images) rec.img.addEventListener('load', paint)
      return () => { for (const rec of images) rec.img.removeEventListener('load', paint) }
    }

    // Lifecycle: Phase 1 fills the pool one node at a time; Phase 2 reshuffles forever — one node at a
    // time fades out and re-emerges (same cover, same glow) at a different free coordinate.
    let phase = 'fill'
    const start = performance.now()
    let nextFillAt = start + rand(FILL_MIN, FILL_MAX)
    let nextTransAt = 0                 // when to begin the next reshuffle (set on entering steady state)
    let trans = null                    // the single in-flight transition: { stage: 'out'|'pause', victim, pauseStart }

    let raf = 0, running = true
    function frame(now) {
      if (!running) return

      if (phase === 'fill') {
        // Spawn one node per jittered interval until the pool reaches the fill target.
        if (now >= nextFillAt) {
          spawn(now)
          nextFillAt = now + rand(FILL_MIN, FILL_MAX)
        }
        if (aliveNodes().length >= fillTarget) {
          phase = 'steady'
          nextTransAt = now + rand(STEADY_MIN, STEADY_MAX)
        }
      } else {
        // Steady state: at most one transition at a time. Fade one node out, hold it hidden through a
        // short pause, then pop the SAME node (same cover + glow) back in at a new free coordinate.
        if (!trans && now >= nextTransAt) {
          const alive = aliveNodes()
          if (alive.length) {
            const victim = pick(alive)
            victim.state = 'out'
            victim.outStart = now
            trans = { stage: 'out', victim, pauseStart: 0 }
          } else {
            nextTransAt = now + rand(STEADY_MIN, STEADY_MAX)
          }
        }
        if (trans && trans.stage === 'out' && now - trans.victim.outStart >= OUT_MS) {
          trans.victim.state = 'hidden' // fully gone; it will re-emerge elsewhere after the pause
          trans.stage = 'pause'
          trans.pauseStart = now
        }
        if (trans && trans.stage === 'pause' && now - trans.pauseStart >= PAUSE_MS) {
          const v = trans.victim
          const spot = findSpot(v)          // a new coordinate, clear of the axis and the other nodes
          if (spot) { v.x = spot.x; v.y = spot.y }
          v.dpx = rand(0, TAU); v.dpy = rand(0, TAU) // fresh drift phase so it doesn't jump mid-wobble
          v.birth = now                     // reset age → pops back in with the scale spring
          v.state = 'alive'
          trans = null
          nextTransAt = now + rand(STEADY_MIN, STEADY_MAX)
        }
      }

      ctx.clearRect(0, 0, W, H)
      drawAxes()
      for (const n of nodes) drawNode(n, now, true)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    const onResize = () => resize()
    window.addEventListener('resize', onResize)
    return () => {
      running = false
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    }
  }, [artKey])

  return (
    <div style={{
      position: 'relative',
      boxSizing: 'border-box',
      width: '100%',
      height,
      borderRadius: RADIUS.card,
      overflow: 'hidden',
      backgroundColor: NEO_RAIL_SURFACE,   // #0F0F0F — icon-rail container floor (matches the pop-up card)
      border: '1px solid rgba(255,255,255,0.08)', // frame around the loading animation
      backgroundImage: LINE_GRID,     // same 22px CSS line grid as the map card
      backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
    }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />

      {/* Pole pills capping the four axis ends, each hanging inward from its end — same recessed pill as
          the live map's axis terminators (scaled down for the mini map). Static furniture, no animation. */}
      <PolePill label={POLE.yHigh} color={ACCENT1} style={{ top: `${AXIS_INSET_FRAC * 100}%`, left: '50%', transform: 'translateX(-50%)' }} />
      <PolePill label={POLE.yLow}  color={ACCENT1} style={{ bottom: `${AXIS_INSET_FRAC * 100}%`, left: '50%', transform: 'translateX(-50%)' }} />
      <PolePill label={POLE.xLow}  color={ACCENT2} style={{ left: `${AXIS_INSET_FRAC * 100}%`, top: '50%', transform: 'translateY(-50%)' }} />
      <PolePill label={POLE.xHigh} color={ACCENT2} style={{ right: `${AXIS_INSET_FRAC * 100}%`, top: '50%', transform: 'translateY(-50%)' }} />
    </div>
  )
}

// Recessed axis-terminator pill, mirrored from DriftMap's pillBase at a smaller scale for the mini map.
function PolePill({ label, color, style }) {
  return (
    <span style={{
      position: 'absolute',
      display: 'inline-flex',
      alignItems: 'center',
      padding: '3px 11px',
      borderRadius: 100,
      background: '#0f0f0f',
      border: '1px solid #000000',
      boxShadow: '0px 0px 2.5px 0px #000000, inset 0px 0px 5px 0px rgba(80,80,80,0.5)',
      fontFamily: FONT,
      fontSize: 10,
      fontWeight: 500,
      letterSpacing: '0.01em',
      whiteSpace: 'nowrap',
      color,
      pointerEvents: 'none',
      zIndex: 2, // always above the canvas nodes — a node (or its glow) never paints over a pill
      ...style,
    }}>
      {label}
    </span>
  )
}
