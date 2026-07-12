import { C, FONT, ACCENT1_FILL, INSET, CARD_DROP, PANEL_LIP, RADIUS } from './tokens'

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
  transition: 'opacity 150ms ease',
}

// Orange-outlined hero CTA (Explore the demo library / Map my music / Done).
export function PrimaryButton({ children, onClick, disabled, style }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...basePill,
        background: ACCENT1_FILL,
        border: `1px solid ${C.accent1}`,
        color: C.accent1,
        boxShadow: '4px 4px 5px 0px #000000',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  )
}

// Secondary button (Paste your tracklist / Back). Styled to match the Explore By preset rows at
// rest (ExploreByPanel): card fill, #848484 label, pill, 16px/500 — all of which already lined up —
// plus the outer drop-shadow those rows carry. Without it the button read as purely recessed (inset
// lip only); the drop-shadow is what makes it sit proud of the panel the way the preset rows do.
export function SecondaryButton({ children, onClick, disabled, style }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...basePill,
        background: C.card,
        color: C.textSecondary,
        boxShadow: PANEL_LIP,
        filter: 'drop-shadow(4px 4px 2.5px black)',
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
