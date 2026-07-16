import { usePlaylistStore } from '../store/usePlaylistStore'
import { C, FONT, INSET, SELECTED } from './import/tokens'
import { SetCreationIcon } from './LeftNav'
import knobOff from '../assets/flow-off.png'

// The Flow toggle (Decision Log #48–52). Functional as of Slice 10: it flips the map between the
// build view (Flow OFF) and the present view (Flow ON — only the chain lit, uniform dark wires with a
// traveling strobe). It appears in the toolbar area once the chain has a head, and slides a knob
// inside a recessed track between the two states.
//
// Two knob states, cross-faded as the knob slides. OFF (default) = the original pre-rendered bitmap
// (assets/flow-off.png) — a dark disc with a gray glyph and baked bevel/shadow. ON = the live selected
// chip (Figma node 913-12) — a 0.5px accent ring + translucent dark glass fill + frosted blur +
// drop shadow + a flat accent glyph. Slides RIGHT (Off) → LEFT (Flow); both labels stay gray.

const W = 136
const H = 70
const EDGE = 9   // gap between the disc and the pill edge it rests against (Figma: knob inset 9)
const DISC = 52  // knob diameter (Figma node 913-12)

const KNOB_TOP = (H - DISC) / 2         // disc vertically centered (equal top/bottom gap)
const KNOB_LEFT_ON = EDGE                // disc EDGE px from the left
const KNOB_LEFT_OFF = W - EDGE - DISC    // disc EDGE px from the right

// OFF bitmap alignment. The PNG (124px canvas) bakes a bottom-right shadow, so its solid disc sits at
// px [2,107] (Ø105) with all padding bottom-right. Scale the 105px disc onto the DISC-sized chip and
// pull the image back so its disc — not the padded canvas — lands exactly on the live chip's box.
const OFF_SCALE = DISC / 105
const OFF_BOX = 124 * OFF_SCALE   // rendered PNG box (≈61.4)
const OFF_SHIFT = -2 * OFF_SCALE  // disc starts ~2px into the canvas (≈-0.99)

// Each label is centered in the empty half — between the knob's disc and the opposite pill edge.
// OFF: knob on the right, so "Off" centers between the left edge (0) and the disc's left side.
// ON:  knob on the left,  so "Flow" centers between the disc's right side and the right edge (W).
const LABEL_OFF_X = (W - EDGE - DISC) / 2   // midpoint of [0, disc-left]
const LABEL_FLOW_X = (EDGE + DISC + W) / 2  // midpoint of [disc-right, W]

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

      {/* Labels — both mounted and cross-faded so "Off"/"Flow" dissolve into each other rather than
          snapping. Each stays pinned opposite the knob's resting side. */}
      <span style={{ ...LABEL_BASE, left: LABEL_OFF_X, opacity: on ? 0 : 1, transition: FADE }}>Off</span>
      <span style={{ ...LABEL_BASE, left: LABEL_FLOW_X, opacity: on ? 1 : 0, transition: FADE }}>Flow</span>

      {/* Knob — one box that SLIDES right (Off) ↔ left (Flow) with a springy ease-out, holding both
          states stacked so the OFF (original bitmap, gray glyph) and ON (selected chip, accent glyph)
          knobs cross-fade during the slide. */}
      <div style={{
        position: 'absolute', top: KNOB_TOP, left: on ? KNOB_LEFT_ON : KNOB_LEFT_OFF,
        width: DISC, height: DISC, pointerEvents: 'none',
        transition: 'left 320ms cubic-bezier(0.34,1.3,0.64,1)',
      }}>
        {/* OFF — the original pre-rendered bitmap, its disc aligned onto the DISC-sized chip box. */}
        <img src={knobOff} alt="" draggable={false} style={{
          position: 'absolute', left: OFF_SHIFT, top: OFF_SHIFT,
          width: OFF_BOX, height: OFF_BOX, maxWidth: 'none', objectFit: 'contain', display: 'block',
          opacity: on ? 0 : 1, transition: FADE,
        }} />
        {/* ON — selected shader (Figma node 913-12): 0.5px accent ring + translucent dark glass fill +
            glass sheen + solid-black drop + a flat accent glyph (no inner shadow). */}
        <div style={{
          ...KNOB_BASE,
          background: `${SELECTED.sheen}, ${SELECTED.fill}`,
          border: `0.5px solid ${SELECTED.border}`,
          boxShadow: `${SELECTED.drop}, ${SELECTED.rim}`,
          backdropFilter: SELECTED.blur, WebkitBackdropFilter: SELECTED.blur,
          opacity: on ? 1 : 0, transition: FADE,
        }}>
          <span style={GLYPH_BOX}><SetCreationIcon color={C.accent1} /></span>
        </div>
      </div>
    </div>
  )
}

const FADE = 'opacity 240ms ease'
const LABEL_BASE = {
  position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
  fontFamily: FONT, fontSize: 14, fontWeight: 600, color: C.textSecondary,
  whiteSpace: 'nowrap', pointerEvents: 'none',
}
const KNOB_BASE = {
  position: 'absolute', inset: 0, boxSizing: 'border-box', borderRadius: '50%',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const GLYPH_BOX = { width: 30, height: 21, display: 'flex' }
