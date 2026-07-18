import { useEffect, useMemo, useRef, useState } from 'react'
import { usePlaylistStore } from '../../store/usePlaylistStore'
import { demoTrackRows } from '../../data/demoLibrary'
import { C, FONT, INSET, RADIUS } from './tokens'
import { ModalCard } from './pieces'
import MiniMapLoader from './MiniMapLoader'

// Reassuring, non-literal status lines that crossfade while the import runs. Order is shuffled once per
// mount so a fast import and a slow one don't always open on the same word.
const MESSAGES = [
  'Tuning the frequencies…',
  'Reading the room…',
  'Plotting the vibes…',
  'Charting the feels…',
  'Aligning the constellations…',
  'Crunching the harmonics…',
]
const HOLD_MS = 8000   // dwell on a line before crossfading to the next
const FADE_MS = 400    // out, then in

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// Rotating status copy: hold ~8s, fade out over 400ms, swap, fade in over 400ms. Reduced motion keeps
// the rotation but drops the transition so the swap is instant.
function RotatingCopy() {
  const order = useRef(shuffle(MESSAGES))
  const [idx, setIdx] = useState(0)
  const [shown, setShown] = useState(true)
  const reduce = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    let outTimer
    const hold = setInterval(() => {
      if (reduce) {
        setIdx((i) => (i + 1) % order.current.length)
        return
      }
      setShown(false) // fade out
      outTimer = setTimeout(() => {
        setIdx((i) => (i + 1) % order.current.length)
        setShown(true) // fade back in
      }, FADE_MS)
    }, HOLD_MS)
    return () => { clearInterval(hold); clearTimeout(outTimer) }
  }, [reduce])

  return (
    <span style={{
      fontFamily: FONT,
      fontSize: 14,
      color: C.textSecondary,
      opacity: shown ? 1 : 0,
      transition: reduce ? 'none' : `opacity ${FADE_MS}ms ease`,
    }}>
      {order.current[idx]}
    </span>
  )
}

// Loading state for an import. Layout top-to-bottom: heading → mini-map canvas → rotating copy →
// progress text → orange progress bar. Import logic/progress tracking are untouched — this is purely
// the visual presentation of the `progress` the store already emits. `name` is already resolved
// Artist–Title (or the raw URL while still resolving) upstream in runImport, so it renders as-is.
// The mini-map is a purely decorative "your map is being built" animation — no connection to the
// actual tracks or progress.
export default function ProgressCard() {
  const { progress, activeTracks } = usePlaylistStore()
  const { current, total, name } = progress
  const pct = total > 0 ? Math.round((current / total) * 100) : 0

  // Cover pool for the decorative mini-map: prefer the user's own library art, fall back to the demo
  // covers so there are always ≥20 real album covers to scatter — even on a first-ever import.
  const artUrls = useMemo(() => {
    const seen = new Set()
    const out = []
    const push = (u) => { if (u && !seen.has(u)) { seen.add(u); out.push(u) } }
    for (const t of activeTracks ?? []) push(t.album_art_url)
    for (const t of demoTrackRows()) push(t.album_art_url)
    return out.slice(0, 30)
  }, [activeTracks])

  return (
    <ModalCard width={520} style={{ gap: 20, alignItems: 'flex-start' }}>
      <h1 style={{ fontFamily: FONT, fontSize: 28, fontWeight: 600, color: C.textPrimary, letterSpacing: '-1px', margin: 0 }}>
        Mapping your music
      </h1>

      <MiniMapLoader height={360} artUrls={artUrls} />

      <RotatingCopy />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
        <p style={{ fontFamily: FONT, fontSize: 14, color: C.textSecondary, margin: 0 }}>
          {total > 0 ? `Analyzing ${current} of ${total}…` : 'Preparing…'}
        </p>
        {name ? (
          <p style={{
            fontFamily: FONT, fontSize: 14, color: C.iconPrimary, margin: 0,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
          }}>
            {name}
          </p>
        ) : null}
      </div>

      <div
        style={{
          width: '100%',
          height: 10,
          background: C.card,
          borderRadius: RADIUS.pill,
          boxShadow: INSET,
          overflow: 'hidden',
        }}
      >
        <div
          className="drift-progress-fill"
          style={{
            width: `${pct}%`,
            height: '100%',
            background: C.accent1,
            borderRadius: RADIUS.pill,
            transition: 'width 250ms ease',
          }}
        />
      </div>
    </ModalCard>
  )
}
