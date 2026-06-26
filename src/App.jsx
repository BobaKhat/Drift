import { useState, useEffect } from 'react'
import DriftMap from './components/DriftMap'
import { analyzeTrack } from './lib/pipeline'

// Hardcoded test track for V1 pipeline proof
const TEST_TRACK = 'Massive Attack – Teardrop'

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
  const [track, setTrack] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    analyzeTrack(TEST_TRACK)
      .then(setTrack)
      .catch((err) => {
        console.error('[drift] pipeline error:', err)
        setError(err.message)
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
      <DriftMap track={track} />

      {/* Debug overlay — remove once pipeline is verified */}
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
        <div>{track.artist} – {track.name}</div>
        <div>E {track.energy?.toFixed(1)} · M {track.mood?.toFixed(1)} · BPM {track.bpm?.toFixed(0)}</div>
        <div>Key {track.key ?? '—'} · Camelot {track.camelot ?? '—'}</div>
        <div style={{ color: 'rgba(255,255,255,0.12)' }}>{track.id}</div>
      </div>
    </>
  )
}
