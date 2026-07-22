import { useState } from 'react'
import { usePlaylistStore } from '../store/usePlaylistStore'
import { C, FONT, MONO, RADIUS, NEO_BAR_BG, NEO_BAR_SHADOW, NEO_BAR_EDGE, NEO_BAR_HOVER_BG, NEO_BAR_HOVER } from './import/tokens'

// Playlists panel body (replaces the Slice-4 placeholder). Shows playlist NAMES + song counts,
// not song lists — the map is the song list. Active playlist gets the orange accent indicator.
export default function PlaylistPanel() {
  const { playlists, activePlaylistId, setActivePlaylist, openImport } = usePlaylistStore()
  const [importHover, setImportHover] = useState(false)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, fontFamily: FONT }}>
      {/* Title — matches the Explore By / Set Builder panel headings. */}
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontFamily: MONO, fontSize: 24, fontWeight: 600, color: '#fff', lineHeight: 1.1 }}>
          Playlists
        </h2>
      </div>

      <div className="hide-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflowY: 'auto' }}>
        {playlists.length === 0 && (
          <div style={{ fontSize: 12, color: C.textSecondary, opacity: 0.6 }}>No playlists yet</div>
        )}

        {playlists.map((p) => {
          const active = p.id === activePlaylistId
          return (
            <button
              key={p.id}
              onClick={() => setActivePlaylist(p.id)}
              style={{
                position: 'relative',
                textAlign: 'left',
                background: active ? C.card : 'transparent',
                border: 'none',
                borderRadius: 8,
                padding: '10px 12px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              {active && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 3,
                    height: 22,
                    background: C.accent1,
                    borderRadius: '0 2px 2px 0',
                  }}
                />
              )}
              <span style={{ fontSize: 14, fontWeight: 500, color: active ? C.textPrimary : C.textSecondary }}>
                {p.name}
              </span>
              <span style={{ fontSize: 12, color: C.textSecondary }}>
                {`${p.count} song${p.count === 1 ? '' : 's'}`}
              </span>
            </button>
          )
        })}
      </div>

      {/* Matches the Explore By preset rows' resting style (ExploreByPanel: 58px pill, raised slab off
          the neomorphic system, 16px/500 label). Those rows are a radio group with an indicator knob and
          an active state; this is a one-shot action, so it takes the shell only — no knob, label centred
          — and keeps the accent-orange label that marks it as the panel's CTA. */}
      <button
        onClick={() => openImport('welcome')}
        onPointerEnter={() => setImportHover(true)}
        onPointerLeave={() => setImportHover(false)}
        style={{
          position: 'relative',
          marginTop: 16,
          height: 58,
          borderRadius: RADIUS.pill,
          background: importHover ? NEO_BAR_HOVER_BG : NEO_BAR_BG,
          border: 'none',
          boxShadow: importHover ? NEO_BAR_HOVER : NEO_BAR_SHADOW,
          color: C.accent1,
          fontFamily: FONT,
          fontSize: 16,
          fontWeight: 500,
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'box-shadow 150ms ease, background 150ms ease',
        }}
      >
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 'inherit',
          boxShadow: NEO_BAR_EDGE,
          pointerEvents: 'none',
        }} />
        <span style={{ position: 'relative' }}>Import more</span>
      </button>
    </div>
  )
}
