import { usePlaylistStore } from '../store/usePlaylistStore'
import { PRESETS, PRESET_KEYS } from '../lib/presets'

const FONT = "'DM Sans', system-ui, -apple-system, sans-serif"
const ACCENT1 = '#F27F37'
const ACCENT2 = '#4B6AE5'
const CARD = '#141416'
const TEXT_SEC = '#848484'

// ——— Figma compass assets (node 748-3700, refreshed) —————————————————————————
// Corner bracket images — each is a unique L-shape, rotated/flipped into position.
const IMG_BR_TR  = 'https://www.figma.com/api/mcp/asset/ed63ed89-a1b5-492b-b286-787d7931ba8a'
const IMG_BR_BR  = 'https://www.figma.com/api/mcp/asset/bc62e23a-6985-4731-901e-a513c6c2cc0f'
const IMG_BR_TL  = 'https://www.figma.com/api/mcp/asset/fccec3ae-ea7c-4d03-a4bf-f5b4d7521de3'
const IMG_BR_BL  = 'https://www.figma.com/api/mcp/asset/1bec76d6-e98c-4746-b30f-faa97b88a3c3'
// Radar rings (concentric, innermost → outermost)
const IMG_RING1  = 'https://www.figma.com/api/mcp/asset/59693937-c6ac-443a-aa8c-f332622a08b4'
const IMG_RING2  = 'https://www.figma.com/api/mcp/asset/96f0b98a-89da-4ba8-b28e-e18810e34998'
const IMG_RING3  = 'https://www.figma.com/api/mcp/asset/7d7bd04c-fe9b-4951-b175-2eae352d1741'
// Diamond quadrant sectors (Vector38=BR, Vector39=BL+TL shared, Vector40=TR)
const IMG_Q_BR   = 'https://www.figma.com/api/mcp/asset/d1b595c2-4f78-4c05-bdff-3a2de7353ad5'
const IMG_Q_BLTL = 'https://www.figma.com/api/mcp/asset/5e955b84-ea65-414c-852d-33cd37e5f1a0'
const IMG_Q_TR   = 'https://www.figma.com/api/mcp/asset/73246b2d-bdf5-4c31-807b-e87aee74faf3'
// Crosshair lines (Union = vertical, Union1 = horizontal)
const IMG_CV     = 'https://www.figma.com/api/mcp/asset/6c8d91dc-a462-47f8-b4fb-9635acffbc6e'
const IMG_CH     = 'https://www.figma.com/api/mcp/asset/a9df0e60-218f-4002-98e8-36f988310054'
// Center dot
const IMG_DOT    = 'https://www.figma.com/api/mcp/asset/ea7d8d51-a871-4f0d-bca3-1a9b3f414c84'
// Inactive preset button indicator — inset circle (node 748-3693)
const IMG_INSET_ELLIPSE = 'https://www.figma.com/api/mcp/asset/64ee7e84-0b76-4d33-9b5f-a0adc6145d5b'

// Shared pill shell: outer filter shadow + dark bg + border. Inner shadow is a child overlay.
const compassPillShell = {
  position: 'absolute',
  display: 'inline-flex', alignItems: 'center',
  background: '#0f0f0f', border: '1px solid black', borderRadius: 100,
  filter: 'drop-shadow(0px 0px 2.5px black)',
}
const compassPillInset = {
  position: 'absolute', inset: 0, borderRadius: 'inherit',
  boxShadow: 'inset 0px 0px 5px 0px rgba(80,80,80,0.5)',
  pointerEvents: 'none',
}
const compassPillText = {
  fontFamily: FONT, fontSize: 12, fontWeight: 510,
  lineHeight: 'normal', whiteSpace: 'nowrap', position: 'relative',
}

// Quadrant sector size (Figma: 66.283 × 66.283 px)
const QS = 66.283

function CompassPreview({ presetKey }) {
  const p = PRESETS[presetKey] ?? PRESETS.vibe

  return (
    <div style={{
      position: 'relative', height: 275, borderRadius: 30,
      background: '#141415', overflow: 'hidden', flexShrink: 0,
      boxShadow: 'inset -1px -1px 3px 0px #373737, inset 2px 2px 2px 0px black',
    }}>
      {/* Dot grid — same spacing/opacity as the map card so compass reads as a smaller map */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1.3px)',
        backgroundSize: '22px 22px',
      }} />

      {/* Backgrind grid — inner rounded border (Figma 748:2494) */}
      <div style={{
        position: 'absolute', left: '50%', top: '50%',
        transform: 'translate(-50%, -50%)',
        width: '100%', height: 275,
        borderRadius: 20, border: '1px solid #282828',
        pointerEvents: 'none',
      }} />

      {/* Corner brackets — image assets, converted from Tailwind transforms */}
      {/* TR: rotate(180deg) */}
      <div style={{ position: 'absolute', right: 19, top: 20, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img alt="" src={IMG_BR_TR} style={{ display: 'block', width: 30, height: 30, transform: 'rotate(180deg)' }} />
      </div>
      {/* BR: rotate(180deg) scaleY(-1) */}
      <div style={{ position: 'absolute', right: 19, bottom: 20, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img alt="" src={IMG_BR_BR} style={{ display: 'block', width: 30, height: 30, transform: 'rotate(180deg) scaleY(-1)' }} />
      </div>
      {/* TL: rotate(90deg) */}
      <div style={{ position: 'absolute', left: 20, top: 20, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img alt="" src={IMG_BR_TL} style={{ display: 'block', width: 30, height: 30, transform: 'rotate(90deg)' }} />
      </div>
      {/* BL: rotate(-90deg) scaleY(-1) */}
      <div style={{ position: 'absolute', left: 20, bottom: 20, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img alt="" src={IMG_BR_BL} style={{ display: 'block', width: 30, height: 30, transform: 'rotate(-90deg) scaleY(-1)' }} />
      </div>

      {/* Radar rings — centered horizontally (translateX-50%) */}
      <div style={{ position: 'absolute', left: '50%', top: 111.29, transform: 'translateX(-50%)', width: 52.426, height: 52.426 }}>
        <img alt="" src={IMG_RING1} style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' }} />
      </div>
      <div style={{ position: 'absolute', left: '50%', top: 86.21, transform: 'translateX(-50%)', width: 102.574, height: 102.574 }}>
        <img alt="" src={IMG_RING2} style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' }} />
      </div>
      <div style={{ position: 'absolute', left: '50%', top: 60, transform: 'translateX(-50%)', width: 155, height: 155 }}>
        <img alt="" src={IMG_RING3} style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' }} />
      </div>

      {/* Diamond quadrant sectors — left:99.38 = center - QS, left:165.06 ≈ center */}
      {/* TR: no transform */}
      <div style={{ position: 'absolute', left: '50%', top: 71.38, width: QS, height: QS }}>
        <img alt="" src={IMG_Q_TR} style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' }} />
      </div>
      {/* TL: rotate(180deg) scaleY(-1) */}
      <div style={{ position: 'absolute', left: `calc(50% - ${QS}px)`, top: 71.38, width: QS, height: QS, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img alt="" src={IMG_Q_BLTL} style={{ display: 'block', width: QS, height: QS, transform: 'rotate(180deg) scaleY(-1)' }} />
      </div>
      {/* BL: rotate(180deg) */}
      <div style={{ position: 'absolute', left: `calc(50% - ${QS}px)`, top: 137.06, width: QS, height: QS, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img alt="" src={IMG_Q_BLTL} style={{ display: 'block', width: QS, height: QS, transform: 'rotate(180deg)' }} />
      </div>
      {/* BR: scaleY(-1) */}
      <div style={{ position: 'absolute', left: '50%', top: 137.06, width: QS, height: QS, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img alt="" src={IMG_Q_BR} style={{ display: 'block', width: QS, height: QS, transform: 'scaleY(-1)' }} />
      </div>

      {/* Crosshair lines (centered) */}
      <div style={{ position: 'absolute', left: '50%', top: 66.12, transform: 'translateX(-50%)', width: 10.197, height: 140.688 }}>
        <img alt="" src={IMG_CV} style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' }} />
      </div>
      <div style={{ position: 'absolute', left: '50%', top: 131.81, transform: 'translateX(-50%)', width: 142.751, height: 10.789 }}>
        <img alt="" src={IMG_CH} style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' }} />
      </div>

      {/* Center dot */}
      <div style={{ position: 'absolute', left: '50%', top: 131, transform: 'translateX(-50%)', width: 13, height: 13 }}>
        <img alt="" src={IMG_DOT} style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' }} />
      </div>

      {/* Axis pills — text driven by active preset */}
      {/* Top (yHigh) — orange */}
      <div style={{ ...compassPillShell, left: '50%', top: 10, transform: 'translateX(-50%)', padding: '10px 25px' }}>
        <div style={compassPillInset} />
        <span style={{ ...compassPillText, color: ACCENT1 }}>{p.yHigh}</span>
      </div>
      {/* Bottom (yLow) — orange */}
      <div style={{ ...compassPillShell, left: '50%', top: 228, transform: 'translateX(-50%)', padding: '10px 25px' }}>
        <div style={compassPillInset} />
        <span style={{ ...compassPillText, color: ACCENT1 }}>{p.yLow}</span>
      </div>
      {/* Right (xHigh) — blue */}
      <div style={{ ...compassPillShell, right: 10, top: '50%', transform: 'translateY(-50%)', padding: '10px 15px' }}>
        <div style={compassPillInset} />
        <span style={{ ...compassPillText, color: ACCENT2 }}>{p.xHigh}</span>
      </div>
      {/* Left (xLow) — blue */}
      <div style={{ ...compassPillShell, left: 10, top: '50%', transform: 'translateY(-50%)', padding: '10px 15px' }}>
        <div style={compassPillInset} />
        <span style={{ ...compassPillText, color: ACCENT2 }}>{p.xLow}</span>
      </div>
    </div>
  )
}

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
                  background: CARD,
                  filter: active ? undefined : 'drop-shadow(4px 4px 2.5px black)',
                  boxShadow: active ? '4px 4px 5px 0px black' : undefined,
                  cursor: 'pointer',
                  transition: 'border-color 180ms ease, filter 180ms ease, box-shadow 180ms ease',
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
                  color: active ? '#fff' : TEXT_SEC,
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
