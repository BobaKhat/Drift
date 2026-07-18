import { useState } from 'react'
import {
  C, FONT, RADIUS, SELECTED,
  NEO_BAR_BG, NEO_BAR_SHADOW, NEO_BAR_EDGE, NEO_BAR_HOVER_BG, NEO_BAR_HOVER,
  NEO_BTN_RAISED, NEO_SCREEN_BG, NEO_RAIL_SURFACE,
} from './tokens'

// Shared presentational primitives for the import flow — keep the bento aesthetic in one place.

// Floating modal shell over the map. A raised slab off the neomorphic system, in the icon rail's CONTAINER
// colour (NEO_RAIL_SURFACE #0F0F0F — the rail floor, not its raised buttons) so every import pop-up matches
// the rail, with the canonical raised recipe (NEO_BTN_RAISED — outer dark cast + inner bevel) and a 1px
// top-light rim so the edge reads against the map.
export function ModalCard({ width, children, style }) {
  return (
    <div
      style={{
        position: 'relative',
        width,
        maxWidth: 'calc(100vw - 140px)',
        background: NEO_RAIL_SURFACE,
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: RADIUS.card,
        padding: 30,
        boxShadow: NEO_BTN_RAISED,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: FONT,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

const basePill = {
  height: 60,
  borderRadius: RADIUS.pill,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: FONT,
  fontSize: 16,
  fontWeight: 500,
  cursor: 'pointer',
  border: 'none',
  padding: '0 30px',
  whiteSpace: 'nowrap',
  transition: 'opacity 150ms ease, background 150ms ease, box-shadow 150ms ease',
}

// Orange-outlined hero CTA (Explore the demo library / Map my music / Done).
export function PrimaryButton({ children, onClick, disabled, style }) {
  const [hover, setHover] = useState(false)
  const lift = hover && !disabled
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        ...basePill,
        // The Explore By row's ACTIVE state: the selected glass chip. Accent ring + accent label over
        // dark glass — the same treatment the rail, the Flow knob and the search icon carry. Hover lifts
        // the glass (brighter sheen, longer drop); disabled sits it back down, since the 0.4 opacity
        // already says the click won't land.
        background: `${lift ? SELECTED.hoverSheen : SELECTED.sheen}, ${SELECTED.fill}`,
        border: `1px solid ${SELECTED.border}`,
        color: C.accent1,
        boxShadow: `${lift ? SELECTED.hoverDrop : SELECTED.drop}, ${SELECTED.rim}`,
        backdropFilter: SELECTED.blur,
        WebkitBackdropFilter: SELECTED.blur,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  )
}

// Secondary button (Paste your tracklist / Back). Still tracks the Explore By preset rows at rest, which
// are now raised slabs off the neomorphic system — same fill, same outer pair, same rim. The rim rides in
// the element's own box-shadow rather than an overlay div (as the rows use): nothing here overlaps the
// 1px it occupies, so the extra node would buy nothing.
export function SecondaryButton({ children, onClick, disabled, style }) {
  const [hover, setHover] = useState(false)
  const lift = hover && !disabled
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        ...basePill,
        background: lift ? NEO_BAR_HOVER_BG : NEO_BAR_BG,
        color: C.textSecondary,
        boxShadow: `${lift ? NEO_BAR_HOVER : NEO_BAR_SHADOW}, ${NEO_BAR_EDGE}`,
        opacity: disabled ? 0.4 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  )
}

// Recessed input/textarea well (paste box, playlist-name field). The inset side of the toolbar system:
// the NEO_SCREEN_BG floor a step below the slab, an inset shadow (dark top-left cast + a faint
// bottom-right light lip) so the field reads as carved into the modal, and a 1px rim.
export const wellStyle = {
  background: NEO_SCREEN_BG, // #0d0d0f — the inset well floor
  border: '1px solid rgba(255,255,255,0.04)',
  borderRadius: RADIUS.well,
  boxShadow: 'inset 2px 2px 4px 0px rgba(0,0,0,0.8), inset -1px -1px 2px 0px rgba(255,255,255,0.03)',
  color: C.textPrimary,
  fontFamily: FONT,
  fontSize: 14,
  padding: 12,
  outline: 'none',
  resize: 'none',
  width: '100%',
}
