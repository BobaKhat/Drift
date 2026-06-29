import { PRESETS } from '../lib/presets'
import { usePlaylistStore } from '../store/usePlaylistStore'

const FONT    = "'DM Sans', system-ui, -apple-system, sans-serif"
const ACCENT1 = '#F27F37'
const ACCENT2 = '#4B6AE5'

// ——— Figma compass assets (node 748-2474, fetched 2026-06-29) ——————————————
// Corner brackets — 4 unique L-shapes placed in each corner
const IMG_BR_TR   = 'https://www.figma.com/api/mcp/asset/5789940c-f9e7-43d7-807e-59966cac6a4b' // rotate(180deg)
const IMG_BR_BR   = 'https://www.figma.com/api/mcp/asset/83dbe4d4-ef53-4519-a227-2816af070b11' // rotate(180deg) scaleY(-1)
const IMG_BR_TL   = 'https://www.figma.com/api/mcp/asset/7d002bfa-a575-4f29-8f39-b6a27370da66' // rotate(90deg)
const IMG_BR_BL   = 'https://www.figma.com/api/mcp/asset/09fbc628-7066-4817-a6fc-57b9ef170791' // rotate(-90deg) scaleY(-1)
// Radar rings — concentric, innermost → outermost
const IMG_RING1   = 'https://www.figma.com/api/mcp/asset/8945ec60-c501-4949-849a-e9ec2f8d10c1' // 52.426 × 52.426
const IMG_RING2   = 'https://www.figma.com/api/mcp/asset/4c4fede6-c0bd-4c7b-8a75-037a1ce083cc' // 102.574 × 102.574
const IMG_RING3   = 'https://www.figma.com/api/mcp/asset/66be1baa-9ed1-4a04-b238-73271ea777c4' // 155 × 155
// Quadrant sectors — TR unique, BL/TL shared, BR unique
const IMG_Q_TR    = 'https://www.figma.com/api/mcp/asset/dbec186c-ac57-4b3b-98b8-dc0ed5da4b96' // no transform
const IMG_Q_BLTL  = 'https://www.figma.com/api/mcp/asset/8822735d-7eb7-47b6-9053-5158e10e37d6' // rotate(180deg) or rotate(180deg) scaleY(-1)
const IMG_Q_BR    = 'https://www.figma.com/api/mcp/asset/8605cffc-22e7-4612-96ea-873baf95ed3d' // scaleY(-1)
// Crosshair — vertical arm (Union) + horizontal arm (Union1), each includes endpoint dots
const IMG_CV      = 'https://www.figma.com/api/mcp/asset/d128508c-d075-41de-b8bf-44367ba1aa94' // 10.197 × 140.688
const IMG_CH      = 'https://www.figma.com/api/mcp/asset/9e97bfec-d697-4173-b9f1-c2bc2168f027' // 142.751 × 10.789
// Center dot
const IMG_DOT     = 'https://www.figma.com/api/mcp/asset/b6bc3787-2a94-47c4-94ed-7f3aa3cfa17d' // 13 × 13

// Quadrant sector size (Figma: 66.283 × 66.283 px)
const QS = 66.283

// Pill shell matches Figma: border-black, drop-shadow 0 0 2.5 black, bg #0f0f0f
const pillShell = {
  position: 'absolute',
  display: 'inline-flex', alignItems: 'center',
  background: '#0f0f0f',
  border: '1px solid black',
  borderRadius: 100,
  filter: 'drop-shadow(0px 0px 2.5px black)',
}
const pillInset = {
  position: 'absolute', inset: 0, borderRadius: 'inherit',
  boxShadow: 'inset 0px 0px 5px 0px #505050',
  pointerEvents: 'none',
}
const pillText = {
  fontFamily: FONT, fontSize: 14, fontWeight: 510,
  lineHeight: 'normal', whiteSpace: 'nowrap', position: 'relative',
}

export default function CompassPreview({ presetKey, locked = false }) {
  const p = PRESETS[presetKey] ?? PRESETS.vibe
  const { activeQuadrant: storeQuadrant } = usePlaylistStore()
  const activeQuadrant = locked ? null : storeQuadrant

  // Active quadrant dims non-active sectors; null = all visible (panel before any pan)
  const qOp = (q) => activeQuadrant == null ? 1 : activeQuadrant === q ? 1 : 0.12

  // Axis pill text color — accent when pole is in active quadrant, gray when it's the opposite
  const yHighColor = activeQuadrant == null || activeQuadrant === 'TR' || activeQuadrant === 'TL' ? ACCENT1 : '#848484'
  const yLowColor  = activeQuadrant == null || activeQuadrant === 'BR' || activeQuadrant === 'BL' ? ACCENT1 : '#848484'
  const xHighColor = activeQuadrant == null || activeQuadrant === 'TR' || activeQuadrant === 'BR' ? ACCENT2 : '#848484'
  const xLowColor  = activeQuadrant == null || activeQuadrant === 'TL' || activeQuadrant === 'BL' ? ACCENT2 : '#848484'

  return (
    <div style={{
      position: 'relative',
      height: 275,
      borderRadius: 30,
      background: '#141415',
      overflow: 'hidden',
      flexShrink: 0,
      boxShadow: 'inset -1px -1px 3px 0px #373737, inset 2px 2px 2px 0px black',
    }}>
      {/* Dot grid */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.055) 1px, transparent 1.3px)',
        backgroundSize: '22px 22px',
      }} />

      {/* Backgrind grid — inner rounded border */}
      <div style={{
        position: 'absolute', left: '50%', top: '50%',
        transform: 'translate(-50%, -50%)',
        width: '100%', height: 275,
        borderRadius: 20, border: '1px solid #282828',
        pointerEvents: 'none',
      }} />

      {/* ── Corner brackets ───────────────────────────────────────────── */}
      {/* TR — rotate(180deg) */}
      <div style={{ position: 'absolute', right: 19, top: 20, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img alt="" src={IMG_BR_TR} style={{ display: 'block', width: 30, height: 30, transform: 'rotate(180deg)' }} />
      </div>
      {/* BR — rotate(180deg) scaleY(-1) */}
      <div style={{ position: 'absolute', right: 19, top: 225, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img alt="" src={IMG_BR_BR} style={{ display: 'block', width: 30, height: 30, transform: 'rotate(180deg) scaleY(-1)' }} />
      </div>
      {/* TL — rotate(90deg) */}
      <div style={{ position: 'absolute', left: 20, top: 20, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img alt="" src={IMG_BR_TL} style={{ display: 'block', width: 30, height: 30, transform: 'rotate(90deg)' }} />
      </div>
      {/* BL — rotate(-90deg) scaleY(-1) */}
      <div style={{ position: 'absolute', left: 20, top: 225, width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <img alt="" src={IMG_BR_BL} style={{ display: 'block', width: 30, height: 30, transform: 'rotate(-90deg) scaleY(-1)' }} />
      </div>

      {/* ── Radar rings (concentric, centered) ───────────────────────── */}
      <div style={{ position: 'absolute', left: '50%', top: 60, transform: 'translateX(-50%)', width: 155, height: 155, pointerEvents: 'none' }}>
        <img alt="" src={IMG_RING3} style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' }} />
      </div>
      <div style={{ position: 'absolute', left: '50%', top: 86.21, transform: 'translateX(-50%)', width: 102.574, height: 102.574, pointerEvents: 'none' }}>
        <img alt="" src={IMG_RING2} style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' }} />
      </div>
      <div style={{ position: 'absolute', left: '50%', top: 111.29, transform: 'translateX(-50%)', width: 52.426, height: 52.426, pointerEvents: 'none' }}>
        <img alt="" src={IMG_RING1} style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' }} />
      </div>

      {/* ── Active quadrant fill — semi-transparent accent triangle ──── */}
      {activeQuadrant && (() => {
        // Vertices derived from sector image positions (QS = 66.283px arm length):
        //   top pole y  = 71.38  (sector top edge, TR/TL)
        //   bottom pole y = 203.34 (sector bottom edge, BR/BL: 137.06 + 66.283)
        //   side offset = 66.283 = QS (sector width — matches the hypotenuse exactly)
        //   center y = 137.5 (275px / 2)
        const fills = {
          TR: `polygon(50% 137.5px, 50% 71.38px, calc(50% + ${QS}px) 137.5px)`,
          TL: `polygon(50% 137.5px, 50% 71.38px, calc(50% - ${QS}px) 137.5px)`,
          BR: `polygon(50% 137.5px, 50% 203.34px, calc(50% + ${QS}px) 137.5px)`,
          BL: `polygon(50% 137.5px, 50% 203.34px, calc(50% - ${QS}px) 137.5px)`,
        }
        return (
          <div style={{
            position: 'absolute', inset: 0,
            background: ACCENT1,
            opacity: 0.18,
            clipPath: fills[activeQuadrant],
            pointerEvents: 'none',
          }} />
        )
      })()}

      {/* ── Quadrant sectors ──────────────────────────────────────────── */}
      {/* TR — no transform */}
      <div style={{ position: 'absolute', left: '50%', top: 71.38, width: QS, height: QS, opacity: qOp('TR'), transition: 'opacity 300ms ease' }}>
        <img alt="" src={IMG_Q_TR} style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' }} />
      </div>
      {/* TL — rotate(180deg) scaleY(-1) */}
      <div style={{ position: 'absolute', left: `calc(50% - ${QS}px)`, top: 71.38, width: QS, height: QS, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: qOp('TL'), transition: 'opacity 300ms ease' }}>
        <img alt="" src={IMG_Q_BLTL} style={{ display: 'block', width: QS, height: QS, transform: 'rotate(180deg) scaleY(-1)' }} />
      </div>
      {/* BL — rotate(180deg) */}
      <div style={{ position: 'absolute', left: `calc(50% - ${QS}px)`, top: 137.06, width: QS, height: QS, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: qOp('BL'), transition: 'opacity 300ms ease' }}>
        <img alt="" src={IMG_Q_BLTL} style={{ display: 'block', width: QS, height: QS, transform: 'rotate(180deg)' }} />
      </div>
      {/* BR — scaleY(-1) */}
      <div style={{ position: 'absolute', left: '50%', top: 137.06, width: QS, height: QS, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: qOp('BR'), transition: 'opacity 300ms ease' }}>
        <img alt="" src={IMG_Q_BR} style={{ display: 'block', width: QS, height: QS, transform: 'scaleY(-1)' }} />
      </div>

      {/* ── Crosshair lines (include orange endpoint dots in the image) ─ */}
      <div style={{ position: 'absolute', left: '50%', top: 66.12, transform: 'translateX(-50%)', width: 10.197, height: 140.688, pointerEvents: 'none' }}>
        <img alt="" src={IMG_CV} style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' }} />
      </div>
      <div style={{ position: 'absolute', left: '50%', top: 131.81, transform: 'translateX(-50%)', width: 142.751, height: 10.789, pointerEvents: 'none' }}>
        <img alt="" src={IMG_CH} style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' }} />
      </div>

      {/* ── Center dot ────────────────────────────────────────────────── */}
      <div style={{ position: 'absolute', left: '50%', top: 131, transform: 'translateX(-50%)', width: 13, height: 13, pointerEvents: 'none' }}>
        <img alt="" src={IMG_DOT} style={{ position: 'absolute', inset: 0, display: 'block', width: '100%', height: '100%' }} />
      </div>

      {/* ── Axis pills ────────────────────────────────────────────────── */}
      {/* Top — yHigh (orange) */}
      <div style={{ ...pillShell, left: '50%', top: 10, transform: 'translateX(-50%)', padding: '10px 25px' }}>
        <div style={pillInset} />
        <span style={{ ...pillText, color: yHighColor, transition: 'color 300ms ease' }}>{p.yHigh}</span>
      </div>
      {/* Bottom — yLow (orange) */}
      <div style={{ ...pillShell, left: '50%', top: 228, transform: 'translateX(-50%)', padding: '10px 25px' }}>
        <div style={pillInset} />
        <span style={{ ...pillText, color: yLowColor, transition: 'color 300ms ease' }}>{p.yLow}</span>
      </div>
      {/* Right — xHigh (blue) */}
      <div style={{ ...pillShell, right: 10, top: '50%', transform: 'translateY(-50%)', padding: '10px 15px' }}>
        <div style={pillInset} />
        <span style={{ ...pillText, color: xHighColor, transition: 'color 300ms ease' }}>{p.xHigh}</span>
      </div>
      {/* Left — xLow (blue) */}
      <div style={{ ...pillShell, left: 10, top: '50%', transform: 'translateY(-50%)', padding: '10px 15px' }}>
        <div style={pillInset} />
        <span style={{ ...pillText, color: xLowColor, transition: 'color 300ms ease' }}>{p.xLow}</span>
      </div>
    </div>
  )
}
