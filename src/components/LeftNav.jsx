import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import PlaylistPanel from './PlaylistPanel'
import ExploreByPanel from './ExploreByPanel'
import SetBuilderPanel from './SetBuilderPanel'
import { usePlaylistStore } from '../store/usePlaylistStore'
import {
  C, NEO_BAR_BG, NEO_BAR_SHADOW, NEO_BAR_EDGE, NEO_TRAY_BG, NEO_TRAY_INSET,
  NEO_BTN_BG, NEO_BTN_HOVER_BG, NEO_BTN_PRESS_BG,
  NEO_BTN_RAISED, NEO_BTN_HOVER, NEO_BTN_PRESS,
  SELECTED,
} from './import/tokens'
import brandmark from '../assets/brandmark.png'
import logo from '../assets/Logo.png'

// Icon rail — floating rounded card (Figma node 799-4821): brand pinned top, nav icons
// centered, profile pinned bottom. The nav icons are raised circles standing off the rail
// surface (NEO_RAIL_*); the active one sinks in and gets an orange ring.
const RAIL_INSET = 10
const RAIL_W = 93
const RAIL_GAP = 10
const RAIL_GUTTER = 7 // extruded-frame width around the inset channel — matches the search bar's 7px gutter
const CIRCLE = 54     // was 60 — trimmed so the buttons sit inside the channel with room for the frame
const GLYPH = 22      // was 25 — icons come down with the buttons
const GAP = 20
const PANEL_W = 374
const PANEL_LEFT = RAIL_INSET + RAIL_W + RAIL_GAP // map card's left edge (113) — panel overlays the map

const RAIL_BG = '#0F0F0F'
const PANEL_BG = '#0F0F0F'
const CARD = '#141416'
const BORDER = '#222224'
const ACCENT = '#F27F37'
const ICON_REST = '#808080'
const FONT = "'DM Sans', system-ui, -apple-system, sans-serif"

// Rail hover micro-interactions (Framer Motion), same recipe as the toolbar glyphs: each button owns the
// trigger via whileHover on the motion.button, and the glyph's own motion sub-elements read the resulting
// "rest"/"hover" variant through context. Everything animated is a transform, so nothing reflows the
// button, and it layers on top of the existing colour/shadow hover + active states rather than replacing
// them. prefers-reduced-motion drops the whileHover entirely (see RailButton), so the transforms never
// fire while the colour hover states stay intact.
const ICON_SPRING = { type: 'spring', stiffness: 400, damping: 15 }

// Recessed well — now only the Set Builder mini-bar's chevron, which lives on the panel rather than the
// rail and so keeps the older pressed-in look. The rail's own buttons moved to the NEO_RAIL_* recipe.
const WELL_SHADOW = 'inset -1px -1px 3px 0px #373737, inset 2px 2px 2px 0px rgba(0,0,0,0.7)'

// The logo/profile PNGs bake the whole button (well + glyph + shadow) onto a canvas with the
// circle slightly inset toward the top-left (shadow padding bottom-right). Given the canvas
// size and the measured circle (width + center), scale so the circle ≈ CIRCLE and offset so the
// circle — not the padded canvas — lines up with the nav circles.
function imageButton(src, canvas, circleW, circleCx) {
  const size = Math.round((CIRCLE * canvas) / circleW)
  const offset = Math.round(CIRCLE / 2 - (circleCx * size) / canvas)
  return { src, size, offset }
}
const BRAND_MEDIA = imageButton(brandmark, 210, 177, 92) // top — product mark
const PROFILE_MEDIA = imageButton(logo, 204, 178, 90) // bottom — profile

// Crate/record-box glyph. Default is grey; active turns Spotify-green with an inner shadow.
function PlaylistsIcon({ active }) {
  const bodyFill = active ? ACCENT : '#808080' // active = accent orange (unified with Flow toggle)
  // The crate body — its inner-shadow filter (active state) wraps only this, never the lid, so the lid can
  // lift past the filter's clip region without being cut off.
  const crateBase = (
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M8.3403 6.9274H16.6602C20.8776 6.9274 22.9876 6.9274 24.1726 8.16113C25.3576 9.39487 25.0776 11.2998 24.5201 15.111L23.9926 18.726C23.5551 21.7147 23.3363 23.2097 22.2151 24.1047C21.0939 24.9997 19.4401 24.9997 16.1314 24.9997H8.86904C5.56159 24.9997 3.90661 24.9997 2.78537 24.1047C1.66414 23.2097 1.44539 21.7147 1.0079 18.726L0.480405 15.111C-0.0783373 11.2998 -0.357084 9.39487 0.8279 8.16113C2.01288 6.9274 4.12285 6.9274 8.3403 6.9274ZM7.50031 19.9997C7.50031 19.4822 7.96655 19.0622 8.54154 19.0622H16.4589C17.0339 19.0622 17.5002 19.4822 17.5002 19.9997C17.5002 20.5172 17.0339 20.9372 16.4589 20.9372H8.54154C7.96655 20.9372 7.50031 20.5172 7.50031 19.9997Z"
      fill={bodyFill}
    />
  )
  // The two stacked slats above the body read as the crate's lid. On hover they lift and tilt back as a
  // unit — "peeking inside." fill-box pins the pivot to the lid's own centre so the tilt reads locally.
  const lid = (
    <motion.g
      style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
      variants={{ rest: { y: 0, rotate: 0 }, hover: { y: -3, rotate: -5 } }}
      transition={ICON_SPRING}
    >
      <path
        opacity="0.4"
        d="M8.13762 0H16.8625C17.1537 0 17.375 1.31548e-07 17.5712 0.0187499C18.9562 0.154998 20.0887 0.987486 20.57 2.10872H4.43018C4.91142 0.987486 6.04515 0.154998 7.43013 0.0187499C7.62388 1.31548e-07 7.84763 0 8.13762 0Z"
        fill="#989898"
      />
      <path
        opacity="0.7"
        d="M5.38766 3.40387C3.65019 3.40387 2.22521 4.45386 1.75021 5.84509L1.72021 5.93258C2.22445 5.78692 2.73936 5.68118 3.26019 5.61634C4.61018 5.44384 6.31765 5.44384 8.30013 5.44384H16.915C18.8975 5.44384 20.605 5.44384 21.9549 5.61634C22.4799 5.68384 22.9974 5.78259 23.4949 5.93258L23.4662 5.84509C22.9912 4.45261 21.5662 3.40387 19.8275 3.40387H5.38766Z"
        fill="#989898"
      />
    </motion.g>
  )

  return (
    <svg width="100%" height="100%" viewBox="0 0 25 25" fill="none" style={{ overflow: 'visible' }} xmlns="http://www.w3.org/2000/svg">
      {active ? (
        <>
          <g filter="url(#filter0_i_748_2167)">{crateBase}</g>
          {lid}
          <defs>
            <filter
              id="filter0_i_748_2167"
              x="0"
              y="0"
              width="26"
              height="25.9997"
              filterUnits="userSpaceOnUse"
              colorInterpolationFilters="sRGB"
            >
              <feFlood floodOpacity="0" result="BackgroundImageFix" />
              <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
              <feColorMatrix
                in="SourceAlpha"
                type="matrix"
                values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                result="hardAlpha"
              />
              <feOffset dx="1" dy="1" />
              <feGaussianBlur stdDeviation="1.5" />
              <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
              <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" />
              <feBlend mode="normal" in2="shape" result="effect1_innerShadow_748_2167" />
            </filter>
          </defs>
        </>
      ) : (
        <>
          {crateBase}
          {lid}
        </>
      )}
    </svg>
  )
}

// Linked-nodes glyph — two node dots joined by an S-curve wire. Default grey; active turns orange with
// an inner shadow. Exported so the Flow toggle knob can reuse the exact Set Builder rail icon. Pass
// `color` to render a plain, fully-connected static glyph (no gap, no motion, no active filter) — the
// Flow toggle uses this for the dark glyph on its orange ON knob.
//
// Rebuilt from the original single combined path into separate elements so the wire can connect on hover:
// the wire is a stroked path (matched to the original's stroke weight 2.14 and S-curve via quadratic
// corners), and the two nodes are r5.25 circles at the original centres. Rest appearance matches the old
// glyph except that the wire now stops ~3px short of the right node — the "disconnected" state.
export function SetCreationIcon({ active, color }) {
  const glyphColor = color || (active ? '#F27F37' : '#808080')
  // Wire centreline: emerges from the left node (start tucked at x8, inside it), sweeps up through the
  // x=15 bend, and runs to the right node's edge (19.5, 5.25). Quadratic controls at the original sharp
  // corners give the broad rounded turns of the source art.
  const WIRE_D = 'M8 15.75 L11.79 15.75 Q15 15.75 15 12.6 L15 8.4 Q15 5.25 18.21 5.25 L19.5 5.25'
  const STROKE_W = 2.14
  const wireProps = { stroke: glyphColor, strokeWidth: STROKE_W, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }

  // Flow toggle: static, fully-connected glyph — unchanged from the original's look.
  if (color) {
    return (
      <svg width="100%" height="100%" viewBox="0 0 30 21" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d={WIRE_D} {...wireProps} />
        <circle cx="5.25" cy="15.75" r="5.25" fill={glyphColor} />
        <circle cx="24.75" cy="5.25" r="5.25" fill={glyphColor} />
      </svg>
    )
  }

  // Rail glyph. At rest the wire only reaches ~halfway to the right node — it stops around the top of the
  // vertical with an upward hook, a big obvious "disconnected" gap (strokeDashoffset 0.48 hides the last
  // ~48% of the path, near the right node). On hover it draws that whole stretch to the node over ~300ms
  // (offset → 0) and, once it has arrived, the right node fires one scale pulse — a "connection made"
  // beat (delay ≈ the wire's travel time so it lands on arrival, not at the start of hover). The wire
  // sits under the nodes, so its tucked start (inside the left node) and its arrival under the right
  // node's edge stay hidden — which also masks the spring's tiny dashoffset overshoot at either end.
  // pathLength=1 normalises the dash maths to the path's own length regardless of its geometry.
  const content = (
    <>
      {/* The glyph inherits its rest/hover variant from the button (so hover draws the wire). When Set
          Builder mode is ACTIVE the BUTTON is pinned to the "hover" variant (see RailButton's
          pinActiveHover) — the wire stays connected the whole time and the node fires its one pulse.
          Clicking OUT drops the button back to "rest", so the wire RETRACTS along the same spring: a
          clean reverse of the connect draw. Nothing here sets its own `animate`, or hover would stop
          propagating from the button. */}
      <motion.path
        d={WIRE_D} {...wireProps}
        pathLength="1" strokeDasharray="1 1"
        variants={{ rest: { strokeDashoffset: 0.48 }, hover: { strokeDashoffset: 0 } }}
        transition={{ type: 'spring', duration: 0.42, bounce: 0.12 }}
      />
      <circle cx="5.25" cy="15.75" r="5.25" fill={glyphColor} />
      <motion.circle
        cx="24.75" cy="5.25" r="5.25" fill={glyphColor}
        style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        variants={{ rest: { scale: 1 }, hover: { scale: [1, 1.15, 1] } }}
        transition={{ duration: 0.32, delay: 0.25, ease: 'easeOut' }}
      />
    </>
  )

  return (
    <svg width="100%" height="100%" viewBox="0 0 30 21" fill="none" style={{ overflow: 'visible' }} xmlns="http://www.w3.org/2000/svg">
      {active ? (
        <>
          <g filter="url(#filter0_i_799_4817)">{content}</g>
          <defs>
            {/* Region widened from the source (0,0,31,22) so the right node's hover pulse can't clip. */}
            <filter
              id="filter0_i_799_4817"
              x="-3"
              y="-3"
              width="37"
              height="28"
              filterUnits="userSpaceOnUse"
              colorInterpolationFilters="sRGB"
            >
              <feFlood floodOpacity="0" result="BackgroundImageFix" />
              <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
              <feColorMatrix
                in="SourceAlpha"
                type="matrix"
                values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                result="hardAlpha"
              />
              <feOffset dx="1" dy="1" />
              <feGaussianBlur stdDeviation="1.5" />
              <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
              <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" />
              <feBlend mode="normal" in2="shape" result="effect1_innerShadow_799_4817" />
            </filter>
          </defs>
        </>
      ) : (
        content
      )}
    </svg>
  )
}

// Filter/sliders glyph — three tracks, each with a round handle. Default grey; active turns orange with
// an inner shadow.
//
// Rebuilt from the original single combined path into separate elements so each handle can move on its
// own: three full-width track lines (stroke weight 1.89, round caps, matched to the source) with three
// r3.68 handle circles at the original knob centres, drawn on top. At rest it matches the old glyph (the
// handles cover the tracks exactly where the source had its knobs); on slide the continuous track shows
// through behind them.
function ExploreIcon({ active }) {
  const glyphColor = active ? '#F27F37' : '#808080'
  const TRACK_W = 1.89
  const R = 3.6797
  const ROWS = [3.6797, 11.9937, 20.3203] // track centre-lines / handle rows
  // On hover the handles slide horizontally by different amounts, started ~50ms apart (top → middle →
  // bottom) so they ripple rather than move in unison, then spring back together on leave.
  const HANDLES = [
    { cx: 17.4624, cy: 3.6797, dx: 3, delay: 0 },
    { cx: 5.89998, cy: 11.9937, dx: -2, delay: 0.05 },
    { cx: 14.15, cy: 20.3203, dx: 4, delay: 0.1 },
  ]
  const content = (
    <>
      {ROWS.map((y, i) => (
        <line key={`t${i}`} x1="0.945" y1={y} x2="24.055" y2={y} stroke={glyphColor} strokeWidth={TRACK_W} strokeLinecap="round" />
      ))}
      {HANDLES.map((h, i) => (
        <motion.circle
          key={`h${i}`}
          cx={h.cx} cy={h.cy} r={R} fill={glyphColor}
          variants={{ rest: { x: 0 }, hover: { x: h.dx, transition: { ...ICON_SPRING, delay: h.delay } } }}
          transition={ICON_SPRING}
        />
      ))}
    </>
  )
  return (
    <svg width="100%" height="100%" viewBox="0 0 25 24" fill="none" style={{ overflow: 'visible' }} xmlns="http://www.w3.org/2000/svg">
      {active ? (
        <>
          <g filter="url(#filter0_i_748_2340)">{content}</g>
          <defs>
            <filter
              id="filter0_i_748_2340"
              x="0"
              y="0"
              width="26"
              height="25"
              filterUnits="userSpaceOnUse"
              colorInterpolationFilters="sRGB"
            >
              <feFlood floodOpacity="0" result="BackgroundImageFix" />
              <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
              <feColorMatrix
                in="SourceAlpha"
                type="matrix"
                values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                result="hardAlpha"
              />
              <feOffset dx="1" dy="1" />
              <feGaussianBlur stdDeviation="1" />
              <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1" />
              <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" />
              <feBlend mode="normal" in2="shape" result="effect1_innerShadow_748_2340" />
            </filter>
          </defs>
        </>
      ) : (
        content
      )}
    </svg>
  )
}

const NAV_ITEMS = [
  { id: 'playlists', label: 'Playlists', Icon: PlaylistsIcon },
  { id: 'sets', label: 'Set Creation', Icon: SetCreationIcon },
  { id: 'explore', label: 'Explore By', Icon: ExploreIcon },
]

// Circular icon button. Two modes:
//  • media: a pre-rendered glass-button PNG (logo / profile) — static, no active/hover states.
//  • default: recessed well with an orange active ring and a glyph that brightens on hover.
function RailButton({ label, Icon, isActive, onClick, media, pinActiveHover }) {
  const [hover, setHover] = useState(false)
  // After a click the pointer is still over the button, so whileHover would keep the glyph pinned to its
  // "hover" (open) state — meaning clicking an ACTIVE icon to close its panel leaves the glyph open until
  // the mouse moves away (e.g. the library crate lid not closing). We suppress hover from the moment of a
  // click until the pointer LEAVES, so the close animation wins; a fresh hover later still previews.
  const [suppressHover, setSuppressHover] = useState(false)
  // Reduced motion drops the whileHover trigger so the glyph transforms never fire; the colour/shadow
  // hover state below (driven by the `hover` flag) is unaffected.
  const reduce = useReducedMotion()

  // Pre-rendered button image (well + glyph + shadow baked in) — render the bitmap directly,
  // recentered on its circle so it aligns with the other buttons.
  if (media) {
    return (
      <button
        title={label}
        onClick={onClick}
        style={{
          width: CIRCLE,
          height: CIRCLE,
          padding: 0,
          border: 'none',
          background: 'transparent',
          flexShrink: 0,
          position: 'relative',
          overflow: 'visible',
          cursor: onClick ? 'pointer' : 'default',
        }}
      >
        <img
          src={media.src}
          alt={label}
          draggable={false}
          style={{
            position: 'absolute',
            width: media.size,
            height: media.size,
            maxWidth: 'none', // override Tailwind preflight's img { max-width: 100% }, which squeezed it
            objectFit: 'contain', // keep the source's 1:1 ratio — a perfect circle, never an oval
            left: media.offset,
            top: media.offset,
            display: 'block',
            pointerEvents: 'none',
          }}
        />
      </button>
    )
  }

  const style = {
    width: CIRCLE,
    height: CIRCLE,
    padding: 0,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    cursor: onClick ? 'pointer' : 'default',
    color: ICON_REST,
    transition: 'color 150ms ease, background 150ms ease, box-shadow 150ms ease',
  }

  // Same button as the toolbar's map controls (NEO_BTN_*): now that the rail buttons sit in an inset
  // channel like the toolbar's tray, they take the tray-button recipe — an outer dark drop + inner bevel
  // (no outer light glow), lifting on hover and sinking to the accent-ringed press while its panel is
  // open. Matches the toolbar's rest / hover / pressed states one-to-one.
  style.background = NEO_BTN_BG
  style.boxShadow = NEO_BTN_RAISED
  if (isActive) {
    style.background = NEO_BTN_PRESS_BG
    style.boxShadow = `inset 0 0 0 1.5px ${SELECTED.border}, ${NEO_BTN_PRESS}`
    style.color = '#FFFFFF'
  } else if (hover && onClick) {
    style.background = NEO_BTN_HOVER_BG
    style.boxShadow = NEO_BTN_HOVER
    style.color = '#CFCFCF'
  }

  // The glyph's open ("hover") vs closed ("rest") variant, driven through `animate` from our OWN hover
  // state rather than framer's whileHover gesture. That gesture is the whole reason the crate lid used to
  // stick open: framer applies/removes whileHover only on pointerenter/leave, so flipping the prop while
  // the pointer already sits on the icon does NOT drop the variant until you move off and back. Deriving
  // the variant from `hover` (tracked via onMouseEnter/Leave) re-evaluates on every render, so a panel
  // close animates the glyph shut immediately even under the still-hovering cursor.
  //  • pinActiveHover + isActive → open the whole time the panel is open.
  //  • hover (and not just-clicked, not reduced-motion) → the inactive-icon peek preview.
  // suppressHover is set on click and cleared on pointer-leave, so clicking to close doesn't re-open as a
  // hover preview; a fresh hover later still previews.
  const open = (pinActiveHover && isActive) || (hover && !suppressHover && !reduce)

  return (
    // motion.button only carries the "rest"/"hover" variant context that the glyph reads; its own
    // background/shadow/colour stay pure inline style, so the raised/hover/active neomorphic states and
    // the orange active ring are untouched — the glyph animation layers on top and works on any button
    // whether or not its panel is the active one.
    <motion.button
      title={label}
      onClick={(e) => { setSuppressHover(true); onClick?.(e) }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setSuppressHover(false) }}
      initial="rest"
      animate={open ? 'hover' : 'rest'}
      style={style}
    >
      <span style={{ width: GLYPH, height: GLYPH, display: 'flex' }}>
        <Icon active={isActive} />
      </span>
    </motion.button>
  )
}

// Collapsed Set Builder — a thin bottom tab (Slice 9 final #5). Clicking anywhere re-expands the
// panel, giving the user the whole map while staying in build mode.
function SetBuilderMiniBar({ onExpand }) {
  return (
    <button
      onClick={onExpand}
      title="Expand Set Builder"
      style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'none', border: 'none', padding: '0 6px', cursor: 'pointer',
      }}
    >
      <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 600, color: '#fff' }}>Set Builder</span>
      <span style={{ width: 30, height: 30, borderRadius: '50%', background: CARD, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: WELL_SHADOW }}>
        {/* chevron up = expand */}
        <svg width="12" height="8" viewBox="0 0 12 8" fill="none" style={{ transform: 'rotate(180deg)' }}>
          <path d="M1 1.5L6 6L11 1.5" stroke={ACCENT} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  )
}

export default function LeftNav() {
  const { activePanel, togglePanel, setBuilderMinimized, toggleSetBuilderMinimized } = usePlaylistStore()

  const panel = NAV_ITEMS.find((p) => p.id === activePanel)
  const minimized = activePanel === 'sets' && setBuilderMinimized

  return (
    <>
      {/* Floating icon rail — now built like the search bar (Figma 925:49): an extruded outer slab
          (NEO_BAR_BG raised on NEO_BAR_SHADOW) framing an inset channel (NEO_TRAY_BG + NEO_TRAY_INSET)
          that the buttons stand out of, with the RAIL_GUTTER reading as the raised border between them.
          box-sizing:border-box keeps the outer footprint at RAIL_W, so PANEL_LEFT (the panel offset) is
          unchanged. The slab is the lighter NEO_BAR_BG now — it's the raised frame, not the dark ground;
          the buttons' NEO_RAIL_* recipe now reads against the channel floor (NEO_TRAY_BG), which is a hair
          off the old RAIL_BG and keeps them popping out of the well. */}
      <div
        style={{
          position: 'fixed',
          left: RAIL_INSET,
          top: RAIL_INSET,
          bottom: RAIL_INSET,
          width: RAIL_W,
          boxSizing: 'border-box',
          padding: RAIL_GUTTER,
          background: NEO_BAR_BG,
          borderRadius: 999, // fully rounded (capsule) ends
          boxShadow: NEO_BAR_SHADOW,
          zIndex: 20,
        }}
      >
        {/* Inset channel — the recessed well carved into the slab; the buttons rise out of this floor. */}
        <div
          style={{
            width: '100%',
            height: '100%',
            boxSizing: 'border-box',
            background: NEO_TRAY_BG,
            borderRadius: 999,
            boxShadow: NEO_TRAY_INSET,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 0',
          }}
        >
          {/* Brand mark (top) — pre-rendered glass button bitmap */}
          <RailButton label="Drift" media={BRAND_MEDIA} />

          {/* Nav icons (centered) */}
          <nav style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: GAP }}>
            {NAV_ITEMS.map((item) => (
              <RailButton
                key={item.id}
                label={item.label}
                Icon={item.Icon}
                isActive={activePanel === item.id}
                onClick={() => togglePanel(item.id)}
                pinActiveHover
              />
            ))}
          </nav>

          {/* Profile (bottom) — pre-rendered glass button bitmap */}
          <RailButton label="Profile" media={PROFILE_MEDIA} onClick={() => {}} />
        </div>

        {/* Raised-slab inner rim — faint top-left highlight + bottom-right inner shade (no border), the
            same overlay the search bar and toolbar use. Rides above the channel so it's never clipped,
            and pointerEvents:none keeps it off the buttons. */}
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit',
          boxShadow: NEO_BAR_EDGE,
          pointerEvents: 'none',
        }} />
      </div>

      {/* Slide-out panel — floating card overlaying the map's left edge. When the Set Builder is
          minimized (#5) it shrinks to a thin bottom tab so the map is fully visible. */}
      <div
        aria-hidden={activePanel === null}
        style={{
          position: 'fixed',
          left: PANEL_LEFT,
          top: minimized ? 'auto' : RAIL_INSET,
          bottom: RAIL_INSET,
          height: minimized ? 60 : undefined,
          width: PANEL_W,
          background: PANEL_BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 20,
          boxShadow: '4px 4px 5px 0px rgba(0,0,0,0.5)',
          zIndex: 15,
          transform: activePanel ? 'translateX(0)' : `translateX(-${PANEL_LEFT + PANEL_W}px)`,
          transition: 'transform 300ms ease-out',
          pointerEvents: activePanel ? 'auto' : 'none',
          display: 'flex',
          flexDirection: 'column',
          padding: minimized ? '0 16px' : '28px 22px',
        }}
      >
        {minimized ? (
          <SetBuilderMiniBar onExpand={toggleSetBuilderMinimized} />
        ) : panel && panel.id === 'explore' ? (
          <ExploreByPanel />
        ) : panel && panel.id === 'sets' ? (
          <SetBuilderPanel />
        ) : panel && panel.id === 'playlists' ? (
          <PlaylistPanel />
        ) : panel ? (
          <>
            <div
              style={{
                fontFamily: FONT,
                fontSize: 9,
                letterSpacing: '0.20em',
                color: C.textSecondary,
                marginBottom: 20,
                textTransform: 'uppercase',
              }}
            >
              {panel.label}
            </div>
            <div
              style={{
                fontFamily: FONT,
                fontSize: 10,
                letterSpacing: '0.06em',
                color: C.textSecondary,
              }}
            >
              Coming soon
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}
