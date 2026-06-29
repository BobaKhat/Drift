import { useMemo, useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useOnViewportChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import TrackNode, { ZOOM_PILL, ZOOM_CARD } from './TrackNode'
import { usePlaylistStore } from '../store/usePlaylistStore'
import { getFeatureValue, resolvePreset } from '../lib/presets'
import CompassPreview from './CompassPreview'

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

function buildNodes(tracks, presetConfig) {
  const { xFeature = 'mood', yFeature = 'energy' } = presetConfig ?? {}
  const scaleX = buildAxisScale(tracks.map((t) => getFeatureValue(t, xFeature)))
  const scaleY = buildAxisScale(tracks.map((t) => getFeatureValue(t, yFeature)))
  return tracks.map((track, i) => {
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
      },
      draggable: false,
      selectable: false,
      connectable: false,
    }
  })
}

const nodeTypes = { track: TrackNode }

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
    setActiveQuadrantRef.current(quadrant)
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
            border: `1.5px solid ${ACCENT1}`,
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
    rf.fitView({ padding: 0.12, maxZoom: MAX_ZOOM, duration: 600 })
  }, [rf])

  const handleZoomIn  = useCallback(() => rf.zoomIn({ duration: 200 }), [rf])
  const handleZoomOut = useCallback(() => rf.zoomOut({ duration: 200 }), [rf])

  return (
    <div style={{
      position: 'absolute', right: 19, top: 19, zIndex: 4,
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10,
    }}>
      {/* Toolbar pill */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
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

// Cap zoom so cards stay map-label sized: at 1.6× a 230px card is ~370px on screen,
// keeping several cards in view rather than 1–2 filling the viewport.
const MAX_ZOOM = 1.6

function DriftMapInner({ tracks }) {
  const { activePreset, customXFeature, customYFeature, setActivePanel } = usePlaylistStore()
  const presetConfig = useMemo(
    () => resolvePreset(activePreset, customXFeature, customYFeature),
    [activePreset, customXFeature, customYFeature]
  )

  const initialNodes = useMemo(() => buildNodes(tracks, presetConfig), [tracks, presetConfig])
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [minZoom, setMinZoom] = useState(0.01)
  const rf = useReactFlow()
  const hasFit = useRef(false)
  const wrapperRef = useRef(null)
  const zoomTimer = useRef(null)
  const highlightTimer = useRef(null)

  // Rebuild and re-fit whenever tracks or preset changes.
  useEffect(() => {
    setNodes(buildNodes(tracks, presetConfig))
    hasFit.current = false
  }, [tracks, presetConfig, setNodes])

  const handleWheel = useCallback((e) => {
    // ctrlKey is true for pinch-to-zoom and ctrl+scroll — the zoom gesture
    if (!e.ctrlKey) return
    const el = wrapperRef.current
    if (!el) return
    el.classList.add('is-zooming')
    clearTimeout(zoomTimer.current)
    zoomTimer.current = setTimeout(() => el.classList.remove('is-zooming'), 150)
  }, [])

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
      MAX_ZOOM, // tightly-clustered libraries shouldn't zoom past the node morph tiers
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
      <ReactFlow
        nodes={nodes}
        edges={[]}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        onPaneClick={() => setActivePanel(null)}

        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        minZoom={minZoom}
        maxZoom={MAX_ZOOM}
        translateExtent={TRANSLATE_EXTENT}
        style={{ background: 'transparent' }}
        proOptions={{ hideAttribution: true }}
      />
      <AxisLayer preset={presetConfig} />
      <SearchBar tracks={tracks} rf={rf} onHighlight={handleHighlight} />
      <ToolBar rf={rf} presetName={presetConfig.label} activePreset={activePreset} />
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
