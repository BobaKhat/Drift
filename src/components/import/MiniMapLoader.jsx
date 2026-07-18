import { useEffect, useRef } from 'react'
import { RADIUS, NEO_SCREEN_BG, NEO_SCREEN_INSET } from './tokens'

// Purely decorative loading animation: a miniature Orion map where fake nodes continuously pop in and
// fade out, so the import screen reads as "your map is being built." No real track data, no progress —
// just a constellation that keeps gently reshuffling. Grid + recessed screen match the live map; the
// canvas over it draws the axis cross and the nodes.

const GRID_LINE = 'rgba(255,255,255,0.035)' // matches the live map's ruling colour
const GRID_SIZE = 16                         // scaled down from the map's 22px so the container reads as a tiny map
const LINE_GRID = `linear-gradient(to right, ${GRID_LINE} 1px, transparent 1px), linear-gradient(to bottom, ${GRID_LINE} 1px, transparent 1px)`

const AXIS_COLOR = 'rgba(242,127,55,0.15)' // orange axis cross at 15%
const AXIS_INSET = 12                        // px the cross holds off the container edges
const AXIS_CLEAR = 12                        // keep nodes this far off the axis lines

const MIN_NODES = 16, MAX_NODES = 24         // pool size kept between these
const SEED_NODES = 20                        // initial fill (also the reduced-motion static count)
const EDGE_PAD = 0.05                        // 5% inset for node placement
const MIN_DIST = 20                          // no two node centres closer than this
const NODE_R_MIN = 3, NODE_R_MAX = 4         // ~6–8px circles

const IN_MS = 300                            // pop-in spring
const OUT_MS = 400                           // fade-out
const GLOW_MS = 500                          // arrival glow pulse
const DRIFT_AMP = 1.5                        // ambient float (px)
const WARM = '255, 235, 210'
const TAU = Math.PI * 2

const rand = (a, b) => a + Math.random() * (b - a)

// Spring/elastic ease-out — overshoots just past 1 then settles, so nodes pop rather than fade in.
function easeOutElastic(x) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const c4 = TAU / 3
  return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1
}

export default function MiniMapLoader({ height = 380 }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

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

    function makeNode(birth) {
      // A free spot: inside the 5% pad, clear of the axis lines, ≥ MIN_DIST from every other node.
      for (let attempt = 0; attempt < 30; attempt++) {
        const x = rand(W * EDGE_PAD, W * (1 - EDGE_PAD))
        const y = rand(H * EDGE_PAD, H * (1 - EDGE_PAD))
        if (Math.abs(x - W / 2) < AXIS_CLEAR || Math.abs(y - H / 2) < AXIS_CLEAR) continue
        let ok = true
        for (const n of nodes) {
          if ((n.x - x) ** 2 + (n.y - y) ** 2 < MIN_DIST * MIN_DIST) { ok = false; break }
        }
        if (!ok) continue
        return {
          x, y, birth,
          state: 'alive', outStart: 0,
          r: rand(NODE_R_MIN, NODE_R_MAX),
          alpha: rand(0.7, 0.9),
          dwx: TAU / rand(4, 6), dpx: rand(0, TAU),
          dwy: TAU / rand(4, 6), dpy: rand(0, TAU),
        }
      }
      return null // container too crowded this tick — skip, try again next spawn
    }

    function spawn(birth) {
      if (nodes.length >= MAX_NODES) return
      const n = makeNode(birth)
      if (n) nodes.push(n)
    }

    function despawn(now) {
      const alive = nodes.filter((n) => n.state === 'alive')
      if (alive.length <= MIN_NODES) return
      const victim = alive[Math.floor(Math.random() * alive.length)]
      victim.state = 'out'
      victim.outStart = now
    }

    function drawAxes() {
      ctx.strokeStyle = AXIS_COLOR
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(AXIS_INSET, H / 2); ctx.lineTo(W - AXIS_INSET, H / 2)
      ctx.moveTo(W / 2, AXIS_INSET); ctx.lineTo(W / 2, H - AXIS_INSET)
      ctx.stroke()
    }

    function drawNode(n, now, animate) {
      let x = n.x, y = n.y
      if (animate) {
        const t = now / 1000
        x += Math.sin(t * n.dwx + n.dpx) * DRIFT_AMP
        y += Math.sin(t * n.dwy + n.dpy) * DRIFT_AMP
      }
      const age = now - n.birth
      const scale = animate ? (age >= IN_MS ? 1 : easeOutElastic(age / IN_MS)) : 1
      const fade = (animate && n.state === 'out') ? Math.max(0, 1 - (now - n.outStart) / OUT_MS) : 1
      const r = n.r * scale
      if (r <= 0.1 || fade <= 0) return

      // Arrival glow pulse — additive warm halo, fading over GLOW_MS.
      if (animate && age < GLOW_MS) {
        const g = 1 - age / GLOW_MS
        const rad = n.r * 3
        const grd = ctx.createRadialGradient(x, y, 0, x, y, rad)
        grd.addColorStop(0, `rgba(${WARM}, ${0.5 * g})`)
        grd.addColorStop(1, `rgba(${WARM}, 0)`)
        ctx.save()
        ctx.globalCompositeOperation = 'lighter'
        ctx.fillStyle = grd
        ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill()
        ctx.restore()
      }

      // Solid warm-white dot with a soft glow (box-shadow 0 0 6px rgba(255,235,210,0.3) equivalent).
      ctx.save()
      ctx.globalAlpha = fade
      ctx.shadowColor = `rgba(${WARM}, 0.3)`
      ctx.shadowBlur = 6
      ctx.fillStyle = `rgba(${WARM}, ${n.alpha})`
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill()
      ctx.restore()
    }

    // Reduced motion: ~20 static dots, drawn once, no animation.
    if (reduce) {
      for (let i = 0; i < SEED_NODES; i++) spawn(0)
      ctx.clearRect(0, 0, W, H)
      drawAxes()
      for (const n of nodes) drawNode(n, 0, false)
      return () => {}
    }

    // Seed the initial constellation with staggered births so it cascades in rather than flashing.
    const startAt = performance.now()
    for (let i = 0; i < SEED_NODES; i++) spawn(startAt + i * 60)

    // Two lightly-jittered timers, offset so pop-ins and pop-outs interleave instead of firing together.
    let nextSpawn = startAt + rand(300, 500)
    let nextDespawn = startAt + rand(450, 700)

    let raf = 0, running = true
    function frame(now) {
      if (!running) return
      if (now >= nextSpawn) { spawn(now); nextSpawn = now + rand(300, 500) }
      if (now >= nextDespawn) { despawn(now); nextDespawn = now + rand(300, 500) }
      // Retire nodes whose fade-out has finished.
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (nodes[i].state === 'out' && now - nodes[i].outStart > OUT_MS) nodes.splice(i, 1)
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
  }, [])

  return (
    <div style={{
      width: '100%',
      height,
      borderRadius: RADIUS.card,
      overflow: 'hidden',
      backgroundColor: NEO_SCREEN_BG, // #0d0d0f — recessed screen, same face as the deck's readouts
      backgroundImage: LINE_GRID,     // mini version of the map's CSS grid
      backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
      boxShadow: NEO_SCREEN_INSET,
    }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  )
}
