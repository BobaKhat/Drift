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
// In Flow ON every chain wire becomes a uniform dark cable and bright comet pulses glide head→tail along
// it. The pulses move at a CONSTANT physical speed and are launched at a CONSTANT physical spacing, both
// independent of chain length — so adding songs never speeds the pulses up (the old fixed-total-sweep
// scheme did), it just lets a longer chain hold more pulses in flight at once. Each wire runs one
// continuous CSS stroke-dashoffset animation (driftFlowStrobe-i keyframes injected by DriftMap); because
// every wire's dash pattern repeats every FLOW_SPACING and slides one spacing per FLOW_PERIOD_S, the
// pulses read as a single coherent marching wave that hands off seamlessly across wire boundaries.
export const DARK_WIRE = 'rgba(255,255,255,0.12)' // flow-mode cable — matches the axis crosshair (AXIS_COLOR)
export const FLOW_STROBE_COLOR = '#F27F37'
export const FLOW_SPEED = 340        // canvas units / second — the constant pulse pace (song positions are canvas units)
export const FLOW_SPACING = 1500     // canvas units between consecutive pulses; a chain N spacings long shows ~N pulses
export const FLOW_PULSE_LEN = 240    // canvas-unit length of the bright comet dash (the rest of a spacing is the dark gap)
// One dashoffset period slides the dash pattern forward by exactly one FLOW_SPACING. Every wire shares
// this period, which (with the per-wire offsets from DriftMap) keeps all pulses locked into one wave.
export const FLOW_PERIOD_S = FLOW_SPACING / FLOW_SPEED
export const FLOW_STROBE_NAME = 'driftFlowStrobe'
// The pulse is a soft dash gliding via ONE continuous linear stroke-dashoffset animation — no offset-path,
// no per-frame SVG mask, no JS timers — so it stays perfectly smooth and display-synced. Two blurred
// layers (a wide dim halo + a narrow bright core, same dash so they move locked together) feather it into
// an orange-core → dark-edge glow that blends into the cable.

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
  const { onWireClick, flowMode, flowTiming } = useContext(BuildContext)
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
    // This wire's dash pattern + offset keyframe come from DriftMap (flowTiming), keyed by its chain
    // position. The dash repeats every FLOW_SPACING (normalized to this wire's own length) and its
    // driftFlowStrobe-i keyframe slides the offset one spacing per FLOW_PERIOD_S — a constant-speed,
    // evenly-spaced stream. Both blurred layers share it so the halo and hot core glide locked together.
    const i = data?.flowIndex ?? 0
    const t = flowTiming?.[i]
    const comet = t ? { animation: `${FLOW_STROBE_NAME}-${i} ${FLOW_PERIOD_S}s linear infinite` } : undefined
    return (
      <>
        <path d={path} fill="none" stroke={DARK_WIRE} strokeWidth={2.5} strokeLinecap="round" />
        {t && (
          <>
            {/* A soft comet: a wide dim halo + a narrow hot core, both the same sliding dash so they move
                locked together. Round caps + blur feather the dash's leading/trailing ends so each pulse
                fades and blends into the cable on its sides rather than reading as a hard segment. */}
            <path
              d={path} fill="none" stroke={FLOW_STROBE_COLOR} strokeWidth={11} strokeLinecap="round"
              strokeOpacity={0.32} pathLength={1} strokeDasharray={t.dash}
              style={{ ...comet, filter: 'blur(7px)' }}
            />
            <path
              d={path} fill="none" stroke={FLOW_STROBE_COLOR} strokeWidth={3.5} strokeLinecap="round"
              pathLength={1} strokeDasharray={t.dash}
              style={{ ...comet, filter: 'blur(2.5px)' }}
            />
          </>
        )}
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
