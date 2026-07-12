import { PRESETS } from '../lib/presets'
import { usePlaylistStore } from '../store/usePlaylistStore'

const FONT    = "'DM Sans', system-ui, -apple-system, sans-serif"
const ACCENT1 = '#F27F37'
const ACCENT2 = '#4B6AE5'

// The compass is drawn as inline SVG + CSS (see the render). It used to reference Figma MCP asset
// URLs (https://www.figma.com/api/mcp/asset/…), but those are temporary and expire — once dead every
// <img> 404'd, showing broken-image icons + white boxes where the crosshair/rings should be. Self-
// contained rendering keeps the compass alive forever.
const BRACKET = '1.5px solid rgba(255,255,255,0.25)' // corner HUD L-shape
const sectorTrans = { transition: 'opacity 300ms ease' }

// Quadrant sector size (matches the active-quadrant highlight geometry: 66.283px arm from centre).
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
// 12px in both mounts (Explore By panel + map toolbar) so the two compasses read as one component
// at one scale — the toolbar copy used to render its pills at 14.
const pillText = {
  fontFamily: FONT, fontSize: 12, fontWeight: 510,
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

      {/* ── Corner brackets (CSS L-shapes; self-contained) ────────────── */}
      {[
        { k: 'tl', s: { left: 20, top: 20, borderTop: BRACKET, borderLeft: BRACKET, borderTopLeftRadius: 3 } },
        { k: 'tr', s: { right: 20, top: 20, borderTop: BRACKET, borderRight: BRACKET, borderTopRightRadius: 3 } },
        { k: 'bl', s: { left: 20, bottom: 20, borderBottom: BRACKET, borderLeft: BRACKET, borderBottomLeftRadius: 3 } },
        { k: 'br', s: { right: 20, bottom: 20, borderBottom: BRACKET, borderRight: BRACKET, borderBottomRightRadius: 3 } },
      ].map(({ k, s }) => (
        <div key={k} style={{ position: 'absolute', width: 20, height: 20, pointerEvents: 'none', ...s }} />
      ))}

      {/* ── Radar dial: quadrant sectors, concentric rings, crosshair, endpoint dots, centre dot ──
          All inline SVG so the compass never depends on external (expiring) image assets. Centred on
          the dial's centre (50%, 137.5px); viewBox units == px. */}
      <svg
        viewBox="-85 -85 170 170" width="170" height="170"
        style={{ position: 'absolute', left: '50%', top: 137.5, transform: 'translate(-50%, -50%)', pointerEvents: 'none', overflow: 'visible' }}
      >
        {/* Quadrant sectors — faint fill inside the diamond; dim when another quadrant is active */}
        <path d="M0 0 L0 -66 L66 0 Z"  fill="rgba(255,255,255,0.035)" opacity={qOp('TR')} style={sectorTrans} />
        <path d="M0 0 L66 0 L0 66 Z"   fill="rgba(255,255,255,0.035)" opacity={qOp('BR')} style={sectorTrans} />
        <path d="M0 0 L0 66 L-66 0 Z"  fill="rgba(255,255,255,0.035)" opacity={qOp('BL')} style={sectorTrans} />
        <path d="M0 0 L-66 0 L0 -66 Z" fill="rgba(255,255,255,0.035)" opacity={qOp('TL')} style={sectorTrans} />
        {/* Concentric rings */}
        <circle r="26" fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth="1" />
        <circle r="51" fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="1" />
        <circle r="77" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
        {/* Diamond connecting the four poles */}
        <polygon points="0,-66 66,0 0,66 -66,0" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
        {/* Crosshair arms (extend just past the poles) */}
        <line x1="0" y1="-70" x2="0" y2="70" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
        <line x1="-70" y1="0" x2="70" y2="0" stroke="rgba(255,255,255,0.22)" strokeWidth="1" />
        {/* Pole dots (bullseye: colored ring + centre) — energy poles orange, mood poles blue */}
        {[
          { cx: 0, cy: -66, c: ACCENT1 },
          { cx: 0, cy: 66, c: ACCENT1 },
          { cx: -66, cy: 0, c: ACCENT2 },
          { cx: 66, cy: 0, c: ACCENT2 },
        ].map(({ cx, cy, c }, i) => (
          <g key={i}>
            <circle cx={cx} cy={cy} r="4.6" fill="#141415" stroke={c} strokeWidth="1.4" />
            <circle cx={cx} cy={cy} r="1.8" fill={c} />
          </g>
        ))}
        {/* Centre bullseye */}
        <circle r="5.5" fill="#141415" stroke={ACCENT1} strokeWidth="1.4" />
        <circle r="2.2" fill={ACCENT1} />
      </svg>

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
