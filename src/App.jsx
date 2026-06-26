import { useState, useEffect } from 'react'
import DriftMap from './components/DriftMap'
import { analyzeTrack } from './lib/pipeline'

const TEST_TRACKS = [
  'Massive Attack – Teardrop',    // chill · dark   → bottom-left
  'Skrillex – Bangarang',         // intense · dark  → top-left
  'Bon Iver – Skinny Love',       // chill · dark-mid → bottom
  'Daft Punk – Get Lucky',        // intense · bright → top-right
  'Gesaffelstein – Pursuit',      // intense · dark  → top-left
]

const MONO = '"Space Mono", "B612 Mono", "Courier New", monospace'

function Shell({ children }) {
  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: '#0c0c0c',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </div>
  )
}

export default function App() {
  const [tracks, setTracks] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.allSettled(TEST_TRACKS.map((t, i) => analyzeTrack(t, { delayMs: i * 2000 })))
      .then((results) => {
        const loaded = results
          .filter((r) => r.status === 'fulfilled')
          .map((r) => r.value)
        results
          .filter((r) => r.status === 'rejected')
          .forEach((r) => console.error('[drift] track failed:', r.reason))
        if (loaded.length === 0) {
          setError('All tracks failed to load.')
        } else {
          setTracks(loaded)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <Shell>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: '0.2em',
            color: 'rgba(255,255,255,0.3)',
          }}
        >
          ANALYZING…
        </span>
      </Shell>
    )
  }

  if (error) {
    return (
      <Shell>
        <div style={{ textAlign: 'center', fontFamily: MONO }}>
          <div style={{ fontSize: 11, letterSpacing: '0.2em', color: 'rgba(255, 80, 80, 0.7)', marginBottom: 8 }}>
            PIPELINE ERROR
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', maxWidth: 480 }}>
            {error}
          </div>
        </div>
      </Shell>
    )
  }

  return (
    <>
      <DriftMap tracks={tracks} />

      {/* Debug overlay */}
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          left: 20,
          fontFamily: MONO,
          fontSize: 9,
          letterSpacing: '0.08em',
          color: 'rgba(255,255,255,0.25)',
          lineHeight: 1.8,
          pointerEvents: 'none',
        }}
      >
        {tracks.map((t) => (
          <div key={t.id}>
            {t.artist} – {t.name} · E {t.energy?.toFixed(1) ?? '—'} · M {t.mood?.toFixed(1) ?? '—'}
          </div>
        ))}
      </div>
    </>
  )
}
