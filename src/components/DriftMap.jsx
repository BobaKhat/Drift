import { useMemo, useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  useNodesState,
  useReactFlow,
  useOnViewportChange,
  useStoreApi,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import TrackNode, { ZOOM_PILL, ZOOM_CARD, ZoomTierContext, BuildContext, BloomContext, SongPreviewCard, getTier, getNodeScale } from './TrackNode'
import WireEdge, { FLOW_STROBE_NAME, FLOW_OFF_START, FLOW_OFF_END, FLOW_SWEEP_S, FLOW_CYCLE_S } from './WireEdge'
import WireDragLayer from './WireDragLayer'
import { usePlaylistStore } from '../store/usePlaylistStore'
import { getFeatureValue, resolvePreset } from '../lib/presets'
import { computeBuildGraph } from '../lib/setChain'
import { scoreCompatibility } from '../lib/compatibility'
import CompassPreview from './CompassPreview'
import CompatibilityCard from './CompatibilityCard'
import FlowToggle from './FlowToggle'

// Flow-space canvas dimensions. A large canvas gives songs room to separate as you
// zoom in (Google Maps model, Decision Log #17) — the primary energy×mood mapping only
// resolves songs to a coarse position, so the extra pixels are what reveals granularity.
const W = 6000
const H = 6000

// Map the 0–100 feature range into the inner 5%–95% of the canvas (Decision Log #22),
// so songs at the extremes sit near the axis terminator pills, not on top of them.
const PAD = { x: [W * 0.05, W * 0.95], y: [H * 0.05, H * 0.95] }

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Secondary-feature tiebreaker signal, ∈ [-0.5, 0.5] per axis. Each axis blends two features
// so two songs that share one secondary value still separate on the other. BPM is raw, so
// normalize it against a typical 60–180 range first. Deterministic — same track, same signal.
// It's blended into the value-space jitter (not added as a canvas offset) so it can never push
// a song out of its integer cell — keeping the strict-order and quadrant guarantees intact.
function tiebreakerSignal(track) {
  const dance = clamp(track.danceability ?? 50, 0, 100) / 100 - 0.5 // -0.5..0.5
  const acoustic = clamp(track.acousticness ?? 50, 0, 100) / 100 - 0.5
  const bpmN = (clamp(track.bpm ?? 120, 60, 180) - 60) / 120 - 0.5
  return { sx: dance * 0.7 + acoustic * 0.3, sy: bpmN * 0.7 + acoustic * 0.3 }
}

// —— Deterministic jitter ————————————————————————————————————————————————————————
// SoundNet rounds features to integers, so many songs share an exact value and stack on the
// same pixel. We scatter each song within ±0.5 of its integer value — a standard overplotting
// technique that visualizes measurement uncertainty, not invented positions. The offset is
// seeded by the track's own data so the same song lands in the same spot across reloads. Two
// independent values (x/y) come from the two halves of one 32-bit hash, so songs scatter in
// 2D rather than along a diagonal.
function hashStr(str) {
  let h = 0x811c9dc5 // FNV-1a, 32-bit
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function jitterPair(track) {
  const h = hashStr(`${track.id ?? ''}|${track.bpm ?? ''}|${track.danceability ?? ''}|${track.acousticness ?? ''}`)
  // Each in [-0.5, 0.5). The open upper bound keeps strict order across integers: value v's
  // jitter never reaches v+0.5, so it can't meet or pass (v+1)'s lowest jittered value.
  const jx = (h & 0xffff) / 0x10000 - 0.5
  const jy = ((h >>> 16) & 0xffff) / 0x10000 - 0.5
  return { jx, jy }
}

// —— Density-based axis scaling ———————————————————————————————————————————————————
// Map the 0–100 feature range to a 0–1 canvas fraction non-linearly: ranges where songs are
// concentrated get more canvas, sparse ranges compress. It re-rules, it doesn't re-plot — the
// mapping is monotonic so song order is preserved exactly. Each half (below/above 50) is
// equalized independently and pinned to [0,0.5] / [0.5,1], so value 50 always lands on the
// quadrant crosshair and no song leaves its vibe zone.
const SCALE_BINS = 32
const DENSITY_FLOOR = 0.2 // min weight per bin — keeps sparse ranges from collapsing to zero

function buildHalfScale(values, lo, hi) {
  const span = hi - lo
  const hist = new Array(SCALE_BINS).fill(0)
  for (const v of values) {
    hist[clamp(Math.floor(((v - lo) / span) * SCALE_BINS), 0, SCALE_BINS - 1)] += 1
  }
  const maxCount = Math.max(1, ...hist)
  // Cumulative bin edges weighted by density (+ floor), normalized to [0,1].
  const edges = new Array(SCALE_BINS + 1)
  edges[0] = 0
  for (let i = 0; i < SCALE_BINS; i++) edges[i + 1] = edges[i] + DENSITY_FLOOR + hist[i] / maxCount
  const total = edges[SCALE_BINS]
  for (let i = 0; i <= SCALE_BINS; i++) edges[i] /= total
  // Piecewise-linear value→fraction. Strictly increasing (floor > 0), so order holds with no ties.
  return (v) => {
    const t = clamp((v - lo) / span, 0, 1) * SCALE_BINS
    const i = Math.min(SCALE_BINS - 1, Math.floor(t))
    return edges[i] + (edges[i + 1] - edges[i]) * (t - i)
  }
}

function buildAxisScale(values) {
  const v = values.map((x) => clamp(x ?? 50, 0, 100))
  const fLow = buildHalfScale(v.filter((x) => x < 50), 0, 50)
  const fUp = buildHalfScale(v.filter((x) => x >= 50), 50, 100)
  return (val) => {
    const c = clamp(val, 0, 100)
    return c < 50 ? 0.5 * fLow(c) : 0.5 + 0.5 * fUp(c)
  }
}

// X axis = mood/valence: dark (low) → left, bright (high) → right.
// Y axis = energy: intense (high) → top (low Y), chill (low) → bottom (high Y).
// scaleX/scaleY are the density remaps for the active library.
function toFlowPos(track, scaleX, scaleY, xFeature, yFeature) {
  const xVal = getFeatureValue(track, xFeature)
  const yVal = getFeatureValue(track, yFeature)
  const { jx, jy } = jitterPair(track)
  const { sx, sy } = tiebreakerSignal(track)

  const mx = xVal + (jx + sx) / 2
  const my = yVal + (jy + sy) / 2
  return {
    x: scaleX(mx) * (PAD.x[1] - PAD.x[0]) + PAD.x[0],
    y: (1 - scaleY(my)) * (PAD.y[1] - PAD.y[0]) + PAD.y[0],
  }
}

// Per-node stagger for the population bloom (Slice 11.5): nodes bloom in a RANDOM order, each rank
// getting rank × 15ms of delay, so songs pop in scattered rather than sweeping across the map.
const BLOOM_STAGGER_MS = 15

function buildNodes(tracks, presetConfig) {
  const { xFeature = 'mood', yFeature = 'energy' } = presetConfig ?? {}
  const scaleX = buildAxisScale(tracks.map((t) => getFeatureValue(t, xFeature)))
  const scaleY = buildAxisScale(tracks.map((t) => getFeatureValue(t, yFeature)))
  const nodes = tracks.map((track, i) => {
    const pos = toFlowPos(track, scaleX, scaleY, xFeature, yFeature)
    return {
      id: track.id ?? `track-${i}`,
      type: 'track',
      position: pos,
      origin: [0.5, 0.5],
      data: {
        name: track.name,
        artist: track.artist,
        albumArtUrl: track.album_art_url,
        bpm: track.bpm ?? null,
        camelot: track.camelot ?? null,
        highlighted: false,
        bloomDelay: 0,
      },
      draggable: false,
      selectable: false,
      connectable: false,
    }
  })
  // Random stagger: shuffle the node order (Fisher–Yates), then delay = rank × 15ms.
  const order = nodes.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  order.forEach((nodeIdx, rank) => { nodes[nodeIdx].data.bloomDelay = rank * BLOOM_STAGGER_MS })
  return nodes
}

const nodeTypes = { track: TrackNode }
const edgeTypes = { wire: WireEdge }

const FONT = "'DM Sans', system-ui, -apple-system, sans-serif"
const AXIS_COLOR = 'rgba(255,255,255,0.10)'
const ACCENT1 = '#F27F37' // Intense / Chill (energy axis)
const ACCENT2 = '#4B6AE5' // Dark / Bright (mood axis)
const MAP_BG = '#141415'
const CARD = '#141416'
const BORDER = '#222224'
const TEXT_SECONDARY = '#848484'

// Layout: rail + map are separate cards floating on a black page, both inset 10px from the
// edges with a 10px gap between them (Figma node 748-2842). The map card starts after the rail.
const PAGE_INSET = 10
const RAIL_W = 93
const RAIL_GAP = 10
const MAP_LEFT = PAGE_INSET + RAIL_W + RAIL_GAP // 113
const EDGE = 16 // inset of axis pills / brackets from the map card edge

// Static dot grid (Figma "Backgrind grid") painted on the map card.
const DOT_GRID = 'radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1.3px)'

// Axis terminator pill (Figma): pill-shaped, recessed inner glow, accent-colored label.
const pillBase = {
  position: 'absolute',
  display: 'inline-flex',
  alignItems: 'center',
  padding: '8px 22px',
  borderRadius: 100,
  background: '#0f0f0f',
  border: '1px solid #000000',
  boxShadow: '0px 0px 2.5px 0px #000000, inset 0px 0px 5px 0px rgba(80,80,80,0.5)',
  fontFamily: FONT,
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: '0.01em',
  whiteSpace: 'nowrap',
  zIndex: 3,
}

// L-shaped HUD corner bracket at the map card's inner corners.
function Bracket({ pos }) {
  const c = 'rgba(255,255,255,0.22)'
  const w = '1.5px solid ' + c
  const size = 22
  const variants = {
    tl: { top: EDGE, left: EDGE, borderTop: w, borderLeft: w, borderTopLeftRadius: 3 },
    tr: { top: EDGE, right: EDGE, borderTop: w, borderRight: w, borderTopRightRadius: 3 },
    bl: { bottom: EDGE, left: EDGE, borderBottom: w, borderLeft: w, borderBottomLeftRadius: 3 },
    br: { bottom: EDGE, right: EDGE, borderBottom: w, borderRight: w, borderBottomRightRadius: 3 },
  }
  return <div style={{ position: 'absolute', width: size, height: size, ...variants[pos] }} />
}

// Small HUD chip naming the quadrant under the viewport centre once you're zoomed in.
// Opacity is controlled imperatively (no React state) so pan/zoom updates are instant and
// avoid re-renders on every frame. pointerEvents: 'auto' overrides the parent's 'none'.
const zoneChipStyle = {
  position: 'absolute',
  left: EDGE + 30,
  bottom: EDGE,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  padding: '6px 14px',
  borderRadius: 100,
  background: '#0f0f0f',
  border: '1px solid #000000',
  boxShadow: '0px 0px 2.5px 0px #000000, inset 0px 0px 5px 0px rgba(80,80,80,0.5)',
  fontFamily: FONT,
  fontSize: 12,
  fontWeight: 500,
  letterSpacing: '0.02em',
  color: '#cfcfcf',
  whiteSpace: 'nowrap',
  zIndex: 3,
  cursor: 'pointer',
  pointerEvents: 'auto',
}

// Zone option row in the chip dropdown.
function ZoneOption({ label, onSelect, isLast }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseDown={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '9px 16px',
        cursor: 'pointer',
        fontFamily: FONT,
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: '0.02em',
        color: '#cfcfcf',
        background: hovered ? 'rgba(255,255,255,0.06)' : 'transparent',
        borderBottom: isLast ? 'none' : `1px solid ${BORDER}`,
        whiteSpace: 'nowrap',
        userSelect: 'none',
      }}
    >
      {label}
    </div>
  )
}

// Crosshair opacity by zoom: full through the circle tier, fades across the pill tier, gone by
// the card tier.
function crosshairOpacityFor(zoom) {
  return clamp((ZOOM_CARD - zoom) / (ZOOM_CARD - ZOOM_PILL), 0, 1)
}

// Drive per-frame zoom work (the node counter-scale) WITHOUT a second useOnViewportChange: that
// hook stores a single `onViewportChange` handler, so a second subscriber would clobber AxisLayer's
// (which owns it for the crosshair/pills). Instead we subscribe to the ReactFlow store's transform
// imperatively — it fires on interactive AND programmatic viewport changes, with no React
// re-render — and coalesce to ~30fps with requestAnimationFrame (trailing edge, so the final zoom
// always lands). Only zoom changes schedule work; pan (zoom unchanged) is a no-op for scaling.
const VIEWPORT_FRAME_MS = 32 // ~30fps

function useThrottledZoom(onZoom) {
  const store = useStoreApi()
  const cbRef = useRef(onZoom)
  useEffect(() => { cbRef.current = onZoom })

  useEffect(() => {
    let raf = 0
    let last = 0
    let zoom = store.getState().transform[2]
    const run = () => {
      const now = performance.now()
      if (now - last < VIEWPORT_FRAME_MS) { raf = requestAnimationFrame(run); return }
      last = now
      raf = 0
      cbRef.current?.(zoom)
    }
    const unsub = store.subscribe((s) => {
      const z = s.transform[2]
      if (z === zoom) return
      zoom = z
      if (!raf) raf = requestAnimationFrame(run)
    })
    return () => { unsub(); if (raf) cancelAnimationFrame(raf) }
  }, [store])
}

// AxisLayer overlay. The crosshair lines mark value 50 on each axis (= canvas centre W/2, H/2)
// and the pole pills sit at the crosshair endpoints: all of it lives in canvas space and
// pans/zooms with the map, fading out as you zoom in since it's only an overview aid. A zone chip
// names the quadrant under the viewport centre, fading in as the crosshair fades out.
// Positions/opacities are written imperatively per frame (via useOnViewportChange) so the lines
// and pills stay locked to the nodes with no batch-cycle lag — no React re-render on pan/zoom.
function AxisLayer({ preset }) {
  const rf = useReactFlow()
  const rootRef = useRef(null)
  const hLineRef = useRef(null)
  const vLineRef = useRef(null)
  const intenseRef = useRef(null)
  const chillRef = useRef(null)
  const darkRef = useRef(null)
  const brightRef = useRef(null)
  const chipRef = useRef(null)
  const chipLabelRef = useRef(null)
  const dimsRef = useRef({ w: 0, h: 0 })
  const [chipOpen, setChipOpen] = useState(false)

  const { setActiveQuadrant } = usePlaylistStore()
  const setActiveQuadrantRef = useRef(setActiveQuadrant)
  useEffect(() => { setActiveQuadrantRef.current = setActiveQuadrant }, [setActiveQuadrant])
  const prevQuadrantRef = useRef(null)

  // Keep preset labels in a ref so applyViewport (stable useCallback) always reads the latest
  // values without needing to be recreated on every preset change.
  const labelsRef = useRef({ yHigh: preset.yHigh, yLow: preset.yLow, xHigh: preset.xHigh, xLow: preset.xLow })
  useEffect(() => {
    labelsRef.current = { yHigh: preset.yHigh, yLow: preset.yLow, xHigh: preset.xHigh, xLow: preset.xLow }
  }, [preset])

  const applyViewport = useCallback(({ x, y, zoom }) => {
    // Crosshair lines: canvas centre mapped to screen, faded by zoom.
    const cx = (W / 2) * zoom + x
    const cy = (H / 2) * zoom + y
    const lineOpacity = crosshairOpacityFor(zoom)
    if (hLineRef.current) { hLineRef.current.style.top = `${cy}px`; hLineRef.current.style.opacity = lineOpacity }
    if (vLineRef.current) { vLineRef.current.style.left = `${cx}px`; vLineRef.current.style.opacity = lineOpacity }

    // Pills ride the crosshair endpoints — Intense/Chill slide along the vertical axis (x = cx),
    // Dark/Bright along the horizontal (y = cy) — and fade with the lines (same opacity).
    if (intenseRef.current) { intenseRef.current.style.left = `${cx}px`; intenseRef.current.style.opacity = lineOpacity }
    if (chillRef.current) { chillRef.current.style.left = `${cx}px`; chillRef.current.style.opacity = lineOpacity }
    if (darkRef.current) { darkRef.current.style.top = `${cy}px`; darkRef.current.style.opacity = lineOpacity }
    if (brightRef.current) { brightRef.current.style.top = `${cy}px`; brightRef.current.style.opacity = lineOpacity }

    // Zone chip: quadrant under the viewport centre; fades in as the crosshair fades out.
    const { w, h } = dimsRef.current
    if (chipRef.current && chipLabelRef.current) {
      const { yHigh, yLow, xHigh, xLow } = labelsRef.current
      const cxCanvas = (w / 2 - x) / zoom
      const cyCanvas = (h / 2 - y) / zoom
      chipLabelRef.current.textContent = `${cyCanvas <= H / 2 ? yHigh : yLow} · ${cxCanvas >= W / 2 ? xHigh : xLow}`
      chipRef.current.style.opacity = 1 - lineOpacity
    }

    // Compass quadrant: TR/TL/BR/BL based on canvas centre of the viewport.
    const qx = (w / 2 - x) / zoom
    const qy = (h / 2 - y) / zoom
    const quadrant = qy <= H / 2
      ? (qx >= W / 2 ? 'TR' : 'TL')
      : (qx >= W / 2 ? 'BR' : 'BL')
    // Only push to the store when it actually changes — this fired every frame before, churning
    // store subscribers (the compass widgets) on every pan even when the quadrant was unchanged.
    if (quadrant !== prevQuadrantRef.current) {
      prevQuadrantRef.current = quadrant
      setActiveQuadrantRef.current(quadrant)
    }
  }, [])

  // Close chip dropdown on click outside.
  useEffect(() => {
    if (!chipOpen) return
    const handler = (e) => {
      if (!chipRef.current?.contains(e.target)) setChipOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [chipOpen])

  // Measure the card once (and on resize) for the zone-chip quadrant math, then refresh.
  // Initialize chip opacity to 0 here (not in JSX style) so React re-renders triggered by
  // chipOpen state don't reset the imperatively-managed opacity value.
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    if (chipRef.current) chipRef.current.style.opacity = '0'
    const measure = () => { dimsRef.current = { w: el.clientWidth, h: el.clientHeight }; applyViewport(rf.getViewport()) }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [applyViewport, rf])

  useOnViewportChange({ onChange: applyViewport })

  const panToZone = useCallback((label) => {
    const { yHigh, xHigh } = labelsRef.current
    const isTop = label.startsWith(yHigh)
    const isRight = label.endsWith(xHigh)
    rf.setCenter(isRight ? (W * 3) / 4 : W / 4, isTop ? H / 4 : (H * 3) / 4, { zoom: 0.4, duration: 600 })
    setChipOpen(false)
  }, [rf])

  const zones = useMemo(() => [
    `${preset.yHigh} · ${preset.xHigh}`,
    `${preset.yHigh} · ${preset.xLow}`,
    `${preset.yLow} · ${preset.xHigh}`,
    `${preset.yLow} · ${preset.xLow}`,
  ], [preset])

  return (
    <div ref={rootRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {/* Crosshair in canvas space (position set per frame) — marks value 50 on each axis. */}
      <div ref={hLineRef} style={{ position: 'absolute', top: 0, left: EDGE, right: EDGE, height: 1, background: AXIS_COLOR, transform: 'translateY(-0.5px)' }} />
      <div ref={vLineRef} style={{ position: 'absolute', left: 0, top: EDGE, bottom: EDGE, width: 1, background: AXIS_COLOR, transform: 'translateX(-0.5px)' }} />

      <Bracket pos="tl" />
      <Bracket pos="tr" />
      <Bracket pos="bl" />
      <Bracket pos="br" />

      {/* Pole pills on the canvas crosshair — left/top set per frame; fade with the lines. */}
      <span ref={intenseRef} style={{ ...pillBase, top: EDGE, transform: 'translateX(-50%)', color: ACCENT1 }}>{preset.yHigh}</span>
      <span ref={chillRef}   style={{ ...pillBase, bottom: EDGE, transform: 'translateX(-50%)', color: ACCENT1 }}>{preset.yLow}</span>
      <span ref={darkRef}    style={{ ...pillBase, left: EDGE, transform: 'translateY(-50%)', color: ACCENT2 }}>{preset.xLow}</span>
      <span ref={brightRef}  style={{ ...pillBase, right: EDGE, transform: 'translateY(-50%)', color: ACCENT2 }}>{preset.xHigh}</span>

      {/* Zone chip — fades in when zoomed in, replacing the crosshair as orientation aid.
          Opacity is managed imperatively; clicking opens a 4-quadrant pan shortcut. */}
      <div
        ref={chipRef}
        style={zoneChipStyle}
        onClick={() => setChipOpen((o) => !o)}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT1, flexShrink: 0 }} />
        <span ref={chipLabelRef} />
        <svg width="9" height="5" viewBox="0 0 9 5" fill="none" style={{ flexShrink: 0, marginLeft: 1 }}>
          <path d="M1 1L4.5 4.5L8 1" stroke="#888" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>

        {/* Dropdown — opens above the chip since it sits at the bottom of the card. */}
        {chipOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 8px)',
              left: 0,
              background: '#0f0f0f',
              borderRadius: 12,
              border: `1px solid ${BORDER}`,
              boxShadow: '0 -4px 24px rgba(0,0,0,0.7)',
              overflow: 'hidden',
              minWidth: 170,
            }}
          >
            {zones.map((zone, i) => (
              <ZoneOption
                key={zone}
                label={zone}
                onSelect={() => panToZone(zone)}
                isLast={i === zones.length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


// —— Map chrome ————————————————————————————————————————————————————————————————

const barShadow = '4px 4px 2.5px 0px rgba(0,0,0,0.9), inset 1px 1.5px 3px 0px #373737'

function MagnifierIcon({ color }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="7.5" cy="7.5" r="5" stroke={color} strokeWidth="1.6" />
      <line x1="11.4" y1="11.4" x2="15.5" y2="15.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

// Individual search result row.
function SearchResult({ track, onSelect, isLast }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseDown={() => onSelect(track)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        cursor: 'pointer',
        background: hovered ? 'rgba(255,255,255,0.05)' : 'transparent',
        borderBottom: isLast ? 'none' : `1px solid ${BORDER}`,
        userSelect: 'none',
      }}
    >
      <div style={{ width: 36, height: 36, borderRadius: 5, overflow: 'hidden', flexShrink: 0 }}>
        {track.album_art_url ? (
          <img
            src={track.album_art_url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            draggable={false}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'rgba(255,255,255,0.3)' }}>
            ♪
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONT, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {track.name}
        </div>
        <div style={{ fontFamily: FONT, fontSize: 11, color: TEXT_SECONDARY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {track.artist}
        </div>
      </div>
    </div>
  )
}

// Top-left search pill — type-ahead search over the active playlist.
function SearchBar({ tracks, rf, onHighlight }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef(null)
  const inputRef = useRef(null)

  const results = useMemo(() => {
    if (query.length < 2) return []
    const q = query.toLowerCase()
    return tracks
      .filter((t) => t.name?.toLowerCase().includes(q) || t.artist?.toLowerCase().includes(q))
      .slice(0, 8)
  }, [query, tracks])

  // Dismiss on click outside.
  useEffect(() => {
    const handler = (e) => {
      if (!wrapperRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = useCallback((track) => {
    setQuery('')
    setOpen(false)
    const node = rf.getNode(track.id)
    if (node) {
      // Zoom to at least card tier so the song is readable after navigation.
      const targetZoom = Math.max(rf.getViewport().zoom, ZOOM_CARD + 0.1)
      rf.setCenter(node.position.x, node.position.y, { zoom: targetZoom, duration: 600 })
    }
    onHighlight(track.id)
  }, [rf, onHighlight])

  const showDropdown = open && query.length >= 2

  return (
    <div ref={wrapperRef} style={{ position: 'absolute', left: 19, top: 19, width: 350, zIndex: 4 }}>
      {/* Pill */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 10px 8px 22px',
          background: CARD,
          borderRadius: 100,
          boxShadow: barShadow,
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => { if (query.length >= 2) setOpen(true) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setOpen(false); setQuery(''); inputRef.current?.blur() }
          }}
          placeholder="Find a Song on Your Map"
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontFamily: FONT,
            fontSize: 14,
            fontWeight: 500,
            color: query ? '#fff' : TEXT_SECONDARY,
          }}
        />
        <div
          onClick={() => inputRef.current?.focus()}
          style={{
            width: 42,
            height: 42,
            borderRadius: '50%',
            // Always shows the Flow toggle ON knob treatment: orange ring + dark tinted fill + orange glyph.
            border: `1.5px solid ${ACCENT1}`,
            background: 'rgba(20,20,22,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            cursor: 'pointer',
          }}
        >
          <MagnifierIcon color={ACCENT1} />
        </div>
      </div>

      {/* Results dropdown */}
      {showDropdown && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            right: 0,
            background: CARD,
            borderRadius: 16,
            border: `1px solid ${BORDER}`,
            boxShadow: '0 8px 32px rgba(0,0,0,0.65)',
            overflow: 'hidden',
          }}
        >
          {results.length === 0 ? (
            <div style={{ padding: '14px 20px', fontFamily: FONT, fontSize: 13, color: TEXT_SECONDARY }}>
              No songs found
            </div>
          ) : (
            results.map((track, i) => (
              <SearchResult
                key={track.id}
                track={track}
                onSelect={handleSelect}
                isLast={i === results.length - 1}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function ToolDivider() {
  return <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />
}

function ToolButton({ children, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        width: 40,
        height: 40,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: CARD,
        color: '#9a9a9a',
        boxShadow: 'inset -1px -1px 3px 0px #373737, inset 2px 2px 2px 0px rgba(0,0,0,0.7)',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {children}
    </div>
  )
}

// Top-right toolbar: active preset label + zoom controls + compass dropdown.
function ToolBar({ rf, presetName = 'Vibe', activePreset }) {
  const stroke = '#9a9a9a'
  const [compassOpen, setCompassOpen] = useState(false)

  const handleFitView = useCallback(() => {
    rf.fitView({ padding: 0.12, maxZoom: FIT_MAX_ZOOM, duration: 600 })
  }, [rf])

  const handleZoomIn  = useCallback(() => rf.zoomIn({ duration: 200 }), [rf])
  const handleZoomOut = useCallback(() => rf.zoomOut({ duration: 200 }), [rf])

  return (
    <div style={{
      position: 'absolute', right: 19, top: 19, zIndex: 4,
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10,
    }}>
      {/* Top row: Flow toggle (build mode only, sits LEFT of the toolbar — Decision Log #48–50,
          Figma 748-1804) + the toolbar pill, right-anchored so the pill never shifts. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <FlowToggle />
      {/* Toolbar pill — height matched to the Flow toggle (70px) so they sit as an even pair. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        height: 70, boxSizing: 'border-box',
        padding: '8px 22px', background: CARD, borderRadius: 100, boxShadow: barShadow,
        position: 'relative',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 500, color: TEXT_SECONDARY }}>Preset</span>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT1 }} />
          <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, color: '#fff' }}>{presetName}</span>
        </div>
        <ToolDivider />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ToolButton onClick={handleFitView}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="3" stroke={stroke} strokeWidth="1.5" />
              <line x1="9" y1="1.5" x2="9" y2="3.5" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
              <line x1="9" y1="14.5" x2="9" y2="16.5" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
              <line x1="1.5" y1="9" x2="3.5" y2="9" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
              <line x1="14.5" y1="9" x2="16.5" y2="9" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </ToolButton>
          <ToolButton onClick={handleZoomIn}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="7.5" cy="7.5" r="5" stroke={stroke} strokeWidth="1.5" />
              <line x1="11.4" y1="11.4" x2="15.5" y2="15.5" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
              <line x1="5.3" y1="7.5" x2="9.7" y2="7.5" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
              <line x1="7.5" y1="5.3" x2="7.5" y2="9.7" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </ToolButton>
          <ToolButton onClick={handleZoomOut}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="7.5" cy="7.5" r="5" stroke={stroke} strokeWidth="1.5" />
              <line x1="11.4" y1="11.4" x2="15.5" y2="15.5" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
              <line x1="5.3" y1="7.5" x2="9.7" y2="7.5" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </ToolButton>
        </div>
        <ToolDivider />
        {/* Chevron toggle — rotates when compass is open */}
        <button
          onClick={() => setCompassOpen((o) => !o)}
          style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'transform 220ms ease',
            transform: compassOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          <svg width="13" height="8" viewBox="0 0 13 8" fill="none">
            <path d="M1 1.5L6.5 6.5L12 1.5" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {/* Inset shadow overlay */}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit',
          boxShadow: 'inset 1px 1.5px 3px 0px #373737',
          pointerEvents: 'none',
        }} />
      </div>
      </div>

      {/* Compass card — slides in below toolbar when open */}
      {compassOpen && (
        <div style={{
          width: 373, padding: 15, borderRadius: 20,
          background: CARD,
          filter: 'drop-shadow(4px 4px 2.5px black)',
          position: 'relative',
        }}>
          <CompassPreview presetKey={activePreset} />
          {/* Inset shadow on card */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: 'inherit',
            boxShadow: 'inset 1px 1.5px 3px 0px #373737',
            pointerEvents: 'none',
          }} />
        </div>
      )}
    </div>
  )
}

// 3000px overflow on each side of the 6000×6000 canvas — songs at the edges
// can be centered without hitting a hard wall
const TRANSLATE_EXTENT = [[-3000, -3000], [W + 3000, H + 3000]]

// Manual zoom ceiling. Cards grow only slowly with zoom (dampened counter-scale — see NODE_PIN /
// NODE_PIN_EXP in TrackNode) while the canvas spreads at full zoom, so zooming deeper mostly
// separates songs and lets you pull individual cards out of a dense cluster. Hence a generous
// ceiling. translateExtent is in flow-space (zoom-independent) and its 3000px margin already
// covers centering at this zoom.
const MAX_ZOOM = 3.5

// Auto-fit (initial load + the fit-view button) is capped lower than MAX_ZOOM so a tightly
// clustered library opens with surrounding context instead of slamming to the manual ceiling;
// the user can then zoom deeper by hand.
const FIT_MAX_ZOOM = 1.6

function DriftMapInner({ tracks }) {
  const {
    activePreset, customXFeature, customYFeature, setActivePanel,
    buildMode, flowMode, chain, orphanGroups, addHead, connectSong, unlinkAfter, registerMapControls,
    toggleDeck, closeDeck,
  } = usePlaylistStore()
  const presetConfig = useMemo(
    () => resolvePreset(activePreset, customXFeature, customYFeature),
    [activePreset, customXFeature, customYFeature]
  )

  // Population bloom (Slice 11.5): nodes are built from STAGED tracks, not the live prop, so a playlist
  // switch can fade the old set out (200ms) before swapping. `bloom.gen` bumps per population to
  // restart the stagger animation; `bloom.active` gates it to the bloom window only.
  const [stagedTracks, setStagedTracks] = useState(tracks)
  const [bloom, setBloom] = useState({ gen: 0, active: true })
  const [previewNodeId, setPreviewNodeId] = useState(null) // hover-preview node (raised z-index)

  const initialNodes = useMemo(() => buildNodes(stagedTracks, presetConfig), [stagedTracks, presetConfig])
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [minZoom, setMinZoom] = useState(0.01)
  const rf = useReactFlow()
  const hasFit = useRef(false)
  const wrapperRef = useRef(null)
  const zoomTimer = useRef(null)
  const highlightTimer = useRef(null)
  const dragRef = useRef(null) // WireDragLayer imperative handle

  // Playlist switch → the old nodes vanish instantly and the new set blooms in with the random
  // stagger: we just stage the new tracks and bump the generation. The new nodes replace the old in
  // one commit and start invisible (their bloom's `backwards` fill holds scale0/opacity0 until each
  // one's delay), so the old set disappears with no fade. Initial mount is skipped (prevTracksRef
  // starts as the initial prop) — the first paint blooms straight in via the mount animation.
  const prevTracksRef = useRef(tracks)
  useEffect(() => {
    if (prevTracksRef.current === tracks) return
    prevTracksRef.current = tracks
    setStagedTracks(tracks)
    setBloom((b) => ({ gen: b.gen + 1, active: true }))
  }, [tracks])

  // Close the bloom window once the last node's stagger + its 400ms animation have elapsed, so nodes
  // that mount afterwards (culling remounts while panning) appear instantly instead of re-blooming.
  useEffect(() => {
    const windowMs = Math.max(0, stagedTracks.length - 1) * BLOOM_STAGGER_MS + 600 + 100
    const t = setTimeout(() => setBloom((b) => (b.active ? { ...b, active: false } : b)), windowMs)
    return () => clearTimeout(t)
  }, [bloom.gen, stagedTracks.length])

  // Build graph: derive the wires + per-node socket assignments from the ordered chain, the orphan
  // groups, and the songs' canvas positions (taken from initialNodes so this never depends on the
  // mutable `nodes` state, avoiding a re-inject loop). Positions only shift on a preset/track
  // rebuild. Socket pairs are optimized geometrically (Slice 9 #1) — no stored snap edges.
  const buildGraph = useMemo(() => {
    const posById = {}
    for (const n of initialNodes) posById[n.id] = n.position
    return computeBuildGraph(chain, orphanGroups, posById)
  }, [chain, orphanGroups, initialNodes])

  // Which orphan group is hovered (whole segment brightens, Decision Log #36/#45). null = none.
  const [hoverGroup, setHoverGroup] = useState(null)

  // Raw track records keyed by id — feeds per-wire compatibility scoring (colors + card).
  const tracksById = useMemo(() => Object.fromEntries(tracks.map((t) => [t.id, t])), [tracks])

  // The wire whose compatibility card is open (Decision Log #31): { source, target } | null. Set on
  // wire click, cleared on any pane click / chain edit / mode change so a stale card never lingers.
  const [selectedWire, setSelectedWire] = useState(null)
  const onWireClick = useCallback((source, target) => setSelectedWire({ source, target }), [])
  useEffect(() => { setSelectedWire(null) }, [chain, orphanGroups, buildMode])
  const selectedTracks = useMemo(() => {
    if (!buildMode || !selectedWire) return null
    const s = tracksById[selectedWire.source]
    const t = tracksById[selectedWire.target]
    return s && t ? { s, t } : null
  }, [buildMode, selectedWire, tracksById])

  // Unplug a wire by grabbing either of its socket dots (Slice 9 r3 #2/#5, r4 #3). EITHER end works:
  // role 'out' grabs the wire leaving this song (upstream = this song, downstream from i+1 detaches);
  // role 'in' grabs the wire arriving (upstream = its predecessor, this song + downstream detaches).
  //
  // The gesture mirrors the tail's new-wire drag exactly — the one interaction we know behaves. We
  // detach immediately (downstream orphans, and instantly becomes a valid snap target so a release
  // right back on it restores) and hand THIS pointerDOWN event to WireDragLayer.start, whose
  // stopPropagation + preventDefault is what stops ReactFlow's 1:1 pane-pan from stealing the drag
  // (r4 #3b) and whose loop then glues a dashed wire to the cursor. `suppressPan` keeps the map
  // still for the whole unplug so only the wire moves (r4 #3b/#5). Release on empty leaves it cut;
  // release on a valid song reconnects via onConnect=connectSong (absorbing whole groups, #6).
  const unplugSocket = useCallback((nodeId, role, event) => {
    const i = chain.indexOf(nodeId)
    if (i < 0) return
    const upstreamIndex = role === 'out' ? i : i - 1
    if (upstreamIndex < 0) return
    const upstreamId = chain[upstreamIndex]
    unlinkAfter(upstreamIndex)
    dragRef.current?.start(upstreamId, 'E', event, { suppressPan: true })
  }, [chain, unlinkAfter])

  // Orphan wires carry a live `bright` flag; chain wires carry their compatibility `tier` (green/
  // amber/red), recomputed whenever the chain, positions, or track data change (Decision Log #30).
  const edges = useMemo(() => {
    if (!buildMode) return []
    const flowCount = Math.max(1, chain.length - 1) // chain-wire count, for the strobe stagger
    let wi = 0
    return buildGraph.edges.map((e) => {
      if (e.data?.orphan) return { ...e, data: { ...e.data, bright: e.data.groupId === hoverGroup } }
      const { tier } = scoreCompatibility(tracksById[e.source], tracksById[e.target])
      // flowIndex = this wire's position in the head→tail chain, driving its strobe delay.
      return { ...e, data: { ...e.data, tier, flowIndex: wi++, flowCount } }
    })
  }, [buildMode, buildGraph, hoverGroup, tracksById, chain.length])
  const chainSet = useMemo(() => new Set(chain), [chain])

  // Strobe timing per chain wire, PROPORTIONAL to each wire's on-map length, so the pulse keeps a
  // constant speed across the whole chain (a uniform, linear glide) rather than the equal-time-per-wire
  // scheme that sped up on long wires. delay = fraction of the chain before this wire × sweep time;
  // activePct = this wire's share of the sweep, as a % of the full cycle. Recomputed on node moves.
  const flowTiming = useMemo(() => {
    if (!buildMode || !flowMode || chain.length < 2) return null
    const posById = new Map(nodes.map((n) => [n.id, n.position]))
    const lens = []
    for (let i = 0; i < chain.length - 1; i++) {
      const a = posById.get(chain[i]), b = posById.get(chain[i + 1])
      lens.push(a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 1)
    }
    const L = lens.reduce((s, l) => s + l, 0) || 1
    let cum = 0
    return lens.map((l) => {
      const delay = (cum / L) * FLOW_SWEEP_S
      cum += l
      return { delay, activePct: ((l / L) * FLOW_SWEEP_S / FLOW_CYCLE_S) * 100 }
    })
  }, [buildMode, flowMode, chain, nodes])

  // Inject build-mode presentation into node data: socket dots for chain + orphan songs, the head
  // halo, the tail's grabbable outgoing socket, orphan treatment (dashed coral + dim, brighter when
  // its group is hovered), and 0.4 dimming for everything not in the set (Slice 9 #6). Runs only on
  // a build-state change (user actions / preset rebuild / hover), so nodes stay static otherwise.
  useEffect(() => {
    setNodes((prev) => prev.map((n) => {
      const inChain = chainSet.has(n.id)
      const groupId = buildMode ? (buildGraph.groupByNode[n.id] ?? null) : null
      const isOrphan = groupId != null
      const sockets = buildMode ? buildGraph.socketsByNode[n.id] : undefined
      const isHead = buildMode && n.id === buildGraph.headId
      const dimmed = buildMode && !inChain && !isOrphan
      const isTail = buildMode && n.id === buildGraph.tailId
      const orphanBright = isOrphan && groupId === hoverGroup
      // Stacking order (Slice 9 r2 #3): in build mode, chain songs sit above non-chain ones so
      // their sockets are always grabbable when songs overlap — and the tail (whose open outgoing
      // socket you drag from) sits highest of all. Orphans just above the dimmed field. A hover-
      // preview node (Slice 11.5) trumps everything so its scaled-up card renders above its neighbours.
      const baseZ = !buildMode ? 0 : isTail ? 40 : inChain ? 30 : isOrphan ? 10 : 0
      const zIndex = n.id === previewNodeId ? 1000 : baseZ
      const d = n.data
      if (
        d.sockets === sockets && d.isHead === isHead && d.dimmed === dimmed && d.isTail === isTail &&
        d.isOrphan === isOrphan && d.orphanBright === orphanBright && d.orphanGroupId === groupId &&
        n.zIndex === zIndex
      ) {
        return n // nothing changed for this node — keep the same reference (no re-render)
      }
      return { ...n, zIndex, data: { ...d, sockets, isHead, dimmed, isTail, isOrphan, orphanBright, orphanGroupId: groupId } }
    }))
  }, [buildMode, buildGraph, chainSet, hoverGroup, previewNodeId, setNodes])

  // Compatibility glow (Slice 11.5): in build mode with an active chain and Flow OFF, EVERY non-chain,
  // non-orphan song is scored against the chain TAIL as a candidate next song and gets a colored glow
  // ring by tier — strong = green, mild = amber; weak or no data gets no ring and stays at the 0.4 dim
  // floor. Missing-key songs still tier off BPM alone (scoreCompatibility handles that). No distance /
  // radius: the whole map lights up by mixability, so a compatible song reads even far from the tail
  // (the radius approach hid distant matches and vanished on small circle-tier nodes at zoom-out).
  // `data.glow` carries the tier ('strong' | 'mild' | undefined); TrackNode maps it to ring + opacity.
  // Disabled under Flow ON (non-chain hidden anyway), with no chain (no tail), or outside build mode —
  // in all those cases glow clears to undefined. Mirrors the dimming effect's lifecycle above.
  useEffect(() => {
    const tailId = buildGraph.tailId
    const tailTrack = tailId ? tracksById[tailId] : null
    const enabled = buildMode && !flowMode && !!tailTrack
    setNodes((prev) => prev.map((n) => {
      let glow // undefined = no ring, stays at the 0.4 floor
      if (enabled && !chainSet.has(n.id) && buildGraph.groupByNode[n.id] == null) {
        const { tier } = scoreCompatibility(tailTrack, tracksById[n.id])
        if (tier === 'strong' || tier === 'mild') glow = tier
      }
      return n.data.glow === glow ? n : { ...n, data: { ...n.data, glow } }
    }))
  }, [buildMode, flowMode, buildGraph, tracksById, chainSet, setNodes])
  // Tier is global (depends only on zoom) — held once here and broadcast via context so nodes
  // re-render only on a threshold crossing, not on every zoom frame.
  const [tier, setTier] = useState('circle')
  const tierRef = useRef('circle')

  // Rebuild on a staged-tracks or preset change. A TRACK change re-fits (new library → the bloom +
  // fitView run). A PRESET-only change instead SLIDES the songs to their new positions (Slice 11.5,
  // Feature 3): add the reposition class for 500ms so React Flow's per-node translate transitions, and
  // DON'T re-fit — keeping the viewport still is what makes the slide visible instead of a jump-cut.
  const prevBuildRef = useRef({ tracks: stagedTracks, preset: presetConfig })
  const repositionTimer = useRef(null)
  useEffect(() => {
    const prev = prevBuildRef.current
    const tracksChanged = prev.tracks !== stagedTracks
    const presetChanged = prev.preset !== presetConfig
    prevBuildRef.current = { tracks: stagedTracks, preset: presetConfig }
    setNodes(buildNodes(stagedTracks, presetConfig))
    if (tracksChanged) {
      hasFit.current = false
    } else if (presetChanged) {
      const el = wrapperRef.current
      el?.classList.add('drift-repositioning')
      clearTimeout(repositionTimer.current)
      repositionTimer.current = setTimeout(() => el?.classList.remove('drift-repositioning'), 520)
    }
  }, [stagedTracks, presetConfig, setNodes])

  const handleWheel = useCallback((e) => {
    // ctrlKey is true for pinch-to-zoom and ctrl+scroll — the zoom gesture
    if (!e.ctrlKey) return
    const el = wrapperRef.current
    if (!el) return
    el.classList.add('is-zooming')
    clearTimeout(zoomTimer.current)
    zoomTimer.current = setTimeout(() => el.classList.remove('is-zooming'), 150)
  }, [])

  // Counter-scale + tier driver (throttled to ~30fps). Writes the scale factor into the
  // --node-scale CSS var so every node rescales via CSS with no React re-render, and flips tier
  // state only when a threshold is crossed.
  const applyZoom = useCallback((zoom) => {
    wrapperRef.current?.style.setProperty('--node-scale', String(getNodeScale(zoom)))
    const next = getTier(zoom)
    if (next !== tierRef.current) {
      tierRef.current = next
      setTier(next)
    }
  }, [])
  useThrottledZoom(applyZoom)

  // Seed the var + tier from the current viewport before first paint (the watcher only fires on a
  // change), so nodes mount at the right scale/tier instead of flashing the default.
  useLayoutEffect(() => { applyZoom(rf.getViewport().zoom) }, [applyZoom, rf])

  useEffect(() => {
    if (hasFit.current || nodes.length === 0) return
    const allMeasured = nodes.every((n) => n.measured?.width && n.measured?.height)
    if (!allMeasured) return

    const songNodes = nodes.filter((n) => n.type === 'track')
    const xs = songNodes.map((n) => n.position.x)
    const ys = songNodes.map((n) => n.position.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)

    // Frame the songs' actual bounding box (not the whole canvas): center on the box's
    // midpoint and zoom to fit its extent, so a clustered library fills the view instead
    // of leaving empty canvas around it.
    const bboxW = (maxX - minX) || 1
    const bboxH = (maxY - minY) || 1
    const bboxCx = (minX + maxX) / 2
    const bboxCy = (minY + maxY) / 2

    // Measure the map card (ReactFlow's container), not the window — the canvas now lives
    // inside an inset card, so centering must use the card's own dimensions.
    const rect = wrapperRef.current?.getBoundingClientRect()
    const vw = rect?.width ?? window.innerWidth - MAP_LEFT - PAGE_INSET
    const vh = rect?.height ?? window.innerHeight - 2 * PAGE_INSET

    const PAD_FRAC = 0.12
    const zoom = Math.min(
      (vw * (1 - 2 * PAD_FRAC)) / bboxW,
      (vh * (1 - 2 * PAD_FRAC)) / bboxH,
      FIT_MAX_ZOOM, // don't auto-open a tight cluster slammed to the manual ceiling
    )
    const x = vw / 2 - bboxCx * zoom
    const y = vh / 2 - bboxCy * zoom

    // Let users still zoom out to take in the full canvas, even though the default frames
    // only the songs.
    const canvasFitZoom = Math.min(vw / W, vh / H)

    console.log(`[drift] viewport: zoom=${zoom.toFixed(4)} x=${x.toFixed(1)} y=${y.toFixed(1)} (map ${Math.round(vw)}×${Math.round(vh)})`)

    rf.setViewport({ x, y, zoom })
    setMinZoom(Math.min(zoom, canvasFitZoom) * 0.8)
    hasFit.current = true
  }, [nodes, rf])

  // Apply a 2-second orange highlight ring to the searched song, then clear it.
  const handleHighlight = useCallback((trackId) => {
    clearTimeout(highlightTimer.current)
    setNodes((prev) => prev.map((n) => ({
      ...n,
      data: { ...n.data, highlighted: n.id === trackId },
    })))
    highlightTimer.current = setTimeout(() => {
      setNodes((prev) => prev.map((n) => ({
        ...n,
        data: { ...n.data, highlighted: false },
      })))
    }, 2000)
  }, [setNodes])

  // Pan the map to a track and flash it — used by the toolbar search and, via registerMapControls,
  // by the panel search which lives outside this ReactFlowProvider (Decision Log #56).
  const focusTrackOnMap = useCallback((trackId) => {
    const node = rf.getNode(trackId)
    if (node) {
      const targetZoom = Math.max(rf.getViewport().zoom, ZOOM_CARD + 0.1)
      rf.setCenter(node.position.x, node.position.y, { zoom: targetZoom, duration: 600 })
    }
    handleHighlight(trackId)
  }, [rf, handleHighlight])

  useEffect(() => { registerMapControls({ focusTrack: focusTrackOnMap }) }, [registerMapControls, focusTrackOnMap])

  // Clicking a song. In build mode it drives the set builder — an empty chain seats the clicked song
  // as the head (Decision Log #38, #42), and once a head exists songs join only by wiring, so further
  // clicks are ignored. Outside build mode it opens that song's Deck View (Decision Log #6, #69).
  const handleNodeClick = useCallback((_e, node) => {
    setSelectedWire(null) // clicking a song dismisses the compatibility card
    if (buildMode) {
      if (chain.length === 0) addHead(node.id)
    } else {
      toggleDeck(node.id) // clicking the open song again closes the deck
    }
  }, [buildMode, chain.length, addHead, toggleDeck])

  // The set-builder panel isn't closeable while building (Decision Log #53), so a pane click only
  // dismisses panels outside build mode. It always dismisses an open compatibility card (Decision
  // Log #31 — "disappears on click-elsewhere") and the Deck View.
  const handlePaneClick = useCallback(() => {
    setSelectedWire(null)
    closeDeck()
    if (!buildMode) setActivePanel(null)
  }, [buildMode, setActivePanel, closeDeck])

  // Bridge a tail socket's pointerdown (in TrackNode) to the drag overlay's imperative handle.
  const startWireDrag = useCallback((sourceId, cardinal, event) => {
    dragRef.current?.start(sourceId, cardinal, event)
  }, [])

  // Album-art ambient glow (Slice 11.5): each TrackNode extracts its art's dominant color on image
  // load and reports it here, where it's cached on that node's data (data.artColor) so the halo
  // survives re-renders and only extracts once. Idempotent — a repeat report for the same color is a
  // no-op (returns the same node reference, so no re-render).
  const setArtColor = useCallback((trackId, color) => {
    setNodes((prev) => prev.map((n) => (
      n.id === trackId && n.data.artColor !== color
        ? { ...n, data: { ...n.data, artColor: color } }
        : n
    )))
  }, [setNodes])

  // Hover preview (Slice 11.5): TWO elements. The hovered circle scales up 2× in place (local to
  // TrackNode) AND a detail card floats above it, rendered here (SongPreviewCard, absolute in the map
  // container — not a React Flow node). `preview` holds the wrapper-relative anchor; `previewOn` drives
  // the fade (in 150 / out 100) before unmount; `previewNodeId` raises the circle's RF z-index above
  // its neighbours (see the build-presentation effect). showPreview returns false during a wire drag
  // (the wrapper has the .wiring class then), vetoing the whole preview. Single id ⇒ one at a time.
  const [preview, setPreview] = useState(null) // { data, left, top, below } | null
  const [previewOn, setPreviewOn] = useState(false)
  const previewHideTimer = useRef(null)

  const showPreview = useCallback((id, data, rect) => {
    const el = wrapperRef.current
    if (!el || el.classList.contains('wiring')) return false
    const c = el.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2 - c.left
    // The circle grows 2× from its centre, so anchor the card off the GROWN top/bottom (± half height).
    const grownTop = rect.top - rect.height / 2 - c.top
    const grownBottom = rect.bottom + rect.height / 2 - c.top
    const below = grownTop < 100 // not enough room above → drop the card below
    clearTimeout(previewHideTimer.current)
    setPreview({ data, left: centerX, top: below ? grownBottom : grownTop, below })
    setPreviewNodeId(id)
    requestAnimationFrame(() => setPreviewOn(true))
    return true
  }, [])

  const hidePreview = useCallback((id) => {
    setPreviewOn(false)
    setPreviewNodeId((cur) => (cur === id ? null : cur))
    clearTimeout(previewHideTimer.current)
    previewHideTimer.current = setTimeout(() => setPreview(null), 120) // unmount after the 100ms fade-out
  }, [])

  const buildCtx = useMemo(() => ({ buildMode, flowMode, flowTiming, startWireDrag, setHoverGroup, unplugSocket, onWireClick, setArtColor, showPreview, hidePreview }), [buildMode, flowMode, flowTiming, startWireDrag, unplugSocket, onWireClick, setArtColor, showPreview, hidePreview])

  return (
    <div
      ref={wrapperRef}
      className="drift-canvas"
      onWheel={handleWheel}
      style={{
        position: 'fixed',
        left: MAP_LEFT,
        top: PAGE_INSET,
        right: PAGE_INSET,
        bottom: PAGE_INSET,
        background: MAP_BG,
        backgroundImage: DOT_GRID,
        backgroundSize: '22px 22px',
        border: `1px solid ${BORDER}`,
        borderRadius: 20,
        overflow: 'hidden',
        zIndex: 1,
      }}
    >
      {/* Broadcast the current tier to every node. Tier changes only on a threshold crossing, so
          this re-renders nodes rarely; between crossings they hold steady while the --node-scale
          CSS var (set on this wrapper) rescales them with no React work. */}
      <ZoomTierContext.Provider value={tier}>
        <BloomContext.Provider value={bloom}>
        <BuildContext.Provider value={buildCtx}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onPaneClick={handlePaneClick}
            onNodeClick={handleNodeClick}
            // Loose so a node's source+target handles both register bounds — the wires (which use
            // our own sourceHandle/targetHandle) resolve to the right cardinal regardless of type.
            connectionMode={ConnectionMode.Loose}

            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag
            zoomOnScroll
            zoomOnPinch
            minZoom={minZoom}
            maxZoom={MAX_ZOOM}
            translateExtent={TRANSLATE_EXTENT}
            // Cull off-screen nodes during pan/zoom — only mount the ones inside the viewport.
            // Big win with 150+ songs. Culling uses each node's measured layout box (not its CSS
            // counter-scale transform), so edge nodes may mount/unmount a few px late while panning.
            // Disabled in build mode so chain wires never blink out when an endpoint pans off-screen.
            onlyRenderVisibleElements={!buildMode}
            style={{ background: 'transparent' }}
            proOptions={{ hideAttribution: true }}
          />
        </BuildContext.Provider>
        </BloomContext.Provider>
      </ZoomTierContext.Provider>
      {/* Wire-drag overlay — only mounted in build mode; draws the dashed drag wire + feedback. */}
      {buildMode && (
        <WireDragLayer ref={dragRef} containerRef={wrapperRef} chainSet={chainSet} onConnect={connectSong} />
      )}
      {/* Strobe keyframes — one continuous linear stroke-dashoffset animation PER wire. Each wire's
          keyframe holds its own travel window (activePct, ∝ its length) so the dash crosses at a
          constant speed chain-wide; it slides from off the path start (FLOW_OFF_START) to off the end
          (FLOW_OFF_END), then holds off the end through the pause (Decision Log #51). */}
      {buildMode && flowMode && flowTiming && (
        <style>{flowTiming.map((w, i) => `@keyframes ${FLOW_STROBE_NAME}-${i}{0%{stroke-dashoffset:${FLOW_OFF_START}}${w.activePct.toFixed(3)}%{stroke-dashoffset:${FLOW_OFF_END}}100%{stroke-dashoffset:${FLOW_OFF_END}}}`).join('')}</style>
      )}
      <AxisLayer preset={presetConfig} />
      <SearchBar tracks={tracks} rf={rf} onHighlight={handleHighlight} />
      <ToolBar rf={rf} presetName={presetConfig.label} activePreset={activePreset} />
      {/* Compatibility card — fixed bottom-right, shown while a wire is selected (Decision Log #31). */}
      {selectedTracks && (
        <CompatibilityCard sourceTrack={selectedTracks.s} targetTrack={selectedTracks.t} />
      )}
      {/* Hover preview (Slice 11.5): the detail card floats above (or below, near the top edge) the
          hovered circle — a separate, non-interactive layer in the map container. Fades in 150 / out 100. */}
      {preview && (
        <div
          style={{
            position: 'absolute',
            left: preview.left,
            top: preview.top,
            transform: preview.below ? 'translate(-50%, 10px)' : 'translate(-50%, calc(-100% - 10px))',
            opacity: previewOn ? 1 : 0,
            transition: `opacity ${previewOn ? 150 : 100}ms ease`,
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          <SongPreviewCard data={preview.data} />
        </div>
      )}
    </div>
  )
}

export default function DriftMap({ tracks }) {
  return (
    <ReactFlowProvider>
      <DriftMapInner tracks={tracks} />
    </ReactFlowProvider>
  )
}
