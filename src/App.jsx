import DriftMap from './components/DriftMap'
import LeftNav from './components/LeftNav'
import ImportFlow from './components/import/ImportFlow'
import { PlaylistProvider, usePlaylistStore } from './store/usePlaylistStore'

const MONO = '"Space Mono", "B612 Mono", "Courier New", monospace'

function DriftApp() {
  const { activeTracks } = usePlaylistStore()

  return (
    <>
      {/* Map is always mounted behind everything — no empty-map state. */}
      <DriftMap tracks={activeTracks} />
      <LeftNav />
      <ImportFlow />

      {/* Debug overlay — active playlist's tracks */}
      {activeTracks.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            left: 70,
            fontFamily: MONO,
            fontSize: 9,
            letterSpacing: '0.08em',
            color: 'rgba(255,255,255,0.25)',
            lineHeight: 1.8,
            pointerEvents: 'none',
            zIndex: 10,
          }}
        >
          {activeTracks.map((t) => (
            <div key={t.id}>
              {t.artist} – {t.name} · E {t.energy?.toFixed(1) ?? '—'} · M {t.mood?.toFixed(1) ?? '—'}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

export default function App() {
  return (
    <PlaylistProvider>
      <DriftApp />
    </PlaylistProvider>
  )
}
