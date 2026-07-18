import { forwardRef, useImperativeHandle, useRef } from 'react'
import { useReactFlow } from '@xyflow/react'
import { getNodeScale, getTier, HEAD_CIRCLE_BUMP, SOCKET_SIZE } from './TrackNode'
import { CARDINAL_VECTOR, facing, nearestCardinal } from '../lib/setChain'
import { scoreCompatibility, WIRE_COLORS } from '../lib/compatibility'
import { BADGE_FLOAT, BADGE_RADIUS } from './StackBadges'

// The wire-drag interaction (Decision Log #40, #41, #52). The user grabs the tail's outgoing socket
// and drags: a dashed white wire trails the cursor, flashes the REAL compatibility color (green/
// amber/red — computed on the fly against whatever target is under the cursor, Decision Log #40) over
// a valid target, and shows an error ✕ at the wire-end over an occupied one (a song already in the
// chain). Release on a valid target latches the connection; release on empty space cancels.
//
// It's driven imperatively — pointer moves update the overlay's SVG nodes directly (coalesced to
// animation frames) so a fast drag never triggers React re-renders. The parent starts a drag via
// the imperative `start` handle; `onConnect(targetId)` fires on a valid release.
//
// Screen math mirrors the map's AxisLayer: container-relative px = flowCoord * zoom + viewportOffset.

const DASH_WHITE = 'rgba(255,255,255,0.85)'
const ACCENT_ORANGE = '#F27F37'

// Cursor-to-badge distance (screen px) at which a dragged wire targets a stack badge instead of a
// node. A wire released here opens the proximity popover to pick which clustered song to wire to.
const BADGE_HIT = 42

// Cursor-to-socket distance (screen px) at which the wire tip snaps onto a valid target's incoming
// socket. Inside this radius the wire locks to the socket and the target illuminates; outside it,
// the wire follows the cursor freely. This is also what governs UNPLUG feel: when you grab a socket
// the just-detached song sits right under the cursor, so a smaller radius lets the wire pull free
// with a shorter drag — a light "cable unplug" instead of having to yank it far (Slice 11 polish #4).
const SNAP_RADIUS = 28

// Map auto-pan while dragging a wire (Slice 9 #5): when the cursor is within EDGE_ZONE px of a
// viewport edge, the map pans in that direction (speed proportional to how deep into the zone), so
// users can wire to off-screen songs. Standard node-editor behavior.
const EDGE_ZONE = 60
const PAN_MAX_SPEED = 16 // px per frame at the very edge

const clamp01 = (v) => Math.max(-1, Math.min(1, v))

// On-screen offset (px) from a node's center out to its boundary socket along `cardinal`, scaled
// the same way the node's DOM is (counter-scale × circle-tier head bump × zoom). Width feeds the
// E/W sockets, height the N/S sockets.
function socketOffset(cardinal, node, scale, zoom, isHead, tier) {
  const v = CARDINAL_VECTOR[cardinal] || CARDINAL_VECTOR.E
  const horiz = cardinal === 'E' || cardinal === 'W'
  const dim = horiz ? (node.measured?.width ?? 32) : (node.measured?.height ?? 32)
  const bump = isHead && tier === 'circle' ? HEAD_CIRCLE_BUMP : 1
  const r = (dim / 2) * scale * bump * zoom
  return { x: v.x * r, y: v.y * r }
}

// Free drag: exit the source along its cardinal, drift toward the cursor.
function bezierPath(sx, sy, cardinal, ex, ey) {
  const v = CARDINAL_VECTOR[cardinal] || CARDINAL_VECTOR.E
  const dist = Math.hypot(ex - sx, ey - sy)
  const off = Math.max(48, dist * 0.42)
  const c1x = sx + v.x * off
  const c1y = sy + v.y * off
  const c2x = ex - v.x * off * 0.35
  const c2y = ey - v.y * off * 0.35
  return `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`
}

// Snapped: exit the source along outCard and enter the target socket along inCard (inCard points
// target→source, so offsetting the control point outward from the socket curves the wire in). This
// mirrors the latched WireEdge, so the snap preview matches the final wire.
function bezierBoth(sx, sy, outCard, ex, ey, inCard) {
  const v1 = CARDINAL_VECTOR[outCard] || CARDINAL_VECTOR.E
  const v2 = CARDINAL_VECTOR[inCard] || CARDINAL_VECTOR.W
  const dist = Math.hypot(ex - sx, ey - sy)
  const off = Math.max(48, dist * 0.42)
  const c1x = sx + v1.x * off
  const c1y = sy + v1.y * off
  const c2x = ex + v2.x * off
  const c2y = ey + v2.y * off
  return `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`
}

const WireDragLayer = forwardRef(function WireDragLayer({ containerRef, chainSet, onConnect, stacksRef, onReleaseStack }, ref) {
  const rf = useReactFlow()
  const pathRef = useRef(null)
  const originSocketRef = useRef(null)
  const targetSocketRef = useRef(null)
  const errorRef = useRef(null)

  // Live drag bookkeeping — refs (not state) so pointer moves never re-render.
  const drag = useRef(null) // { sourceId, cardinal } | null
  const result = useRef({ mode: 'empty', targetId: null })
  const lastEvent = useRef(null)
  const raf = useRef(0)
  const suppressPan = useRef(false) // true for unplug drags — map stays put, only the wire moves (r4 #3b/#5)

  // The render loop is a stale closure for the whole drag, so read chainSet through a ref that's
  // refreshed every render. This matters for unplug (Slice 9 r3 #2): when a wire is unplugged the
  // downstream songs orphan mid-drag and must immediately become valid snap targets (re-pluggable),
  // not stay "occupied" from the pre-unplug chainSet.
  const chainSetRef = useRef(chainSet)
  chainSetRef.current = chainSet

  const containerRect = () => containerRef.current?.getBoundingClientRect()

  // Flow center → container-relative px.
  const toScreen = (pos, vp) => ({ x: pos.x * vp.zoom + vp.x, y: pos.y * vp.zoom + vp.y })

  // Pan the map when the cursor nears a viewport edge (Slice 9 #5). Returns nothing; mutates the
  // viewport, and the very next render() re-derives the wire against the panned viewport so the
  // dragged endpoint stays glued to the cursor while the canvas slides underneath.
  const autoPan = (rect, e) => {
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    let px = 0, py = 0
    if (x < EDGE_ZONE) px = (EDGE_ZONE - x) / EDGE_ZONE
    else if (x > rect.width - EDGE_ZONE) px = -(EDGE_ZONE - (rect.width - x)) / EDGE_ZONE
    if (y < EDGE_ZONE) py = (EDGE_ZONE - y) / EDGE_ZONE
    else if (y > rect.height - EDGE_ZONE) py = -(EDGE_ZONE - (rect.height - y)) / EDGE_ZONE
    if (px === 0 && py === 0) return
    const vp = rf.getViewport()
    rf.setViewport({ x: vp.x + clamp01(px) * PAN_MAX_SPEED, y: vp.y + clamp01(py) * PAN_MAX_SPEED, zoom: vp.zoom })
  }

  const render = () => {
    const d = drag.current
    const e = lastEvent.current
    const rect = containerRect()
    if (!d || !e || !rect) return

    const vp = rf.getViewport()
    const scale = getNodeScale(vp.zoom)
    const tier = getTier(vp.zoom)
    const sourceNode = rf.getNode(d.sourceId)
    if (!sourceNode) return

    const srcCenter = toScreen(sourceNode.position, vp)
    const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top }

    // Stack badges take priority over node snapping: a wire dropped on a badge opens the proximity
    // popover to pick a member. Badge screen centre = representative canvas centre projected, lifted
    // BADGE_FLOAT px (a constant screen offset, matching the counter-scaled badge in the map).
    const badges = stacksRef?.current
    if (badges && badges.length) {
      let hit = null, best = Infinity
      for (const s of badges) {
        const c = toScreen({ x: s.x, y: s.y }, vp)
        const by = c.y - BADGE_FLOAT
        const d = Math.hypot(cursor.x - c.x, cursor.y - by)
        if (d <= BADGE_HIT && d < best) { best = d; hit = { s, x: c.x, y: by } }
      }
      if (hit) {
        const outCard = facing(srcCenter, { x: hit.x, y: hit.y })
        const srcOff = socketOffset(outCard, sourceNode, scale, vp.zoom, sourceNode.data?.isHead, tier)
        const src = { x: srcCenter.x + srcOff.x, y: srcCenter.y + srcOff.y }
        result.current = { mode: 'stack', targetId: null, stack: hit.s }
        // Stop the wire at the badge's outer edge, not its centre: walk back from the badge centre
        // toward the source by the badge radius so the tip lands on the ring.
        const bdx = src.x - hit.x, bdy = src.y - hit.y
        const bd = Math.hypot(bdx, bdy) || 1
        const edgeX = hit.x + (bdx / bd) * BADGE_RADIUS
        const edgeY = hit.y + (bdy / bd) * BADGE_RADIUS
        const path = pathRef.current
        if (path) {
          path.setAttribute('d', bezierPath(src.x, src.y, outCard, edgeX, edgeY))
          path.setAttribute('stroke', ACCENT_ORANGE)
          path.setAttribute('stroke-dasharray', '6 6')
          path.style.filter = 'drop-shadow(0 0 5px rgba(242,127,55,0.7))'
        }
        const origin = originSocketRef.current
        if (origin) {
          const bump = sourceNode.data?.isHead && tier === 'circle' ? HEAD_CIRCLE_BUMP : 1
          origin.setAttribute('r', (SOCKET_SIZE / 2) * scale * vp.zoom * bump)
          origin.setAttribute('cx', src.x)
          origin.setAttribute('cy', src.y)
        }
        if (targetSocketRef.current) targetSocketRef.current.style.display = 'none'
        if (errorRef.current) errorRef.current.style.display = 'none'
        return
      }
    }

    // Magnetic snap: the wire snaps to the valid (non-chain) song whose BODY the cursor is nearest,
    // once within SNAP_RADIUS of any edge. The incoming socket is then placed on whichever cardinal
    // faces the cursor (relative to the target's center) — mirroring the outgoing hover-reveal — and
    // updates every frame as the cursor moves around the node. Chain songs under the cursor are
    // occupied.
    let snapNode = null
    let snapSocket = null
    let snapInCard = null
    let snapDist = Infinity
    let occupied = false
    for (const n of rf.getNodes()) {
      const w = n.measured?.width
      if (!w) continue
      const h = n.measured?.height ?? w
      const c = toScreen(n.position, vp)
      const hw = (w / 2) * vp.zoom * scale
      const hh = (h / 2) * vp.zoom * scale
      // Distance from the cursor to the node's box (0 when inside).
      const ex = Math.max(Math.abs(cursor.x - c.x) - hw, 0)
      const ey = Math.max(Math.abs(cursor.y - c.y) - hh, 0)
      const edgeDist = Math.hypot(ex, ey)
      if (chainSetRef.current.has(n.id)) {
        if (edgeDist <= 8) occupied = true
        continue
      }
      if (edgeDist <= SNAP_RADIUS && edgeDist < snapDist) {
        snapDist = edgeDist
        snapNode = n
        snapInCard = nearestCardinal(cursor.x - c.x, cursor.y - c.y) // edge facing the cursor
        const off = socketOffset(snapInCard, n, scale, vp.zoom, false, tier)
        snapSocket = { x: c.x + off.x, y: c.y + off.y }
      }
    }
    const snapped = !!snapNode

    const mode = snapped ? 'snapped' : occupied ? 'occupied' : 'empty'
    result.current = { mode, targetId: snapped ? snapNode.id : null, inCardinal: snapInCard }

    // Source outgoing socket: when snapped, aim at the target center so the exit edge matches the
    // final latched wire; otherwise follow the cursor so all four edges stay reachable.
    const aim = snapped ? toScreen(snapNode.position, vp) : cursor
    const outCard = facing(srcCenter, aim)
    const srcOff = socketOffset(outCard, sourceNode, scale, vp.zoom, sourceNode.data?.isHead, tier)
    const src = { x: srcCenter.x + srcOff.x, y: srcCenter.y + srcOff.y }

    // Wire: locked to the socket when snapped, flashing the REAL compatibility color of the
    // source→target transition (Decision Log #40) so the user sees the verdict before releasing;
    // else dashed white to the cursor.
    const path = pathRef.current
    if (path) {
      if (snapped) {
        const { tier } = scoreCompatibility(sourceNode.data, snapNode.data)
        const color = WIRE_COLORS[tier]
        path.setAttribute('d', bezierBoth(src.x, src.y, outCard, snapSocket.x, snapSocket.y, snapInCard))
        path.setAttribute('stroke', color)
        path.setAttribute('stroke-dasharray', 'none')
        path.style.filter = `drop-shadow(0 0 5px ${color})`
      } else {
        path.setAttribute('d', bezierPath(src.x, src.y, outCard, cursor.x, cursor.y))
        path.setAttribute('stroke', DASH_WHITE)
        path.setAttribute('stroke-dasharray', '6 6')
        path.style.filter = 'none'
      }
    }

    // Origin socket dot — the source's OUT socket: FILLED orange at the live source boundary (r4 #2).
    const origin = originSocketRef.current
    if (origin) {
      const bump = sourceNode.data?.isHead && tier === 'circle' ? HEAD_CIRCLE_BUMP : 1
      origin.setAttribute('r', (SOCKET_SIZE / 2) * scale * vp.zoom * bump)
      origin.setAttribute('cx', src.x)
      origin.setAttribute('cy', src.y)
    }

    // Incoming socket on the snapped target: 12px HOLLOW — only shown while snapped (r4 #2).
    const sock = targetSocketRef.current
    if (sock) {
      if (snapped) {
        sock.setAttribute('r', (SOCKET_SIZE / 2) * scale * vp.zoom)
        sock.setAttribute('cx', snapSocket.x)
        sock.setAttribute('cy', snapSocket.y)
        sock.style.display = 'block'
      } else {
        sock.style.display = 'none'
      }
    }

    // Error ✕ over an occupied song when not snapped (Decision Log #41).
    const err = errorRef.current
    if (err) {
      if (mode === 'occupied') {
        err.setAttribute('transform', `translate(${cursor.x}, ${cursor.y})`)
        err.style.display = 'block'
      } else {
        err.style.display = 'none'
      }
    }
  }

  // A single rAF loop runs for the whole drag: it auto-pans the map when the cursor nears an edge
  // and redraws the wire every frame. Running continuously (not just on pointermove) is what lets
  // the map keep panning while the cursor is held stationary at the edge (Slice 9 #5).
  const loop = () => {
    raf.current = requestAnimationFrame(loop)
    const rect = containerRect()
    const e = lastEvent.current
    if (rect && e && !suppressPan.current) autoPan(rect, e)
    render()
  }

  const onMove = (e) => { lastEvent.current = e }

  const finish = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0 }
    drag.current = null
    lastEvent.current = null
    suppressPan.current = false
    containerRef.current?.classList.remove('wiring') // restore the tail's static socket dot
    // Hide overlay.
    if (pathRef.current) pathRef.current.style.display = 'none'
    if (originSocketRef.current) originSocketRef.current.style.display = 'none'
    if (targetSocketRef.current) targetSocketRef.current.style.display = 'none'
    if (errorRef.current) errorRef.current.style.display = 'none'
  }

  const onUp = () => {
    const { mode, targetId, stack } = result.current
    const sourceId = drag.current?.sourceId // the song the wire was dragged FROM
    // Latch on a valid snap. The socket pair is optimized geometrically on release (Slice 9 #1) —
    // the snapped preview edge is intentionally discarded, so we don't forward it.
    if (mode === 'snapped' && targetId) onConnect(targetId)
    // Dropped on a stack badge: hand the cluster + source to the map, which opens the popover (and
    // highlights the members compatible with the source) to pick a member.
    else if (mode === 'stack' && stack) onReleaseStack?.(stack, sourceId)
    finish()
  }

  useImperativeHandle(ref, () => ({
    start(sourceId, cardinal, event, opts = {}) {
      // Keep the pane from panning / the node from registering a click. This preventDefault on the
      // pointerDOWN is what stops ReactFlow's 1:1 pane-pan from hijacking the gesture (r4 #3b).
      event.stopPropagation()
      event.preventDefault()
      suppressPan.current = !!opts.suppressPan
      drag.current = { sourceId, cardinal }
      result.current = { mode: 'empty', targetId: null }
      lastEvent.current = event
      containerRef.current?.classList.add('wiring') // hide the node's static grab socket
      if (pathRef.current) {
        pathRef.current.style.display = 'block'
        pathRef.current.setAttribute('stroke', DASH_WHITE)
        pathRef.current.setAttribute('stroke-dasharray', '6 6')
      }
      if (originSocketRef.current) originSocketRef.current.style.display = 'block'
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      if (!raf.current) raf.current = requestAnimationFrame(loop) // start the pan+draw loop
    },
  }))

  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 6, overflow: 'visible' }}>
      <path ref={pathRef} style={{ display: 'none' }} fill="none" stroke={DASH_WHITE} strokeWidth={2} strokeDasharray="6 6" strokeLinecap="round" />
      {/* Origin = the OUT (source) socket: FILLED orange, black ring + soft glow (Slice 9 r4 #2). */}
      <circle ref={originSocketRef} style={{ display: 'none', filter: 'drop-shadow(0 0 5px rgba(242,127,55,0.8))' }} r={SOCKET_SIZE / 2} fill="#F27F37" stroke="#000000" strokeWidth={2} />
      {/* Target = the IN socket on the snapped song: HOLLOW near-black, thin orange ring. */}
      <circle ref={targetSocketRef} style={{ display: 'none' }} r={SOCKET_SIZE / 2} fill="#060606" stroke="#F27F37" strokeWidth={1} />
      <g ref={errorRef} style={{ display: 'none' }}>
        <circle r={9} fill="#0c0c0c" stroke="#FF2B2B" strokeWidth={1.5} />
        <path d="M -3.5 -3.5 L 3.5 3.5 M 3.5 -3.5 L -3.5 3.5" stroke="#FF2B2B" strokeWidth={1.6} strokeLinecap="round" />
      </g>
    </svg>
  )
})

export default WireDragLayer
