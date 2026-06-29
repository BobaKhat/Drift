import { usePlaylistStore } from '../store/usePlaylistStore'
import { PRESETS, PRESET_KEYS } from '../lib/presets'
import CompassPreview from './CompassPreview'

const FONT    = "'DM Sans', system-ui, -apple-system, sans-serif"
const ACCENT1 = '#F27F37'
const CARD    = '#141416'
const TEXT_SEC = '#848484'

const IMG_INSET_ELLIPSE = 'https://www.figma.com/api/mcp/asset/d4ff4a27-be5f-4c68-9de4-46c2bde5715e'

// ——— Main panel ——————————————————————————————————————————————————————————————
export default function ExploreByPanel() {
  const { activePreset, setActivePreset } = usePlaylistStore()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 0 }}>
      {/* ——— Title ——— */}
      <div style={{ marginBottom: 18 }}>
        <h2 style={{
          margin: 0,
          fontFamily: FONT, fontSize: 36, fontWeight: 600,
          color: '#fff', lineHeight: 1.1,
        }}>
          Explore By
        </h2>
        {/* Divider */}
        <div style={{ marginTop: 18, height: 1, background: 'rgba(255,255,255,0.08)' }} />
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
                  border: active ? `1px solid ${ACCENT1}` : 'none',
                  background: active ? 'rgba(20,20,22,0.2)' : CARD,
                  backdropFilter: active ? 'blur(4px)' : undefined,
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
                {/* Indicator — orange ring when active, Figma inset ellipse when inactive */}
                {active ? (
                  <div style={{
                    width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                    border: `1px solid ${ACCENT1}`,
                    background: 'rgba(20,20,22,0.2)',
                    boxShadow: '4px 4px 5px 0px black',
                    position: 'relative',
                  }} />
                ) : (
                  <div style={{ width: 30, height: 30, flexShrink: 0, position: 'relative' }}>
                    <img
                      alt=""
                      src={IMG_INSET_ELLIPSE}
                      style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' }}
                    />
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* Compass preview */}
        <div style={{ marginTop: 35, paddingBottom: 20 }}>
          <CompassPreview presetKey={activePreset} />
        </div>
      </div>
    </div>
  )
}
