import { usePlaylistStore } from '../store/usePlaylistStore'
import { SetCreationIcon } from './LeftNav'
import { C, FONT, INSET } from './import/tokens'

// The Flow toggle (Decision Log #48–52, Figma OFF 748-2568 / ON 748-2563). Functional as of Slice 10:
// it flips the map between the build view (Flow OFF) and the present view (Flow ON — only the chain
// lit, uniform dark wires with a traveling strobe). It appears in the toolbar area once the chain has
// a head, and slides a round knob (the linked-nodes glyph, shared with the Set Builder rail icon)
// between the two states.
//   OFF: recessed gray knob on the LEFT, "Off" in Text/Secondary on the right.
//   ON : orange knob on the RIGHT with an accent ring, "Flow" in accent on the left.

const W = 140
const H = 70
const KNOB = 60
const GLYPH = 26
const PAD = 5
const KNOB_ON_LEFT = W - KNOB - PAD // 75

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
        position: 'relative', width: W, height: H, flexShrink: 0,
        borderRadius: 100, background: C.card,
        boxShadow: '4px 4px 2.5px 0px rgba(0,0,0,1), inset 1px 1.5px 3px 0px #373737',
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      {/* Label — swaps side + text with the state. */}
      <span style={{
        position: 'absolute', top: '50%', transform: 'translateY(-50%)',
        ...(on ? { left: 22 } : { right: 22 }),
        fontFamily: FONT, fontSize: 14, fontWeight: 600,
        color: on ? C.accent1 : C.textSecondary,
        transition: 'color 220ms ease',
      }}>
        {on ? 'Flow' : 'Off'}
      </span>

      {/* Knob — slides left↔right; recessed gray (OFF) vs orange with accent ring (ON). */}
      <div style={{
        position: 'absolute', top: PAD, left: on ? KNOB_ON_LEFT : PAD,
        width: KNOB, height: KNOB, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: on ? C.accent1 : C.card,
        boxShadow: on
          ? `0 0 0 2px rgba(242,127,55,0.7), 0 0 18px 3px rgba(242,127,55,0.5), 4px 4px 5px 0px rgba(0,0,0,0.5)`
          : INSET,
        transition: 'left 260ms cubic-bezier(0.4,0,0.2,1), background 220ms ease, box-shadow 220ms ease',
      }}>
        <span style={{ width: GLYPH, height: GLYPH, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* Gray glyph when OFF; dark glyph on the orange knob when ON. */}
          <SetCreationIcon color={on ? '#141416' : C.iconPrimary} />
        </span>
      </div>
    </div>
  )
}
