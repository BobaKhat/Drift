import { memo, useRef, useState, useCallback, useEffect, useContext, createContext, Fragment } from 'react'
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import { nearestCardinal } from '../lib/setChain'
import { camelotColor } from '../lib/camelot'
import { ORPHAN_CORAL, ORPHAN_INACTIVE } from './import/tokens'

// Tune these thresholds — spec says we'll adjust after seeing it
export const ZOOM_PILL = 0.55   // circle → pill (earlier so pills appear sooner)
export const ZOOM_CARD = 1.5    // pill → card (0.95 pill band; cards only when zoomed deep into a region)

// Counter-scaling against the pane's zoom controls each node's on-screen size.
//
// Circle tier keeps its dampened map-pin scaling: on-screen size = CIRCLE_SIZE * zoom^DAMP,
// produced by scaling the node by zoom^(DAMP-1). A low exponent means circles barely change
// size as you zoom out, growing a little toward the pill threshold.
const CIRCLE_ZOOM_DAMP = 0.3

// Pill + card tiers counter-scale against the pane's zoom past the pill threshold, but with
// DAMPENED GROWTH rather than perfect cancellation. We scale the node by NODE_PIN / zoom^EXP, so
// on-screen width = canvasWidth * zoom * (NODE_PIN / zoom^EXP) = canvasWidth * NODE_PIN * zoom^(1-EXP).
// With EXP just under 1, cards grow slowly while the canvas (spreading at full zoom) outpaces them
// — deeper zoom still separates songs, and cards gain a little readable size. EXP = 1 fully cancels
// zoom (constant footprint); lower EXP = more growth. NODE_PIN sets the size at zoom 1.0 (where
// zoom^anything = 1, the formula's reference point). Both tiers use this SAME scale formula, so the
// pill→card morph (now ZOOM_CARD = 1.5) is a clean width-driven growth with no scale jump wherever
// the threshold sits — only the canvas width animates (PILL_W → CARD_W):
//   pill: PILL_W=175 → ~152px @ z=0.55 → ~177px @ z=1.5, across the 0.55–1.5 pill band
//   card: CARD_W=230 → ~232px @ z=1.5 (card threshold) → ~264px @ MAX_ZOOM 3.5
// Tune NODE_PIN for the size at zoom 1.0; tune NODE_PIN_EXP for how fast cards grow with zoom.
const NODE_PIN = 0.95
const NODE_PIN_EXP = 0.85 // 1 = constant footprint, <1 = dampened growth (canvas still outpaces)

const EASING = 'cubic-bezier(0.16, 1, 0.3, 1)'
const DUR = '400ms'

// Circle is sized in *screen* pixels (Google Maps pin behavior): the counter-scale below holds its
// on-screen diameter ~constant regardless of zoom, up until the pill morph threshold. 32px base.
const CIRCLE_SIZE = 32
const PILL_ART = 30
const CARD_ART = 42
const PILL_W = 175
const CARD_W = 230

const FONT = "'DM Sans', system-ui, -apple-system, sans-serif"
const ACCENT1 = '#F27F37' // set-builder head accent + sockets (Decision Log color styles)

// Circle-tier head size bump (Decision Log #42). Shared with WireEdge/WireDragLayer so the wire's
// boundary offset matches the visually-bumped socket position exactly.
export const HEAD_CIRCLE_BUMP = 1.14

// Flow ON dim level for everything outside the connected chain (Slice 10) — near-invisible but not
// gone, so the map keeps faint spatial context.
const FLOW_DIM = 0 // Flow ON: non-chain songs (dimmed + orphans) are fully hidden — only the chain shows

// Tier (circle/pill/card) depends only on zoom, so it is identical for every node. The map computes
// it once and broadcasts it through this context, so a node re-renders only when the tier actually
// changes (a threshold crossing) — never on every zoom frame.
export const ZoomTierContext = createContext('circle')

// Build-mode context: whether the set builder is active, plus the callback a tail node's outgoing
// socket calls to begin a wire drag. Global (not per-node) so it lives in context, not node data.
export const BuildContext = createContext({ buildMode: false, startWireDrag: null })

export function getTier(zoom) {
  if (zoom >= ZOOM_CARD) return 'card'
  if (zoom >= ZOOM_PILL) return 'pill'
  return 'circle'
}

// Counter-scale factor for a given zoom (see the constants above). The map writes this into the
// `--node-scale` CSS custom property once per (throttled) frame; nodes read it via CSS and rescale
// without any React re-render. Circle uses dampened map-pin scaling; pill + card share the
// dampened-growth curve.
export function getNodeScale(zoom) {
  return zoom >= ZOOM_PILL
    ? NODE_PIN / Math.pow(zoom, NODE_PIN_EXP)
    : Math.pow(zoom, CIRCLE_ZOOM_DAMP - 1)
}

function t(...props) {
  return props.map((p) => `${p} ${DUR} ${EASING}`).join(', ')
}

const ART_TRANSITION = t('width', 'height', 'border-radius')
const ROOT_TRANSITION = t('width', 'height', 'border-radius', 'background', 'border-color', 'border-width', 'padding', 'gap', 'opacity', 'box-shadow')

const nameStyle = {
  fontFamily: FONT, fontSize: 11, fontWeight: 600, letterSpacing: '0.02em',
  color: 'rgba(255,255,255,0.9)', lineHeight: 1.3,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
}
const subStyle = {
  fontFamily: FONT, fontSize: 9, letterSpacing: '0.03em',
  color: 'rgba(255,255,255,0.4)',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
}

// Cardinal → React Flow Position (for edge curve direction) and → boundary placement of the
// visible socket dot. Handles all sit at the node CENTER so edges never drift as the node
// counter-scales (see DriftMap edge notes); the dots ride the boundary and the bezier exits
// through them because the edge carries the cardinal Position.
const HANDLE_POSITION = { N: Position.Top, E: Position.Right, S: Position.Bottom, W: Position.Left }
const SOCKET_PLACEMENT = {
  N: { left: '50%', top: 0, transform: 'translate(-50%, -50%)' },
  S: { left: '50%', bottom: 0, transform: 'translate(-50%, 50%)' },
  E: { right: 0, top: '50%', transform: 'translate(50%, -50%)' },
  W: { left: 0, top: '50%', transform: 'translate(-50%, -50%)' },
}

// A socket dot on a chain song. Both roles render at the SAME 12px size and are told apart only by
// FILL, like a power outlet (Slice 9 r4 #2): OUT (the source, where a wire is dragged FROM) = FILLED
// orange with a black ring — it's "pushing energy out"; IN (the target, where a wire ARRIVES) =
// HOLLOW, near-black fill + 1px orange ring — "empty, waiting to be filled". When `onGrab` is passed
// the socket is a draggable "plug" with a larger invisible hit area. `extraClass` tags the tail's
// hover-revealed outgoing socket.
const SOCKET_NEAR_BLACK = '#060606'
export const SOCKET_SIZE = 12
// Grab target around a draggable socket. Kept small enough that on a 32px circle-tier node the two
// boundary sockets don't swallow the node's center — the center must stay free so the tail can
// still start a NEW wire by pressing its body (Slice 9 r3 #2 conflict fix).
const SOCKET_HIT = 15
function Socket({ cardinal, role, extraClass, onGrab }) {
  const isOut = role === 'out'
  const dot = (
    <div
      className={onGrab ? undefined : extraClass}
      style={{
        width: SOCKET_SIZE, height: SOCKET_SIZE, borderRadius: '50%',
        // OUT (source, drag-from) = FILLED orange; IN (target) = HOLLOW near-black (Slice 9 r4 #2).
        background: isOut ? ACCENT1 : SOCKET_NEAR_BLACK,
        border: isOut ? '2px solid #000000' : `1px solid ${ACCENT1}`,
        boxShadow: isOut ? `0 0 6px rgba(242,127,55,0.7)` : 'none',
        pointerEvents: 'none',
      }}
    />
  )
  if (!onGrab) {
    return (
      <div className={extraClass} style={{ position: 'absolute', width: SOCKET_SIZE, height: SOCKET_SIZE, pointerEvents: 'none', zIndex: 5, ...SOCKET_PLACEMENT[cardinal] }}>
        {dot}
      </div>
    )
  }
  // Draggable plug: transparent hit box centered on the boundary point, dot centered inside.
  return (
    <div
      className={extraClass}
      onPointerDown={onGrab}
      title="Drag to unplug"
      style={{
        position: 'absolute', width: SOCKET_HIT, height: SOCKET_HIT,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'grab', pointerEvents: 'auto', zIndex: 6, touchAction: 'none',
        ...SOCKET_PLACEMENT[cardinal],
      }}
    >
      {dot}
    </div>
  )
}

// Anchor glyph shown on the head song's card (Decision Log #42, card zoom).
function AnchorIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="5" r="2.4" stroke={ACCENT1} strokeWidth="1.6" />
      <path d="M12 7.4V21M12 21c-3.6 0-6.5-2.9-6.5-6.5M12 21c3.6 0 6.5-2.9 6.5-6.5M5 12h3M16 12h3"
        stroke={ACCENT1} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TrackNode({ id, data }) {
  const { albumArtUrl, artist, name, bpm, camelot, highlighted, sockets, isHead, dimmed, isTail, isOrphan, orphanBright, orphanGroupId } = data
  const tier = useContext(ZoomTierContext)
  const { buildMode, flowMode, startWireDrag, setHoverGroup, unplugSocket } = useContext(BuildContext)
  const isCircle = tier === 'circle'
  const isPill = tier === 'pill'
  const isCard = tier === 'card'

  // Tail hover-reveal: the outgoing socket is hidden until the cursor is over the tail song, then it
  // appears on the edge nearest the cursor (kept off the incoming edge). A pointerdown anywhere on
  // the node starts the wire drag from that edge. Only the tail wires this up.
  const [hoverOut, setHoverOut] = useState(null)
  const grabbable = buildMode && isTail
  const inCardinal = sockets ? Object.keys(sockets).find((c) => sockets[c] === 'in') : null

  // Measure off the element the handler is bound to (e.currentTarget = the node root), so the
  // origin is always the node's own center — never a stale ref or an ancestor's box.
  const cardinalFromEvent = useCallback((e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2)
    const dy = e.clientY - (r.top + r.height / 2)
    return nearestCardinal(dx, dy, inCardinal)
  }, [inCardinal])

  const onTailPointerMove = useCallback((e) => {
    const c = cardinalFromEvent(e)
    setHoverOut((prev) => (prev === c ? prev : c))
  }, [cardinalFromEvent])
  const onTailPointerLeave = useCallback(() => setHoverOut(null), [])
  const onTailPointerDown = useCallback((e) => {
    const c = cardinalFromEvent(e)
    if (c) startWireDrag?.(id, c, e)
  }, [cardinalFromEvent, startWireDrag, id])

  // Orphan hover: brighten the whole disconnected group (Decision Log #36/#45) by reporting this
  // node's group id up to the map, which re-tints every node + wire sharing it.
  const onOrphanEnter = useCallback(() => setHoverGroup?.(orphanGroupId), [setHoverGroup, orphanGroupId])
  const onOrphanLeave = useCallback(() => setHoverGroup?.(null), [setHoverGroup])

  // Re-measure ReactFlow's record of this node when the tier (and thus its size/handles) changes.
  // Guarded by prevTier so a culling-driven mount at the current tier doesn't fire it.
  const updateNodeInternals = useUpdateNodeInternals()
  const prevTier = useRef(tier)
  useEffect(() => {
    if (prevTier.current !== tier) {
      prevTier.current = tier
      updateNodeInternals(id)                                   // immediately
      const timer = setTimeout(() => updateNodeInternals(id), 420) // and after the morph settles
      return () => clearTimeout(timer)
    }
  }, [tier, id, updateNodeInternals])

  const artSize = isCircle ? CIRCLE_SIZE : isPill ? PILL_ART : CARD_ART
  const artStyle = {
    width: artSize, height: artSize, flexShrink: 0,
    borderRadius: isCard ? 5 : '50%', overflow: 'hidden',
    transition: ART_TRANSITION,
  }

  // Head treatment differs per tier (Decision Log #42). Circle: orange halo + slight size bump.
  // Pill: orange accent border + glow. Card: lighter border + anchor icon.
  const headBorderColor = isHead
    ? (isCard ? 'rgba(255,255,255,0.5)' : ACCENT1)
    : (isCircle ? 'transparent' : 'rgba(255,255,255,0.12)')
  const headGlow = isHead && !isCircle
    ? `0 0 0 1px ${ACCENT1}, 0 0 16px rgba(242,127,55,0.45)`
    : null

  // Orphan treatment (Decision Log #36, Slice 9 r2 #4). At REST: quiet — a muted dark-gray dashed
  // border, NO glow, dim (~45%). On group HOVER: warm coral border + glow lights up the whole group.
  // (The socket dots stay orange regardless — see Socket.) Overrides the head/normal border below.
  const orphanColor = orphanBright ? ORPHAN_CORAL : ORPHAN_INACTIVE
  const orphanGlow = isOrphan && orphanBright
    ? `0 0 0 1px ${ORPHAN_CORAL}, 0 0 18px rgba(255,122,92,0.5)`
    : null

  // Counter-scale is driven by the shared --node-scale var; the head gets a small circle-tier size
  // bump layered on top of it.
  const scaleExpr = isHead && isCircle
    ? `scale(calc(var(--node-scale, 1) * ${HEAD_CIRCLE_BUMP}))`
    : 'scale(var(--node-scale, 1))'

  return (
    <div
      title={isCircle ? `${artist} – ${name}` : undefined}
      onPointerMove={grabbable ? onTailPointerMove : undefined}
      onPointerLeave={grabbable ? onTailPointerLeave : undefined}
      onPointerDown={grabbable ? onTailPointerDown : undefined}
      onMouseEnter={isOrphan ? onOrphanEnter : undefined}
      onMouseLeave={isOrphan ? onOrphanLeave : undefined}
      style={{
        position: 'relative',
        display: 'flex', flexDirection: 'row', alignItems: 'center',
        // dimensions — explicit height for circle/pill so text at width:0 can't inflate it
        width: isCircle ? CIRCLE_SIZE : isPill ? PILL_W : CARD_W,
        height: isCard ? undefined : (isCircle ? CIRCLE_SIZE : 50),
        minHeight: isCard ? 62 : undefined,
        borderRadius: isCircle ? CIRCLE_SIZE / 2 : isPill ? 25 : 8,
        background: isCircle ? 'transparent' : 'rgba(18,18,18,0.90)',
        // Orphans always carry a dashed coral border (even in the circle tier); everyone else keeps
        // the solid head/normal border, none in the circle tier.
        borderWidth: isOrphan ? 1 : (isCircle ? 0 : 1),
        borderStyle: isOrphan ? 'dashed' : 'solid',
        borderColor: isOrphan ? orphanColor : headBorderColor,
        boxShadow: highlighted
          ? '0 0 0 2.5px #F27F37, 0 0 18px rgba(242,127,55,0.45)'
          : orphanGlow || headGlow || '0 0 20px rgba(255,255,255,0.08), 0 0 40px rgba(255,255,255,0.04)',
        gap: isCircle ? 0 : 10,
        padding: isCircle ? 0 : '10px 15px',
        cursor: grabbable ? 'grab' : 'default', userSelect: 'none',
        // Build-mode dimming (Slice 9 #6): non-set songs drop to 0.4 so the set reads clearly.
        // Orphans get their own band — ~45% at rest, lifting to ~0.95 when their group is hovered.
        // Flow ON (Slice 10): only the connected chain stays lit; everything else — non-set AND
        // orphans — recedes to near-invisible (~9%), keeping faint spatial context.
        opacity: flowMode
          ? (!isOrphan && !dimmed ? 1 : FLOW_DIM)
          : (isOrphan ? (orphanBright ? 0.95 : 0.45) : (dimmed ? 0.4 : 1)),
        // Counter the pane's zoom. The factor lives in the --node-scale CSS var, written by the map
        // once per throttled frame, so zooming rescales every node via CSS with no React re-render.
        // Out of the transition (tracks zoom instantly, no rubber-banding); the 400ms morph below
        // animates width/shape only.
        transform: scaleExpr,
        transition: ROOT_TRANSITION,
      }}
    >
      {/* Edge anchors: source + target handle per cardinal, all pinned to the node CENTER. Keeping
          them centered means their measured bounds don't move as the node counter-scales, so wires
          never drift mid-zoom; the edge still exits in the right direction because it carries the
          cardinal Position. Both types exist so an edge's sourceHandle and targetHandle both
          resolve to the intended cardinal (a source-only handle isn't found as a target). */}
      {/* Fragment (not a wrapper element): the Handles are position:absolute, so as direct children
          they're out of flow and never become flex items — a wrapping <span> would take a flex slot
          and, with the row gap, inject phantom empty space before the album art. */}
      {(['N', 'E', 'S', 'W']).map((c) => (
        <Fragment key={c}>
          <Handle id={c} type="source" position={HANDLE_POSITION[c]} className="wire-anchor" isConnectable={false} />
          <Handle id={c} type="target" position={HANDLE_POSITION[c]} className="wire-anchor" isConnectable={false} />
        </Fragment>
      ))}

      {/* Circle-tier head halo — an orange glowing ring around the pin (Decision Log #42). */}
      {isHead && isCircle && (
        <div style={{
          position: 'absolute', inset: -6, borderRadius: '50%',
          border: `2px solid ${ACCENT1}`,
          boxShadow: `0 0 14px 2px rgba(242,127,55,0.55)`,
          pointerEvents: 'none', zIndex: 0,
        }} />
      )}

      {/* Album art — the constant anchor across all tiers; its size/shape morph between tiers. */}
      {albumArtUrl ? (
        <img
          src={albumArtUrl}
          alt={`${name} – ${artist}`}
          draggable={false}
          style={{ ...artStyle, objectFit: 'cover', display: 'block', position: 'relative', zIndex: 1 }}
        />
      ) : (
        <div style={{ ...artStyle, position: 'relative', zIndex: 1, background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'rgba(255,255,255,0.3)' }}>
          ♪
        </div>
      )}

      {/* Pill: title only — minimal DOM (background + image + title), the lighter spread-view node. */}
      {isPill && <div style={{ ...nameStyle, flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>{name}</div>}

      {/* Card: full detail (name/artist + BPM/Camelot). Only a handful are on-screen at this depth. */}
      {isCard && (
        <>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              {isHead && <AnchorIcon />}
              <div style={nameStyle}>{name}</div>
            </div>
            <div style={subStyle}>{artist}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0, position: 'relative', zIndex: 1 }}>
            <div style={{ ...nameStyle, overflow: 'visible' }}>{bpm != null ? `${Math.round(bpm)} BPM` : '—'}</div>
            {/* Camelot key colored via the Camelot hue system (matches the panel rows). */}
            <div style={{ ...subStyle, overflow: 'visible', color: camelot ? camelotColor(camelot) : subStyle.color }}>{camelot ?? '—'}</div>
          </div>
        </>
      )}

      {/* Connected socket dots — permanent on chain songs (IN faces the previous song, OUT the next).
          Each is a draggable "plug": grabbing it unplugs that wire (Slice 9 r3 #2/#5). */}
      {buildMode && sockets && Object.entries(sockets).map(([cardinal, role]) => (
        <Socket
          key={cardinal}
          cardinal={cardinal}
          role={role}
          onGrab={unplugSocket ? (e) => { e.stopPropagation(); unplugSocket(id, role, e) } : undefined}
        />
      ))}

      {/* Tail's open outgoing socket — hover-revealed on the edge nearest the cursor. Tagged
          'wire-grab' so the drag overlay can hide it while a wire is in flight. */}
      {grabbable && hoverOut && (
        <Socket cardinal={hoverOut} role="out" extraClass="wire-grab" />
      )}
    </div>
  )
}

export default memo(TrackNode)
