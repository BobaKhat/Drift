import { useState } from 'react'
import { C, FONT, RADIUS, SELECTED, NEO_SCREEN_BG, NEO_RAIL_SURFACE, NEO_BTN_PRESS_BG, NEO_BTN_PRESS } from './tokens'

// Shared presentational primitives for the import flow — flat treatment (no neomorphic bevels): solid
// fills, clean 1px borders, and only a plain drop shadow on the modal itself so it lifts off the map.

// Floating modal shell over the map. Flat slab in the icon rail's CONTAINER colour (NEO_RAIL_SURFACE
// #0F0F0F) so every import pop-up matches the rail, with a clean 1px border and a soft, non-directional
// drop shadow (elevation, not extrusion) so the edge reads against the busy map behind it.
export function ModalCard({ width, children, style }) {
  return (
    <div
      style={{
        position: 'relative',
        width,
        maxWidth: 'calc(100vw - 140px)',
        background: NEO_RAIL_SURFACE,
        border: `1px solid ${C.border}`,
        borderRadius: RADIUS.card,
        padding: 30,
        boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
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

// Hero CTA (Explore the demo library / Map my music / Done). States:
//   • DISABLED  — flat dark inactive button (neutral fill, gray text, no accent), reads as "not yet".
//   • SELECTED  — the icon rail's active-button recipe verbatim: sunk-in dark face (NEO_BTN_PRESS_BG), an
//                 inset accent ring + press shadow, white label. A held "you're on this" look, not a lift.
//   • ENABLED   — the flat selected-button look: accent-tinted fill under a 1px accent border with accent
//                 text; hover brightens the fill.
export function PrimaryButton({ children, onClick, disabled, selected, style }) {
  const [hover, setHover] = useState(false)
  const lift = hover && !disabled && !selected
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        ...basePill,
        ...(disabled
          ? { background: C.card, border: `1px solid ${C.border}`, color: C.textSecondary, cursor: 'not-allowed' }
          : selected
            ? { background: NEO_BTN_PRESS_BG, color: C.accent1, boxShadow: `inset 0 0 0 1.5px ${SELECTED.border}, ${NEO_BTN_PRESS}` }
            : { background: lift ? 'rgba(242,127,55,0.20)' : 'rgba(242,127,55,0.12)', border: `1px solid ${C.accent1}`, color: C.accent1 }),
        ...style,
      }}
    >
      {children}
    </button>
  )
}

// Secondary button (Paste your tracklist / Back). Flat: solid card fill under a 1px border, no bevel or
// drop. Hover steps the fill and border a touch lighter.
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
        background: lift ? '#1c1c1e' : C.card,
        border: `1px solid ${lift ? '#333335' : C.border}`,
        color: C.textSecondary,
        opacity: disabled ? 0.4 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  )
}

// Input/textarea field (paste box, playlist-name field). Flat: a slightly darker fill than the modal
// under a 1px border — reads as a field without the carved-in inset shadow.
export const wellStyle = {
  background: NEO_SCREEN_BG, // #0d0d0f — a step darker than the modal so the field reads
  border: `1px solid ${C.border}`,
  borderRadius: RADIUS.well,
  color: C.textPrimary,
  fontFamily: FONT,
  fontSize: 14,
  padding: 12,
  outline: 'none',
  resize: 'none',
  width: '100%',
}
