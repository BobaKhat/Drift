import { useMemo, useState, useRef, useEffect } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { generateJourneyNarrative } from '../lib/journey'
import { NEO_BAR_BG, NEO_BAR_SHADOW, NEO_BAR_EDGE } from './import/tokens'

// Journey — a small HUD readout in the bottom-right of the map that opens a deterministic text summary
// of the connected set's energy arc (2–4 sentences). It only appears in set-builder mode once the
// connected chain has 2+ tracks that carry both energy AND mood; generateJourneyNarrative returns null
// otherwise and this renders nothing (Decision Log data source: skip null-feature tracks, hide below 2).
//
// This is the UI shell only — all the arc math lives in src/lib/journey.js so it stays testable. The
// component recomputes the summary whenever the chain (order/membership) or track features change; it's
// local math over data already in memory, so it's instant and re-runs freely.
//
// Interaction mirrors the stack-badge popover (Decision Log #19): click the pill to open, click outside
// to dismiss. The single accent + mono-style caps label + corner brackets carry the instrument identity.

const FONT = "'DM Sans', system-ui, -apple-system, sans-serif"
const ACCENT1 = '#F27F37'
const TEXT_SECONDARY = '#848484'
const EDGE = 16 // matches the map's HUD corner inset (brackets, coord readout)

// Surface material — the same raised neomorphic slab the top-right toolbar pill wears (NEO_BAR_BG face +
// the outer light/dark pair + the NEO_BAR_EDGE inner bevel), so the Journey pill and its popover read as
// the same instrument family as the toolbar. Composed into one boxShadow since these are flat divs (the
// toolbar layers the bevel as a separate overlay).
const HUD_SURFACE = {
  background: NEO_BAR_BG,
  boxShadow: `${NEO_BAR_SHADOW}, ${NEO_BAR_EDGE}`,
}

// Small L-bracket at one corner of the popover — the HUD's corner-bracket motif (#71). `corner` is one
// of tl/tr/bl/br. Drawn as one box carrying only its two corner-facing borders, with the joining corner
// rounded so the arms meet in a soft curve rather than a hard right angle.
function CornerBracket({ corner }) {
  const len = 9
  const inset = 6
  const radius = 4
  const isTop = corner[0] === 't'
  const isLeft = corner[1] === 'l'
  return (
    <div
      style={{
        position: 'absolute', width: len, height: len,
        [isTop ? 'top' : 'bottom']: inset,
        [isLeft ? 'left' : 'right']: inset,
        borderStyle: 'solid', borderColor: 'rgba(242,127,55,0.55)', borderWidth: 0,
        borderTopWidth: isTop ? 1 : 0,
        borderBottomWidth: isTop ? 0 : 1,
        borderLeftWidth: isLeft ? 1 : 0,
        borderRightWidth: isLeft ? 0 : 1,
        borderRadius: 0,
        [`border${isTop ? 'Top' : 'Bottom'}${isLeft ? 'Left' : 'Right'}Radius`]: radius,
      }}
    />
  )
}

// Affordance chevron on the trigger pill — same glyph as the zone chip's dropdown caret. The popover
// opens ABOVE the pill, so it points UP at rest (there's more above) and flips DOWN when open (collapse),
// and the glyph lights accent while open. It carries the toolbar chevron's hover microinteraction: the
// bounce lives on a wrapper motion.div (variants driven by the pill's whileHover — see below) so the
// open/close rotate can stay an independent CSS transform on the svg without the two transforms fighting.
// The nudge is a couple px UPWARD, toward the drawer this one drops (the toolbar's drops down, so it
// nudges down; this one rises, so it nudges up).
const CHEV_BOUNCE = { rest: { y: 0 }, hover: { y: [0, -2, 0], transition: { duration: 0.3, ease: 'easeOut' } } }

function ChevronIcon({ open }) {
  return (
    <motion.div style={{ display: 'flex', flexShrink: 0 }} variants={CHEV_BOUNCE}>
      <svg
        width="9" height="5" viewBox="0 0 9 5" fill="none"
        style={{ transition: 'transform 200ms ease', transform: open ? 'rotate(0deg)' : 'rotate(180deg)' }}
      >
        <path d="M1 1L4.5 4.5L8 1" stroke={open ? ACCENT1 : '#9a9a9a'} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </motion.div>
  )
}

// The compressed one-line arc rendered as spaced-out mono caps, e.g. "CHILL → INTENSE → CHILL".
function ArcLine({ text, style }) {
  return (
    <span
      style={{
        fontFamily: FONT, fontSize: 11, fontWeight: 500, letterSpacing: '0.1em',
        textTransform: 'uppercase', color: TEXT_SECONDARY, whiteSpace: 'nowrap', ...style,
      }}
    >
      {text}
    </span>
  )
}

export default function JourneyTrigger({ tracks, hidden = false }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  // Gate the hover bounce on reduced-motion, exactly as the toolbar chevron does.
  const reduce = useReducedMotion()

  // Recompute on any change to the chain's membership/order or the tracks' features. `tracks` is the
  // ordered connected chain; identity changes when the map rebuilds it, which is exactly the recompute
  // trigger the spec asks for (add / remove / reorder / unlink / rewire).
  const journey = useMemo(() => generateJourneyNarrative(tracks), [tracks])

  // Close the popover if the chain shrinks below the threshold or the trigger otherwise disappears.
  useEffect(() => { if (!journey) setOpen(false) }, [journey])

  // Dismiss on click outside — same intent as the stack popover / zone chip (Decision Log #19). Listen
  // in the CAPTURE phase: React Flow's pane calls stopPropagation on mousedown to drive panning, which
  // would swallow a bubble-phase document listener, so a click on the map canvas would never close us.
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler, true)
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', handler, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!journey || hidden) return null

  return (
    <div
      ref={rootRef}
      style={{
        position: 'absolute', right: EDGE, bottom: EDGE + 26, zIndex: 4,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10,
        pointerEvents: 'none', // children re-enable; keeps the empty column from eating pans
      }}
    >
      {/* Popover — opens ABOVE the pill (the pill sits at the card's bottom edge). Near-black HUD
          material, dark and instrument-like, NOT the bento panel. Text is 13.5px secondary, 2–4
          sentences. Corner brackets echo the map's HUD framing. */}
      {open && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'relative', width: 300, boxSizing: 'border-box',
            padding: '16px 18px', borderRadius: 12,
            ...HUD_SURFACE,
            pointerEvents: 'auto',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}
        >
          <CornerBracket corner="tl" />
          <CornerBracket corner="tr" />
          <CornerBracket corner="bl" />
          <CornerBracket corner="br" />

          {/* Header: accent dot + label + the compressed arc as a mono readout. The arc can be longer
              than the fixed-width popover, so it shrinks and ellipsizes here rather than clipping mid-
              glyph — the full arc always stays legible on the trigger pill below. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT1, flexShrink: 0 }} />
            <span style={{
              fontFamily: FONT, fontSize: 11, fontWeight: 600, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: '#fff', flexShrink: 0,
            }}>
              Journey
            </span>
            <ArcLine text={journey.compressed} style={{ marginLeft: 'auto', minWidth: 0, flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis' }} />
          </div>

          {/* Divider — a faint hairline, matching the map HUD's quiet rules. */}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', width: '100%' }} />

          {/* The narrative. */}
          <p style={{
            margin: 0, fontFamily: FONT, fontSize: 13.5, lineHeight: 1.5,
            color: TEXT_SECONDARY, letterSpacing: '0.005em',
          }}>
            {journey.summary}
          </p>
        </div>
      )}

      {/* Trigger pill — accent dot + JOURNEY caps, with the compressed arc appended when it fits. A
          motion.div so hovering the pill drives the chevron's bounce variant (same as the toolbar). */}
      <motion.div
        initial="rest" animate="rest" whileHover={reduce ? undefined : 'hover'}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        role="button"
        aria-expanded={open}
        title="Journey — the energy arc of your set"
        style={{
          pointerEvents: 'auto', cursor: 'pointer', userSelect: 'none',
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '7px 14px', borderRadius: 100,
          ...HUD_SURFACE,
          // A faint accent outer glow when the popover is open, so the pill reads "active" — layered on
          // top of the toolbar-slab shadow the pill wears at rest.
          boxShadow: open
            ? `${HUD_SURFACE.boxShadow}, 0 0 10px 0 rgba(242,127,55,0.35)`
            : HUD_SURFACE.boxShadow,
          transition: 'box-shadow 140ms ease',
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: ACCENT1, flexShrink: 0 }} />
        <span style={{
          fontFamily: FONT, fontSize: 11, fontWeight: 600, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: '#fff',
        }}>
          Journey
        </span>
        <ArcLine text={journey.compressed} />
        <ChevronIcon open={open} />
      </motion.div>
    </div>
  )
}
