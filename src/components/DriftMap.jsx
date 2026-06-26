import { useMemo } from 'react'
import {
  ReactFlow,
  useNodesState,
  useViewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import TrackNode from './TrackNode'

// Flow-space canvas dimensions
const W = 1000
const H = 800

// 5%–95% padding as per spec
const PAD = { x: [W * 0.05, W * 0.95], y: [H * 0.05, H * 0.95] }

// Map audio feature value (0–100) to flow-space pixel coordinate.
// Mood is inverted: high valence (bright) = top = low Y.
function toFlowPos(energy, mood) {
  const x = (energy / 100) * (PAD.x[1] - PAD.x[0]) + PAD.x[0]
  const y = (1 - mood / 100) * (PAD.y[1] - PAD.y[0]) + PAD.y[0]
  return { x, y }
}

function buildNodes(track) {
  if (!track) return []
  const pos = toFlowPos(track.energy ?? 50, track.mood ?? 50)
  return [
    {
      id: track.id ?? 'track-0',
      type: 'track',
      position: pos,
      origin: [0.5, 0.5], // center node on its coordinate
      data: {
        name: track.name,
        artist: track.artist,
        albumArtUrl: track.album_art_url,
      },
      draggable: false,
      selectable: false,
      connectable: false,
    },
  ]
}

const nodeTypes = { track: TrackNode }

const MONO = '"Space Mono", "B612 Mono", "Courier New", monospace'
const AXIS_COLOR = 'rgba(255,255,255,0.11)'
const LABEL_COLOR = 'rgba(255,255,255,0.28)'

// Renders crosshair axes and quadrant labels, tracking the React Flow viewport.
function AxisLayer() {
  const { x, y, zoom } = useViewport()

  // Flow-space center → screen-space pixel
  const cx = (W / 2) * zoom + x
  const cy = (H / 2) * zoom + y

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'hidden',
      }}
    >
      {/* Horizontal axis line */}
      <div
        style={{
          position: 'absolute',
          top: cy,
          left: 0,
          right: 0,
          height: 1,
          background: AXIS_COLOR,
          transform: 'translateY(-0.5px)',
        }}
      />
      {/* Vertical axis line */}
      <div
        style={{
          position: 'absolute',
          left: cx,
          top: 0,
          bottom: 0,
          width: 1,
          background: AXIS_COLOR,
          transform: 'translateX(-0.5px)',
        }}
      />

      {/* Axis pole labels */}
      <span style={{ position: 'absolute', top: cy - 22, left: 20, fontSize: 9, fontFamily: MONO, letterSpacing: '0.15em', color: LABEL_COLOR }}>CHILL</span>
      <span style={{ position: 'absolute', top: cy - 22, right: 20, fontSize: 9, fontFamily: MONO, letterSpacing: '0.15em', color: LABEL_COLOR }}>INTENSE</span>
      <span style={{ position: 'absolute', top: 14, left: cx + 12, fontSize: 9, fontFamily: MONO, letterSpacing: '0.15em', color: LABEL_COLOR }}>BRIGHT</span>
      <span style={{ position: 'absolute', bottom: 14, left: cx + 12, fontSize: 9, fontFamily: MONO, letterSpacing: '0.15em', color: LABEL_COLOR }}>DARK</span>

      {/* Quadrant labels */}
      <span style={{ position: 'absolute', top: cy - 44, left: 48, fontSize: 9, fontFamily: MONO, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.10)' }}>Chill · Bright</span>
      <span style={{ position: 'absolute', top: cy - 44, right: 48, fontSize: 9, fontFamily: MONO, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.10)', textAlign: 'right' }}>Intense · Bright</span>
      <span style={{ position: 'absolute', bottom: 36, left: 48, fontSize: 9, fontFamily: MONO, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.10)' }}>Chill · Dark</span>
      <span style={{ position: 'absolute', bottom: 36, right: 48, fontSize: 9, fontFamily: MONO, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.10)', textAlign: 'right' }}>Intense · Dark</span>
    </div>
  )
}

export default function DriftMap({ track }) {
  const initialNodes = useMemo(() => buildNodes(track), [track])
  const [nodes, , onNodesChange] = useNodesState(initialNodes)

  // Center flow-space origin on screen
  const defaultViewport = useMemo(() => ({
    x: window.innerWidth / 2 - W / 2,
    y: window.innerHeight / 2 - H / 2,
    zoom: 1,
  }), [])

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#0c0c0c' }}>
      <ReactFlow
        nodes={nodes}
        edges={[]}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        defaultViewport={defaultViewport}
        fitView={false}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll
        zoomOnPinch
        minZoom={0.3}
        maxZoom={3}
        style={{ background: '#0c0c0c' }}
        proOptions={{ hideAttribution: true }}
      >
        <AxisLayer />
      </ReactFlow>
    </div>
  )
}
