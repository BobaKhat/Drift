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

const MONO = '"Space Mono", "B612 Mono", "Courier New", monospace'
const AXIS_COLOR = 'rgba(255,255,255,0.15)'
const LABEL_COLOR = 'rgba(255,255,255,0.28)'

// AxisLayer writes positions directly to the DOM via refs — no React re-renders
// on zoom/pan. useOnViewportChange fires in the same frame as the d3-zoom event,
// while useViewport() would route through React's batch cycle (one frame late).
function AxisLayer() {
  const rf = useReactFlow()
  const hLineRef = useRef(null)
  const vLineRef = useRef(null)
  const darkRef = useRef(null)
  const brightRef = useRef(null)
  const intenseRef = useRef(null)
  const chillRef = useRef(null)
  const qiDarkRef = useRef(null)
  const qiBrightRef = useRef(null)

  const applyViewport = useCallback(({ x, y, zoom }) => {
    const cx = (W / 2) * zoom + x
    const cy = (H / 2) * zoom + y
    if (hLineRef.current)    hLineRef.current.style.top      = `${cy}px`
    if (vLineRef.current)    vLineRef.current.style.left     = `${cx}px`
    if (darkRef.current)     darkRef.current.style.top       = `${cy - 22}px`
    if (brightRef.current)   brightRef.current.style.top     = `${cy - 22}px`
    if (intenseRef.current)  intenseRef.current.style.left   = `${cx + 12}px`
    if (chillRef.current)    chillRef.current.style.left     = `${cx + 12}px`
    if (qiDarkRef.current)   qiDarkRef.current.style.top     = `${cy - 44}px`
    if (qiBrightRef.current) qiBrightRef.current.style.top   = `${cy - 44}px`
  }, [])

  // Set correct positions before first paint so there's no flash at (0,0)
  useLayoutEffect(() => { applyViewport(rf.getViewport()) }, [applyViewport, rf])

  // Track all subsequent viewport changes imperatively
  useOnViewportChange({ onChange: applyViewport })

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <div ref={hLineRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: AXIS_COLOR, transform: 'translateY(-0.5px)' }} />
      <div ref={vLineRef} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 1, background: AXIS_COLOR, transform: 'translateX(-0.5px)' }} />

      <span ref={darkRef}    style={{ position: 'absolute', top: 0, left: 20,  fontSize: 9, fontFamily: MONO, letterSpacing: '0.15em', color: LABEL_COLOR }}>DARK</span>
      <span ref={brightRef}  style={{ position: 'absolute', top: 0, right: 20, fontSize: 9, fontFamily: MONO, letterSpacing: '0.15em', color: LABEL_COLOR }}>BRIGHT</span>
      <span ref={intenseRef} style={{ position: 'absolute', top: 14,    left: 0, fontSize: 9, fontFamily: MONO, letterSpacing: '0.15em', color: LABEL_COLOR }}>INTENSE</span>
      <span ref={chillRef}   style={{ position: 'absolute', bottom: 14, left: 0, fontSize: 9, fontFamily: MONO, letterSpacing: '0.15em', color: LABEL_COLOR }}>CHILL</span>

      <span ref={qiDarkRef}   style={{ position: 'absolute', top: 0, left: 48,  fontSize: 9, fontFamily: MONO, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.10)' }}>Intense · Dark</span>
      <span ref={qiBrightRef} style={{ position: 'absolute', top: 0, right: 48, fontSize: 9, fontFamily: MONO, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.10)', textAlign: 'right' }}>Intense · Bright</span>
      <span style={{ position: 'absolute', bottom: 36, left: 48,  fontSize: 9, fontFamily: MONO, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.10)' }}>Chill · Dark</span>
      <span style={{ position: 'absolute', bottom: 36, right: 48, fontSize: 9, fontFamily: MONO, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.10)', textAlign: 'right' }}>Chill · Bright</span>
    </div>
  )
}


// 1500px overflow on each side of the 3000×3000 canvas — songs at the edges
// can be centered without hitting a hard wall
const TRANSLATE_EXTENT = [[-1500, -1500], [W + 1500, H + 1500]]

function DriftMapInner({ tracks }) {
  const initialNodes = useMemo(() => buildNodes(tracks), [tracks])
  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [minZoom, setMinZoom] = useState(0.01)
  const rf = useReactFlow()
  const hasFit = useRef(false)
  const wrapperRef = useRef(null)
  const zoomTimer = useRef(null)

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

    const PAD_FRAC = 0.12
    const vw = window.innerWidth, vh = window.innerHeight
    const zoom = Math.min(
      (vw * (1 - 2 * PAD_FRAC)) / (2 * extX),
      (vh * (1 - 2 * PAD_FRAC)) / (2 * extY),
    )
    const x = vw / 2 - canvasCx * zoom
    const y = vh / 2 - canvasCy * zoom

    console.log(`[drift] songs x=[${minX.toFixed(0)}, ${maxX.toFixed(0)}] y=[${minY.toFixed(0)}, ${maxY.toFixed(0)}]`)
    console.log(`[drift] viewport: zoom=${zoom.toFixed(4)} x=${x.toFixed(1)} y=${y.toFixed(1)}`)
    songNodes.forEach((n) => {
      const sx = n.position.x * zoom + x
      const sy = n.position.y * zoom + y
      const visible = sx >= 0 && sx <= vw && sy >= 0 && sy <= vh
      console.log(`  "${n.data.name}": flow=(${n.position.x.toFixed(0)},${n.position.y.toFixed(0)}) screen=(${sx.toFixed(0)},${sy.toFixed(0)}) — ${visible ? '✓' : '✗ OFF-SCREEN'}`)
    })

    rf.setViewport({ x, y, zoom })
    setMinZoom(zoom * 0.8)
    hasFit.current = true
  }, [nodes, rf])

  return (
    <div
      ref={wrapperRef}
      className="drift-canvas"
      onWheel={handleWheel}
      style={{ width: '100vw', height: '100vh', background: '#0c0c0c', position: 'relative' }}
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
        style={{ background: '#0c0c0c' }}
        proOptions={{ hideAttribution: true }}
      />
      <AxisLayer />
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
