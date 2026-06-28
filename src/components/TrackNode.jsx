import { memo, useRef, useEffect } from 'react'
import { useViewport, useUpdateNodeInternals } from '@xyflow/react'

// Tune these thresholds — spec says we'll adjust after seeing it
export const ZOOM_PILL = 0.55   // circle → pill (earlier so pills appear sooner)
export const ZOOM_CARD = 1.0    // pill → card (0.45 pill band; cards by 1.0 to show more songs)

// Circle on-screen size scales with zoom^CIRCLE_ZOOM_DAMP. A low exponent dampens the
// scaling: circles stay large and barely shrink when zoomed out, while still growing a
// little as you zoom in toward the pill threshold. (1 = scales fully with zoom; 0 = fixed
// on-screen size.)
const CIRCLE_ZOOM_DAMP = 0.3

const EASING = 'cubic-bezier(0.16, 1, 0.3, 1)'
const DUR = '400ms'

// Circle is sized in *screen* pixels (Google Maps pin behavior): we counter-scale the node
// by 1/zoom in the circle tier so its on-screen diameter stays constant regardless of zoom,
// up until the pill morph threshold. 32px base, no border in circle tier.
const CIRCLE_SIZE = 32
const PILL_ART = 30
const CARD_ART = 42
const PILL_W = 175
const CARD_W = 230

const FONT = "'DM Sans', system-ui, -apple-system, sans-serif"

function getTier(zoom) {
  if (zoom >= ZOOM_CARD) return 'card'
  if (zoom >= ZOOM_PILL) return 'pill'
  return 'circle'
}

function t(...props) {
  return props.map((p) => `${p} ${DUR} ${EASING}`).join(', ')
}

function TrackNode({ id, data }) {
  const { albumArtUrl, artist, name, bpm, camelot } = data
  const { zoom } = useViewport()
  const tier = getTier(zoom)
  const isCircle = tier === 'circle'
  const isPill = tier === 'pill'
  const isCard = tier === 'card'

  // Dampened counter-scale: on-screen size = CIRCLE_SIZE * zoom^CIRCLE_ZOOM_DAMP, achieved
  // by scaling the node by zoom^(DAMP-1) against the pane's zoom transform.
  const circleScale = Math.pow(zoom, CIRCLE_ZOOM_DAMP - 1)

  const updateNodeInternals = useUpdateNodeInternals()
  const prevTier = useRef(tier)

  useEffect(() => {
    if (prevTier.current !== tier) {
      prevTier.current = tier
      // notify immediately + after transition completes
      updateNodeInternals(id)
      const timer = setTimeout(() => updateNodeInternals(id), 420)
      return () => clearTimeout(timer)
    }
  }, [tier, id, updateNodeInternals])

  const artSize = isCircle ? CIRCLE_SIZE : isPill ? PILL_ART : CARD_ART

  return (
    <div
      title={isCircle ? `${artist} – ${name}` : undefined}
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        // dimensions — explicit height for circle/pill so text at width:0 can't inflate it
        width: isCircle ? CIRCLE_SIZE : isPill ? PILL_W : CARD_W,
        height: isCard ? undefined : (isCircle ? CIRCLE_SIZE : 50),
        minHeight: isCard ? 62 : undefined,
        // shape
        borderRadius: isCircle ? CIRCLE_SIZE / 2 : isPill ? 25 : 8,
        // surface
        background: isCircle ? 'transparent' : 'rgba(18,18,18,0.90)',
        borderWidth: isCircle ? 0 : 1,
        borderStyle: 'solid',
        borderColor: isCircle ? 'transparent' : 'rgba(255,255,255,0.12)',
        boxShadow: '0 0 20px rgba(255,255,255,0.08), 0 0 40px rgba(255,255,255,0.04)',
        // layout
        gap: isCircle ? 0 : 10,
        padding: isCircle ? 0 : '10px 15px 10px 15px',
        overflow: 'hidden',
        cursor: 'default',
        userSelect: 'none',
        // Counter the pane's zoom scale so the circle holds a fixed on-screen size (map-pin
        // behavior). Kept out of the transition below so it tracks zoom instantly with no
        // rubber-banding; pill/card render at true canvas size and scale with zoom as normal.
        transform: isCircle ? `scale(${circleScale})` : 'none',
        // transitions
        transition: t('width', 'height', 'border-radius', 'background', 'border-color', 'border-width', 'padding', 'gap'),
      }}
    >
      {/* Album art — circular in circle/pill, rounded rect in card */}
      <div
        style={{
          width: artSize,
          height: artSize,
          borderRadius: isCard ? 5 : '50%',
          overflow: 'hidden',
          flexShrink: 0,
          transition: t('width', 'height', 'border-radius'),
        }}
      >
        {albumArtUrl ? (
          <img
            src={albumArtUrl}
            alt={`${name} – ${artist}`}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            draggable={false}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              background: 'rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              color: 'rgba(255,255,255,0.3)',
            }}
          >
            ♪
          </div>
        )}
      </div>

      {/* Name + artist — left text column */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          opacity: isCircle ? 0 : 1,
          transition: t('opacity'),
        }}
      >
        <div
          style={{
            fontFamily: FONT,
            fontSize: 11,
            letterSpacing: '0.02em',
            color: 'rgba(255,255,255,0.9)',
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontFamily: FONT,
            fontSize: 9,
            letterSpacing: '0.03em',
            color: 'rgba(255,255,255,0.4)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {artist}
        </div>
      </div>

      {/* BPM + Camelot — right column, card only, mirrors name/artist size hierarchy */}
      {isCard && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 2,
            flexShrink: 0,
            opacity: isCircle ? 0 : 1,
          }}
        >
          <div
            style={{
              fontFamily: FONT,
              fontSize: 11,
              letterSpacing: '0.02em',
              color: 'rgba(255,255,255,0.9)',
              lineHeight: 1.3,
              whiteSpace: 'nowrap',
            }}
          >
            {bpm != null ? `${Math.round(bpm)} BPM` : '—'}
          </div>
          <div
            style={{
              fontFamily: FONT,
              fontSize: 9,
              letterSpacing: '0.03em',
              color: 'rgba(255,255,255,0.4)',
              whiteSpace: 'nowrap',
            }}
          >
            {camelot ?? '—'}
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(TrackNode)
