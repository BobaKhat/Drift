import { useState } from 'react'
import {
  C, FONT, INSET, CARD_DROP, PANEL_LIP, RADIUS, SELECTED,
  NEO_BAR_BG, NEO_BAR_SHADOW, NEO_BAR_EDGE, NEO_BAR_HOVER_BG, NEO_BAR_HOVER,
} from './tokens'

// Shared presentational primitives for the import flow — keep the bento aesthetic in one place.

// Floating modal shell over the map: panel surface, soft drop + inner lip (from Figma).
export function ModalCard({ width, children, style }) {
  return (
    <div
      style={{
        position: 'relative',
        width,
        maxWidth: 'calc(100vw - 140px)',
        background: C.panel,
        borderRadius: RADIUS.card,
        padding: 30,
        boxShadow: `${CARD_DROP}, ${PANEL_LIP}`,
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

// Recessed input/textarea well (paste box, playlist-name field).
export const wellStyle = {
  background: C.card,
  border: `1px solid ${C.border}`,
  borderRadius: RADIUS.well,
  boxShadow: INSET,
  color: C.textPrimary,
  fontFamily: FONT,
  fontSize: 14,
  padding: 12,
  outline: 'none',
  resize: 'none',
  width: '100%',
}
