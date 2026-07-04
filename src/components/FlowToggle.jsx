import { usePlaylistStore } from '../store/usePlaylistStore'
import { C, FONT } from './import/tokens'
import knobOn from '../assets/flow-knob-on.svg'
import knobOff from '../assets/flow-knob-off.svg'

// The Flow toggle (Decision Log #48–52, Figma OFF 748-2568 / ON 748-2563). Functional as of Slice 10:
// it flips the map between the build view (Flow OFF) and the present view (Flow ON — only the chain
// lit, uniform dark wires with a traveling strobe). It appears in the toolbar area once the chain has
// a head, and slides the knob between the two states.
//
// The knobs are the exact Figma frame assets: OFF = recessed dark circle + gray glyph; ON = dark
// circle with an orange ring + orange glyph + raised drop shadow. The ON asset's viewBox is 70 (a
// 60px knob + 10px shadow overflow), so it's placed 1px up/left and drawn at 70px with the shadow
// spilling past the slot (overflow visible), matching the frame's `inset[-1.67% -15% -15%]` offset.

const W = 140
const H = 70
const KNOB = 60
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
      {/* Label — swaps side + text with the state (Figma: "Off" gray right / "Flow" accent left). */}
      <span style={{
        position: 'absolute', top: '50%', transform: 'translateY(-50%)',
        ...(on ? { left: 22 } : { right: 22 }),
        fontFamily: FONT, fontSize: 14, fontWeight: 600,
        color: on ? C.accent1 : C.textSecondary,
        transition: 'color 220ms ease',
      }}>
        {on ? 'Flow' : 'Off'}
      </span>

      {/* Knob — the Figma asset, sliding left↔right. Slot is 60px; the ON asset draws at 70px offset
          −1/−1 so its drop shadow spills past the slot exactly as in the frame. */}
      <div style={{
        position: 'absolute', top: PAD, left: on ? KNOB_ON_LEFT : PAD,
        width: KNOB, height: KNOB, overflow: 'visible',
        transition: 'left 260ms cubic-bezier(0.4,0,0.2,1)',
      }}>
        {on ? (
          <img src={knobOn} alt="" draggable={false}
            style={{ position: 'absolute', top: -1, left: -1, width: 70, height: 70, display: 'block', pointerEvents: 'none' }} />
        ) : (
          <img src={knobOff} alt="" draggable={false}
            style={{ position: 'absolute', inset: 0, width: KNOB, height: KNOB, display: 'block', pointerEvents: 'none' }} />
        )}
      </div>
    </div>
  )
}
