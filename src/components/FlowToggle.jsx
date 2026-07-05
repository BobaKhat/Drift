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
const EDGE = 8 // gap between the visible disc and the pill edge it rests against

// The knob PNG (124px canvas) bakes a bottom-right drop shadow, so the solid disc isn't centered in
// its own image — it measures at px [2,107] (center 54.5, Ø105), with the padding all bottom-right.
// We render the image in a KNOB-sized box but position it by where the DISC lands, not the box, so the
// visible disc is what's vertically centered and sits exactly EDGE px from the left/right pill edge.
const KNOB = 60                     // rendered image-box size (contain-fit)
const SCALE = KNOB / 124            // PNG canvas is 124px
const DISC_INSET = 2 * SCALE        // disc's solid edge starts ~2px into the PNG (≈0.97)
const DISC = 105 * SCALE            // rendered disc diameter (≈50.8)
const KNOB_TOP = H / 2 - (DISC_INSET + DISC / 2)   // disc vertically centered (equal top/bottom gap)
const KNOB_LEFT_ON = EDGE - DISC_INSET             // disc EDGE px from the left
const KNOB_LEFT_OFF = W - EDGE - DISC_INSET - DISC  // disc EDGE px from the right

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
      <span style={{ ...LABEL_BASE, left: 26, opacity: on ? 0 : 1, transition: FADE }}>Off</span>
      <span style={{ ...LABEL_BASE, right: 26, opacity: on ? 1 : 0, transition: FADE }}>Flow</span>

      {/* Knob — one box that SLIDES right (Off) ↔ left (Flow) with a springy ease-out, holding both
          PNGs stacked so the OFF (gray) and ON (orange ring + orange glyph) knobs cross-fade during the
          slide — the ring/glyph colour transition rides the same fade. Square box + contain = true circle. */}
      <div style={{
        position: 'absolute', top: KNOB_TOP, left: on ? KNOB_LEFT_ON : KNOB_LEFT_OFF,
        width: KNOB, height: KNOB, pointerEvents: 'none',
        transition: 'left 320ms cubic-bezier(0.34,1.3,0.64,1)',
      }}>
        <img src={knobOff} alt="" draggable={false} style={{ ...KNOB_IMG, opacity: on ? 0 : 1, transition: FADE }} />
        <img src={knobOn} alt="" draggable={false} style={{ ...KNOB_IMG, opacity: on ? 1 : 0, transition: FADE }} />
      </div>
    </div>
  )
}

const FADE = 'opacity 240ms ease'
const LABEL_BASE = {
  position: 'absolute', top: '50%', transform: 'translateY(-50%)',
  fontFamily: FONT, fontSize: 14, fontWeight: 600, color: C.textSecondary,
  pointerEvents: 'none',
}
const KNOB_IMG = {
  position: 'absolute', inset: 0, width: KNOB, height: KNOB,
  maxWidth: 'none', objectFit: 'contain', display: 'block',
}
