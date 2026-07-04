import { usePlaylistStore } from '../store/usePlaylistStore'
import { SetCreationIcon } from './LeftNav'
import { C, FONT, INSET, ACCENT1_FILL } from './import/tokens'

// The Flow toggle (Decision Log #48–52, Figma OFF 913-2 / ON 748-2563). Functional as of Slice 10: it
// flips the map between the build view (Flow OFF) and the present view (Flow ON — only the chain lit,
// uniform dark wires with a traveling strobe). It appears in the toolbar area once the chain has a
// head, and slides a knob inside a recessed track between the two states.
//
// The knob is a true CSS circle (equal width/height, border-radius 50%) so it can never render as an
// oval. It slides RIGHT (Off) → LEFT (Flow); labels stay gray, and the state color lives in the knob:
//   OFF: dark knob, gray glyph, sits recessed in the track.
//   ON : translucent dark fill + a 1.5px orange accent ring + orange glyph + orange glow (Figma
//        748-2563 "selected" treatment).

const W = 140
const H = 70
const KNOB = 52
const GLYPH = 26
const TRACK_INSET = 8
const KNOB_TOP = (H - KNOB) / 2 // 9 — vertically centered
const KNOB_LEFT_ON = TRACK_INSET + 1                 // 9  — left, near the track's left edge
const KNOB_LEFT_OFF = W - TRACK_INSET - 1 - KNOB     // 79 — right, near the track's right edge

export default function FlowToggle() {
  const { buildMode, chain, flowMode, toggleFlowMode } = usePlaylistStore()

  // Only in build mode, once a head exists (Decision Log edge case: no Flow without a chain head).
  if (!buildMode || chain.length < 1) return null

  const on = flowMode
  return (
    <div
      onClick={toggleFlowMode}
      role="switch"
      aria-checked={on}
      title={on ? 'Flow on' : 'Flow off'}
      style={{
        position: 'relative', width: W, height: H, flexShrink: 0, overflow: 'hidden',
        borderRadius: 100, background: C.card,
        boxShadow: '4px 4px 5px 0px #000000, inset 1px 1.5px 3px 0px #373737',
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      {/* Recessed track/well the knob rides in. */}
      <div style={{
        position: 'absolute', inset: TRACK_INSET, borderRadius: 100,
        background: C.card, boxShadow: INSET,
      }} />

      {/* Label — gray in both states, opposite the knob ("Off" left / "Flow" right). */}
      <span style={{
        position: 'absolute', top: '50%', transform: 'translateY(-50%)',
        ...(on ? { right: 26 } : { left: 26 }),
        fontFamily: FONT, fontSize: 14, fontWeight: 600, color: C.textSecondary,
      }}>
        {on ? 'Flow' : 'Off'}
      </span>

      {/* Knob — a perfect CSS circle sliding right (Off) ↔ left (Flow). ON carries the orange ring +
          glow; both keep a 1.5px border (transparent when off) via border-box so the size never jumps. */}
      <div style={{
        position: 'absolute', top: KNOB_TOP, left: on ? KNOB_LEFT_ON : KNOB_LEFT_OFF,
        width: KNOB, height: KNOB, borderRadius: '50%', boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: on ? ACCENT1_FILL : C.card,
        border: `1.5px solid ${on ? C.accent1 : 'transparent'}`,
        boxShadow: on
          ? `0 0 12px 1px rgba(242,127,55,0.55), 4px 4px 5px 0px rgba(0,0,0,0.45)`
          : `2px 2px 5px 0px rgba(0,0,0,0.6), inset 0 1px 1px rgba(255,255,255,0.04)`,
        transition: 'left 260ms cubic-bezier(0.4,0,0.2,1), background 200ms ease, border-color 200ms ease, box-shadow 200ms ease',
      }}>
        <span style={{ width: GLYPH, height: GLYPH, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <SetCreationIcon color={on ? C.accent1 : C.iconPrimary} />
        </span>
      </div>
    </div>
  )
}
