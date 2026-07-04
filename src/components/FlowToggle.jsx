import { usePlaylistStore } from '../store/usePlaylistStore'
import { SetCreationIcon } from './LeftNav'
import { C, FONT, INSET } from './import/tokens'

// The Flow toggle (Decision Log #48–52, Figma OFF 748-2568 / ON 748-2563). VISUAL ONLY this slice:
// it renders the OFF state, is disabled, and shows a "Coming soon" tooltip — Flow mode itself is
// Slice 10. It's shown for the whole of set-builder mode (from the moment the panel opens), so it's
// always available in the toolbar area alongside the map.
//
// Pill with a round knob (the linked-nodes glyph, shared with the Set Builder rail icon) + a label.
// OFF: knob left, gray glyph, "Off" in Text/Secondary. (ON would slide the knob right, turn it
// orange, and read "Flow" — built in Slice 10.)

const KNOB = 60
const GLYPH = 26 // linked-nodes glyph box inside the knob

export default function FlowToggle() {
  const { buildMode } = usePlaylistStore()

  // Visible for the whole of build mode (set-builder panel open).
  if (!buildMode) return null

  return (
    <div
      title="Coming soon"
      aria-disabled="true"
      style={{
        display: 'flex', alignItems: 'center', gap: 15,
        width: 140, boxSizing: 'border-box',
        padding: '5px 20px 5px 5px', borderRadius: 100,
        background: C.card,
        boxShadow: '4px 4px 2.5px 0px rgba(0,0,0,1), inset 1px 1.5px 3px 0px #373737',
        cursor: 'default', userSelect: 'none', flexShrink: 0,
        // No container opacity — that made the whole pill see-through (songs showed behind it). The
        // OFF/inert state is already conveyed by the gray glyph + "Off" label.
      }}
    >
      {/* Knob — recessed dark circle with the Set Builder rail glyph, gray for the OFF/inactive
          state (it turns orange when active, matching the rail icon — wired up in Slice 10). */}
      <div style={{
        width: KNOB, height: KNOB, borderRadius: '50%', flexShrink: 0,
        background: C.card, boxShadow: INSET,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ width: GLYPH, height: GLYPH, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <SetCreationIcon active={false} />
        </span>
      </div>
      <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, color: C.textSecondary }}>Off</span>
    </div>
  )
}
