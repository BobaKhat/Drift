import { usePlaylistStore } from '../store/usePlaylistStore'
import { C, FONT, INSET } from './import/tokens'

// The Flow toggle (Decision Log #48–52, Figma OFF 748-2568 / ON 748-2563). VISUAL ONLY this slice:
// it renders the OFF state, is disabled, and shows a "Coming soon" tooltip — Flow mode itself is
// Slice 10. It only appears in set-builder mode once the chain has a head (Decision Log edge case:
// "Disable Flow toggle until chain has a head"), so it never sits over an empty map.
//
// Pill with a round knob (the pulse/activity glyph — two nodes joined by a wire) + a label. OFF:
// knob left, gray glyph, "Off" in Text/Secondary. (ON would slide the knob right, turn it orange,
// and read "Flow" — built in Slice 10.)

const KNOB = 60

// Two nodes joined by a wire — the "flow / activity" glyph inside the knob.
function FlowGlyph({ color }) {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" style={{ display: 'block' }}>
      <path d="M10 19C13 15 17 15 20 11" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx="9" cy="20" r="3" fill={color} />
      <circle cx="21" cy="10" r="3" fill={color} />
    </svg>
  )
}

export default function FlowToggle() {
  const { buildMode, chain } = usePlaylistStore()

  // Only in build mode, and only once a head exists (Decision Log edge case).
  if (!buildMode || chain.length < 1) return null

  return (
    <div
      title="Coming soon"
      aria-disabled="true"
      style={{
        display: 'flex', alignItems: 'center', gap: 15,
        padding: '5px 20px 5px 5px', borderRadius: 100,
        background: C.card,
        boxShadow: '4px 4px 2.5px 0px rgba(0,0,0,1), inset 1px 1.5px 3px 0px #373737',
        cursor: 'default', userSelect: 'none', flexShrink: 0,
        opacity: 0.9, // reads as inert, not fully active
      }}
    >
      {/* Knob — recessed dark circle with the gray glyph (OFF / inactive state). */}
      <div style={{
        width: KNOB, height: KNOB, borderRadius: '50%', flexShrink: 0,
        background: C.card, boxShadow: INSET,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <FlowGlyph color={C.iconPrimary} />
      </div>
      <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, color: C.textSecondary }}>Off</span>
    </div>
  )
}
