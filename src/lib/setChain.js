// Set-builder chain geometry. A set is one head + a sequential chain wired one-to-one via
// sockets (Decision Log #33). Each song has four cardinal sockets (N/E/S/W). A wire leaves the
// source on the edge facing the target and enters the target on the edge facing the source;
// a song's own incoming and outgoing sockets never share an edge (Decision Log #34).
//
// Nothing here touches the DOM or React Flow — it's pure geometry over {x,y} positions, so the
// map can derive edges + socket dots from the chain + node positions with a single memo.

export const CARDINALS = ['N', 'E', 'S', 'W']

// Screen/flow-space is y-down, so South is +y and North is -y.
export const CARDINAL_VECTOR = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
}

export const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' }

// The cardinal socket on `a` that faces `b` — the dominant axis of the a→b vector. Ties on the
// horizontal (>=) so perfectly diagonal pairs still resolve deterministically.
export function facing(a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'E' : 'W'
  return dy >= 0 ? 'S' : 'N'
}

// Pick the outgoing cardinal for a source node: the edge most aligned with the direction to the
// target (Decision Log #34: in/out never share an edge, so `takenIn` is excluded). We score every
// cardinal by its dot product with the node→target vector and take the best remaining one — so when
// the natural facing edge is already the incoming socket, we fall back to the *next-closest* edge
// (usually a side), never the OPPOSITE edge, which would fire the wire away from the target and loop
// it back around (Slice 9 fix #3). Score = component of (target−node) along each unit cardinal.
function resolveOut(node, target, takenIn) {
  const dx = target.x - node.x
  const dy = target.y - node.y
  const score = { N: -dy, S: dy, E: dx, W: -dx } // dot product with each unit cardinal (N = -y)
  let best = null
  let bestScore = -Infinity
  for (const c of CARDINALS) {
    if (c === takenIn) continue
    if (score[c] > bestScore) { bestScore = score[c]; best = c }
  }
  return best
}

// Derive the render + persistence model for a chain.
//   chain     — ordered array of track ids (index 0 = head)
//   posById   — { [trackId]: {x, y} } flow-space node centers
// Returns:
//   edges          — React Flow edge descriptors (source/target + cardinal handles)
//   socketsByNode  — { [trackId]: { N|E|S|W: 'in' | 'out' } } for the CONNECTED socket dots only.
//                    The tail's open outgoing socket is NOT included here — it's hover-revealed on
//                    the node at the cursor-nearest edge, not shown permanently (Slice 8 socket spec).
//   headId, tailId — chain ends
//
// Every socket pair is optimized geometrically: the outgoing edge faces the target and the incoming
// edge faces the source, based purely on relative node positions (Decision Log #34, Slice 9 #1). The
// wire-drag snap preview may show a different edge mid-drag, but the latched wire always resolves to
// this "sockets face each other" layout so U-shaped arcs never persist.
export function computeChainGraph(chain, posById) {
  const edges = []
  // Track each node's in/out cardinal during the walk, then flatten to a cardinal→role map for
  // rendering. Keeping them separate keeps the collision check (in vs out edge) simple.
  const roles = {} // id -> { in?: cardinal, out?: cardinal }
  const ensure = (id) => (roles[id] ||= {})

  for (let i = 0; i < chain.length - 1; i++) {
    const aId = chain[i]
    const bId = chain[i + 1]
    const a = posById[aId]
    const b = posById[bId]
    if (!a || !b) continue

    const ra = ensure(aId)
    const rb = ensure(bId)

    // a's incoming (if any) was assigned on the previous iteration, so it's safe to read here.
    const outA = resolveOut(a, b, ra.in)
    const inB = facing(b, a)

    ra.out = outA
    rb.in = inB

    edges.push({
      id: `wire-${aId}-${bId}`,
      source: aId,
      target: bId,
      sourceHandle: outA,
      targetHandle: inB,
      type: 'wire',
    })
  }

  const headId = chain[0] ?? null
  const tailId = chain[chain.length - 1] ?? null

  // Flatten to { [trackId]: { N|E|S|W: 'in' | 'out' } } for the connected socket dots. The tail's
  // open outgoing socket is intentionally omitted — the node reveals it on hover.
  const socketsByNode = {}
  for (const [id, r] of Object.entries(roles)) {
    const m = {}
    if (r.in) m[r.in] = 'in'
    if (r.out) m[r.out] = 'out'
    socketsByNode[id] = m
  }
  // Ensure every chain member has an entry (a lone head has no connections yet).
  for (const id of chain) socketsByNode[id] ||= {}

  return { edges, socketsByNode, headId, tailId }
}

// Derive the full build-mode graph: the connected chain plus every orphan group (Decision Log
// #35, #45). Orphan groups keep their internal wires (the cut is non-destructive) but are tagged
// so the map can draw them dashed/coral and dim them. Each group is `{ id, tracks: [ids] }`.
// Returns everything computeChainGraph does for the main chain, plus:
//   orphanIds    — Set of every track id living in an orphan group
//   groupByNode  — { [trackId]: groupId } for the orphan nodes (used for group-hover brightening)
// Orphan edges carry `data: { orphan: true, groupId }` and a group-scoped id so they never collide
// with the main chain's `wire-a-b` ids.
export function computeBuildGraph(chain, orphanGroups = [], posById) {
  const main = computeChainGraph(chain, posById)
  const edges = [...main.edges]
  const socketsByNode = { ...main.socketsByNode }
  const groupByNode = {}
  const orphanIds = new Set()

  for (const grp of orphanGroups) {
    const g = computeChainGraph(grp.tracks, posById)
    for (const e of g.edges) {
      edges.push({ ...e, id: `orphan-${grp.id}-${e.id}`, type: 'wire', data: { orphan: true, groupId: grp.id } })
    }
    for (const [id, m] of Object.entries(g.socketsByNode)) socketsByNode[id] = m
    for (const id of grp.tracks) { groupByNode[id] = grp.id; orphanIds.add(id) }
  }

  return { edges, socketsByNode, headId: main.headId, tailId: main.tailId, orphanIds, groupByNode }
}

// The cardinal nearest a cursor offset (dx, dy from node center), used to place the tail's
// hover-revealed outgoing socket. `exclude` keeps it off the incoming edge (Decision Log #34).
export function nearestCardinal(dx, dy, exclude) {
  const score = { N: -dy, S: dy, E: dx, W: -dx } // dot product with each unit cardinal (N = -y)
  let best = null
  let bestScore = -Infinity
  for (const c of CARDINALS) {
    if (c === exclude) continue
    if (score[c] > bestScore) { bestScore = score[c]; best = c }
  }
  return best
}

// Minutes label for a set header ("7 Songs – 34 min"). Durations are seconds; missing ones
// count as 0 so the total stays stable rather than NaN.
export function formatSetMeta(tracks) {
  const count = tracks.length
  const totalSec = tracks.reduce((sum, t) => sum + (t?.duration || 0), 0)
  const min = Math.round(totalSec / 60)
  return `${count} Song${count === 1 ? '' : 's'} – ${min} min`
}
