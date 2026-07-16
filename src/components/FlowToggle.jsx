import { usePlaylistStore } from '../store/usePlaylistStore'
import {
  C, FONT, SELECTED,
  NEO_BAR_BG, NEO_BAR_SHADOW, NEO_BAR_EDGE,
  NEO_BTN_BG, NEO_BTN_RAISED,
  NEO_TRAY_BG, NEO_TRAY_INSET,
} from './import/tokens'
import { SetCreationIcon } from './LeftNav'

// The Flow toggle (Decision Log #48–52). Functional as of Slice 10: it flips the map between the
// build view (Flow OFF) and the present view (Flow ON — only the chain lit, uniform dark wires with a
// traveling strobe). It appears in the toolbar area once the chain has a head, and slides a knob
// inside a recessed track between the two states.
//
// The pill and track are the same two levels as the toolbar and the search bar: a raised slab with a
// well cut into it (see the NEO_* block in import/tokens).
//
// Two knob states, cross-faded as the knob slides. OFF = a raised knob in that well, shaded like the
// toolbar's buttons. ON = the selected shader (Figma node 913-12) — a 0.5px accent ring + translucent
// dark glass fill + frosted blur + drop shadow + a flat accent glyph. The ON state deliberately does NOT
// use the neomorphic recipe: it's the app-wide active/selected treatment, shared with the icon rail and
// the Explore By rows, and the knob has to keep reading as a member of that set when it's lit.
// Slides RIGHT (Off) → LEFT (Flow). "Off" stays gray; "Flow" lights accent alongside the knob's ring and
// glyph, so everything naming the live state is accent and everything naming the idle one is gray.

const W = 136
const H = 70
const EDGE = 9   // gap between the disc and the pill edge it rests against (Figma: knob inset 9)
const DISC = 52  // knob diameter (Figma node 913-12)
const TRACK = 8  // the well's inset from the pill edge — also what the labels centre against

const KNOB_TOP = (H - DISC) / 2         // disc vertically centered (equal top/bottom gap)
const KNOB_LEFT_ON = EDGE                // disc EDGE px from the left
const KNOB_LEFT_OFF = W - EDGE - DISC    // disc EDGE px from the right

// Each label is centered in the empty half of the TRACK — between the knob's disc and the far end of the
// well. The well, not the pill: the track is inset TRACK px, so centering against the pill's outer edge
// (as this used to) measured 8px of slab the label can't occupy and pushed it that much toward the outer
// curve. Both land 26.5px either side of the toggle's midline, so the pair reads symmetric.
// OFF: knob on the right, so "Off" centers between the track's left end and the disc's left side.
// ON:  knob on the left,  so "Flow" centers between the disc's right side and the track's right end.
const LABEL_OFF_X = (TRACK + (W - EDGE - DISC)) / 2     // midpoint of [track-left, disc-left]
const LABEL_FLOW_X = ((EDGE + DISC) + (W - TRACK)) / 2  // midpoint of [disc-right, track-right]

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
        borderRadius: 100, background: NEO_BAR_BG,
        boxShadow: NEO_BAR_SHADOW,
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      {/* Recessed track/well the knob rides in — the toolbar's tray at a smaller scale. The knob's own
          9px EDGE inset gives it the same kind of gutter the tray buttons get from their 7px padding. */}
      <div style={{
        position: 'absolute', inset: TRACK, borderRadius: 100,
        background: NEO_TRAY_BG, boxShadow: NEO_TRAY_INSET,
      }} />

      {/* Labels — both mounted and cross-faded so "Off"/"Flow" dissolve into each other rather than
          snapping. Each stays pinned opposite the knob's resting side. "Flow" carries the accent so the
          lit state reads as one unit (ring + glyph + label); "Off" stays gray, like the knob it names. */}
      <span style={{ ...LABEL_BASE, left: LABEL_OFF_X, opacity: on ? 0 : 1, transition: FADE }}>Off</span>
      <span style={{ ...LABEL_BASE, left: LABEL_FLOW_X, color: C.accent1, opacity: on ? 1 : 0, transition: FADE }}>Flow</span>

      {/* Knob — one box that SLIDES right (Off) ↔ left (Flow) with a springy ease-out, holding both
          states stacked so the OFF (original bitmap, gray glyph) and ON (selected chip, accent glyph)
          knobs cross-fade during the slide. */}
      <div style={{
        position: 'absolute', top: KNOB_TOP, left: on ? KNOB_LEFT_ON : KNOB_LEFT_OFF,
        width: DISC, height: DISC, pointerEvents: 'none',
        transition: 'left 320ms cubic-bezier(0.34,1.3,0.64,1)',
      }}>
        {/* OFF — a raised knob riding in the well, shaded like the toolbar's buttons. */}
        <div style={{
          ...KNOB_BASE,
          background: NEO_BTN_BG,
          boxShadow: NEO_BTN_RAISED,
          opacity: on ? 0 : 1, transition: FADE,
        }}>
          <span style={GLYPH_BOX}><SetCreationIcon color={C.iconPrimary} /></span>
        </div>
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

      {/* Raised-slab inner rim — same overlay the toolbar pill and search bar carry. */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 'inherit',
        boxShadow: NEO_BAR_EDGE,
        pointerEvents: 'none',
      }} />
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
