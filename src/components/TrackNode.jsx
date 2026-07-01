import { memo, useRef, useEffect, useContext, createContext } from 'react'
import { useUpdateNodeInternals } from '@xyflow/react'

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

// Tier (circle/pill/card) depends only on zoom, so it is identical for every node. The map computes
// it once and broadcasts it through this context, so a node re-renders only when the tier actually
// changes (a threshold crossing) — never on every zoom frame.
export const ZoomTierContext = createContext('circle')

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
const ROOT_TRANSITION = t('width', 'height', 'border-radius', 'background', 'border-color', 'border-width', 'padding', 'gap')

const nameStyle = {
  fontFamily: FONT, fontSize: 11, letterSpacing: '0.02em',
  color: 'rgba(255,255,255,0.9)', lineHeight: 1.3,
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
}
const subStyle = {
  fontFamily: FONT, fontSize: 9, letterSpacing: '0.03em',
  color: 'rgba(255,255,255,0.4)',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
}

function TrackNode({ id, data }) {
  const { albumArtUrl, artist, name, bpm, camelot, highlighted } = data
  const tier = useContext(ZoomTierContext)
  const isCircle = tier === 'circle'
  const isPill = tier === 'pill'
  const isCard = tier === 'card'

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

  return (
    <div
      title={isCircle ? `${artist} – ${name}` : undefined}
      style={{
        display: 'flex', flexDirection: 'row', alignItems: 'center',
        // dimensions — explicit height for circle/pill so text at width:0 can't inflate it
        width: isCircle ? CIRCLE_SIZE : isPill ? PILL_W : CARD_W,
        height: isCard ? undefined : (isCircle ? CIRCLE_SIZE : 50),
        minHeight: isCard ? 62 : undefined,
        borderRadius: isCircle ? CIRCLE_SIZE / 2 : isPill ? 25 : 8,
        background: isCircle ? 'transparent' : 'rgba(18,18,18,0.90)',
        borderWidth: isCircle ? 0 : 1, borderStyle: 'solid',
        borderColor: isCircle ? 'transparent' : 'rgba(255,255,255,0.12)',
        boxShadow: highlighted
          ? '0 0 0 2.5px #F27F37, 0 0 18px rgba(242,127,55,0.45)'
          : '0 0 20px rgba(255,255,255,0.08), 0 0 40px rgba(255,255,255,0.04)',
        gap: isCircle ? 0 : 10,
        padding: isCircle ? 0 : '10px 15px',
        overflow: 'hidden', cursor: 'default', userSelect: 'none',
        // Counter the pane's zoom. The factor lives in the --node-scale CSS var, written by the map
        // once per throttled frame, so zooming rescales every node via CSS with no React re-render.
        // Out of the transition (tracks zoom instantly, no rubber-banding); the 400ms morph below
        // animates width/shape only.
        transform: 'scale(var(--node-scale, 1))',
        transition: ROOT_TRANSITION,
      }}
    >
      {/* Album art — the constant anchor across all tiers; its size/shape morph between tiers. */}
      {albumArtUrl ? (
        <img
          src={albumArtUrl}
          alt={`${name} – ${artist}`}
          draggable={false}
          style={{ ...artStyle, objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <div style={{ ...artStyle, background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'rgba(255,255,255,0.3)' }}>
          ♪
        </div>
      )}

      {/* Pill: title only — minimal DOM (background + image + title), the lighter spread-view node. */}
      {isPill && <div style={{ ...nameStyle, flex: 1, minWidth: 0 }}>{name}</div>}

      {/* Card: full detail (name/artist + BPM/Camelot). Only a handful are on-screen at this depth. */}
      {isCard && (
        <>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={nameStyle}>{name}</div>
            <div style={subStyle}>{artist}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
            <div style={{ ...nameStyle, overflow: 'visible' }}>{bpm != null ? `${Math.round(bpm)} BPM` : '—'}</div>
            <div style={{ ...subStyle, overflow: 'visible' }}>{camelot ?? '—'}</div>
          </div>
        </>
      )}
    </div>
  )
}

export default memo(TrackNode)
