import { usePlaylistStore } from '../store/usePlaylistStore'
import { C, FONT, INSET } from './import/tokens'
import knobOn from '../assets/flow-on.png'
import knobOff from '../assets/flow-off.png'

// The Flow toggle (Decision Log #48–52). Functional as of Slice 10: it flips the map between the
// build view (Flow OFF) and the present view (Flow ON — only the chain lit, uniform dark wires with a
// traveling strobe). It appears in the toolbar area once the chain has a head, and slides a knob
// inside a recessed track between the two states.
//
// The knob is a pre-rendered PNG (assets/flow-on.png / flow-off.png) — ON = dark circle with an
// orange ring + orange glyph + glow; OFF = dark circle with a gray glyph. It's drawn in a fixed
// SQUARE box with object-fit: contain (and max-width: none to defeat the base img reset), so it can
// never render as an oval. Slides RIGHT (Off) → LEFT (Flow); labels stay gray.

const W = 140
const H = 70
const KNOB = 60 // square image box (the circle + its baked glow)
const KNOB_TOP = (H - KNOB) / 2 // 5 — vertically centered
const KNOB_LEFT_ON = 5              // left
const KNOB_LEFT_OFF = W - KNOB - 5  // 75 — right

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
        position: 'absolute', inset: 8, borderRadius: 100,
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

      {/* Knob PNG — sliding right (Off) ↔ left (Flow). Square box + contain keeps it a true circle. */}
      <img
        src={on ? knobOn : knobOff}
        alt=""
        draggable={false}
        style={{
          position: 'absolute', top: KNOB_TOP, left: on ? KNOB_LEFT_ON : KNOB_LEFT_OFF,
          width: KNOB, height: KNOB, maxWidth: 'none', objectFit: 'contain',
          display: 'block', pointerEvents: 'none',
          transition: 'left 260ms cubic-bezier(0.4,0,0.2,1)',
        }}
      />
    </div>
  )
}
