import { useMemo, useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  useOnViewportChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import TrackNode from './TrackNode'

// Flow-space canvas dimensions
const W = 3000
const H = 3000

// 5%–95% padding as per spec
const PAD = { x: [W * 0.05, W * 0.95], y: [H * 0.05, H * 0.95] }

// X axis = mood/valence: dark (low) → left, bright (high) → right.
// Y axis = energy: intense (high) → top (low Y), chill (low) → bottom (high Y).
function toFlowPos(energy, mood) {
  const x = (mood / 100) * (PAD.x[1] - PAD.x[0]) + PAD.x[0]
  const y = (1 - energy / 100) * (PAD.y[1] - PAD.y[0]) + PAD.y[0]
  return { x, y }
}

function buildNodes(tracks) {
  return tracks.map((track, i) => {
    const pos = toFlowPos(track.energy ?? 50, track.mood ?? 50)
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

// AxisLayer writes positions directly to the DOM via refs — no React re-renders
// on zoom/pan. useOnViewportChange fires in the same frame as the d3-zoom event,
// while useViewport() would route through React's batch cycle (one frame late).
function AxisLayer() {
  const rf = useReactFlow()
  const hLineRef = useRef(null)
  const vLineRef = useRef(null)
  const intenseRef = useRef(null)
  const chillRef = useRef(null)
  const darkRef = useRef(null)
  const brightRef = useRef(null)

  const applyViewport = useCallback(({ x, y, zoom }) => {
    const cx = (W / 2) * zoom + x
    const cy = (H / 2) * zoom + y
    if (hLineRef.current) hLineRef.current.style.top = `${cy}px`
    if (vLineRef.current) vLineRef.current.style.left = `${cx}px`
    // Intense/Chill ride the vertical axis (x = cx) along the top/bottom edges.
    if (intenseRef.current) intenseRef.current.style.left = `${cx}px`
    if (chillRef.current) chillRef.current.style.left = `${cx}px`
    // Dark/Bright ride the horizontal axis (y = cy) along the left/right edges.
    if (darkRef.current) darkRef.current.style.top = `${cy}px`
    if (brightRef.current) brightRef.current.style.top = `${cy}px`
  }, [])

  // Inset each crosshair line so it stops at the terminator pills instead of bleeding
  // past them to the card edge. The insets equal the pills' rendered size (constant — the
  // pills only slide along the line, never change size), so this runs once, not per-frame.
  const fitLines = useCallback(() => {
    const { current: hLine } = hLineRef
    const { current: vLine } = vLineRef
    if (hLine && darkRef.current && brightRef.current) {
      hLine.style.left = `${EDGE + darkRef.current.offsetWidth}px`
      hLine.style.right = `${EDGE + brightRef.current.offsetWidth}px`
    }
    if (vLine && intenseRef.current && chillRef.current) {
      vLine.style.top = `${EDGE + intenseRef.current.offsetHeight}px`
      vLine.style.bottom = `${EDGE + chillRef.current.offsetHeight}px`
    }
  }, [])

  // Set correct positions before first paint so there's no flash at (0,0)
  useLayoutEffect(() => {
    applyViewport(rf.getViewport())
    fitLines()
    // Webfont swap changes pill widths — re-measure once DM Sans has loaded.
    document.fonts?.ready?.then(fitLines)
  }, [applyViewport, fitLines, rf])

  // Track all subsequent viewport changes imperatively
  useOnViewportChange({ onChange: applyViewport })

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <div ref={hLineRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: AXIS_COLOR, transform: 'translateY(-0.5px)' }} />
      <div ref={vLineRef} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 1, background: AXIS_COLOR, transform: 'translateX(-0.5px)' }} />

      <Bracket pos="tl" />
      <Bracket pos="tr" />
      <Bracket pos="bl" />
      <Bracket pos="br" />

      <span ref={intenseRef} style={{ ...pillBase, top: EDGE, transform: 'translateX(-50%)', color: ACCENT1 }}>Intense</span>
      <span ref={chillRef} style={{ ...pillBase, bottom: EDGE, transform: 'translateX(-50%)', color: ACCENT1 }}>Chill</span>
      <span ref={darkRef} style={{ ...pillBase, left: EDGE, transform: 'translateY(-50%)', color: ACCENT2 }}>Dark</span>
      <span ref={brightRef} style={{ ...pillBase, right: EDGE, transform: 'translateY(-50%)', color: ACCENT2 }}>Bright</span>
    </div>
  )
}


// —— Map chrome (visual only; functionality lands in a later slice) ————————————————

const barShadow = '4px 4px 2.5px 0px rgba(0,0,0,0.9), inset 1px 1.5px 3px 0px #373737'

function MagnifierIcon({ color }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="7.5" cy="7.5" r="5" stroke={color} strokeWidth="1.6" />
      <line x1="11.4" y1="11.4" x2="15.5" y2="15.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

// Top-left search pill.
function SearchBar() {
  return (
    <div
      style={{
        position: 'absolute', left: 19, top: 19, width: 350, zIndex: 4,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 10px 8px 30px', background: CARD, borderRadius: 100, boxShadow: barShadow,
      }}
    >
      <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 500, color: TEXT_SECONDARY, whiteSpace: 'nowrap' }}>
        Find a Song on Your Map
      </span>
      <div style={{ width: 42, height: 42, borderRadius: '50%', border: `1.5px solid ${ACCENT1}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <MagnifierIcon color={ACCENT1} />
      </div>
    </div>
  )
}

function ToolDivider() {
  return <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />
}

function ToolButton({ children }) {
  return (
    <div
      style={{
        width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: CARD, color: '#9a9a9a',
        boxShadow: 'inset -1px -1px 3px 0px #373737, inset 2px 2px 2px 0px rgba(0,0,0,0.7)',
      }}
    >
      {children}
    </div>
  )
}

// Top-right toolbar: active preset + view controls.
function ToolBar() {
  const stroke = '#9a9a9a'
  return (
    <div
      style={{
        position: 'absolute', right: 19, top: 19, zIndex: 4,
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '8px 22px', background: CARD, borderRadius: 100, boxShadow: barShadow,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 500, color: TEXT_SECONDARY }}>Preset</span>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT1 }} />
        <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, color: '#fff' }}>Vibe</span>
      </div>
      <ToolDivider />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ToolButton>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="3" stroke={stroke} strokeWidth="1.5" />
            <line x1="9" y1="1.5" x2="9" y2="3.5" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="9" y1="14.5" x2="9" y2="16.5" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="1.5" y1="9" x2="3.5" y2="9" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="14.5" y1="9" x2="16.5" y2="9" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </ToolButton>
        <ToolButton>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="7.5" cy="7.5" r="5" stroke={stroke} strokeWidth="1.5" />
            <line x1="11.4" y1="11.4" x2="15.5" y2="15.5" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="5.3" y1="7.5" x2="9.7" y2="7.5" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="7.5" y1="5.3" x2="7.5" y2="9.7" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </ToolButton>
        <ToolButton>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="7.5" cy="7.5" r="5" stroke={stroke} strokeWidth="1.5" />
            <line x1="11.4" y1="11.4" x2="15.5" y2="15.5" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="5.3" y1="7.5" x2="9.7" y2="7.5" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </ToolButton>
      </div>
      <ToolDivider />
      <svg width="13" height="8" viewBox="0 0 13 8" fill="none">
        <path d="M1 1.5L6.5 6.5L12 1.5" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
}

// 1500px overflow on each side of the 3000×3000 canvas — songs at the edges
// can be centered without hitting a hard wall
const TRANSLATE_EXTENT = [[-1500, -1500], [W + 1500, H + 1500]]

function DriftMapInner({ tracks }) {
  const initialNodes = useMemo(() => buildNodes(tracks), [tracks])
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [minZoom, setMinZoom] = useState(0.01)
  const rf = useReactFlow()
  const hasFit = useRef(false)
  const wrapperRef = useRef(null)
  const zoomTimer = useRef(null)

  // Switching playlists swaps the visible songs: rebuild nodes and re-fit the viewport.
  useEffect(() => {
    setNodes(buildNodes(tracks))
    hasFit.current = false
  }, [tracks, setNodes])

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

    // Center on canvas midpoint so axis crosshair lands at screen center,
    // then zoom to fit the outermost song from that fixed center point.
    const canvasCx = W / 2
    const canvasCy = H / 2
    const extX = Math.max(Math.abs(minX - canvasCx), Math.abs(maxX - canvasCx)) || 1
    const extY = Math.max(Math.abs(minY - canvasCy), Math.abs(maxY - canvasCy)) || 1

    // Measure the map card (ReactFlow's container), not the window — the canvas now lives
    // inside an inset card, so centering must use the card's own dimensions.
    const rect = wrapperRef.current?.getBoundingClientRect()
    const vw = rect?.width ?? window.innerWidth - MAP_LEFT - PAGE_INSET
    const vh = rect?.height ?? window.innerHeight - 2 * PAGE_INSET

    const PAD_FRAC = 0.12
    const zoom = Math.min(
      (vw * (1 - 2 * PAD_FRAC)) / (2 * extX),
      (vh * (1 - 2 * PAD_FRAC)) / (2 * extY),
    )
    const x = vw / 2 - canvasCx * zoom
    const y = vh / 2 - canvasCy * zoom

    console.log(`[drift] viewport: zoom=${zoom.toFixed(4)} x=${x.toFixed(1)} y=${y.toFixed(1)} (map ${Math.round(vw)}×${Math.round(vh)})`)

    rf.setViewport({ x, y, zoom })
    setMinZoom(zoom * 0.8)
    hasFit.current = true
  }, [nodes, rf])

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

        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        minZoom={minZoom}
        maxZoom={3}
        translateExtent={TRANSLATE_EXTENT}
        style={{ background: 'transparent' }}
        proOptions={{ hideAttribution: true }}
      />
      <AxisLayer />
      <SearchBar />
      <ToolBar />
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
