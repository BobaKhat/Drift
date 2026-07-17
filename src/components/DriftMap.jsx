import { useMemo, useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  useNodesState,
  useReactFlow,
  useOnViewportChange,
  useStoreApi,
  ViewportPortal,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import TrackNode, { ZOOM_CARD, ZoomTierContext, BuildContext, BloomContext, SongPreviewCard, getTier, getNodeScale } from './TrackNode'
import WireEdge, { FLOW_STROBE_NAME, FLOW_OFF_START, FLOW_OFF_END, FLOW_SWEEP_S, FLOW_CYCLE_S } from './WireEdge'
import WireDragLayer from './WireDragLayer'
import { usePlaylistStore } from '../store/usePlaylistStore'
import { getFeatureValue, resolvePreset } from '../lib/presets'
import { computeBuildGraph } from '../lib/setChain'
import { scoreCompatibility } from '../lib/compatibility'
import NebulaLayer from './NebulaLayer'
import CompassPreview from './CompassPreview'
import CompatibilityCard from './CompatibilityCard'
import FlowToggle from './FlowToggle'
import {
  SELECTED,
  NEO_BAR_BG, NEO_BAR_SHADOW, NEO_BAR_EDGE,
  NEO_BTN_BG, NEO_BTN_HOVER_BG, NEO_BTN_PRESS_BG,
  NEO_BTN_RAISED, NEO_BTN_HOVER, NEO_BTN_PRESS,
  NEO_CHEV_RAISED, NEO_CHEV_HOVER,
  NEO_TRAY_BG, NEO_TRAY_INSET,
  NEO_PANEL_SHADOW, NEO_PANEL_EDGE,
} from './import/tokens'

// Flow-space canvas dimensions. A large canvas gives songs room to separate as you
// zoom in (Google Maps model, Decision Log #17) — the primary energy×mood mapping only
// resolves songs to a coarse position, so the extra pixels are what reveals granularity.
//
// LANDSCAPE, not square (~16:9). The map card is a wide rectangle, so a square canvas can only be
// fit to it by matching its height — which left the whole plot, and the axis cross drawn around it,
// stranded in a narrow column with dead gutters either side. Matching the canvas to the card's
// rough aspect lets the coordinate system fill the space it's drawn in. 10667×6000 ≈ 1.778:1, so on
// a widescreen (16:9 / 16:10) display the horizontal axis line reaches the viewport edges at the
// default fit, not just the vertical one. The consequence is that mood gets more pixels per unit than
// energy: flow space is anisotropic, which is fine because nothing reads distance ACROSS the two axes
// — this is a vibe map, not a metric space. (Wire lengths, the one canvas-space distance we do
// measure, only pace the strobe along a single path, and on-screen path length still scales uniformly
// with zoom.)
const H = 6000

// Canvas WIDTH is dynamic — it tracks the card's aspect ratio (W = H * cardW/cardH, recomputed on
// resize) so the axis box and the card share a shape. That shared shape is what lets minZoom leave
// equal margins on all four sides at max zoom-out (see makeGeom / computeMinZoom below). H is fixed;
// nothing reads a module-level W anymore — every W-dependent value comes from the per-render `geom`
// object so a single W change updates the padding band, axis endpoints, fit box and pan clamp together.

// Axis extent in CANVAS space. The crosshair runs to 2% from each canvas edge and the four terminator
// pills cap those ends. At the default fit zoom this inset lands ~16px in from the canvas bounds, which
// reads the same as the old card-edge pinning while now being anchored to the map, not the viewport.
// Declared here rather than with the rest of the layout because the song band below is derived FROM it.
const AXIS_INSET = 0.02
const AXIS_Y = [H * AXIS_INSET, H * (1 - AXIS_INSET)] // Y-axis extent is fixed with H

// The 0–100 feature range maps into an inner band of the canvas (Decision Log #22) so songs at the
// extremes sit clear of the terminator pills instead of on top of them. Y is fixed with H; the X band
// is derived per-W in makeGeom. A song at value 50 always lands at 50% of W whatever W is — positions
// are purely proportional, so a changing W reshapes the quadrants without disturbing any song's
// relative place.
//
// —— The band is SOLVED, not chosen ——————————————————————————————————————————————————————————
// The target is an even MARGIN: the song field sits the same number of screen px in from the axis end
// on all four poles, so the cloud reads as centred in the card rather than stretched top-to-bottom.
//
// A pill is anchored at the axis end and hangs INWARD at a constant SCREEN size (AxisLayer counter-
// scales it by 1/zoom), so in canvas units it reaches pillPx/zoom past that end — which is why the pad
// must clear the pill's FOOTPRINT and not merely the axis inset. Walking inward from an axis end, the
// margin a pole needs, in screen px:
//
//     pill inner edge  pillPx      <- the pill's WIDTH on the X poles, its HEIGHT on the Y poles
//     song boundary    + PILL_GAP  <- clearance between the song's edge and the pill
//     song centre      + SONG_R    <- PAD lands the song's CENTRE, hence this last term
//
// Solve that ONCE on the binding pole — X, whose pills are far the widest — then spend the same margin
// on both axes. Converting a screen margin back to a fraction just divides by that axis's px-per-frac:
//
//     MARGIN_PX = PILL_W + PILL_GAP + SONG_R
//     PAD_FRAC  = AXIS_INSET + MARGIN_PX / (dimension × zoom)
//
// The fractions come out UNEQUAL precisely because the margin is equal: Y is the shorter axis in screen
// px (885 vs 1325), so the same margin costs it a bigger fraction. Canvas units are the wrong currency
// here — nothing on screen is a canvas unit; it is always fraction × (dimension × zoom).
//
// To re-derive, edit the measured inputs below and the fractions follow. Every input is a SCREEN
// measurement taken at the fit zoom, so all of them move if the pills are restyled or the card resizes.
const PILL_W = 95.5 // widest SIDE pill across ALL presets ("Melodic" on Vocal) — governs X
const PILL_H = 37.5 // pill height, identical on every preset — governs Y
const SONG_R = 9    // circle-tier song radius at fit zoom = (CIRCLE_SIZE/2) × zoom^CIRCLE_ZOOM_DAMP
const PILL_GAP = 7  // clearance on the BINDING pole (X). Y inherits the same margin and so runs looser.

// Screen px held clear between the axis box (i.e. the pole pills, which sit on it) and the card edge.
// ONE constant drives both halves of that promise, and it has to: computeMinZoom reserves 2× this on
// height so the pills clear the edge at the FIT, and EXPANDED_EXTENT below expands by this ÷ zoom so
// they still clear it at every PAN limit. Split the two and they contradict — see EXPANDED_EXTENT.
const EDGE_MARGIN_PX = 20

// The reference card the band is solved for — a 1440x900 window, which after the rail and page insets
// leaves a 1317x880 card. computeMinZoom is height-bound on any card at least as wide as it is tall, so
// the fit zoom reduces to this: 0.1458 here. Must track computeMinZoom's own formula exactly.
const REF_CARD_W = 1317
const REF_CARD_H = 880
const FIT_ZOOM = (REF_CARD_H - 2 * EDGE_MARGIN_PX) / (H * (1 - 2 * AXIS_INSET))

// Screen px spanned by a full 1.0 of each fraction at that zoom — the `dimension × zoom` denominator
// above. Both collapse to the card's own pixel size over AXIS_SPAN, since the fit maps exactly that
// much canvas onto the card: 1325px across, 885px down. X gets 1.5× more px per unit of pad than Y.
const X_PX_PER_FRAC = (H * (REF_CARD_W / REF_CARD_H)) * FIT_ZOOM // = W × minZoom
const Y_PX_PER_FRAC = H * FIT_ZOOM                               // = H × minZoom

// Set by X's pill, then spent on both axes. 111.5px on the reference card.
const MARGIN_PX = PILL_W + PILL_GAP + SONG_R

const PAD_X_FRAC = AXIS_INSET + MARGIN_PX / X_PX_PER_FRAC // ≈ 0.1041
const PAD_Y_FRAC = AXIS_INSET + MARGIN_PX / Y_PX_PER_FRAC // ≈ 0.1459
const PAD_Y = [H * PAD_Y_FRAC, H * (1 - PAD_Y_FRAC)]

// What this fixes and what it forfeits: the MARGIN is even — 111.5px on all four poles — and CLEARANCE
// is not, 7px on X against 65px on Y. Those two can never both be even: the margin is pill + gap, and
// the side pills are 2.5× wider than the top pills are tall while X only buys 1.5× more screen px per
// unit of pad. Fixing either forces the other apart. This is the even-margin branch; the even-clearance
// branch (10px on every pole) is one edit away — swap both fractions back to the per-axis form,
// AXIS_INSET + (pillPx + PILL_GAP + SONG_R) / pxPerFrac, which gives ≈ 0.1064 / 0.0838.
//
// Note PILL_GAP now means X's clearance ONLY, and X is the whole map's floor: it has no headroom, by
// construction. Raising PILL_GAP raises the shared margin and pushes both axes in together.
//
// Two traps that survive the derivation:
//  - PILL_W must be measured across ALL FOUR presets, never the default one. They swap which label sits
//    on which axis (Texture puts "Intense" on X, Vocal "Melodic"), so tuning against Vibe alone reads an
//    83px pill and silently starves X — it went to ~1.5px that way once already.
//  - This is a SCREEN target met with CANVAS constants, so it is exact only on the reference card. A
//    bigger card has margin to spare; a much smaller one (~1024x768) eats into the gap. And verifying
//    against the demo library proves nothing: no demo song reaches the band edge on most presets, so the
//    pills read hundreds of px clear even at a pad that would overlap badly. Check the band edge itself.

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
function toFlowPos(track, scaleX, scaleY, xFeature, yFeature, PAD) {
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

function buildNodes(tracks, presetConfig, PAD) {
  const { xFeature = 'mood', yFeature = 'energy' } = presetConfig ?? {}
  const scaleX = buildAxisScale(tracks.map((t) => getFeatureValue(t, xFeature)))
  const scaleY = buildAxisScale(tracks.map((t) => getFeatureValue(t, yFeature)))
  const nodes = tracks.map((track, i) => {
    const pos = toFlowPos(track, scaleX, scaleY, xFeature, yFeature, PAD)
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
const AXIS_COLOR = 'rgba(255,255,255,0.08)' // crosshair lines — present but subtle, never competing with songs
const ACCENT1 = '#F27F37' // Intense / Chill (energy axis)
const ACCENT2 = '#4B6AE5' // Dark / Bright (mood axis)
const MAP_BG = '#141415'
const CARD = '#141416'
const BORDER = '#222224'
const TEXT_SECONDARY = '#848484'
const ICON_PRIMARY = '#808080' // Figma "Icons/Primary" — the toolbar glyphs

// Layout: rail + map are separate cards floating on a black page, both inset 10px from the
// edges with a 10px gap between them (Figma node 748-2842). The map card starts after the rail.
const PAGE_INSET = 10
const RAIL_W = 93
const RAIL_GAP = 10
const MAP_LEFT = PAGE_INSET + RAIL_W + RAIL_GAP // 113
const EDGE = 16 // inset of the HUD brackets / zone chip from the map card edge

// AXIS_INSET / AXIS_Y are declared up with the PAD derivation — the song band is solved from them, so
// they have to precede it. The band the songs occupy (PAD, ~10.4% on X / ~14.6% on Y) sits inside these
// ends, and the space between the two is not slack: it is exactly what the pills consume as they hang
// inward at constant screen size, plus PILL_GAP.

// Canvas width from the card's live aspect ratio (H fixed). Guarded so a zero/NaN pre-layout
// measurement falls back to 16:9 instead of poisoning the geometry.
const canvasWidthFor = (vw, vh) => (vw > 0 && vh > 0 ? H * (vw / vh) : (H * 16) / 9)

// All W-dependent geometry, derived together from one width so a resize updates it in lock-step. Note
// AXIS_X, PAD.x and AXIS_BOUNDS.{x,width} scale with W while everything Y is fixed.
// AXIS_BOUNDS is what "fit view" frames — not the songs' bounding box — and always contains the songs,
// since the axis (2%–98%) brackets PAD (~10.5%–89.5% on X, ~14.7%–85.3% on Y).
//
// The pan clamp is NOT here any more: it is the only piece of geometry that depends on zoom (its margin
// is EDGE_MARGIN_PX ÷ zoom in canvas units), and geom feeds the node-rebuild effect via geom.PAD — so a
// zoom-dependent geom would rebuild every node and crossfade the nebula on every zoom step. See
// EXPANDED_EXTENT / the translateExtent driver in DriftMapInner.
function makeGeom(W) {
  const AXIS_X = [W * AXIS_INSET, W * (1 - AXIS_INSET)]
  const PAD = { x: [W * PAD_X_FRAC, W * (1 - PAD_X_FRAC)], y: PAD_Y }
  const AXIS_BOUNDS = { x: AXIS_X[0], y: AXIS_Y[0], width: AXIS_X[1] - AXIS_X[0], height: AXIS_Y[1] - AXIS_Y[0] }
  return { W, AXIS_X, PAD, AXIS_BOUNDS }
}

// The pan clamp, at a given zoom. d3-zoom holds the viewport INSIDE this box, so pushing the box OUTward
// by the margin is what lets the viewport travel far enough to leave the pills that much clear of its
// edge — insetting it would do the exact opposite, stopping the pan early and pushing the pills off the
// side. The margin is a screen distance, so it converts at ÷ zoom, and the extent must be rewritten
// whenever zoom changes.
//
// This interlocks with computeMinZoom, and exactly: at the fit, the viewport is 2×EDGE_MARGIN_PX taller
// (in screen px) than the axis box, i.e. exactly as much as this expansion adds, so the extent lands
// flush with the viewport and d3 still allows no pan at all. Change one margin without the other and the
// fit either unlocks and lets a pill drift closer than the promise, or clamps inside the framed view.
const EXPANDED_EXTENT = (geom, zoom) => {
  const m = EDGE_MARGIN_PX / zoom
  return [
    [geom.AXIS_X[0] - m, AXIS_Y[0] - m],
    [geom.AXIS_X[1] + m, AXIS_Y[1] + m],
  ]
}
// Breathing room around the axis box when fitting, as a fraction of the card per side. Small: the
// box already carries a 2% canvas margin, and the terminator pills hang inward from its edges.
const FIT_PAD_FRAC = 0.04

// —— Dot grid ————————————————————————————————————————————————————————————————————————
// The original subtle grid, as a CSS background on the map card — so it sits BEHIND the songs, and keeps
// a constant 22px SCREEN size so the ruling stays evenly visible at ANY zoom (a canvas-space grid spreads
// its spacing with zoom and goes invisible once you're zoomed in). To give it motion reference instead of
// dead wallpaper, its background-position is driven from the viewport pan every frame, so the whole field
// scrolls 1:1 with the map as you pan. Zoom deliberately does NOT touch it: a grid that resizes with zoom
// was tried and it reads as terrain sliding under the songs rather than a steady rule behind them, so the
// pan driver below stays pan-only on purpose — don't wire the scale into it.
//
// Lines, not dots (two layers: verticals + horizontals) — both inherit the one background-position and
// background-size, which is why the pan code needs no per-layer math. GRID_LINE is far weaker than the
// dots it replaced (0.035 to their 0.055) and that is not a taste call: a 1px ruling in both axes inks
// ~9% of every 22px cell where a dot inked ~0.7%, so holding the old alpha would have put >10x the light
// on the map and turned the backdrop into the subject. The ceiling is AXIS_COLOR (0.08): the crosshair is
// the map's one piece of real information, and a grid that reaches it competes with the axes.
const GRID_LINE = 'rgba(255,255,255,0.035)'
const LINE_GRID = `linear-gradient(to right, ${GRID_LINE} 1px, transparent 1px), linear-gradient(to bottom, ${GRID_LINE} 1px, transparent 1px)`
const GRID_SIZE = 22 // px — constant on-screen grid spacing

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
  color: '#fff',
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
        color: '#fff',
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

// AxisLayer. Two very different things live here:
//
//   1. The crosshair lines + pole pills are pure CANVAS-space furniture, rendered into React Flow's
//      ViewportPortal so the pane's own pan/zoom transform carries them — exactly like a song node.
//      There is NO per-frame positioning: each element is placed once at its canvas coordinate (the
//      lines span AXIS_INSET→1-AXIS_INSET on each axis, crossing at W/2,H/2; the pills cap the four
//      ends) and the viewport moves them. Only their *size* is counter-scaled — a shared CSS var
//      (--axis-scale = 1/zoom, written by the map's throttled zoom driver) keeps the lines a 1px
//      hairline and the pill text a constant readable size at any zoom, the same trick the nodes use.
//      They carry no opacity fade: they're always fully present at a low alpha, and the viewport
//      clamp (translateExtent + minZoom) guarantees the full cross with all four pills is always
//      reachable, so the user simply pans/zooms to whichever region they want.
//
//   2. The zone chip IS viewport chrome — pinned to the card corner, naming the quadrant under the
//      card centre. It's driven imperatively per frame (useOnViewportChange, no React re-render) and
//      fades in only once the crosshair intersection (canvas W/2,H/2) has scrolled off-card.
function AxisLayer({ preset, geom }) {
  const rf = useReactFlow()
  const rootRef = useRef(null)
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

  // W is dynamic (resizes with the card), so the per-frame handlers read it from a ref rather than
  // closing over a stale value. JSX below reads geom directly and re-renders when W changes.
  const geomRef = useRef(geom)
  useEffect(() => { geomRef.current = geom }, [geom])

  // Zone chip only. The lines/pills are static ViewportPortal geometry now — nothing to position here.
  const applyViewport = useCallback(({ x, y, zoom }) => {
    const { W } = geomRef.current
    const { w, h } = dimsRef.current
    // Canvas coordinate under the card centre — feeds both the quadrant label and the compass store.
    const cxCanvas = (w / 2 - x) / zoom
    const cyCanvas = (h / 2 - y) / zoom

    if (chipRef.current && chipLabelRef.current) {
      const { yHigh, yLow, xHigh, xLow } = labelsRef.current
      chipLabelRef.current.textContent = `${cyCanvas <= H / 2 ? yHigh : yLow} · ${cxCanvas >= W / 2 ? xHigh : xLow}`
      // Fade the chip in when the crosshair intersection (canvas W/2,H/2) is NOT visible on the card.
      // Project that point through the viewport transform to screen space and test it against the
      // card rect inset by a small margin, so the chip appears just as the cross leaves the frame.
      const sx = (W / 2) * zoom + x
      const sy = (H / 2) * zoom + y
      const M = 50
      const centreVisible = sx >= M && sx <= w - M && sy >= M && sy <= h - M
      chipRef.current.style.opacity = centreVisible ? 0 : 1
    }

    // Compass quadrant: TR/TL/BR/BL based on the canvas point under the viewport centre.
    const quadrant = cyCanvas <= H / 2
      ? (cxCanvas >= W / 2 ? 'TR' : 'TL')
      : (cxCanvas >= W / 2 ? 'BR' : 'BL')
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
    const { W } = geomRef.current
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
      {/* Crosshair + pole pills — static CANVAS geometry rendered inside the pane's ViewportPortal, so
          React Flow's own transform pans/zooms them with the songs. Nothing here is positioned per
          frame: only the counter-scale (--axis-scale = 1/zoom) rides along, keeping the lines a 1px
          hairline (scaleX/Y on the thin axis only, so length still tracks the map) and the pill text a
          constant screen size (uniform scale about the anchored edge, so each pill stays capped on its
          axis end and hangs inward). pointerEvents:none so the furniture never eats a pan or a click. */}
      <ViewportPortal>
        <div style={{ pointerEvents: 'none' }}>
          {/* Horizontal line — value 50 on the energy axis (canvas H/2), spanning the mood axis. */}
          <div style={{
            position: 'absolute', left: geom.AXIS_X[0], top: H / 2,
            width: geom.AXIS_X[1] - geom.AXIS_X[0], height: 1, background: AXIS_COLOR,
            transformOrigin: 'center', transform: 'translateY(-50%) scaleY(var(--axis-scale, 1))',
          }} />
          {/* Vertical line — value 50 on the mood axis (canvas W/2), spanning the energy axis. */}
          <div style={{
            position: 'absolute', left: geom.W / 2, top: AXIS_Y[0],
            width: 1, height: AXIS_Y[1] - AXIS_Y[0], background: AXIS_COLOR,
            transformOrigin: 'center', transform: 'translateX(-50%) scaleX(var(--axis-scale, 1))',
          }} />

          {/* Pole pills capping the four axis ends, each anchored by its OUTER edge so it hangs inward. */}
          <span style={{ ...pillBase, left: geom.W / 2, top: AXIS_Y[0], transformOrigin: 'top center',    transform: 'translateX(-50%) scale(var(--axis-scale, 1))',      color: ACCENT1 }}>{preset.yHigh}</span>
          <span style={{ ...pillBase, left: geom.W / 2, top: AXIS_Y[1], transformOrigin: 'bottom center', transform: 'translate(-50%, -100%) scale(var(--axis-scale, 1))', color: ACCENT1 }}>{preset.yLow}</span>
          <span style={{ ...pillBase, left: geom.AXIS_X[0], top: H / 2,  transformOrigin: 'left center',   transform: 'translateY(-50%) scale(var(--axis-scale, 1))',      color: ACCENT2 }}>{preset.xLow}</span>
          <span style={{ ...pillBase, left: geom.AXIS_X[1], top: H / 2,  transformOrigin: 'right center',  transform: 'translate(-100%, -50%) scale(var(--axis-scale, 1))', color: ACCENT2 }}>{preset.xHigh}</span>
        </div>
      </ViewportPortal>

      {/* Zone chip — fades in when the crosshair centre scrolls off-card, naming the current quadrant.
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


// Search glyph (Figma) — a filled outline, not a stroked circle+line, so the ring keeps its taper
// and the handle its rounded join. Figma exports this as two paths behind an outside-mask (its way
// of faking an outward stroke), but a mask forces the browser to rasterize the glyph through an
// offscreen buffer, which is what made it render soft. A centred 1px stroke on the single base path
// reproduces the same weight with no mask, so it stays vector-crisp at any DPR.
const MAGNIFIER_PATH = 'M7.58341 14.6569C5.60748 14.6569 3.93273 13.9709 2.55914 12.5988C1.18638 11.2276 0.5 9.55415 0.5 7.57844C0.5 5.60274 1.18638 3.92887 2.55914 2.55683C3.93191 1.18479 5.60666 0.499177 7.58341 0.500001C9.56015 0.500824 11.2345 1.18684 12.6064 2.55806C13.9784 3.92928 14.6648 5.60274 14.6656 7.57844C14.6656 8.43659 14.5135 9.26714 14.2095 10.0701C13.9054 10.8731 13.5058 11.5599 13.0106 12.1306L20.314 19.4277C20.4294 19.543 20.4912 19.6851 20.4994 19.8539C20.5068 20.0211 20.445 20.1706 20.314 20.3023C20.1822 20.4341 20.0363 20.5 19.8765 20.5C19.7166 20.5 19.5708 20.4341 19.4389 20.3023L12.1368 13.004C11.5188 13.5303 10.8081 13.9375 10.0047 14.2258C9.2013 14.514 8.3938 14.6581 7.58217 14.6581M7.58217 13.4228C9.2219 13.4228 10.6066 12.8587 11.7363 11.7304C12.8652 10.6021 13.4296 9.21814 13.4296 7.57844C13.4296 5.93875 12.8656 4.55518 11.7375 3.42773C10.6095 2.30029 9.2252 1.73615 7.58464 1.73533C5.94408 1.73533 4.55937 2.29947 3.43051 3.42773C2.30165 4.556 1.7368 5.93957 1.73598 7.57844C1.73516 9.21732 2.29959 10.6009 3.42927 11.7292C4.55896 12.8574 5.94326 13.4216 7.58217 13.4216'

function MagnifierIcon({ color }) {
  return (
    <svg width="21" height="21" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d={MAGNIFIER_PATH} fill={color} stroke={color} strokeWidth="1" strokeLinejoin="round" />
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
          <div style={{ width: '100%', height: '100%', background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: TEXT_SECONDARY }}>
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
    <div ref={wrapperRef} style={{ position: 'absolute', left: 20, top: 20, width: 350, zIndex: 4 }}>
      {/* Extruded outer slab (Figma 925:49, 350×70) with the input field recessed into it — the 7px
          gutter is what lets the inset field read as carved out of the slab rather than sat on it.
          Padding carries the whole gutter now. It used to be 6px padding + a 1px border, but the system
          is borderless (the shadows are the edge), so the border's 1px moved into the padding — same
          7px gutter, and the slab still lands at exactly 350×70 (matching the toolbar's height), since
          the height is content-driven and so escapes border-box: 56 + 7 + 7. */}
      <div
        style={{
          padding: 7,
          background: NEO_BAR_BG,
          borderRadius: 100,
          boxShadow: NEO_BAR_SHADOW,
          position: 'relative',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            height: 56,
            padding: '0 6px 0 20px',
            background: NEO_TRAY_BG,
            borderRadius: 100,
            boxShadow: NEO_TRAY_INSET,
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
              minWidth: 0,
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
              width: 45,
              height: 45,
              borderRadius: '50%',
              // The selected shader (Figma 748:2210), same treatment as the Flow toggle's ON knob: a 1px
              // accent ring over a translucent dark glass fill, frosted, with a solid-black drop. NOT the
              // neomorphic button recipe and no hover lift — this reads as a persistent accent chip, not
              // a raised button you can push.
              border: `1px solid ${SELECTED.border}`,
              background: `${SELECTED.sheen}, ${SELECTED.fill}`,
              boxShadow: `${SELECTED.drop}, ${SELECTED.rim}`,
              backdropFilter: SELECTED.blur, WebkitBackdropFilter: SELECTED.blur,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              cursor: 'pointer',
              // Pinned to Figma's y=6 rather than flex-centred, and that is deliberate: centring a
              // 45px circle in the 56px field lands it on 5.5px, putting the ring AND the 21px glyph
              // inside it on half-pixels, which is what made the icon look blurry. At y=6 every
              // offset is a whole pixel (6, and 6 + (45-21)/2 = 18). Figma snapped it for the same
              // reason — 6 above / 5 below is not sloppy centring, it is the pixel grid.
              alignSelf: 'flex-start',
              marginTop: 6,
            }}
          >
            <MagnifierIcon color={ACCENT1} />
          </div>
        </div>
        {/* Raised-slab inner rim — a faint top-left highlight + bottom-right inner shade (no border).
            Same overlay the toolbar pill uses: it rides above the children so the rim is never clipped
            by them, and pointerEvents:none keeps it off the input and the icon underneath. */}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit',
          boxShadow: NEO_BAR_EDGE,
          pointerEvents: 'none',
        }} />
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

// Recenter / fit-view glyph (Figma): a viewfinder — four bracketed corners around a centre dot.
function RecenterIcon({ color }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 6.15385C8.97994 6.15385 8.00165 6.55907 7.28036 7.28036C6.55907 8.00165 6.15385 8.97994 6.15385 10C6.15385 11.0201 6.55907 11.9983 7.28036 12.7196C8.00165 13.4409 8.97994 13.8462 10 13.8462C11.0201 13.8462 11.9983 13.4409 12.7196 12.7196C13.4409 11.9983 13.8462 11.0201 13.8462 10C13.8462 8.97994 13.4409 8.00165 12.7196 7.28036C11.9983 6.55907 11.0201 6.15385 10 6.15385ZM7.33333 0H7.29949C6.17949 0 5.29128 -8.0237e-08 4.57641 0.0584615C3.8441 0.117949 3.22564 0.243077 2.66051 0.530256C1.74358 0.997615 0.998199 1.74335 0.531282 2.66051C0.243077 3.22462 0.117949 3.8441 0.0584615 4.57641C-8.0237e-08 5.29128 0 6.17949 0 7.29949V7.33333C0 7.53735 0.0810436 7.733 0.225302 7.87726C0.369561 8.02152 0.565218 8.10256 0.769231 8.10256C0.973244 8.10256 1.1689 8.02152 1.31316 7.87726C1.45742 7.733 1.53846 7.53735 1.53846 7.33333C1.53846 6.17231 1.53846 5.34667 1.59179 4.70154C1.64308 4.06564 1.74256 3.67077 1.90154 3.35795C2.22109 2.7309 2.7309 2.22109 3.35795 1.90154C3.67077 1.74256 4.06564 1.6441 4.70154 1.59179C5.34769 1.53949 6.17231 1.53846 7.33333 1.53846C7.53735 1.53846 7.733 1.45742 7.87726 1.31316C8.02152 1.1689 8.10256 0.973244 8.10256 0.769231C8.10256 0.565218 8.02152 0.369561 7.87726 0.225302C7.733 0.0810436 7.53735 0 7.33333 0ZM12.6667 1.53846C13.8287 1.53846 14.6533 1.53846 15.2985 1.59179C15.9344 1.64308 16.3292 1.74256 16.6421 1.90154C17.2691 2.22109 17.7789 2.7309 18.0985 3.35795C18.2574 3.67077 18.3559 4.06564 18.4082 4.70154C18.4605 5.34769 18.4615 6.17231 18.4615 7.33333C18.4615 7.53735 18.5426 7.733 18.6868 7.87726C18.8311 8.02152 19.0268 8.10256 19.2308 8.10256C19.4348 8.10256 19.6304 8.02152 19.7747 7.87726C19.919 7.733 20 7.53735 20 7.33333V7.29949C20 6.17949 20 5.29128 19.9415 4.57641C19.8821 3.8441 19.7569 3.22564 19.4697 2.66051C19.0027 1.74373 18.2573 0.998374 17.3405 0.531282C16.7744 0.243077 16.1559 0.117949 15.4236 0.0584615C14.7087 -8.0237e-08 13.8205 0 12.7005 0H12.6667C12.4627 4.29925e-09 12.267 0.0810436 12.1227 0.225302C11.9785 0.369561 11.8974 0.565218 11.8974 0.769231C11.8974 0.973244 11.9785 1.1689 12.1227 1.31316C12.267 1.45742 12.4627 1.53846 12.6667 1.53846ZM1.53846 12.6667C1.53846 12.4627 1.45742 12.267 1.31316 12.1227C1.1689 11.9785 0.973244 11.8974 0.769231 11.8974C0.565218 11.8974 0.369561 11.9785 0.225302 12.1227C0.0810436 12.267 0 12.4627 0 12.6667V12.7005C0 13.8205 -8.0237e-08 14.7087 0.0584615 15.4236C0.117949 16.1559 0.243077 16.7744 0.530256 17.3405C0.99779 18.2571 1.74351 19.0021 2.66051 19.4687C3.22462 19.7569 3.8441 19.8821 4.57641 19.9415C5.29128 20 6.17949 20 7.29949 20H7.33333C7.53735 20 7.733 19.919 7.87726 19.7747C8.02152 19.6304 8.10256 19.4348 8.10256 19.2308C8.10256 19.0268 8.02152 18.8311 7.87726 18.6868C7.733 18.5426 7.53735 18.4615 7.33333 18.4615C6.17231 18.4615 5.34667 18.4615 4.70154 18.4082C4.06564 18.3569 3.67077 18.2574 3.35795 18.0985C2.7309 17.7789 2.22109 17.2691 1.90154 16.6421C1.74256 16.3292 1.6441 15.9344 1.59179 15.2985C1.53949 14.6523 1.53846 13.8277 1.53846 12.6667ZM20 12.6667C20 12.4627 19.919 12.267 19.7747 12.1227C19.6304 11.9785 19.4348 11.8974 19.2308 11.8974C19.0268 11.8974 18.8311 11.9785 18.6868 12.1227C18.5426 12.267 18.4615 12.4627 18.4615 12.6667C18.4615 13.8287 18.4615 14.6533 18.4082 15.2985C18.3569 15.9344 18.2574 16.3292 18.0985 16.6421C17.7789 17.2691 17.2691 17.7789 16.6421 18.0985C16.3292 18.2574 15.9344 18.3559 15.2985 18.4082C14.6523 18.4605 13.8277 18.4615 12.6667 18.4615C12.4627 18.4615 12.267 18.5426 12.1227 18.6868C11.9785 18.8311 11.8974 19.0268 11.8974 19.2308C11.8974 19.4348 11.9785 19.6304 12.1227 19.7747C12.267 19.919 12.4627 20 12.6667 20H12.7005C13.8205 20 14.7087 20 15.4236 19.9415C16.1559 19.8821 16.7744 19.7569 17.3405 19.4697C18.2569 19.0025 19.0019 18.2571 19.4687 17.3405C19.7569 16.7744 19.8821 16.1559 19.9415 15.4236C20 14.7087 20 13.8205 20 12.7005V12.6667Z" fill={color} />
    </svg>
  )
}

// Zoom glyphs (Figma) — solid magnifiers with a chunky handle, not stroked outlines.
function ZoomInIcon({ color }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M14.656 12.8978H13.7296L13.4013 12.5812C14.1341 11.73 14.6697 10.7273 14.9697 9.64495C15.2697 8.56258 15.3267 7.42729 15.1367 6.3203C14.5856 3.06086 11.8652 0.457994 8.58201 0.0593566C3.622 -0.550323 -0.540653 3.62364 0.0573628 8.58315C0.45604 11.866 3.05917 14.5862 6.31893 15.1372C7.42603 15.3272 8.56144 15.2702 9.64392 14.9702C10.7264 14.6702 11.7292 14.1347 12.5805 13.402L12.8971 13.7303V14.6565L17.8923 19.6395C18.373 20.1202 19.1469 20.1202 19.6277 19.6395L19.6394 19.6277C20.1202 19.147 20.1202 18.3732 19.6394 17.8925L14.656 12.8978ZM7.6205 12.8978C4.70078 12.8978 2.34389 10.5412 2.34389 7.62174C2.34389 4.70231 4.70078 2.34566 7.6205 2.34566C10.5402 2.34566 12.8971 4.70231 12.8971 7.62174C12.8971 10.5412 10.5402 12.8978 7.6205 12.8978ZM7.6205 4.69058C7.29218 4.69058 7.03421 4.94852 7.03421 5.27681V7.0355H5.27534C4.94702 7.0355 4.68905 7.29345 4.68905 7.62174C4.68905 7.95002 4.94702 8.20797 5.27534 8.20797H7.03421V9.96666C7.03421 10.2949 7.29218 10.5529 7.6205 10.5529C7.94882 10.5529 8.20679 10.2949 8.20679 9.96666V8.20797H9.96566C10.294 8.20797 10.5519 7.95002 10.5519 7.62174C10.5519 7.29345 10.294 7.0355 9.96566 7.0355H8.20679V5.27681C8.20679 4.94852 7.94882 4.69058 7.6205 4.69058Z" fill={color} />
    </svg>
  )
}

function ZoomOutIcon({ color }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M14.656 12.8978H13.7296L13.4013 12.5812C14.1341 11.73 14.6697 10.7273 14.9697 9.64495C15.2697 8.56258 15.3267 7.42729 15.1367 6.3203C14.5856 3.06086 11.8652 0.457994 8.58201 0.0593566C3.622 -0.550323 -0.540653 3.62364 0.0573628 8.58315C0.45604 11.866 3.05917 14.5862 6.31893 15.1372C7.42603 15.3272 8.56144 15.2702 9.64392 14.9702C10.7264 14.6702 11.7292 14.1347 12.5805 13.402L12.8971 13.7303V14.6565L17.8923 19.6395C18.373 20.1202 19.1469 20.1202 19.6277 19.6395L19.6394 19.6277C20.1202 19.147 20.1202 18.3732 19.6394 17.8925L14.656 12.8978ZM7.6205 12.8978C4.70078 12.8978 2.34389 10.5412 2.34389 7.62174C2.34389 4.70231 4.70078 2.34566 7.6205 2.34566C10.5402 2.34566 12.8971 4.70231 12.8971 7.62174C12.8971 10.5412 10.5402 12.8978 7.6205 12.8978ZM7.62176 7.03477C7.29344 7.03477 7.62176 7.03477 7.03547 7.03477L7.03421 7.0355H5.27534C4.94702 7.0355 4.68905 7.29345 4.68905 7.62174C4.68905 7.95002 4.94702 8.20797 5.27534 8.20797L7.03421 8.20723C7.03421 8.20723 7.29245 8.20723 7.62113 8.20723C7.94981 8.20723 8.20805 8.20723 8.20805 8.20723L8.20679 8.20797H9.96566C10.294 8.20797 10.5519 7.95002 10.5519 7.62174C10.5519 7.29345 10.294 7.0355 9.96566 7.0355H8.20679C8.20405 7.03477 7.95009 7.03477 7.62176 7.03477Z" fill={color} />
    </svg>
  )
}

// A click on these fires an instant action (zoom step / recenter), so a raw :active flash would be
// gone before the eye caught it. Hold the accent on for a floor of ~180ms after press instead.
const PRESS_MIN_MS = 180

// Raised icon button (Figma 916:36 / 1067:103 / 1067:105) — a 60x40 rounded rect, not a circle. The
// glyph still lands on whole pixels at this size — (60 - 20) / 2 = 20 across, (40 - 20) / 2 = 10 down —
// so the icons stay crisp; see MagnifierIcon on why that matters. `radius` is positional rather than
// decorative: the tray's two end buttons round their OUTER corners to 20, which is the tray's own 27
// radius minus its 7px padding, so those caps sit concentric inside the trench's ends instead of
// cutting across them. Every inner corner stays 10.
// Owns its icon rather than taking children so the pressed state can recolour the glyph.
function ToolButton({ icon: Icon, onClick, radius = 10 }) {
  const [pressed, setPressed] = useState(false)
  const [hover, setHover] = useState(false)
  const downAt = useRef(0)
  const timer = useRef(0)

  useEffect(() => () => clearTimeout(timer.current), [])

  const press = useCallback(() => {
    clearTimeout(timer.current)
    downAt.current = performance.now()
    setPressed(true)
  }, [])

  // Keep the accent lit for the remainder of PRESS_MIN_MS if the click was quicker than that.
  const release = useCallback(() => {
    clearTimeout(timer.current)
    const held = performance.now() - downAt.current
    timer.current = setTimeout(() => setPressed(false), Math.max(0, PRESS_MIN_MS - held))
  }, [])

  return (
    <div
      onClick={onClick}
      onPointerDown={press}
      onPointerUp={release}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => { setHover(false); if (pressed) release() }}
      style={{
        width: 60,
        height: 40,
        borderRadius: radius,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Raised at rest (extruded, lit top-left); floats a touch higher on hover (larger offset/blur);
        // sinks to an inset well on press, dropping to the darker press background with the accent ring
        // on top. The ring stays an INSET shadow, not a border: a border would shrink the content box to
        // 47px and drop the 20px glyph onto a half-pixel (13.5), blurring it — a shadow doesn't touch
        // layout, so the glyph stays put at 15px.
        background: pressed ? NEO_BTN_PRESS_BG : (hover ? NEO_BTN_HOVER_BG : NEO_BTN_BG),
        boxShadow: pressed
          ? `inset 0 0 0 1.5px ${SELECTED.border}, ${NEO_BTN_PRESS}`
          : (hover ? NEO_BTN_HOVER : NEO_BTN_RAISED),
        transition: 'box-shadow 120ms ease, background 120ms ease',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <Icon color={pressed ? ACCENT1 : ICON_PRIMARY} />
    </div>
  )
}

// Top-right toolbar: active preset label + zoom controls + compass dropdown.
function ToolBar({ rf, presetName = 'Vibe', activePreset, geom }) {
  const stroke = ICON_PRIMARY
  const [compassOpen, setCompassOpen] = useState(false)
  const [chevHover, setChevHover] = useState(false)

  // Fit the axis box, not the nodes — same framing the map opens with, so this button always
  // returns you to the full crosshair with its four poles in view.
  const handleFitView = useCallback(() => {
    rf.fitBounds(geom.AXIS_BOUNDS, { padding: FIT_PAD_FRAC, duration: 600 })
  }, [rf, geom])

  const handleZoomIn  = useCallback(() => rf.zoomIn({ duration: 200 }), [rf])
  const handleZoomOut = useCallback(() => rf.zoomOut({ duration: 200 }), [rf])

  return (
    <div style={{
      position: 'absolute', right: 20, top: 20, zIndex: 4,
      display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10,
    }}>
      {/* Top row: Flow toggle (build mode only, sits LEFT of the toolbar — Decision Log #48–50,
          Figma 748-1804) + the toolbar pill, right-anchored so the pill never shifts. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <FlowToggle />
      {/* Toolbar pill (Figma 748:2968). Height is the design's 70, and with 40px buttons the math closes
          on Figma's own numbers: 8px pill padding + 7px tray padding + the 40px buttons = 70, which is
          exactly the search bar and Flow toggle height, so all three sit as an even row. The 3px this
          padding briefly carried was only headroom for 50px buttons — at 40 the tray fits at Figma's 8. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        height: 70, boxSizing: 'border-box',
        padding: '8px 30px', background: NEO_BAR_BG, borderRadius: 100, boxShadow: NEO_BAR_SHADOW,
        position: 'relative',
      }}>
        {/* Label rides directly on the pill surface — no tray behind it. The split between the label (on
            the slab) and the buttons (in the trench) is the point: it separates readout from control. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 500, color: TEXT_SECONDARY }}>Preset</span>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT1 }} />
          <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, color: '#fff' }}>{presetName}</span>
        </div>
        {/* Recessed tray (Figma 916:31) holding the three map controls. The chevron stays OUT of it —
            in the mockup the tray ends before the chevron, which reads right: the tray groups the map
            controls, and the dropdown affordance stays distinct. 7px padding on the 40px buttons makes
            the tray 54 tall, so its pill radius resolves to 27 — and the end buttons' 20px outer caps
            are exactly that minus the padding, which is what lets them nest concentrically in the ends.
            The end radii are positional: whichever button sits at an end gets the cap. */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: 7, borderRadius: 100,
          background: NEO_TRAY_BG, boxShadow: NEO_TRAY_INSET,
        }}>
          <ToolButton icon={RecenterIcon} onClick={handleFitView} radius="20px 10px 10px 20px" />
          <ToolButton icon={ZoomInIcon} onClick={handleZoomIn} />
          <ToolButton icon={ZoomOutIcon} onClick={handleZoomOut} radius="10px 20px 20px 10px" />
        </div>
        {/* Chevron toggle — raised, but on the PILL rather than in the tray, so it takes the outer-glow
            recipe (NEO_CHEV_*) instead of the wells' inner bevel. There's no trench floor beside it for
            an outer light shadow to wash out, which is the whole reason the tray buttons can't have one;
            see the rule at the top of the NEO_* block. The glyph rotates when the compass is open while
            the button surface stays put, and the open state sinks it inset. */}
        <button
          onClick={() => setCompassOpen((o) => !o)}
          onPointerEnter={() => setChevHover(true)}
          onPointerLeave={() => setChevHover(false)}
          style={{
            width: 34, height: 34, borderRadius: '50%', flexShrink: 0, padding: 0,
            border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: compassOpen ? NEO_BTN_PRESS_BG : (chevHover ? NEO_BTN_HOVER_BG : NEO_BTN_BG),
            boxShadow: compassOpen ? NEO_BTN_PRESS : (chevHover ? NEO_CHEV_HOVER : NEO_CHEV_RAISED),
            transition: 'box-shadow 120ms ease, background 120ms ease',
          }}
        >
          <svg width="13" height="8" viewBox="0 0 13 8" fill="none" style={{
            transition: 'transform 220ms ease',
            transform: compassOpen ? 'rotate(180deg)' : 'rotate(0deg)',
          }}>
            <path d="M1 1.5L6.5 6.5L12 1.5" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {/* Raised-slab inner rim — a faint top-left highlight + bottom-right inner shade (no border) */}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit',
          boxShadow: NEO_BAR_EDGE,
          pointerEvents: 'none',
        }} />
      </div>
      </div>

      {/* Compass card — slides in below toolbar when open */}
      {compassOpen && (
        <div style={{
          width: 373, padding: 15, borderRadius: 20,
          background: NEO_BAR_BG,
          filter: NEO_PANEL_SHADOW,
          position: 'relative',
        }}>
          <CompassPreview presetKey={activePreset} />
          {/* Raised-panel inner rim — top-left highlight + bottom-right inner shade (no border) */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: 'inherit',
            boxShadow: NEO_PANEL_EDGE,
            pointerEvents: 'none',
          }} />
        </div>
      )}
    </div>
  )
}

// Pan is clamped to the axis box (the 2%–98% crosshair bounds = geom.AXIS_BOUNDS), plus EDGE_MARGIN_PX:
// the user can never scroll past the axis endpoints into empty canvas. Combined with a minZoom that makes
// AXIS_BOUNDS fill the viewport at full zoom-out (see computeMinZoom), this guarantees the complete cross
// with all four pills is always in reach and there's no void to get lost in.

// minZoom = the zoom at which AXIS_BOUNDS fills the viewport. Recomputed from the card's live size on
// resize. Now that the canvas shares the card's aspect ratio, the width and height terms coincide, so the
// 30px reserved on height (15px top + 15px bottom) yields ~15px on all four sides at max zoom-out.
const computeMinZoom = (vw, vh, bounds) =>
  Math.min(vw / bounds.width, (vh - 2 * EDGE_MARGIN_PX) / bounds.height)

// Manual zoom ceiling. Cards grow only slowly with zoom (dampened counter-scale — see NODE_PIN /
// NODE_PIN_EXP in TrackNode) while the canvas spreads at full zoom, so zooming deeper mostly
// separates songs and lets you pull individual cards out of a dense cluster. Hence a generous
// ceiling. translateExtent is in flow-space (zoom-independent) and its 3000px margin already
// covers centering at this zoom.
const MAX_ZOOM = 3.5

// Ceiling on the auto-fit zoom, below MAX_ZOOM. Now that the fit frames the axis box rather than
// the song cluster, this only binds on a very small card — but it keeps the fit from ever slamming
// to the manual ceiling; the user can still zoom deeper by hand.
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

  // Canvas width tracks the card's aspect ratio (set in the resize effect below); all W-dependent
  // geometry is derived from it in one memo so every consumer reads a consistent snapshot per render.
  const [W, setW] = useState(() => (H * 16) / 9) // provisional 16:9 until the card is measured on mount
  const geom = useMemo(() => makeGeom(W), [W])

  const initialNodes = useMemo(() => buildNodes(stagedTracks, presetConfig, geom.PAD), [stagedTracks, presetConfig, geom.PAD])
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

  // Rebuild on a staged-tracks, preset, or canvas-width change. A TRACK change re-fits (new library →
  // the bloom + fitView run). A WIDTH change (resize) also re-fits, since the axis box has reshaped and
  // must be re-framed with the new aspect. A PRESET-only change instead SLIDES the songs to their new
  // positions (Slice 11.5, Feature 3): add the reposition class for 500ms so React Flow's per-node
  // translate transitions, and DON'T re-fit — keeping the viewport still is what makes the slide visible
  // instead of a jump-cut. Positions come from toFlowPos with the current PAD, so a wider/narrower W just
  // rescales every X proportionally (value 50 stays at 50% of W).
  const prevBuildRef = useRef({ tracks: stagedTracks, preset: presetConfig, pad: geom.PAD })
  const repositionTimer = useRef(null)

  // Song centres for the density nebula. Same pure function on the same inputs as the rebuild below,
  // so the cloud is drawn from exactly the positions the nodes land on and can't drift out of register
  // with them. Deliberately NOT derived from the `nodes` state: that array is rebuilt for dimming,
  // glow tiers and selection too, and each new identity would trigger a needless crossfade.
  //
  // Flow mode is the present view — only the chain stays lit and everything else drops to FLOW_DIM
  // (see TrackNode) — so the gas has to follow the same rule, or the atmosphere goes on advertising
  // the density of songs the presenter has just deliberately pushed into the dark. Emitters narrow to
  // the chain, leaving the cloud sitting on the set alone. Orphans are excluded with the rest: flow
  // mode dims them too, since they're cut from the chain even though they were once in it.
  //
  // Depending on `chainSet` only while flow mode is ON keeps ordinary set-building (flow OFF) from
  // churning this memo — otherwise every wire the user connects would crossfade the whole nebula.
  const litSet = flowMode ? chainSet : null
  const songPositions = useMemo(() => {
    const built = buildNodes(stagedTracks, presetConfig, geom.PAD)
    const lit = litSet ? built.filter((n) => litSet.has(n.id)) : built
    return lit.map((n) => n.position)
  }, [stagedTracks, presetConfig, geom.PAD, litSet])
  useEffect(() => {
    const prev = prevBuildRef.current
    const tracksChanged = prev.tracks !== stagedTracks
    const presetChanged = prev.preset !== presetConfig
    const widthChanged = prev.pad !== geom.PAD
    prevBuildRef.current = { tracks: stagedTracks, preset: presetConfig, pad: geom.PAD }
    setNodes(buildNodes(stagedTracks, presetConfig, geom.PAD))
    if (tracksChanged || widthChanged) {
      hasFit.current = false
    } else if (presetChanged) {
      const el = wrapperRef.current
      el?.classList.add('drift-repositioning')
      clearTimeout(repositionTimer.current)
      repositionTimer.current = setTimeout(() => el?.classList.remove('drift-repositioning'), 520)
    }
  }, [stagedTracks, presetConfig, geom.PAD, setNodes])

  const handleWheel = useCallback((e) => {
    // ctrlKey is true for pinch-to-zoom and ctrl+scroll — the zoom gesture
    if (!e.ctrlKey) return
    const el = wrapperRef.current
    if (!el) return
    el.classList.add('is-zooming')
    clearTimeout(zoomTimer.current)
    zoomTimer.current = setTimeout(() => el.classList.remove('is-zooming'), 150)
  }, [])

  const store = useStoreApi()

  // Keep the pan clamp EDGE_MARGIN_PX outside the axis box at the CURRENT zoom, so the pills never
  // reach the card edge however far you pan (they used to land flush — measured 1px off it at every
  // limit). The margin is a screen distance and the extent is canvas-space, so this has to be rewritten
  // as zoom changes; it is pushed straight into the React Flow store rather than passed as a prop
  // because a prop would put zoom on the render path — ~30 re-renders a second, the exact thing the
  // rest of this file goes out of its way to avoid. geom rides a ref so the writer stays identity-stable.
  const geomRef = useRef(geom)
  const applyExtent = useCallback((zoom) => {
    store.getState().setTranslateExtent(EXPANDED_EXTENT(geomRef.current, zoom))
  }, [store])
  // A resize reshapes the axis box without touching zoom, so re-apply on geom too.
  useEffect(() => {
    geomRef.current = geom
    applyExtent(rf.getViewport().zoom)
  }, [geom, applyExtent, rf])

  // Counter-scale + tier driver (throttled to ~30fps). Writes the scale factor into the
  // --node-scale CSS var so every node rescales via CSS with no React re-render, and flips tier
  // state only when a threshold is crossed. --axis-scale (a true 1/zoom) rides the same frame: the
  // crosshair furniture in the ViewportPortal reads it to hold a constant screen size at any zoom.
  const applyZoom = useCallback((zoom) => {
    const el = wrapperRef.current
    if (el) {
      el.style.setProperty('--node-scale', String(getNodeScale(zoom)))
      el.style.setProperty('--axis-scale', String(1 / zoom))
    }
    applyExtent(zoom)
    const next = getTier(zoom)
    if (next !== tierRef.current) {
      tierRef.current = next
      setTier(next)
    }
  }, [applyExtent])
  useThrottledZoom(applyZoom)

  // Scroll the grid with the map. The grid is a fixed 22px CSS background (constant density, so it's
  // visible at any zoom), so to give it motion reference we write the viewport PAN into the card's
  // background-position on every transform change — panning by N screen px shifts the translate by N at
  // any zoom, so the grid tracks the map 1:1. Guarded to skip no-op frames; a background-position write
  // is a cheap paint with no React re-render, so this can ride every transform update.
  useEffect(() => {
    let px = null, py = null
    const apply = () => {
      const [x, y] = store.getState().transform
      if (x === px && y === py) return
      px = x; py = y
      if (wrapperRef.current) wrapperRef.current.style.backgroundPosition = `${x}px ${y}px`
    }
    apply()
    return store.subscribe(apply)
  }, [store])

  // Seed the var + tier from the current viewport before first paint (the watcher only fires on a
  // change), so nodes mount at the right scale/tier instead of flashing the default.
  useLayoutEffect(() => { applyZoom(rf.getViewport().zoom) }, [applyZoom, rf])

  useEffect(() => {
    if (hasFit.current || nodes.length === 0) return
    const allMeasured = nodes.every((n) => n.measured?.width && n.measured?.height)
    if (!allMeasured) return

    // Frame the AXIS box, not the songs' bounding box. The crosshair and its terminator pills are
    // canvas-anchored (see AxisLayer), so they only work as a frame of reference if the default view
    // actually contains them — fitting the song cluster alone crops the axis ends, and their pills,
    // off the card. The axis box always contains the songs (2%–98% brackets PAD's ~10.4%/~14.6% band), so this
    // still frames the whole library; it just pulls back far enough to show the poles the library is
    // being measured against. Cost, accepted: a tightly-clustered library no longer fills the view.
    // Measure the map card (ReactFlow's container), not the window — the canvas lives inside an
    // inset card, so centering must use the card's own dimensions. clientWidth/Height, NOT
    // getBoundingClientRect: the card carries a 1px border, and the pane ReactFlow actually lays out in
    // is the CONTENT box. Measuring the border box made the fit centre for 880px inside an 878px pane,
    // skewing every margin 1px (top pole 20px clear, bottom 18px) and leaving the fit zoom a hair above
    // the floor the resize path computes from clientHeight — which is what let a "locked" fit still
    // drift a pixel or two under a hard drag. Same measurement as the resize effect below, on purpose.
    const el = wrapperRef.current
    const vw = el?.clientWidth || window.innerWidth - MAP_LEFT - PAGE_INSET - 2
    const vh = el?.clientHeight || window.innerHeight - 2 * PAGE_INSET - 2

    // minZoom is the zoom at which AXIS_BOUNDS exactly fills the card — the hard floor the viewport
    // clamps to. The default fit adds a little breathing room (FIT_PAD_FRAC) but can never zoom out
    // past that floor, so it's clamped up to minZoom for a very large box. Fit still frames the axis
    // cross, just tighter when the padded fit would fall below the floor.
    const floor = computeMinZoom(vw, vh, geom.AXIS_BOUNDS)
    const zoom = Math.max(floor, Math.min(
      (vw * (1 - 2 * FIT_PAD_FRAC)) / geom.AXIS_BOUNDS.width,
      (vh * (1 - 2 * FIT_PAD_FRAC)) / geom.AXIS_BOUNDS.height,
      FIT_MAX_ZOOM,
    ))
    // The axis box is centred on the canvas, so its midpoint is the crosshair itself.
    const x = vw / 2 - (geom.W / 2) * zoom
    const y = vh / 2 - (H / 2) * zoom

    setMinZoom(floor)
    rf.setViewport({ x, y, zoom })
    hasFit.current = true
  }, [nodes, rf, geom])

  // Canvas width + framing track the card's live aspect ratio. Measure immediately on mount (so the very
  // first fit frames the axis with the right shape), then on every resize — debounced 200ms so a window
  // drag doesn't rebuild positions on every pixel. Setting W reshapes the geometry, which re-fits via the
  // rebuild effect above (widthChanged → hasFit=false); minZoom is set here too so the pan clamp stays
  // right even for an aspect-preserving resize that leaves W unchanged.
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    let t = 0
    const measure = () => {
      const vw = el.clientWidth, vh = el.clientHeight
      if (vw <= 0 || vh <= 0) return
      setW(canvasWidthFor(vw, vh))
      setMinZoom(computeMinZoom(vw, vh, makeGeom(canvasWidthFor(vw, vh)).AXIS_BOUNDS))
    }
    measure() // immediate, no debounce — the mount measurement
    const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(measure, 200) })
    ro.observe(el)
    return () => { clearTimeout(t); ro.disconnect() }
  }, [])

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
        backgroundImage: LINE_GRID,
        backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
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
            // No translateExtent prop: it is zoom-dependent and owned imperatively (see applyExtent).
            // Passing it here too would let React Flow's prop→store sync clobber the live value on any
            // re-render that happens to carry a stale one.
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
      {/* Density nebula — canvas-space gas under the songs. Rendered before AxisLayer so its portal
          content is inserted first and the crosshair stays on top of the cloud; both sit below the
          nodes (ViewportPortal content renders under the node layer) and above the card's line grid,
          which is a CSS background on the wrapper below everything. */}
      <NebulaLayer songPositions={songPositions} width={geom.W} height={H} />
      <AxisLayer preset={presetConfig} geom={geom} />
      <SearchBar tracks={tracks} rf={rf} onHighlight={handleHighlight} />
      <ToolBar rf={rf} presetName={presetConfig.label} activePreset={activePreset} geom={geom} />
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
