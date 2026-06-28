import { useState } from 'react'
import PlaylistPanel from './PlaylistPanel'

const RAIL_W = 50
const PANEL_W = 320
const RAIL_BG = '#141414'
const PANEL_BG = '#111111'
const ACCENT = '#e8631a'
const MONO = '"Space Mono", "B612 Mono", "Courier New", monospace'

function PlaylistsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1.5" y="1.5" width="6" height="6" rx="1.5" fill="currentColor" />
      <rect x="10.5" y="1.5" width="6" height="6" rx="1.5" fill="currentColor" />
      <rect x="1.5" y="10.5" width="6" height="6" rx="1.5" fill="currentColor" />
      <rect x="10.5" y="10.5" width="6" height="6" rx="1.5" fill="currentColor" />
    </svg>
  )
}

function SetCreationIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="4" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="14" cy="4" r="2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="14" cy="14" r="2" stroke="currentColor" strokeWidth="1.4" />
      <line x1="6.4" y1="7.9" x2="12.1" y2="5.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="6.4" y1="10.1" x2="12.1" y2="12.7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function ExploreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="2" y1="5" x2="16" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="2" y1="9" x2="16" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="2" y1="13" x2="16" y2="13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="6" cy="5" r="2" fill={RAIL_BG} stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="9" r="2" fill={RAIL_BG} stroke="currentColor" strokeWidth="1.5" />
      <circle cx="7" cy="13" r="2" fill={RAIL_BG} stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function ProfileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="9" cy="6.5" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 16c0-3.59 2.91-6.5 6.5-6.5s6.5 2.91 6.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

const NAV_ITEMS = [
  { id: 'playlists', label: 'Playlists', Icon: PlaylistsIcon },
  { id: 'sets', label: 'Set Creation', Icon: SetCreationIcon },
  { id: 'explore', label: 'Explore By', Icon: ExploreIcon },
]

function RailButton({ label, Icon, isActive, onClick }) {
  return (
    <button
      title={label}
      onClick={onClick}
      style={{
        position: 'relative',
        width: RAIL_W,
        height: 44,
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: isActive ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.32)',
        transition: 'color 200ms ease',
        flexShrink: 0,
      }}
    >
      {isActive && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 3,
            height: 20,
            background: ACCENT,
            borderRadius: '0 2px 2px 0',
          }}
        />
      )}
      <Icon />
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
      {/* Icon rail */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          width: RAIL_W,
          background: RAIL_BG,
          borderRight: '1px solid rgba(255,255,255,0.06)',
          zIndex: 20,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          paddingTop: 16,
          paddingBottom: 16,
        }}
      >
        {/* Top nav icons */}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 4 }}>
          {NAV_ITEMS.map((item) => (
            <RailButton
              key={item.id}
              label={item.label}
              Icon={item.Icon}
              isActive={activePanel === item.id}
              onClick={() => toggle(item.id)}
            />
          ))}
        </div>

        {/* Profile pinned to bottom */}
        <RailButton
          label="Profile"
          Icon={ProfileIcon}
          isActive={false}
          onClick={() => {}}
        />
      </div>

      {/* Slide-out panel */}
      <div
        aria-hidden={activePanel === null}
        style={{
          position: 'fixed',
          left: RAIL_W,
          top: 0,
          bottom: 0,
          width: PANEL_W,
          background: PANEL_BG,
          borderRight: '1px solid rgba(255,255,255,0.08)',
          zIndex: 19,
          transform: activePanel ? 'translateX(0)' : `translateX(-${PANEL_W}px)`,
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
                fontFamily: MONO,
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
                  fontFamily: MONO,
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
