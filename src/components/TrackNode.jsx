import { memo, useRef, useState, useCallback, useEffect, useContext, createContext, Fragment } from 'react'
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react'
import ColorThief from 'colorthief'
import { nearestCardinal } from '../lib/setChain'
import { camelotColor } from '../lib/camelot'
import { C, ORPHAN_CORAL, ORPHAN_INACTIVE } from './import/tokens'

// Album-art ambient glow (Slice 11.5): one shared ColorThief extractor + a URL→color cache so each
// unique cover is sampled only once across the whole map (and the color survives node data being
// rebuilt on a preset change, via the cache read in TrackNode). ColorThief's median-cut quantization
// surfaces an actual palette of distinct colors, which is far better than an average at finding the
// accent color on dark EDM artwork. The fallback — accent orange at 30% — covers missing art, any
// extraction failure, and genuinely monochrome covers where no swatch is vivid enough.
// Exported so the Deck View track-info bar can reuse the SAME extraction + per-URL cache for its
// album-art gradient (Slice 12 #4) — the color the ambient glow already derived for this cover.
export const colorThief = new ColorThief()
export const artColorCache = new Map()
export const ART_FALLBACK = 'rgba(242,127,55,0.3)' // #F27F37 @ 30%

// RGB → HSL (h in 0–360, s/l in 0–100). Used to score palette swatches by saturation + lightness.
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l * 100] // achromatic
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [(h / 6) * 360, s * 100, l * 100]
}

// Pick the accent color from a ColorThief palette: keep swatches with lightness in 25–75% (drops the
// near-black background and near-white blowouts), then take the most saturated — that's the vivid
// accent, no boosting needed. Returns { color, scored, best } for the caller (color null ⇒ no swatch
// qualified ⇒ use the orange fallback). `scored` carries per-swatch HSL for the diagnostic logging.
export function pickAccentColor(palette) {
  const scored = (palette || []).map(([r, g, b]) => {
    const [h, s, l] = rgbToHsl(r, g, b)
    return { r, g, b, h, s, l, usable: l >= 25 && l <= 75 }
  })
  const usable = scored.filter((c) => c.usable)
  const best = usable.length ? usable.reduce((a, b) => (b.s > a.s ? b : a)) : null
  return { color: best ? `rgb(${best.r}, ${best.g}, ${best.b})` : null, scored, best }
}

let artDebugCount = 0 // logs the palette + selection for the first 5 songs only

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
// Exported for the stack-overlap detector (Slice 14): the CSS width AND height of a node at each tier,
// which the greedy clusterer scales to on-screen size to test whether two nodes' rendered rectangles
// physically intersect. Heights are the node root's box height per tier (pill 50, card minHeight 62).
export const NODE_PILL_W = PILL_W
export const NODE_CARD_W = CARD_W
export const NODE_PILL_H = 50
export const NODE_CARD_H = 62

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

// Node population bloom (Slice 11.5): `gen` bumps on each population (initial load / playlist switch)
// so nodes flip animation-name and re-bloom; `active` is true only during the bloom window, so nodes
// that mount later (culling remount on pan) appear instantly instead of blooming again.
export const BloomContext = createContext({ gen: 0, active: false })

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
  color: C.textPrimary, lineHeight: 1.3,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
}
const subStyle = {
  fontFamily: FONT, fontSize: 9, letterSpacing: '0.03em',
  color: C.textSecondary,
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

// Music-note placeholder glyph, shown in place of album art when a track has no cover (iTunes AND
// Deezer both missed). #848484 on a #222224 tile — same footprint as the album art it replaces.
function MusicNoteIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
      <path d="M9 17V5l11-2v12" stroke="#848484" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6" cy="17" r="3" fill="#848484" />
      <circle cx="17" cy="15" r="3" fill="#848484" />
    </svg>
  )
}

// Floating hover-preview card (Slice 11.5): rendered by the map in an absolute layer ABOVE the hovered
// circle — NOT a React Flow node, so it never affects layout/culling. Its chrome is IDENTICAL to a
// card-tier TrackNode (same bg / border / album-art glow + inset shadow / dimensions / art size / text)
// so the preview reads as the very same card the node becomes when zoomed in. Fully non-interactive.
// The container styles below MUST stay in sync with the card-tier branch of TrackNode's root style.
export function SongPreviewCard({ data }) {
  const { albumArtUrl, name, artist, bpm, camelot, artColor } = data
  const artColorResolved = artColor ?? (albumArtUrl ? artColorCache.get(albumArtUrl) : null) ?? ART_FALLBACK
  // No crossOrigin here (this card never reads pixels — the glow color comes from the cache), so even
  // non-CORS art displays; a genuinely dead url falls back to the placeholder instead of a broken icon.
  const [artFailed, setArtFailed] = useState(false)
  return (
    <div style={{
      width: CARD_W, minHeight: 62, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10,
      padding: '10px 15px', borderRadius: 8,
      background: 'rgba(18,18,18,0.90)',                       // ← identical to card-tier node
      border: '1px solid rgba(255,255,255,0.12)',             // ← identical to card-tier node border
      boxShadow: `0px 0px 7px 0px ${artColorResolved}, inset 0px 0px 5px 0px #373737`, // ← the node's artGlow
      pointerEvents: 'none',
    }}>
      {albumArtUrl && !artFailed ? (
        <img src={albumArtUrl} alt="" draggable={false} onError={() => setArtFailed(true)}
          style={{ width: CARD_ART, height: CARD_ART, borderRadius: 5, objectFit: 'cover', flexShrink: 0, display: 'block' }} />
      ) : (
        <div style={{ width: CARD_ART, height: CARD_ART, borderRadius: 5, background: '#222224', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <MusicNoteIcon size={Math.round(CARD_ART * 0.5)} />
        </div>
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div style={nameStyle}>{name}</div>
        <div style={subStyle}>{artist}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
        <div style={{ ...nameStyle, overflow: 'visible' }}>{bpm != null ? `${Math.round(bpm)} BPM` : '—'}</div>
        <div style={{ ...subStyle, overflow: 'visible', color: camelot ? camelotColor(camelot) : subStyle.color }}>{camelot ?? '—'}</div>
      </div>
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
  const { albumArtUrl, artist, name, bpm, camelot, highlighted, sockets, isHead, dimmed, isTail, isOrphan, orphanBright, orphanGroupId, glow, artColor, bloomDelay } = data
  const tier = useContext(ZoomTierContext)
  const { buildMode, flowMode, startWireDrag, setHoverGroup, unplugSocket, setArtColor, showPreview, hidePreview } = useContext(BuildContext)
  const { gen: bloomGen, active: bloomActive } = useContext(BloomContext)
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

  // Hover preview (Slice 11.5): on CIRCLE tier only, a 200ms dwell scales THIS node up 2× in place (it
  // stays a circle) — pills and cards already show enough and get no hover. `hovered` drives the
  // 2× scale + z-index; `scaleTrans` carries the directional transition (200ms ease-out up / 150ms
  // ease-in down) and is cleared after the down settles so zoom stays instant otherwise. showPreview
  // floats the detail card + raises this node's z-index and returns false during a wire drag (vetoing
  // the preview); hidePreview dismisses both. One-at-a-time is enforced by the map.
  const [hovered, setHovered] = useState(false)
  const [scaleTrans, setScaleTrans] = useState(null) // 'up' | 'down' | null
  const hoverTimer = useRef(null)
  const scaleTransTimer = useRef(null)
  const previewEligible = isCircle && !!showPreview // circle tier ONLY — pills/cards already show enough
  const onNodeEnter = useCallback((e) => {
    if (isOrphan) onOrphanEnter()
    if (!previewEligible) return
    const el = e.currentTarget // capture the element; re-measure at fire time (position may have panned)
    clearTimeout(hoverTimer.current)
    hoverTimer.current = setTimeout(() => {
      // showPreview floats the detail card + returns false during a wire drag → preview vetoed.
      if (el.isConnected && showPreview(id, data, el.getBoundingClientRect())) {
        clearTimeout(scaleTransTimer.current)
        setScaleTrans('up')
        setHovered(true)
      }
    }, 200)
  }, [isOrphan, onOrphanEnter, previewEligible, showPreview, id, data])
  const onNodeLeave = useCallback(() => {
    if (isOrphan) onOrphanLeave()
    clearTimeout(hoverTimer.current) // cancel a still-pending dwell
    if (hovered) {
      hidePreview?.(id)
      setScaleTrans('down')
      clearTimeout(scaleTransTimer.current)
      scaleTransTimer.current = setTimeout(() => setScaleTrans(null), 160)
    }
    setHovered(false)
  }, [isOrphan, onOrphanLeave, hidePreview, id, hovered])
  useEffect(() => () => { clearTimeout(hoverTimer.current); clearTimeout(scaleTransTimer.current) }, [])

  // A hovered circle/pill node STAYS its own tier (a circle stays a circle) and just scales up 2×; the
  // details live in a SEPARATE floating card the map renders. So the effective render tier == the real
  // tier — no morph. previewActive only drives the 2× scale + z-index below.
  const previewActive = hovered && isCircle
  const effCard = isCard
  const effPill = isPill
  const effCircle = isCircle

  // Album-art color extraction (Slice 11.5): on the cover's load, quantize its palette once and pick
  // the accent color (most-saturated swatch with lightness in 25–75%), then report it up to the map to
  // cache on node data. A URL cache short-circuits repeats (remounts from culling, other songs sharing
  // a cover). No usable swatch (monochrome cover), a CORS-tainted read, or a decode error all fall back
  // to accent orange. The <img> carries crossOrigin="anonymous" so the canvas read isn't tainted; a
  // hard load failure lands in onArtError instead.
  const onArtLoad = useCallback((e) => {
    if (!albumArtUrl) return
    const cached = artColorCache.get(albumArtUrl)
    if (cached) { setArtColor?.(id, cached); return }
    let color = ART_FALLBACK
    try {
      const palette = colorThief.getPalette(e.currentTarget, 5)
      const { color: accent, scored, best } = pickAccentColor(palette)
      if (accent) {
        color = accent
      } else {
        console.log(`[artColor] fallback used: ${name} ${albumArtUrl} ${scored.length ? 'no swatch in L∈[25,75]' : 'empty-palette'}`)
      }

      // —— DIAGNOSTIC: full palette + which swatch was selected and why, for the first 5 songs ————————
      if (artDebugCount < 5) {
        artDebugCount++
        console.log(`[artColor] ${name}: palette(${scored.length}) ${scored.map((c) => `rgb(${c.r},${c.g},${c.b})`).join(' ')}`)
        scored.forEach((c) => console.log(
          `[artColor]   rgb(${c.r},${c.g},${c.b}) H:${c.h.toFixed(0)}° S:${c.s.toFixed(0)}% L:${c.l.toFixed(0)}%` +
          `${c.usable ? '' : ' [filtered: L out of 25–75]'}${best === c ? ' ← SELECTED (max saturation)' : ''}`
        ))
        console.log(`[artColor] ${name}: → ${accent ? `selected ${color}` : `fallback ${color} (no usable swatch)`}`)
      }
      // ————————————————————————————————————————————————————————————————————————————————————————————————
    } catch (err) {
      color = ART_FALLBACK
      console.log(`[artColor] fallback used: ${name} ${albumArtUrl} exception:${err?.message ?? 'unknown'}`)
    }
    artColorCache.set(albumArtUrl, color)
    setArtColor?.(id, color)
  }, [albumArtUrl, id, name, setArtColor])

  // Art load falls back gracefully so a failed image NEVER shows the browser's broken-image glyph:
  //   'cors'  → try with crossOrigin (colorthief can read the pixels for the glow color)
  //   'plain' → CORS was rejected (non-CORS host) → retry the SAME url without crossOrigin so the art
  //             still DISPLAYS; the canvas read then taints → onArtLoad catches it → orange glow.
  //   'failed'→ plain load failed too (dead / 404 url) → show the music-note placeholder instead.
  const [artSrcMode, setArtSrcMode] = useState('cors')
  useEffect(() => { setArtSrcMode('cors') }, [albumArtUrl]) // fresh url → start over
  const onArtError = useCallback(() => {
    setArtSrcMode((m) => (m === 'cors' ? 'plain' : 'failed'))
  }, [])
  // When the art can't be shown at all, register the orange fallback glow for this node.
  useEffect(() => {
    if (artSrcMode === 'failed' && albumArtUrl) {
      if (!artColorCache.has(albumArtUrl)) artColorCache.set(albumArtUrl, ART_FALLBACK)
      setArtColor?.(id, ART_FALLBACK)
    }
  }, [artSrcMode, albumArtUrl, id, setArtColor])

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

  const artSize = effCircle ? CIRCLE_SIZE : effPill ? PILL_ART : CARD_ART
  const artStyle = {
    width: artSize, height: artSize, flexShrink: 0,
    borderRadius: effCard ? 5 : '50%', overflow: 'hidden',
    transition: ART_TRANSITION,
  }

  // Head treatment differs per tier (Decision Log #42). Circle: orange halo + slight size bump.
  // Pill: orange accent border + glow. Card: lighter border + anchor icon.
  const headBorderColor = isHead
    ? (effCard ? 'rgba(255,255,255,0.5)' : ACCENT1)
    : (effCircle ? 'transparent' : 'rgba(255,255,255,0.12)')
  const headGlow = isHead && !effCircle
    ? `0 0 0 1px ${ACCENT1}, 0 0 16px rgba(242,127,55,0.45)`
    : null

  // Orphan treatment (Decision Log #36, Slice 9 r2 #4). At REST: quiet — a muted dark-gray dashed
  // border, NO glow, dim (~45%). On group HOVER: warm coral border + glow lights up the whole group.
  // (The socket dots stay orange regardless — see Socket.) Overrides the head/normal border below.
  const orphanColor = orphanBright ? ORPHAN_CORAL : ORPHAN_INACTIVE
  const orphanGlow = isOrphan && orphanBright
    ? `0 0 0 1px ${ORPHAN_CORAL}, 0 0 18px rgba(255,122,92,0.5)`
    : null

  // Compatibility glow (Slice 11.5): a soft colored halo on a non-chain (`dimmed`) song sized by how
  // well it'd mix as the next song after the tail — green #1EFFB8 (strong) / amber #F7CB29 (mild),
  // matching the wire compatibility colors. Blurred only (no hard `0 0 0 Npx` ring) so it reads as a
  // glow, not a border, and — because it scales with the node's counter-scale — stays visible even on
  // small circle-tier nodes at full zoom-out. The tier also lifts opacity (0.85 / 0.65) above the 0.4
  // dim floor. `glow` is the tier string or undefined; only dimmed songs carry it.
  const compatGlow = !dimmed ? null
    : glow === 'strong' ? '0 0 8px 1px rgba(30,255,184,0.75), 0 0 22px 6px rgba(30,255,184,0.40)'
    : glow === 'mild' ? '0 0 8px 1px rgba(247,203,41,0.70), 0 0 22px 6px rgba(247,203,41,0.35)'
    : null
  const dimOpacity = glow === 'strong' ? 0.85 : glow === 'mild' ? 0.65 : 0.4

  // Album-art ambient glow (Slice 11.5) — the identity signal for songs COMMITTED to the set: a soft
  // 5px halo in the cover's dominant color (fallback orange @30% until sampled, or on failure/missing
  // art), plus the recessed inner shadow. Shows on chain songs — but NOT the head (keeps its orange
  // treatment) and NOT orphans — in build mode, and on EVERY song outside build mode. It never lands
  // on a non-chain song, so it and the compatibility glow (the discovery signal) never overlap.
  const artColorResolved = artColor ?? (albumArtUrl ? artColorCache.get(albumArtUrl) : null) ?? ART_FALLBACK
  const showArtGlow = !buildMode || (!dimmed && !isOrphan && !isHead)
  const artGlow = showArtGlow
    ? `0px 0px 7px 0px ${artColorResolved}, inset 0px 0px 5px 0px #373737`
    : null

  // Counter-scale is driven by the shared --node-scale var; the circle-tier head gets a small size
  // bump, and a hover-preview node gets a 2× boost — all folded into one transform so zoom, head
  // bump and hover compose cleanly.
  const previewScale = previewActive ? 2 : 1
  const headBumpFactor = isHead && effCircle ? HEAD_CIRCLE_BUMP : 1
  const scaleExpr = `scale(calc(var(--node-scale, 1) * ${headBumpFactor} * ${previewScale}))`

  // Transform transition ONLY while a hover-preview is scaling in/out (200ms ease-out up, 150ms
  // ease-in down, then cleared) — so the counter-scale still tracks zoom instantly the rest of the time.
  const transformTrans = scaleTrans === 'up' ? ', transform 200ms ease-out'
    : scaleTrans === 'down' ? ', transform 150ms ease-in'
    : ''

  // Population bloom (Slice 11.5): during the bloom window, run the per-node stagger animation (the
  // parity of `gen` picks the keyframe so a playlist switch restarts it for every node). The delay
  // lives in a CSS var, so re-ranking on a preset reflow updates it WITHOUT re-triggering the anim
  // (only the animation-name string changing does that). 600ms = 400 overshoot + 200 settle; the
  // per-segment easing lives in the keyframes. Outside the window: no animation — late culling
  // remounts on pan appear instantly instead of re-blooming.
  const bloomAnim = bloomActive
    ? `${bloomGen % 2 ? 'driftNodeBloomB' : 'driftNodeBloomA'} 600ms var(--bloom-delay, 0ms) backwards`
    : undefined

  return (
    <div
      title={effCircle ? `${artist} – ${name}` : undefined}
      onPointerMove={grabbable ? onTailPointerMove : undefined}
      onPointerLeave={grabbable ? onTailPointerLeave : undefined}
      onPointerDown={grabbable ? onTailPointerDown : undefined}
      onMouseEnter={onNodeEnter}
      onMouseLeave={onNodeLeave}
      style={{
        position: 'relative',
        '--bloom-delay': `${bloomDelay ?? 0}ms`,
        animation: bloomAnim,
        // Hover-preview node lifts above its neighbours (the map also raises the RF wrapper z-index).
        zIndex: previewActive ? 50 : undefined,
        display: 'flex', flexDirection: 'row', alignItems: 'center',
        // dimensions — explicit height for circle/pill so text at width:0 can't inflate it
        width: effCircle ? CIRCLE_SIZE : effPill ? PILL_W : CARD_W,
        height: effCard ? undefined : (effCircle ? CIRCLE_SIZE : 50),
        minHeight: effCard ? 62 : undefined,
        borderRadius: effCircle ? CIRCLE_SIZE / 2 : effPill ? 25 : 8,
        background: effCircle ? 'transparent' : 'rgba(18,18,18,0.90)',
        // Orphans always carry a dashed coral border (even in the circle tier); everyone else keeps
        // the solid head/normal border, none in the circle tier.
        borderWidth: isOrphan ? 1 : (effCircle ? 0 : 1),
        borderStyle: isOrphan ? 'dashed' : 'solid',
        borderColor: isOrphan ? orphanColor : headBorderColor,
        // Priority (highest first): search highlight → orphan → head → album-art identity glow →
        // compatibility discovery glow → the default ambient. artGlow and compatGlow are mutually
        // exclusive (chain vs non-chain), so their relative order is moot.
        boxShadow: highlighted
          ? '0 0 0 2.5px #F27F37, 0 0 18px rgba(242,127,55,0.45)'
          : orphanGlow || headGlow || artGlow || compatGlow || '0 0 20px rgba(255,255,255,0.08), 0 0 40px rgba(255,255,255,0.04)',
        gap: effCircle ? 0 : 10,
        padding: effCircle ? 0 : '10px 15px',
        cursor: grabbable ? 'grab' : 'default', userSelect: 'none',
        // Build-mode dimming (Slice 9 #6): non-set songs drop to 0.4 so the set reads clearly.
        // Orphans get their own band — ~45% at rest, lifting to ~0.95 when their group is hovered.
        // Flow ON (Slice 10): only the connected chain stays lit; everything else — non-set AND
        // orphans — recedes to near-invisible (~9%), keeping faint spatial context.
        // Compatibility glow (Slice 11.5, Flow OFF only): a dimmed non-chain song lifts above the 0.4
        // floor by how well it'd mix as the next song after the tail — dimOpacity (0.85 strong / 0.65
        // mild / 0.4 otherwise), paired with the colored ring above. Set from `glow` on node data.
        opacity: flowMode
          ? (!isOrphan && !dimmed ? 1 : FLOW_DIM)
          : (isOrphan ? (orphanBright ? 0.95 : 0.45) : (dimmed ? dimOpacity : 1)),
        // Counter the pane's zoom. The factor lives in the --node-scale CSS var, written by the map
        // once per throttled frame, so zooming rescales every node via CSS with no React re-render.
        // Out of the transition (tracks zoom instantly, no rubber-banding); the 400ms morph below
        // animates width/shape only.
        transform: scaleExpr,
        transition: `${ROOT_TRANSITION}${transformTrans}`,
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
      {isHead && effCircle && (
        <div style={{
          position: 'absolute', inset: -6, borderRadius: '50%',
          border: `2px solid ${ACCENT1}`,
          boxShadow: `0 0 14px 2px rgba(242,127,55,0.55)`,
          pointerEvents: 'none', zIndex: 0,
        }} />
      )}

      {/* Album art — the constant anchor across all tiers; its size/shape morph between tiers. On a
          load failure it degrades (crossOrigin → plain → placeholder) rather than showing a broken icon. */}
      {albumArtUrl && artSrcMode !== 'failed' ? (
        <img
          key={artSrcMode}
          src={albumArtUrl}
          alt=""
          draggable={false}
          crossOrigin={artSrcMode === 'cors' ? 'anonymous' : undefined}
          onLoad={onArtLoad}
          onError={onArtError}
          style={{ ...artStyle, objectFit: 'cover', display: 'block', position: 'relative', zIndex: 1 }}
        />
      ) : (
        <div style={{ ...artStyle, position: 'relative', zIndex: 1, background: '#222224', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <MusicNoteIcon size={Math.round(artSize * 0.5)} />
        </div>
      )}

      {/* Pill: title only — minimal DOM (background + image + title), the lighter spread-view node. */}
      {effPill && <div style={{ ...nameStyle, flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>{name}</div>}

      {/* Card (or a hovered circle/pill previewing as one): full detail (name/artist + BPM/Camelot). */}
      {effCard && (
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
