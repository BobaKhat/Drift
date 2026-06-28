import { usePlaylistStore } from '../store/usePlaylistStore'
import { C, FONT, PANEL_LIP, RADIUS } from './import/tokens'

// Playlists panel body (replaces the Slice-4 placeholder). Shows playlist NAMES + song counts,
// not song lists — the map is the song list. Active playlist gets the orange accent indicator.
export default function PlaylistPanel() {
  const { playlists, activePlaylistId, setActivePlaylist, openImport } = usePlaylistStore()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, fontFamily: FONT }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflowY: 'auto' }}>
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
              <span style={{ fontSize: 14, fontWeight: 500, color: active ? C.textPrimary : 'rgba(255,255,255,0.72)' }}>
                {p.name}
              </span>
              <span style={{ fontSize: 12, color: C.textSecondary }}>
                {`${p.count} song${p.count === 1 ? '' : 's'}`}
              </span>
            </button>
          )
        })}
      </div>

      <button
        onClick={() => openImport('welcome')}
        style={{
          marginTop: 16,
          height: 44,
          borderRadius: RADIUS.pill,
          background: C.card,
          boxShadow: PANEL_LIP,
          border: 'none',
          color: C.accent1,
          fontFamily: FONT,
          fontSize: 14,
          fontWeight: 500,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        Import more
      </button>
    </div>
  )
}
