// —— Stack-overlap detection (Slice 14) ————————————————————————————————————————————————
// At pill tier and above, songs whose covers physically overlap on screen read as a smudge. We do NOT
// hide or move any of them — every song always renders at its true canvas position (that spatial
// placement IS the map). Instead we float a count badge over each cluster: a non-destructive overlay
// that says "N songs here, click to pick one". The overlapping songs stay visible underneath it.
//
// The clustering is pure screen-space greedy grouping (Decision Log: "brute-force pairwise is fine
// for <200 songs"): take the first ungrouped song, sweep up every other ungrouped song whose rendered
// RECTANGLE overlaps the seed's by a meaningful amount, mark them grouped, repeat. Grouping depends
// ONLY on the songs' canvas positions and the zoom (which sets the on-screen node size) — NOT on pan,
// since a pan shifts every centre equally and leaves pairwise offsets unchanged. So the map recomputes
// on zoom + preset switch, never on pan.
//
// Overlap must be SUBSTANTIAL, not a mere touch: the intersecting rectangle has to cover >40% of the
// node on BOTH axes (≡ centre offset < 0.6× the node's size on each axis). That's the point where one
// pill hides nearly half the other and the text is unreadable. Edge-touches and partial slide-overs
// render normally with no badge.
//
// Screen centre = canvasPos × zoom + panOffset, but the pan term cancels in every pairwise offset,
// so we compare canvasPos × zoom directly and skip reading the viewport translation here.

// Compare two members for representative selection: first ALPHABETICALLY by song name (Decision
// Log), id as a stable tiebreaker so the pick never flickers between two same-named songs.
function repLess(a, b) {
  const an = (a.name || '').toLowerCase()
  const bn = (b.name || '').toLowerCase()
  if (an !== bn) return an < bn
  return a.id < b.id
}

// Greedy-cluster the nodes at a given zoom.
//   nodes  — React Flow nodes ({ id, position:{x,y}, data:{ name, ... } }); positions are canvas-space.
//   zoom   — current pane zoom.
//   nodeW  — on-screen node WIDTH (px) at the current tier. Sum of the two half-widths, so two centres
//            closer than this on x overlap horizontally.
//   nodeH  — on-screen node HEIGHT (px) at the current tier (same, for the y axis).
//
// Returns `stacks` — [{ reprId, x, y, count, members }] for clusters of ≥2, where x/y is the
// representative's CANVAS centre (the badge floats above it, but every member still renders in place)
// and members carries each song's display data for the popover. Nothing is hidden.
export function computeStacks(nodes, zoom, nodeW, nodeH) {
  const pts = nodes.map((n) => ({
    id: n.id,
    cx: n.position.x,
    cy: n.position.y,
    sx: n.position.x * zoom,
    sy: n.position.y * zoom,
    name: n.data?.name ?? '',
    data: n.data ?? {},
  }))

  const used = new Set()
  const stacks = []
  const halfW = nodeW / 2
  const halfH = nodeH / 2

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    if (used.has(p.id)) continue
    used.add(p.id)
    const members = [p]
    for (let j = 0; j < pts.length; j++) {
      const q = pts[j]
      if (used.has(q.id)) continue
      // Require MEANINGFUL overlap: the intersecting rectangle must cover >40% of the node on BOTH
      // axes — the point where one pill hides nearly half the other and its text is unreadable. A
      // mere edge-touch or partial slide-over does NOT stack.
      const overlapX = Math.max(0, Math.min(p.sx + halfW, q.sx + halfW) - Math.max(p.sx - halfW, q.sx - halfW))
      const overlapY = Math.max(0, Math.min(p.sy + halfH, q.sy + halfH) - Math.max(p.sy - halfH, q.sy - halfH))
      if (overlapX / nodeW > 0.4 && overlapY / nodeH > 0.4) {
        used.add(q.id)
        members.push(q)
      }
    }
    if (members.length < 2) continue

    let rep = members[0]
    for (const m of members) if (repLess(m, rep)) rep = m

    stacks.push({
      reprId: rep.id,
      x: rep.cx,
      y: rep.cy,
      count: members.length,
      members: members.map((m) => ({
        id: m.id,
        name: m.data.name,
        artist: m.data.artist,
        albumArtUrl: m.data.albumArtUrl,
        bpm: m.data.bpm ?? null,
        camelot: m.data.camelot ?? null,
        artColor: m.data.artColor ?? null,
      })),
    })
  }

  return stacks
}

// A stable signature of a stack set — reprId + sorted member ids per stack — so callers can skip a
// React commit when a zoom step leaves the grouping unchanged (the common case while zooming within
// a tier). Sorted so member order never affects the comparison.
export function stacksSignature(stacks) {
  return stacks
    .map((s) => `${s.reprId}:${s.members.map((m) => m.id).sort().join('.')}`)
    .sort()
    .join('|')
}
