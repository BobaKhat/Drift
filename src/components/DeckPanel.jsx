import { useEffect, useMemo, useRef, useState } from 'react'
import { usePlaylistStore } from '../store/usePlaylistStore'
import { useAudio } from '../store/useAudioStore'
import DeckVisualizer from './DeckVisualizer'
import { resolvePreview } from '../lib/preview'
import { C, FONT, INSET, PANEL_LIP } from './import/tokens'
import { CAMELOT_WHEEL, WIRE_COLORS, scoreCompatibility } from '../lib/compatibility'
import { camelotColor } from '../lib/camelot'
import { useAlbumColor } from './useAlbumColor'

// Deck View (Slice 12, Figma node 748:2359) — a right-side bento panel that opens on a song click
// and overlays the map, keeping the user in map context (Decision Log #6, #58–68). Slice 13 adds
// 30-second preview playback (play/pause button + spinning disc, progress ring, live counter) via
// the shared audio engine (see useAudioStore). Slice 14 fills the hero tile with the raymarched
// metaball visualizer (DeckVisualizer) and makes the VU meter reactive — both run on the analyser
// while playing and on cached track features (BPM/energy/mood) while idle (Decision #77). Data tiles
// come from the cached `tracks` row in Supabase (Decision Log #87); preview URLs are resolved once
// and cached to tracks.preview_url on first play.

// Responsive width: narrower on smaller screens, wider on large monitors (gives the map more room).
const PANEL_W = 'clamp(320px, 28vw, 420px)'
const PAGE_INSET = 10        // matches the map's inset so the deck lines up with the map's right edge

const ACCENT = C.accent1     // orange — BPM ring, progress ring
const ACCENT2 = C.accent2    // blue — Camelot ring, Energy slider
const CARD = C.card          // #141416 tile
const SUB = C.textSecondary  // #848484

const labelStyle = { fontFamily: FONT, fontSize: 12, fontWeight: 500, color: SUB }
const TILE_SHADOW = '4px 4px 5px 0px rgba(0,0,0,0.8)'
const TILE_LIP = PANEL_LIP // inset 1px 1.5px 3px #373737 — the recessed module lip

// —— Responsive spacing + type ————————————————————————————————————————————————————————
// The visualizer holds an aspect-ratio floor (never a thin strip) that tracks the responsive width;
// the data tiles absorb the vertical squeeze by shrinking their rows and scaling type with vh
// (clamped ≥13px). Spacing mirrors the Figma proportions: ~20px panel gutter, ~15px inside tiles.
const VIS_MIN = 'clamp(175px, 15vw, 230px)'          // hero min-height, ≈16:9 of the panel width
const DISC_W = 'clamp(126px, 11.3vw, 176px)'         // playback-disc width (square = row-1 height)
const BENTO1 = `minmax(108px, ${DISC_W})`            // disc-height band, capped vs width so
                                                      // the square disc never crowds the circles
const BENTO2 = 'minmax(84px, 120px)'
const GAP = 'clamp(8px, 1vh, 12px)'                   // gaps between tiles
const PAD_OUT = 'clamp(14px, 1.8vh, 20px)'            // panel edge → tiles (Figma ~20px gutter)
const PAD = 'clamp(13px, 1.6vh, 16px)'                // inside each tile (Figma ~15px; never hugs)
const PAD_PILL = 'clamp(8px, 1vh, 12px)'              // BPM/Camelot pill — keeps circles ≥50px
const F_NUM = 'clamp(1.25rem, 2.6vh, 1.75rem)'          // BPM/Camelot numbers (20–28px)
const F_COUNT = 'clamp(1.5rem, 3.4vh, 2.25rem)'         // compatible-keys count (24–36px)
const F_TILE_LABEL = 'clamp(0.8125rem, 1.4vh, 0.875rem)'// tile labels (13–14px)
const F_TRACK_NAME = 18                                  // track title — fixed, never scales
const F_TRACK_SUB = 13                                   // artist — fixed, never scales
const F_SLIDER_VAL = 'clamp(0.75rem, 1.5vh, 0.875rem)'  // slider value (12–14px) — quieter than the track

// —— Small shared pieces ————————————————————————————————————————————————————————————
function MusicNote({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
      <path d="M9 17V5l11-2v12" stroke={SUB} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6" cy="17" r="3" fill={SUB} />
      <circle cx="17" cy="15" r="3" fill={SUB} />
    </svg>
  )
}

function Thumb({ url, size, radius }) {
  const [failed, setFailed] = useState(false)
  // `size` may be a number (px) or a CSS length string (e.g. a clamp()); the fallback glyph uses a
  // fixed size when it can't derive one from a numeric size.
  const noteSize = typeof size === 'number' ? Math.round(size * 0.42) : 24
  return (
    <div style={{ width: size, height: size, borderRadius: radius, overflow: 'hidden', flexShrink: 0, background: '#222224' }}>
      {url && !failed ? (
        <img src={url} alt="" draggable={false} onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <MusicNote size={noteSize} />
        </div>
      )}
    </div>
  )
}

// A recessed compatibility badge (Decision Log #65) — a dark inset well with tier-colored key text.
function KeyBadge({ text, color, big }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      padding: big ? '3px 6px' : '2px 7px', borderRadius: 6,
      background: '#0C0C0C', boxShadow: 'inset 1px 1px 3px 0px #000000, inset -1px -1px 2px 0px rgba(55,55,55,0.6)',
      fontFamily: FONT, fontSize: big ? 13 : 10, fontWeight: 600, color, whiteSpace: 'nowrap',
    }}>
      {text}
    </span>
  )
}

// A soft tinted pill (the "Strong Match" / BPM-delta chip style from Figma) — tier-colored.
function TintPill({ text, color }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 6px', borderRadius: 5,
      background: `${color}33`, fontFamily: FONT, fontSize: 10, fontWeight: 500, color, whiteSpace: 'nowrap',
    }}>
      {text}
    </span>
  )
}

// —— Reactive VU meter (Slice 14, Decision Log #68, Figma 748:2433) ———————————————————
// The recessed pill well + green→red gradient from Slice 12, now animated. While a preview plays the
// level follows the analyser's overall amplitude (fast attack / slow release, classic VU ballistics);
// idle, it pulses at the track's BPM — a decaying kick each (60 / BPM)s beat — from cached data
// (Decision #77). Width + brightness are mutated directly on the fill node inside a rAF loop (no
// setState at 60fps); the loop only runs while the deck is open.
function MeterTile({ track, open }) {
  const { engine } = useAudio()
  const fillRef = useRef(null)
  const stRef = useRef({ level: 0.55, freq: null })

  useEffect(() => {
    if (!open) return
    const st = stRef.current
    let raf
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const an = engine.analyser
      let target
      if (engine.getSnapshot().playing && an) {
        if (!st.freq || st.freq.length !== an.frequencyBinCount) st.freq = new Uint8Array(an.frequencyBinCount)
        an.getByteFrequencyData(st.freq)
        let s = 0
        for (let i = 0; i < 80; i++) s += st.freq[i] // same bass→highs band the visualizer reads
        target = 0.15 + (s / (80 * 255)) * 1.1
      } else {
        const bpm = track?.bpm > 0 ? track.bpm : 120
        const p = ((performance.now() / 1000) * bpm) / 60 % 1
        target = 0.52 + 0.2 * Math.pow(1 - p, 2.4)
      }
      st.level += (target - st.level) * (target > st.level ? 0.45 : 0.1)
      const el = fillRef.current
      if (el) {
        el.style.width = `${(Math.min(0.97, Math.max(0.06, st.level)) * 100).toFixed(2)}%`
        el.style.filter = `brightness(${(0.8 + st.level * 0.55).toFixed(3)})`
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open, track?.bpm, engine])

  return (
    <div style={{
      // Slim accent strip (fixed ~40px), not a full grid row — leaves the BPM/Camelot pill the rest
      // of the column height so the circles fill their pill.
      flex: '0 0 auto', height: 48, borderRadius: 20, position: 'relative',
      background: CARD, boxShadow: `${TILE_SHADOW}, ${TILE_LIP}`,
      display: 'flex', alignItems: 'center', padding: '8px 15px',
    }}>
      {/* Recessed pill well */}
      <div style={{
        position: 'relative', flex: 1, alignSelf: 'stretch', overflow: 'hidden',
        borderRadius: 100, background: '#000', border: `1px solid ${C.border}`, boxShadow: INSET,
      }}>
        {/* Animated gradient level: rounded base on the left, squared leading edge on the right. */}
        <div ref={fillRef} style={{
          position: 'absolute', top: 3, bottom: 3, left: 3, width: '64%',
          borderRadius: '100px 4px 4px 100px',
          background: 'linear-gradient(90deg, #1ED460 0%, #FF9512 52%, red 100%)',
          boxShadow: 'inset -1px -1px 3px 0px #373737, inset 2px 2px 2px 0px #000000',
        }} />
      </div>
    </div>
  )
}

// —— Track info bar (Decision Log #60) ————————————————————————————————————————————————
// Album-art gradient (Slice 12 #4): a left→right wash from the card color into the cover's dominant
// hue at ~35% toward the play-button side. The colour comes from the shared useAlbumColor hook (same
// extraction as the map's ambient glow and the Slice 14 visualizer); falls back to the plain card
// surface when no vivid color is available.
function PlayIcon({ color }) {
  return (
    // Larger glyph with rounded corners — the round stroke (same colour as the fill) softens the joins.
    <svg width="28" height="28" viewBox="0 0 16 16" fill="none" style={{ marginLeft: 4 }}>
      <path d="M4 3v10l8.5-5L4 3z" fill={color} stroke={color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

function PauseIcon({ color }) {
  return (
    // Two rounded vertical bars — same weight as the play glyph.
    <svg width="26" height="26" viewBox="0 0 16 16" fill="none">
      <rect x="4" y="3" width="3" height="10" rx="1.4" fill={color} />
      <rect x="9" y="3" width="3" height="10" rx="1.4" fill={color} />
    </svg>
  )
}

// Resolve (and cache/persist) the open track's preview URL when the deck opens, so the play button
// knows whether to enable and clicking it is instant. Returns 'loading' | 'ready' | 'none'.
function usePreviewStatus(track) {
  const [status, setStatus] = useState(track.preview_url ? 'ready' : 'loading')
  useEffect(() => {
    let cancelled = false
    if (track.preview_url) { setStatus('ready'); return }
    setStatus('loading')
    resolvePreview(track).then((url) => { if (!cancelled) setStatus(url ? 'ready' : 'none') })
    return () => { cancelled = true }
  }, [track.id, track.preview_url])
  return status
}

// mm:ss (e.g. 15 → "0:15", 90 → "1:30").
function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Track info bar (Figma 748:2362): recessed tile (radius 20, tile extrusion), a left→right album-art
// wash (color at ~35% on the album side, fading to #141414), and a play button filled with the
// album's color (white glyph). Falls back to the plain card + light play button when no color.
function TrackInfoBar({ track }) {
  const rgb = useAlbumColor(track.album_art_url)
  const { isPlaying, currentTrackId, toggle } = useAudio()
  const previewStatus = usePreviewStatus(track)
  const playing = isPlaying && currentTrackId === track.id
  const disabled = previewStatus === 'none'
  const background = rgb ? `linear-gradient(90deg, rgba(${rgb}, 0.38) 0%, #141414 72%)` : '#141416'
  // Play glyph is tinted with the album colour; the button itself is a recessed dark well (design-system inset).
  const playGlyph = rgb ? `rgb(${rgb})` : ACCENT
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: PAD, borderRadius: 20, flexShrink: 0,
      background,
      boxShadow: `${TILE_SHADOW}, ${TILE_LIP}`,
    }}>
      <Thumb url={track.album_art_url} size={'clamp(52px, 8vh, 70px)'} radius={15} />
      {/* Text truncates with ellipsis; the 60px play button (flex-shrink 0) reserves the right side. */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONT, fontSize: F_TRACK_NAME, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {track.name ?? 'Unknown'}
        </div>
        <div style={{ fontFamily: FONT, fontSize: F_TRACK_SUB, color: SUB, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 6 }}>
          {track.artist ?? ''}
        </div>
      </div>
      {/* Play/pause button (Slice 13). Recessed dark well filled with the album-color glyph; toggles
          this track's 30-second preview. Dimmed + disabled when the track has no available preview. */}
      <button
        type="button"
        onClick={disabled ? undefined : () => toggle(track)}
        disabled={disabled}
        title={disabled ? 'No preview available' : playing ? 'Pause' : 'Play'}
        aria-label={disabled ? 'No preview available' : playing ? 'Pause' : 'Play'}
        style={{
          width: 60, height: 60, borderRadius: '50%', flexShrink: 0, marginLeft: 12, // 12px gap + 12 = 24 (doubled)
          background: CARD, display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: INSET, border: 'none', padding: 0,
          opacity: disabled ? 0.4 : 1, cursor: disabled ? 'default' : 'pointer',
        }}
      >
        {playing ? <PauseIcon color={playGlyph} /> : <PlayIcon color={playGlyph} />}
      </button>
    </div>
  )
}

// —— Playback disc (Decision Log #61) — album art as a vinyl with a 0% orange progress ring —————
// Fully fluid: a square tile whose height fills the bento row (alignSelf stretch + aspect-ratio),
// with all internals (ring via SVG viewBox, art, spindle) sized in %, so it scales with the row.
function PlaybackDisc({ track }) {
  const r = 47
  const circ = 2 * Math.PI * r
  const { isPlaying, currentTrackId, engine } = useAudio()
  const active = currentTrackId === track.id      // this track is the one loaded in the engine
  const playing = isPlaying && active

  // currentTime is polled off the engine via rAF while playing (smoother than the 4Hz timeupdate
  // event) to drive the ring + counter. Paused mid-preview holds the last value; stopping/switching
  // makes this track inactive → reset to 0.
  const [time, setTime] = useState(0)
  useEffect(() => {
    if (!playing) return
    let raf
    const tick = () => { setTime(engine.getCurrentTime()); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, engine])
  useEffect(() => { if (!active) setTime(0) }, [active])

  // Ring fills over the real preview length (≈30s), falling back to 30 before metadata loads.
  const dur = active && engine.getDuration() > 0 ? engine.getDuration() : 30
  const progress = Math.min(1, dur > 0 ? time / dur : 0)
  const dashoffset = circ * (1 - progress)

  return (
    <div style={{
      aspectRatio: '1 / 1', alignSelf: 'stretch', flexShrink: 0, borderRadius: 20, position: 'relative',
      background: CARD, boxShadow: `${TILE_SHADOW}, ${TILE_LIP}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* Ring group — 74% of the disc, square. */}
      <div style={{ position: 'relative', width: '74%', aspectRatio: '1 / 1' }}>
        {/* Progress ring: full faint track + an orange arc that fills clockwise with playback. */}
        <svg viewBox="0 0 100 100" width="100%" height="100%" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="2.6" />
          <circle cx="50" cy="50" r={r} fill="none" stroke={ACCENT} strokeWidth="2.6"
            strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={dashoffset} />
        </svg>
        {/* Album art record, clipped to a circle inside the ring. Spins while playing (~8s/turn,
            linear); pausing freezes the angle; stopping (inactive) removes the animation → back to 0. */}
        <div style={{
          position: 'absolute', inset: '7%', borderRadius: '50%', overflow: 'hidden', background: '#222224',
          // All-longhand (not the `animation` shorthand) so toggling animationPlayState per render
          // doesn't clash with a shorthand reset. `none` name = no spin (stopped → snaps back to 0°).
          animationName: active ? 'driftDiscSpin' : 'none',
          animationDuration: '8s',
          animationTimingFunction: 'linear',
          animationIterationCount: 'infinite',
          animationPlayState: playing ? 'running' : 'paused',
        }}>
          {track.album_art_url
            ? <img src={track.album_art_url} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><MusicNote size={20} /></div>}
        </div>
        {/* Vinyl label + spindle hole. */}
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          width: '20%', aspectRatio: '1 / 1', borderRadius: '50%', background: CARD,
          border: '1px solid rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ width: '24%', aspectRatio: '1 / 1', borderRadius: '50%', background: '#060606' }} />
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: '5%', fontFamily: FONT, fontSize: 10, fontWeight: 600, color: SUB }}>
        {fmtTime(time)} / {fmtTime(dur)}
      </div>
    </div>
  )
}

// —— BPM + Camelot circles (Decision Log #62, #63) ————————————————————————————————————
// Circles are sized by HEIGHT: each takes the pill's inner height and derives its width from
// aspect-ratio, so they stay perfect circles instead of stretching to fill the cell width. They sit
// snug side-by-side, centered in the pill (justify-content: center), capped so they never overflow.
const CIRCLE_MAX = 84 // px — caps the circles at their regular-window size so they don't keep growing
                      // (and overflowing the narrower pill) at very wide/tall viewports

function StatCircle({ value, label, ringColor, ringWidth, valueColor }) {
  return (
    <div style={{
      height: '100%', maxHeight: CIRCLE_MAX, aspectRatio: '1 / 1', flexShrink: 0, borderRadius: '50%',
      border: `${ringWidth}px solid ${ringColor}`, background: C.panel, boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      boxShadow: `4px 4px 5px 0px rgba(0,0,0,0.7), inset 4px 4px 5px 0px rgba(55,55,55,0.35)`,
    }}>
      <div style={{ fontFamily: FONT, fontSize: F_NUM, fontWeight: 600, color: valueColor, lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: FONT, fontSize: F_TILE_LABEL, fontWeight: 500, color: SUB, marginTop: 2 }}>{label}</div>
    </div>
  )
}

function BpmCamelot({ track }) {
  const bpm = track.bpm != null ? Math.round(track.bpm) : '—'
  const camelot = track.camelot ? String(track.camelot).replace(/\s+/g, '').toUpperCase() : null
  return (
    // Pill fills the column width (so it matches the VU meter below), holding the two circles centered
    // + snug. Overflow at wide viewports is prevented by the circle-size cap (CIRCLE_MAX), not a width cap.
    <div style={{
      flex: '1.6 1 0', minHeight: 0,
      display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'center',
      padding: PAD_PILL, borderRadius: 1000, boxSizing: 'border-box',
      background: CARD, boxShadow: `${TILE_SHADOW}, ${TILE_LIP}`,
    }}>
      <StatCircle value={bpm} label="BPM" ringColor={ACCENT} ringWidth={1} valueColor="#fff" />
      {/* Key value colored by the Slice 11 Camelot hue system (A/B variants share a hue); '—' → gray. */}
      <StatCircle value={camelot ?? '—'} label="Camelot" ringColor={ACCENT2} ringWidth={2} valueColor={camelotColor(camelot)} />
    </div>
  )
}

// —— Next Up (Decision Log #66) ———————————————————————————————————————————————————————
function NextUp({ track, nextTrack }) {
  const score = nextTrack ? scoreCompatibility(track, nextTrack) : null
  const tierColor = score ? WIRE_COLORS[score.tier] : null
  const tierLabel = score
    ? (score.tier === 'strong' ? 'Strong Match' : score.tier === 'mild' ? 'Mild Match' : 'Weak Match')
    : null
  const bpmText = score?.bpmDelta != null
    ? `${score.bpmDelta > 0 ? '+' : ''}${Math.round(score.bpmDelta)} BPM`
    : '— BPM'

  return (
    <div style={{
      flex: '260 1 0', minWidth: 0, height: '100%', minHeight: 0, overflow: 'hidden', boxSizing: 'border-box',
      borderRadius: 20, padding: PAD,
      background: CARD, boxShadow: `${TILE_SHADOW}, ${TILE_LIP}`,
      display: 'flex', flexDirection: 'column', gap: GAP,
    }}>
      <div style={{ fontFamily: FONT, fontSize: 10, fontWeight: 500, color: SUB, letterSpacing: '0.04em' }}>NEXT UP</div>
      {nextTrack ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Thumb url={nextTrack.album_art_url} size={25} radius={5} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {nextTrack.name ?? 'Unknown'}
              </div>
              <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 500, color: SUB, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 4 }}>
                {nextTrack.artist ?? ''}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <TintPill text={bpmText} color={tierColor} />
            <TintPill text={`${nextTrack.camelot ?? '—'} | ${tierLabel}`} color={tierColor} />
          </div>
        </div>
      ) : (
        // Not in an active set chain — the V1 solo-browse state (Decision Log #66).
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 6, paddingBottom: 4 }}>
          <div style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, color: SUB }}>Add to a set</div>
          <div style={{ fontFamily: FONT, fontSize: 11, color: SUB }}>Chain this song in the Set Builder to see what mixes next.</div>
        </div>
      )}
    </div>
  )
}

// —— Compatible Keys (Decision Log #65) ———————————————————————————————————————————————
function CompatibleKeys({ track }) {
  const camelot = track.camelot ? String(track.camelot).replace(/\s+/g, '').toUpperCase() : null
  const wheel = camelot ? CAMELOT_WHEEL[camelot] : null
  // 2 adjacent (strong) + 1 parallel (mild) — e.g. 3A → 2A, 4A, 3B.
  const keys = wheel
    ? [
        { text: wheel.adjacent[0], color: WIRE_COLORS.strong },
        { text: wheel.adjacent[1], color: WIRE_COLORS.strong },
        { text: wheel.parallel, color: WIRE_COLORS.mild },
      ]
    : []

  return (
    <div style={{
      flexGrow: 0, flexShrink: 0, width: DISC_W, height: '100%', minHeight: 0, overflow: 'hidden', boxSizing: 'border-box',
      borderRadius: 20, padding: PAD,
      background: CARD, boxShadow: `${TILE_SHADOW}, ${TILE_LIP}`,
      display: 'flex', flexDirection: 'column',
    }}>
      {wheel ? (
        <>
          <div style={{ fontFamily: FONT, fontSize: F_COUNT, fontWeight: 500, color: '#fff', lineHeight: 1 }}>{keys.length}</div>
          <div style={{ fontFamily: FONT, fontSize: F_TILE_LABEL, fontWeight: 500, color: SUB, marginTop: 3 }}>compatible keys</div>
          <div style={{ display: 'flex', gap: 5, marginTop: 'auto', paddingTop: 10, flexWrap: 'nowrap' }}>
            {keys.map((k) => <KeyBadge key={k.text} text={k.text} color={k.color} big />)}
          </div>
        </>
      ) : (
        // Key-unknown empty state (Decision Log #65, key-unknown state).
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ fontFamily: FONT, fontSize: 15, fontWeight: 600, color: SUB }}>Key unknown</div>
          <div style={{ fontFamily: FONT, fontSize: 11, color: SUB, marginTop: 6 }}>No Camelot data for this track.</div>
        </div>
      )}
    </div>
  )
}

// —— Energy + Mood sliders (Decision Log #67) — read-only display ——————————————————————
function ReadonlySlider({ value, color, leftLabel, rightLabel }) {
  const has = value != null && !Number.isNaN(value)
  const pct = has ? Math.max(0, Math.min(100, value)) : 0
  const shown = has ? Math.round(value) : '—'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ ...labelStyle, width: 46, textAlign: 'right', flexShrink: 0 }}>{leftLabel}</span>
      <div style={{ flex: 1, position: 'relative', height: 17 }}>
        {/* Recessed track well */}
        <div style={{ position: 'absolute', top: 3, bottom: 3, left: 0, right: 0, borderRadius: 100, background: '#060606', boxShadow: INSET }} />
        {/* Filled portion */}
        <div style={{ position: 'absolute', top: 3, bottom: 3, left: 0, width: `${pct}%`, borderRadius: 100, background: color, boxShadow: 'inset -1px -1px 3px 0px #373737, inset 2px 2px 2px 0px #000000' }} />
        {/* Knob */}
        <div style={{ position: 'absolute', top: '50%', left: `${pct}%`, transform: 'translate(-50%,-50%)', width: 20, height: 20, borderRadius: '50%', background: color, border: `2px solid ${C.border}`, boxShadow: 'inset -1px -1px 3px 0px #373737, inset 2px 2px 2px 0px #000000' }} />
        {/* Value above the knob — its centre is clamped ~16px inside the track so the number never
            pokes past the tile's padding at the extremes (0 / 100). */}
        <div style={{ position: 'absolute', bottom: 'calc(100% + 4px)', left: `clamp(16px, ${pct}%, calc(100% - 16px))`, transform: 'translateX(-50%)', fontFamily: FONT, fontSize: F_SLIDER_VAL, fontWeight: 700, color, whiteSpace: 'nowrap' }}>{shown}</div>
      </div>
      <span style={{ ...labelStyle, width: 46, flexShrink: 0 }}>{rightLabel}</span>
    </div>
  )
}

function MoodEnergySliders({ track }) {
  return (
    <div style={{
      // Extra top room for the value numbers that sit above each track; sides/bottom + inter-slider
      // gap use the responsive scale so the module compresses with the rest at short viewports.
      borderRadius: 20, padding: `clamp(20px, 2.6vh, 28px) ${PAD} ${PAD}`, flexShrink: 0,
      background: CARD, boxShadow: `${TILE_SHADOW}, ${TILE_LIP}`,
      display: 'flex', flexDirection: 'column', gap: 'clamp(20px, 2.8vh, 26px)',
    }}>
      {/* Energy — blue accent, Chill → Intense (Decision Log semantic vocabulary). */}
      <ReadonlySlider value={track.energy} color={ACCENT2} leftLabel="Chill" rightLabel="Intense" />
      {/* Mood (valence) — orange accent, Dark → Bright. */}
      <ReadonlySlider value={track.mood} color={ACCENT} leftLabel="Dark" rightLabel="Bright" />
    </div>
  )
}

// —— Deck content ————————————————————————————————————————————————————————————————————
// The deck closes by clicking the song again (toggle), clicking the map, or pressing Esc — there is
// no explicit close button in the bar.
function DeckContent({ track, nextTrack, open }) {
  return (
    // Non-scrolling grid that always fills the panel height (Decision Log #6 — deck stays in map
    // context, no internal scroll). Rows use fr/min-max so the layout breathes with the viewport: the
    // visualizer hero (empty) absorbs the most slack, the two bento rows scale within a bounded band
    // (so the square disc + circles never overflow their width), and the text-driven track bar and
    // sliders stay at their content height. Fits without scroll at ~700px and without whitespace at
    // ~1080px.
    <div style={{
      flex: 1, minHeight: 0, overflow: 'hidden',
      display: 'grid',
      // Visualizer row has a real min (VIS_MIN, ~16:9) and grabs slack (1fr) — so it grows tall but
      // never collapses to a strip. The two bento rows are the compressible band (min→max), shrinking
      // first at short viewports; the text-driven bar + sliders stay at content height.
      // Rows: visualizer, track bar, disc row, sliders (auto), compatible/next (BENTO2).
      gridTemplateRows: `minmax(${VIS_MIN}, 1fr) auto ${BENTO1} auto ${BENTO2}`,
      // Pin the single column to the panel width (min 0) so long track names can't expand a row past
      // the panel and instead truncate with ellipsis (#3).
      gridTemplateColumns: 'minmax(0, 1fr)',
      gap: GAP, padding: PAD_OUT,
    }}>
      <DeckVisualizer track={track} open={open} />
      <TrackInfoBar track={track} />
      {/* Bento row 1: playback disc (left) beside the BPM/Camelot + meter column (right). */}
      <div style={{ display: 'flex', gap: GAP, minHeight: 0 }}>
        <PlaybackDisc track={track} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: GAP }}>
          <BpmCamelot track={track} />
          <MeterTile track={track} open={open} />
        </div>
      </div>
      <MoodEnergySliders track={track} />
      {/* Bento row 2: Compatible Keys (left) + Next Up (right). */}
      <div style={{ display: 'flex', gap: GAP, minHeight: 0 }}>
        <CompatibleKeys track={track} />
        <NextUp track={track} nextTrack={nextTrack} />
      </div>
    </div>
  )
}

export default function DeckPanel() {
  const { deckTrackId, closeDeck, activeTracks, chain } = usePlaylistStore()
  const open = !!deckTrackId
  const track = useMemo(() => activeTracks.find((t) => t.id === deckTrackId) ?? null, [activeTracks, deckTrackId])

  // Keep the last-shown track rendered through the slide-out so the panel doesn't blank mid-close.
  const [shown, setShown] = useState(null)
  useEffect(() => { if (track) setShown(track) }, [track])
  const display = track ?? shown

  const tracksById = useMemo(() => Object.fromEntries(activeTracks.map((t) => [t.id, t])), [activeTracks])
  const nextTrack = useMemo(() => {
    if (!display) return null
    const i = chain.indexOf(display.id)
    if (i === -1 || i === chain.length - 1) return null
    return tracksById[chain[i + 1]] ?? null
  }, [display, chain, tracksById])

  // ESC closes the deck (map click / X button also close it).
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') closeDeck() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closeDeck])

  return (
    <div
      aria-hidden={!open}
      style={{
        position: 'fixed', top: PAGE_INSET, right: PAGE_INSET, bottom: PAGE_INSET,
        width: PANEL_W, maxWidth: `calc(100vw - ${PAGE_INSET * 2}px)`,
        background: C.panel, border: `1px solid ${C.border}`, borderRadius: 20,
        boxShadow: '-6px 4px 24px 0px rgba(0,0,0,0.5)',
        zIndex: 18, display: 'flex', flexDirection: 'column',
        transform: open ? 'translateX(0)' : `translateX(calc(100% + ${PAGE_INSET + 8}px))`,
        transition: 'transform 300ms ease-out',
        pointerEvents: open ? 'auto' : 'none',
        overflow: 'hidden',
      }}
    >
      {display && <DeckContent track={display} nextTrack={nextTrack} open={open} />}
    </div>
  )
}
