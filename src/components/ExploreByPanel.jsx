import { useState } from 'react'
import { usePlaylistStore } from '../store/usePlaylistStore'
import { PRESETS, PRESET_KEYS } from '../lib/presets'
import {
  SELECTED,
  NEO_BAR_BG, NEO_BAR_SHADOW, NEO_BAR_EDGE, NEO_BAR_HOVER_BG, NEO_BAR_HOVER,
  NEO_TRAY_BG, NEO_TRAY_INSET,
} from './import/tokens'
import CompassPreview from './CompassPreview'

const FONT    = "'DM Sans', system-ui, -apple-system, sans-serif"
const ACCENT1 = '#F27F37'
const TEXT_SEC = '#848484'

// ——— Main panel ——————————————————————————————————————————————————————————————
export default function ExploreByPanel() {
  const { activePreset, setActivePreset } = usePlaylistStore()
  // One key rather than per-row flags — only one row can be under the cursor at a time.
  const [hoverKey, setHoverKey] = useState(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 0 }}>
      {/* ——— Title ——— */}
      <div style={{ marginBottom: 18 }}>
        <h2 style={{
          margin: 0,
          fontFamily: FONT, fontSize: 24, fontWeight: 600,
          color: '#fff', lineHeight: 1.1,
        }}>
          Explore By
        </h2>
      </div>

      {/* ——— Scrollable body ——— */}
      <div className="hide-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1, minHeight: 0, overflowY: 'auto' }}>

        {/* Preset rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
          {PRESET_KEYS.map((key) => {
            const p = PRESETS[key]
            const active = activePreset === key
            const lift = hoverKey === key
            return (
              <button
                key={key}
                onClick={() => setActivePreset(key)}
                onPointerEnter={() => setHoverKey(key)}
                onPointerLeave={() => setHoverKey((k) => (k === key ? null : k))}
                style={{
                  position: 'relative',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '15px 15px 15px 30px',
                  height: 58,
                  borderRadius: 1000,
                  // Two treatments. INACTIVE is a raised slab off the panel — the same construction as
                  // the toolbar pill, with the indicator recessed into it as a well (see the NEO_* block
                  // in import/tokens). ACTIVE is the selected shader (Figma 913-12): accent ring +
                  // translucent dark glass fill + sheen + accent label, matching the rail and the Flow
                  // knob. The row stops being a physical slab when it lights up; that's the system.
                  // Hover lifts whichever of the two it's wearing, and the active row lifts too: unlike a
                  // disabled button it still takes the click, it's just idempotent, so holding it flat
                  // would read as "not clickable" rather than "already chosen".
                  border: active ? `1px solid ${SELECTED.border}` : 'none',
                  background: active
                    ? `${lift ? SELECTED.hoverSheen : SELECTED.sheen}, ${SELECTED.fill}`
                    : (lift ? NEO_BAR_HOVER_BG : NEO_BAR_BG),
                  backdropFilter: active ? SELECTED.blur : undefined,
                  WebkitBackdropFilter: active ? SELECTED.blur : undefined,
                  boxShadow: active
                    ? `${lift ? SELECTED.hoverDrop : SELECTED.drop}, ${SELECTED.rim}`
                    : (lift ? NEO_BAR_HOVER : NEO_BAR_SHADOW),
                  cursor: 'pointer',
                  transition: 'border-color 180ms ease, box-shadow 180ms ease, background 180ms ease, backdrop-filter 180ms ease',
                  width: '100%',
                }}
              >
                {/* Raised-slab inner rim — inactive only; the active row gets SELECTED.rim instead. */}
                {!active && (
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: 'inherit',
                    boxShadow: NEO_BAR_EDGE,
                    pointerEvents: 'none',
                  }} />
                )}
                <span style={{
                  fontFamily: FONT, fontSize: 16, fontWeight: 500,
                  color: active ? ACCENT1 : TEXT_SEC,
                  transition: 'color 180ms ease',
                  position: 'relative',
                }}>
                  {p.label}
                </span>
                {/* Indicator — ACTIVE is the same glass chip as the row it sits in and the rail: dark
                    20% fill, 1px accent ring, sheen + drop. Figma 748-2483 tints this one orange @ 20%,
                    but the fill stays neutral here on purpose — every selected surface in the app reads
                    the same, and the accent stays in the ring and the label rather than the glass.
                    INACTIVE is a well cut into the row (was a now-expired Figma asset). */}
                {active ? (
                  <div style={{
                    width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                    border: `1px solid ${SELECTED.border}`,
                    background: `${SELECTED.sheen}, ${SELECTED.fill}`,
                    backdropFilter: SELECTED.blur,
                    WebkitBackdropFilter: SELECTED.blur,
                    boxShadow: `${SELECTED.drop}, ${SELECTED.rim}`,
                  }} />
                ) : (
                  <div style={{
                    width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                    background: NEO_TRAY_BG,
                    boxShadow: NEO_TRAY_INSET,
                  }} />
                )}
              </button>
            )
          })}
        </div>

        {/* Compass preview */}
        <div style={{ marginTop: 35, paddingBottom: 20 }}>
          <CompassPreview presetKey={activePreset} locked />
        </div>
      </div>
    </div>
  )
}
