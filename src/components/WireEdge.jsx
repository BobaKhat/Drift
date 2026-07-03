import { getBezierPath, useStore, useInternalNode, Position } from '@xyflow/react'
import { getNodeScale, getTier, HEAD_CIRCLE_BUMP } from './TrackNode'

// Latched chain wire. A smooth bezier that exits the source socket and enters the target socket
// along their cardinal directions — matching the sweeping S-curves in the Figma wire components.
//
// The wire anchors (React Flow handles) all sit at the node CENTER so their measured bounds don't
// drift as nodes counter-scale during zoom. That means the raw endpoints we're handed are node
// centers — so here we push each endpoint OUT to the boundary socket dot, along the edge's
// cardinal, by the node's half-size × its live counter-scale (× the head size-bump). This lands the
// wire exactly on the orange socket dot instead of running through the card/pill body.
//
// Slice 8 renders every wire in the "strong" compatibility color (green #1EFFB8) as a placeholder:
// real per-wire compatibility scoring (and the amber/red/dark-flow variants) arrives in Slice 11.
export const WIRE_STRONG = '#1EFFB8'

// Half-size of the node along the socket's axis (width for E/W, height for N/S), scaled the same
// way the node's DOM is: counter-scale × the circle-tier head bump. Returned in flow units, which
// the viewport transform then multiplies by zoom — matching the dot's on-screen offset.
function boundaryOffset(position, node, scale, isHead, tier) {
  const w = node?.measured?.width ?? 32
  const h = node?.measured?.height ?? 32
  const bump = isHead && tier === 'circle' ? HEAD_CIRCLE_BUMP : 1
  const s = scale * bump
  switch (position) {
    case Position.Right:  return { x:  (w / 2) * s, y: 0 }
    case Position.Left:   return { x: -(w / 2) * s, y: 0 }
    case Position.Top:    return { x: 0, y: -(h / 2) * s }
    case Position.Bottom: return { x: 0, y:  (h / 2) * s }
    default:              return { x: 0, y: 0 }
  }
}

export default function WireEdge({ source, target, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }) {
  // Subscribe to zoom so the boundary offset tracks the live counter-scale (few chain edges, so the
  // per-frame recompute during zoom is cheap).
  const zoom = useStore((s) => s.transform[2])
  const scale = getNodeScale(zoom)
  const tier = getTier(zoom)
  const sNode = useInternalNode(source)
  const tNode = useInternalNode(target)

  const so = boundaryOffset(sourcePosition, sNode, scale, sNode?.data?.isHead, tier)
  const to = boundaryOffset(targetPosition, tNode, scale, tNode?.data?.isHead, tier)

  const [path] = getBezierPath({
    sourceX: sourceX + so.x, sourceY: sourceY + so.y, sourcePosition,
    targetX: targetX + to.x, targetY: targetY + to.y, targetPosition,
    curvature: 0.35,
  })

  return (
    <>
      {/* Soft glow underlay */}
      <path d={path} fill="none" stroke={WIRE_STRONG} strokeWidth={5} strokeOpacity={0.18} strokeLinecap="round" />
      <path d={path} fill="none" stroke={WIRE_STRONG} strokeWidth={2} strokeLinecap="round" />
    </>
  )
}
