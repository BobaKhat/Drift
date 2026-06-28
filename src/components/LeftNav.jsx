import { useState } from 'react'
import PlaylistPanel from './PlaylistPanel'
import brandmark from '../assets/brandmark.png'
import logo from '../assets/Logo.png'

// Icon rail — floating rounded card (Figma node 799-4821): brand pinned top, nav icons
// centered, profile pinned bottom. Icons are recessed circles; the active one gets an
// orange ring.
const RAIL_INSET = 10
const RAIL_W = 93
const RAIL_GAP = 10
const CIRCLE = 60
const GLYPH = 25
const GAP = 20
const PANEL_W = 320
const PANEL_LEFT = RAIL_INSET + RAIL_W + RAIL_GAP // map card's left edge (113) — panel overlays the map

const RAIL_BG = '#0F0F0F'
const PANEL_BG = '#0F0F0F'
const CARD = '#141416'
const BORDER = '#222224'
const ACCENT = '#F27F37'
const ICON_REST = '#808080'
const FONT = "'DM Sans', system-ui, -apple-system, sans-serif"

// Recessed well — the three nav icons (pressed-in look). The top (logo) and bottom (profile)
// buttons instead use pre-rendered glass-button PNGs (see imageButton below).
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
  const bodyFill = active ? '#1ED760' : '#808080'
  const body = (
    <>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.3403 6.9274H16.6602C20.8776 6.9274 22.9876 6.9274 24.1726 8.16113C25.3576 9.39487 25.0776 11.2998 24.5201 15.111L23.9926 18.726C23.5551 21.7147 23.3363 23.2097 22.2151 24.1047C21.0939 24.9997 19.4401 24.9997 16.1314 24.9997H8.86904C5.56159 24.9997 3.90661 24.9997 2.78537 24.1047C1.66414 23.2097 1.44539 21.7147 1.0079 18.726L0.480405 15.111C-0.0783373 11.2998 -0.357084 9.39487 0.8279 8.16113C2.01288 6.9274 4.12285 6.9274 8.3403 6.9274ZM7.50031 19.9997C7.50031 19.4822 7.96655 19.0622 8.54154 19.0622H16.4589C17.0339 19.0622 17.5002 19.4822 17.5002 19.9997C17.5002 20.5172 17.0339 20.9372 16.4589 20.9372H8.54154C7.96655 20.9372 7.50031 20.5172 7.50031 19.9997Z"
        fill={bodyFill}
      />
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
    </>
  )

  return (
    <svg width="100%" height="100%" viewBox="0 0 25 25" fill="none" xmlns="http://www.w3.org/2000/svg">
      {active ? (
        <>
          <g filter="url(#filter0_i_748_2167)">{body}</g>
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
        body
      )}
    </svg>
  )
}

// Linked-nodes glyph. Default grey; active turns orange with an inner shadow.
function SetCreationIcon({ active }) {
  const d =
    'M19.3932 6.30001H18.2145C17.6462 6.30001 17.1011 6.52125 16.6992 6.91508C16.2973 7.30891 16.0715 7.84305 16.0715 8.4V12.6C16.0715 13.7139 15.6199 14.7822 14.8162 15.5698C14.0124 16.3575 12.9222 16.8 11.7855 16.8H10.6068C10.3413 18.0747 9.60219 19.2075 8.53283 19.9785C7.46346 20.7496 6.14001 21.1042 4.81905 20.9734C3.4981 20.8426 2.27374 20.2359 1.38336 19.2708C0.492979 18.3057 0 17.051 0 15.75C0 14.449 0.492979 13.1943 1.38336 12.2292C2.27374 11.2641 3.4981 10.6574 4.81905 10.5266C6.14001 10.3958 7.46346 10.7504 8.53283 11.5214C9.60219 12.2925 10.3413 13.4253 10.6068 14.7H11.7855C12.3538 14.7 12.8989 14.4787 13.3008 14.0849C13.7027 13.6911 13.9285 13.157 13.9285 12.6V8.4C13.9285 7.28609 14.3801 6.21781 15.1838 5.43016C15.9876 4.64251 17.0778 4.20001 18.2145 4.20001H19.3932C19.6587 2.92526 20.3978 1.79255 21.4672 1.02145C22.5365 0.250362 23.86 -0.104168 25.1809 0.026597C26.5019 0.157362 27.7263 0.764107 28.6166 1.7292C29.507 2.69429 30 3.94898 30 5.25001C30 6.55104 29.507 7.80572 28.6166 8.77081C27.7263 9.73591 26.5019 10.3427 25.1809 10.4734C23.86 10.6042 22.5365 10.2497 21.4672 9.47856C20.3978 8.70747 19.6587 7.57475 19.3932 6.30001Z'

  return (
    <svg width="100%" height="100%" viewBox="0 0 30 21" fill="none" xmlns="http://www.w3.org/2000/svg">
      {active ? (
        <>
          <g filter="url(#filter0_i_799_4817)">
            <path d={d} fill="#F27F37" />
          </g>
          <defs>
            <filter
              id="filter0_i_799_4817"
              x="0"
              y="0"
              width="31"
              height="22"
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
        <path d={d} fill="#808080" />
      )}
    </svg>
  )
}

// Filter/sliders glyph. Default grey; active turns blue with an inner shadow.
function ExploreIcon({ active }) {
  const d =
    'M24.9999 20.3203C24.9999 20.5709 24.9011 20.8112 24.7253 20.9884C24.5495 21.1656 24.3111 21.2651 24.0624 21.2651H17.6874C17.4786 22.0498 17.0188 22.7431 16.3792 23.2375C15.7396 23.732 14.9561 24 14.15 24C13.3438 24 12.5603 23.732 11.9207 23.2375C11.2811 22.7431 10.8213 22.0498 10.6125 21.2651H0.937497C0.688857 21.2651 0.450401 21.1656 0.274586 20.9884C0.0987716 20.8112 0 20.5709 0 20.3203C0 20.0698 0.0987716 19.8295 0.274586 19.6523C0.450401 19.4751 0.688857 19.3756 0.937497 19.3756H10.6125C10.8213 18.5909 11.2811 17.8976 11.9207 17.4032C12.5603 16.9087 13.3438 16.6407 14.15 16.6407C14.9561 16.6407 15.7396 16.9087 16.3792 17.4032C17.0188 17.8976 17.4786 18.5909 17.6874 19.3756H24.0624C24.3111 19.3756 24.5495 19.4751 24.7253 19.6523C24.9011 19.8295 24.9999 20.0698 24.9999 20.3203ZM24.9999 3.67966C24.9999 3.93023 24.9011 4.17054 24.7253 4.34772C24.5495 4.5249 24.3111 4.62444 24.0624 4.62444H20.9999C20.7911 5.40908 20.3313 6.10238 19.6917 6.59684C19.0521 7.09131 18.2685 7.35932 17.4624 7.35932C16.6563 7.35932 15.8727 7.09131 15.2332 6.59684C14.5936 6.10238 14.1338 5.40908 13.925 4.62444H0.937497C0.814383 4.62444 0.692475 4.6 0.578732 4.55252C0.46499 4.50504 0.361641 4.43545 0.274586 4.34772C0.187532 4.25999 0.118476 4.15584 0.0713626 4.04121C0.024249 3.92659 0 3.80373 0 3.67966C0 3.55559 0.024249 3.43274 0.0713626 3.31811C0.118476 3.20348 0.187532 3.09933 0.274586 3.0116C0.361641 2.92387 0.46499 2.85428 0.578732 2.8068C0.692475 2.75932 0.814383 2.73488 0.937497 2.73488H13.925C14.1338 1.95024 14.5936 1.25694 15.2332 0.762478C15.8727 0.26801 16.6563 0 17.4624 0C18.2685 0 19.0521 0.26801 19.6917 0.762478C20.3313 1.25694 20.7911 1.95024 20.9999 2.73488H24.0624C24.186 2.73319 24.3087 2.75647 24.4232 2.80335C24.5377 2.85023 24.6417 2.91976 24.7291 3.00783C24.8165 3.0959 24.8855 3.20072 24.932 3.31611C24.9785 3.43151 25.0016 3.55512 24.9999 3.67966ZM24.9999 11.9937C25.0016 12.1182 24.9785 12.2419 24.932 12.3572C24.8855 12.4726 24.8165 12.5775 24.7291 12.6655C24.6417 12.7536 24.5377 12.8231 24.4232 12.87C24.3087 12.9169 24.186 12.9402 24.0624 12.9385H9.43747C9.22867 13.7231 8.76883 14.4164 8.12925 14.9109C7.48967 15.4054 6.70608 15.6734 5.89998 15.6734C5.09388 15.6734 4.31029 15.4054 3.67071 14.9109C3.03113 14.4164 2.57129 13.7231 2.36249 12.9385H0.937497C0.688857 12.9385 0.450401 12.8389 0.274586 12.6618C0.0987716 12.4846 0 12.2443 0 11.9937C0 11.7431 0.0987716 11.5028 0.274586 11.3256C0.450401 11.1485 0.688857 11.0489 0.937497 11.0489H2.36249C2.57129 10.2643 3.03113 9.57099 3.67071 9.07652C4.31029 8.58205 5.09388 8.31404 5.89998 8.31404C6.70608 8.31404 7.48967 8.58205 8.12925 9.07652C8.76883 9.57099 9.22867 10.2643 9.43747 11.0489H24.0624C24.3111 11.0489 24.5495 11.1485 24.7253 11.3256C24.9011 11.5028 24.9999 11.7431 24.9999 11.9937Z'

  return (
    <svg width="100%" height="100%" viewBox="0 0 25 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {active ? (
        <>
          <g filter="url(#filter0_i_748_2340)">
            <path d={d} fill="#4B6AE5" />
          </g>
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
        <path d={d} fill="#808080" />
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
function RailButton({ label, Icon, isActive, onClick, media }) {
  const [hover, setHover] = useState(false)

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
    border: '1px solid transparent',
    color: ICON_REST,
    transition: 'color 160ms ease, background 160ms ease, border-color 160ms ease, box-shadow 160ms ease',
  }

  style.background = CARD
  style.boxShadow = WELL_SHADOW
  if (isActive) {
    style.background = 'rgba(20,20,22,0.2)'
    style.border = `1px solid ${ACCENT}`
    style.boxShadow = '4px 4px 5px 0px rgba(0,0,0,0.5)'
    style.color = '#FFFFFF'
  } else if (hover && onClick) {
    style.color = '#CFCFCF'
  }

  return (
    <button
      title={label}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={style}
    >
      <span style={{ width: GLYPH, height: GLYPH, display: 'flex' }}>
        <Icon active={isActive} />
      </span>
    </button>
  )
}

export default function LeftNav() {
  const [activePanel, setActivePanel] = useState(null)

  function toggle(id) {
    setActivePanel((prev) => (prev === id ? null : id))
  }

  const panel = NAV_ITEMS.find((p) => p.id === activePanel)

  return (
    <>
      {/* Floating icon rail */}
      <div
        style={{
          position: 'fixed',
          left: RAIL_INSET,
          top: RAIL_INSET,
          bottom: RAIL_INSET,
          width: RAIL_W,
          background: RAIL_BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 20,
          boxShadow: '4px 4px 5px 0px rgba(0,0,0,0.6), inset 3px 2px 5px 0px #373737',
          zIndex: 20,
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
              onClick={() => toggle(item.id)}
            />
          ))}
        </nav>

        {/* Profile (bottom) — pre-rendered glass button bitmap */}
        <RailButton label="Profile" media={PROFILE_MEDIA} onClick={() => {}} />
      </div>

      {/* Slide-out panel — floating card overlaying the map's left edge */}
      <div
        aria-hidden={activePanel === null}
        style={{
          position: 'fixed',
          left: PANEL_LEFT,
          top: RAIL_INSET,
          bottom: RAIL_INSET,
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
          padding: '28px 22px',
        }}
      >
        {panel && (
          <>
            <div
              style={{
                fontFamily: FONT,
                fontSize: 9,
                letterSpacing: '0.20em',
                color: 'rgba(255,255,255,0.40)',
                marginBottom: 20,
                textTransform: 'uppercase',
              }}
            >
              {panel.label}
            </div>
            {panel.id === 'playlists' ? (
              <PlaylistPanel />
            ) : (
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: 10,
                  letterSpacing: '0.06em',
                  color: 'rgba(255,255,255,0.18)',
                }}
              >
                Coming soon
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
