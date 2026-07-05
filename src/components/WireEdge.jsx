import { useContext } from 'react'
import { getBezierPath, useStore, useInternalNode, Position } from '@xyflow/react'
import { getNodeScale, getTier, HEAD_CIRCLE_BUMP, BuildContext } from './TrackNode'
import { ORPHAN_CORAL, ORPHAN_INACTIVE } from './import/tokens'
import { WIRE_COLORS } from '../lib/compatibility'

// Latched chain wire. A smooth bezier that exits the source socket and enters the target socket
// along their cardinal directions — matching the sweeping S-curves in the Figma wire components.
//
// The wire anchors (React Flow handles) all sit at the node CENTER so their measured bounds don't
// drift as nodes counter-scale during zoom. That means the raw endpoints we're handed are node
// centers — so here we push each endpoint OUT to the boundary socket dot, along the edge's
// cardinal, by the node's half-size × its live counter-scale (× the head size-bump). This lands the
// wire exactly on the orange socket dot instead of running through the card/pill body.
//
// Each wire is colored by the compatibility tier of its source→target transition (Decision Log #30):
// green strong / amber mild / red weak. The tier is computed once per chain change in DriftMap and
// handed down through edge `data.tier`; the glow underlay matches it. Green is kept as the default
// only for the rare edge that mounts before its tier is attached.
export const WIRE_STRONG = WIRE_COLORS.strong

// —— Flow mode (Slice 10) ————————————————————————————————————————————————————————
// In Flow ON every chain wire becomes a uniform dark cable and a single bright strobe pulse travels
// head→tail across the whole chain, pausing between sweeps. Each wire runs the same CSS keyframe
// (driftFlowStrobe, injected by DriftMap) — a comet dash sliding along the normalized path — but with
// a staggered animation-delay so the pulse hands off wire→wire in order. All wires share one
// FLOW_CYCLE_S period so they stay in lockstep across loops.
export const DARK_WIRE = '#2A2A2A'
export const FLOW_STROBE_COLOR = '#F27F37'
export const FLOW_SWEEP_S = 3     // total head→tail sweep time (regardless of chain length)
export const FLOW_PAUSE_S = 1     // quiet gap between sweeps — short, so pulses repeat often
export const FLOW_CYCLE_S = FLOW_SWEEP_S + FLOW_PAUSE_S
export const FLOW_STROBE_NAME = 'driftFlowStrobe'
// The pulse is a single soft dash that glides via ONE continuous CSS animation on stroke-dashoffset
// (linear) — no offset-path, no per-frame SVG mask, no JS timers — so it stays perfectly smooth and
// display-synced. Two blurred layers (a wide dim halo + a narrow bright core, same dash so they move
// locked together) feather it into an orange-core → dark-edge glow that blends into the cable. The
// dash has a huge gap (one pulse per wire, never a repeat) and parks fully off the path end during the
// pause; animation-fill-mode:backwards keeps it off the path start during the stagger delay too — so
// no orange is ever left on any wire at rest.
export const FLOW_DASH = '0.2 12'
export const FLOW_OFF_START = 0.35   // dash + blur parked off the path start
export const FLOW_OFF_END = -1.35    // dash + blur parked off the path end (held through the pause)
// Percentage of the full cycle during which a single wire's pulse is mid-travel — the keyframe's
// travel window. Equals one wire's slice (sweep / n) as a fraction of the whole cycle.
export const flowStrobeActivePct = (n) => (100 * (FLOW_SWEEP_S / Math.max(1, n))) / FLOW_CYCLE_S

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

export default function WireEdge({ source, target, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data }) {
  // Subscribe to zoom so the boundary offset tracks the live counter-scale (few chain edges, so the
  // per-frame recompute during zoom is cheap).
  const zoom = useStore((s) => s.transform[2])
  const { onWireClick, flowMode } = useContext(BuildContext)
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

  // Orphan wires (Decision Log #35, #36, Slice 9 r2 #4): dashed and retained between disconnected
  // songs. At REST they're muted dark gray; on group hover (`data.bright`) they light up coral.
  // Non-interactive — orphans are re-wired on the map, not cut from it.
  if (data?.orphan) {
    // Orphans vanish completely in Flow ON — only the presented chain and its wires remain.
    return (
      <path
        d={path} fill="none" stroke={data.bright ? ORPHAN_CORAL : ORPHAN_INACTIVE} strokeWidth={2}
        strokeDasharray="6 6" strokeLinecap="round"
        strokeOpacity={flowMode ? 0 : (data.bright ? 0.95 : 0.85)}
        style={{ transition: 'stroke 180ms ease, stroke-opacity 180ms ease' }}
      />
    )
  }

  // Flow ON: a uniform dark cable with the traveling orange strobe on top. The pulse is a dash sliding
  // along the normalized (pathLength=1) path via one continuous linear stroke-dashoffset animation; its
  // animation-delay staggers it after the upstream wires so it sweeps head→tail (Decision Log #51). The
  // wire stays clickable.
  if (flowMode) {
    const delay = (data?.flowIndex ?? 0) * (FLOW_SWEEP_S / Math.max(1, data?.flowCount ?? 1))
    // Both blurred layers share the exact same dash + keyframe so they glide locked together: the wide
    // dim halo feathers the leading/trailing edges, the narrow bright core is the hot centre.
    const comet = {
      animation: `${FLOW_STROBE_NAME} ${FLOW_CYCLE_S}s linear infinite`,
      animationDelay: `${delay}s`,
      animationFillMode: 'backwards',
    }
    return (
      <>
        <path d={path} fill="none" stroke={DARK_WIRE} strokeWidth={2.5} strokeLinecap="round" />
        <path
          d={path} fill="none" stroke={FLOW_STROBE_COLOR} strokeWidth={9} strokeLinecap="round"
          strokeOpacity={0.4} pathLength={1} strokeDasharray={FLOW_DASH}
          style={{ ...comet, filter: 'blur(6px)' }}
        />
        <path
          d={path} fill="none" stroke={FLOW_STROBE_COLOR} strokeWidth={3.5} strokeLinecap="round"
          pathLength={1} strokeDasharray={FLOW_DASH}
          style={{ ...comet, filter: 'blur(2px)' }}
        />
        <path
          d={path} fill="none" stroke="transparent" strokeWidth={20} strokeLinecap="round"
          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); onWireClick?.(source, target) }}
        />
      </>
    )
  }

  // Connected chain wire. Cutting/rewiring is done by grabbing the socket dots directly (Slice 9 r3
  // #2); the wire's own body is a click target that opens the compatibility card (Decision Log #31).
  // Color = the compatibility tier of this transition (green/amber/red), with a matching glow.
  const color = WIRE_COLORS[data?.tier] ?? WIRE_STRONG
  return (
    <>
      {/* Soft glow underlay — matches the wire's compatibility color. */}
      <path d={path} fill="none" stroke={color} strokeWidth={5} strokeOpacity={0.18} strokeLinecap="round" />
      <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
      {/* Transparent wide hit path: opens the compatibility card. Its own pointerEvents override the
          edge group's, so it stays clickable even though the map isn't elementsSelectable. */}
      <path
        d={path} fill="none" stroke="transparent" strokeWidth={20} strokeLinecap="round"
        style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
        onClick={(e) => { e.stopPropagation(); onWireClick?.(source, target) }}
      />
    </>
  )
}
