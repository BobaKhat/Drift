import { usePlaylistStore } from '../store/usePlaylistStore'
import { PRESETS, PRESET_KEYS } from '../lib/presets'
import { SELECTED } from './import/tokens'
import CompassPreview from './CompassPreview'

const FONT    = "'DM Sans', system-ui, -apple-system, sans-serif"
const ACCENT1 = '#F27F37'
const CARD    = '#141416'
const TEXT_SEC = '#848484'

// ——— Main panel ——————————————————————————————————————————————————————————————
export default function ExploreByPanel() {
  const { activePreset, setActivePreset } = usePlaylistStore()

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
            return (
              <button
                key={key}
                onClick={() => setActivePreset(key)}
                style={{
                  position: 'relative',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '15px 15px 15px 30px',
                  height: 58,
                  borderRadius: 1000,
                  // Selected shader (Figma node 748-2339) — accent ring + 20%-accent glass fill +
                  // frosted backdrop blur + accent label; the indicator knob is an empty accent ring.
                  border: active ? `1px solid ${SELECTED.border}` : 'none',
                  background: active ? SELECTED.fill : CARD,
                  backdropFilter: active ? SELECTED.blur : undefined,
                  WebkitBackdropFilter: active ? SELECTED.blur : undefined,
                  filter: active ? undefined : 'drop-shadow(4px 4px 2.5px black)',
                  boxShadow: active ? '4px 4px 5px 0px black' : undefined,
                  cursor: 'pointer',
                  transition: 'border-color 180ms ease, filter 180ms ease, box-shadow 180ms ease, background 180ms ease, backdrop-filter 180ms ease',
                  width: '100%',
                }}
              >
                {/* Inset shadow overlay — inactive only */}
                {!active && (
                  <div style={{
                    position: 'absolute', inset: 0, borderRadius: 'inherit',
                    boxShadow: 'inset 1px 1.5px 3px 0px #373737',
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
                {/* Indicator — empty orange ring when active (Figma 748-2481); recessed circle when
                    inactive (was a now-expired Figma asset image → drawn with an inset shadow instead). */}
                {active ? (
                  <div style={{
                    width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                    border: `1px solid ${SELECTED.border}`,
                    background: SELECTED.fill,
                    backdropFilter: SELECTED.blur,
                    WebkitBackdropFilter: SELECTED.blur,
                    boxShadow: SELECTED.drop,
                  }} />
                ) : (
                  <div style={{
                    width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                    background: CARD,
                    boxShadow: 'inset 2px 2px 3px 0px rgba(0,0,0,0.9), inset -1px -1px 2px 0px rgba(255,255,255,0.05)',
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
