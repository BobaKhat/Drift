import { useEffect, useMemo, useRef, useState } from 'react'
import { usePlaylistStore } from '../store/usePlaylistStore'
import { useAudio } from '../store/useAudioStore'
import DeckVisualizer from './DeckVisualizer'
import { resolvePreview } from '../lib/preview'
import { FEATURE_POLES, getFeatureValue, resolvePreset } from '../lib/presets'
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
// DO NOT grow this to buy space. It looks free — the extra height nominally comes out of the
// visualizer's 1fr above — but only while that 1fr still has slack. On a short window the visualizer
// is already pinned at VIS_MIN, and then every pixel added here is taken out of BENTO1 instead: the
// disc row, and with it the BPM/Camelot pill and its circles. Measured at 1600×760, raising this to
// 138px shrank the pill from 94.9px to 91.4px and its circles from 78.9px to 75.4px.
// Any extra room the tiles below need has to be found INSIDE them (see F_COUNT), not here.
const BENTO2 = 'minmax(84px, 120px)'
const GAP = 'clamp(8px, 1vh, 12px)'                   // gaps between tiles
const PAD_OUT = 'clamp(14px, 1.8vh, 20px)'            // panel edge → tiles (Figma ~20px gutter)
const PAD = 'clamp(13px, 1.6vh, 16px)'                // inside each tile, VERTICAL — compresses with height
// Horizontal padding inside a tile is FIXED at the Figma 15px, not clamped: side gutters have no
// reason to track viewport height, and letting them drift 13–16px meant the deck's left/right text
// edges didn't line up between tiles. Applies to every tile except the three whose insets are set by
// their own geometry: the visualizer (bleeds to its edges), the vinyl disc (square, no padding) and
// the BPM/Camelot pill (PAD_PILL, sized to keep the circles ≥50px).
const PAD_X = 15
const PAD_PILL = 'clamp(8px, 1vh, 12px)'              // BPM/Camelot pill — keeps circles ≥50px
const F_NUM = 'clamp(1.25rem, 2.6vh, 1.75rem)'          // BPM/Camelot numbers (20–28px)
// Compatible-keys count. Was clamp(1.5rem, 3.4vh, 2.25rem) → 24–36px. Reduced because it is the ONLY
// slack inside that tile, and the tile has to find ~6px somewhere to lift the "compatible keys" label
// (and NextUp's matching "Add to a set") off the badges. The alternative — a taller BENTO2 row — steals
// from the BPM/Camelot pill on short windows; see the note there. Shrinking the number is contained:
// nothing outside this tile moves.
const F_COUNT = 'clamp(1.375rem, 2.8vh, 1.75rem)'       // compatible-keys count (22–28px)
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
      // 5px sides on the `big` (Compatible Keys) variant, not 6. Those three badges are the widest
      // thing in that tile, and after it lost 25px to NextUp the worst-case key set — three 3-char
      // Camelot codes like 10A/12A/11B, 125px — no longer fit the 121px on offer. Trimming a pixel a
      // side (plus a tighter row gap) brings the worst case to ~117 and buys back the margin.
      padding: big ? '3px 5px' : '2px 7px', borderRadius: 6,
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
      // 1px vertical (not 2): NextUp is the only consumer, and its row is height-critical — see the
      // note on the tile. The horizontal padding carries the pill shape; the vertical was slack.
      display: 'inline-flex', alignItems: 'center', padding: '1px 6px', borderRadius: 5,
      background: `${color}33`, fontFamily: FONT, fontSize: 10, fontWeight: 500, color, whiteSpace: 'nowrap',
    }}>
      {text}
    </span>
  )
}

// —— Reactive VU meter (Slice 14, Decision Log #68, Figma 748:2433) ———————————————————
// The recessed pill well + green→red gradient from Slice 12, now animated. While a preview plays the
// bar pulses on the KICK (see below); idle, it pulses at the track's BPM — a decaying kick each
// (60 / BPM)s beat — from cached data (Decision #77). Width + brightness are mutated directly on the
// fill node inside a rAF loop (no setState at 60fps); the loop only runs while the deck is open.
//
// The bar is driven by ONSET DETECTION, not by level. Two earlier attempts failed, and both failures
// are instructive enough to be worth recording, because both look reasonable on paper:
//
//  1. Broadband level (mean of bins 0–79, mapped 0.15 + mean/255 * 1.1). On a limited master that
//     band's mean sits ~180–220/255, so the mapping ran past 1.0 and the bar sat clamped at its 97%
//     ceiling. Dead.
//  2. Kick-band level (peak of 20–170Hz, rescaled off a raised floor). Better, but still not a pulse:
//     that band carries the sustained BASSLINE as well as the kick, so on four-on-the-floor material
//     the level never dips between hits. There is nothing for the bar to fall toward, and no amount of
//     attack/release tuning can manufacture a pulse from a signal that doesn't have one. Measured on
//     Levels/126bpm: ~30 mean-crossings/min against ~126 kicks/min — it tracked song dynamics, not beats.
//
// The fix is to stop asking "how much low end is there" and ask "how much MORE than a moment ago".
// That's spectral flux: the frame-to-frame RISE in band energy. A droning sub, however loud, has a
// frame delta of ~0; the attack of a kick is a sharp positive step. Only rises count — the decay side
// clamps to zero — so the signal spikes on each transient and collapses between them by construction.
//
// (Note it must be the frame DERIVATIVE, not the excess over a slow running average. A baseline EMA
// lags through any loud section, leaving energy persistently above it, and the bar parks high all over
// again — measured at mean 72% of the well, 2 pulses in 10s. Same trap as #2, one level up.)
//
// Verified on Levels/126bpm: the bar now makes ~225 upward moves/min against ~286 low-band onsets/min
// in the audio, resting at ~14% of the well and peaking ~75%, never touching the ceiling.
const KICK_LO_HZ = 20
const KICK_HI_HZ = 170
const FLUX_DECAY = 0.995  // adaptive gain bleeds down, so a quiet passage re-sensitises the bar
const MIN_FLUX = 1.5      // don't divide by ~0 and amplify frame noise into a strobe
const REST = 0.12         // resting width between hits — a dead-flat 0 reads as broken, not idle

// With flux, the target is already a transient: near zero between hits, spiking on each. So attack is
// FAST (snap to the hit) and release is slow (a visible decay tail) — the classic VU shape, which is
// right here precisely because the input is now a transient rather than a level.
const ATTACK = 0.60
const RELEASE = 0.12

// —— Dot-matrix face. The meter is an LED panel: a fixed lattice of lamps, lit left→right by the
// level. Built as a CSS mask rather than a grid of DOM nodes — MET_COLS × MET_ROWS is ~72 lamps, and
// mutating 72 element styles every frame at 60fps to animate one number would be absurd. With the mask,
// the rAF loop still writes exactly ONE property (the fill's width), same as the old solid bar; the
// lattice is a static paint on top.
const MET_COLS = 24
const MET_ROWS = 3
const METER_GRADIENT = 'linear-gradient(90deg, #1ED460 0%, #FF9512 52%, red 100%)'
// A dot per lattice cell, tiled. Stops at 30%/36% of the cell's radius leave a clear gutter between
// lamps — without the gap they merge and it's just the old continuous bar with dents in it.
const DOT_MASK = (() => {
  const img = 'radial-gradient(circle at 50% 50%, #000 0 30%, transparent 36%)'
  const size = `${(100 / MET_COLS).toFixed(4)}% ${(100 / MET_ROWS).toFixed(4)}%`
  return {
    WebkitMaskImage: img, maskImage: img,
    WebkitMaskSize: size, maskSize: size,
    WebkitMaskRepeat: 'repeat', maskRepeat: 'repeat',
  }
})()

function MeterTile({ track, open }) {
  const { engine } = useAudio()
  const fillRef = useRef(null)
  const stRef = useRef({ level: 0.55, freq: null, prev: 0, fluxMax: 0 })

  useEffect(() => {
    if (!open) return
    const st = stRef.current
    // Re-arm the detector for this track. The baseline and the adaptive gain are both learned from
    // the audio, so carrying them across a song change would mis-calibrate the bar — a loud track's
    // gain would leave the next one looking dead until it bled back down.
    st.prev = 0
    st.fluxMax = 0
    let raf
    const tick = () => {
      raf = requestAnimationFrame(tick)
      // The meter's OWN 2048-point analyser, not the visualizer's 256-point one — see audioEngine.
      // Falls back to the shared analyser if the high-res tap failed to build, so the bar degrades
      // to the old (coarse) behaviour rather than freezing.
      const an = engine.meterAnalyser ?? engine.analyser
      let target
      if (engine.getSnapshot().playing && an) {
        if (!st.freq || st.freq.length !== an.frequencyBinCount) st.freq = new Uint8Array(an.frequencyBinCount)
        an.getByteFrequencyData(st.freq)
        // Resolve the kick band from Hz against the LIVE analyser config rather than hardcoding bin
        // indices — bin width is sampleRate/fftSize, so the right bins depend on a setting that lives
        // in audioEngine.js. At today's fftSize 256 (~172Hz/bin) the whole kick band is bin 0; if the
        // FFT is ever widened to 2048 (~21.5Hz/bin) this resolves to bins 0–7 with no edit here.
        const binHz = an.context.sampleRate / an.fftSize
        let lo = Math.floor(KICK_LO_HZ / binHz)
        const hi = Math.min(an.frequencyBinCount - 1, Math.max(lo, Math.floor(KICK_HI_HZ / binHz)))
        // Drop bin 0 whenever the band is wide enough to spare it: it holds DC offset and subsonic
        // rumble, which are not the kick but WILL hold the energy up and flatten the pulse. Only keep
        // it if the band collapsed to a single bin (the coarse fallback analyser, where bin 0 IS the
        // kick band and excluding it would leave nothing to read).
        if (hi > lo) lo = Math.max(lo, 1)

        // Mean, not peak — the baseline needs a stable measure of the band, and a single hot bin
        // would make it jitter. The transient is recovered from the delta below, not from the peak.
        let sum = 0
        for (let i = lo; i <= hi; i++) sum += st.freq[i]
        const energy = sum / (hi - lo + 1)

        // The onset itself: how much the band ROSE since last frame. A droning sub sits flat frame to
        // frame and contributes nothing; a kick's attack is a sharp positive step.
        const flux = Math.max(0, energy - st.prev)
        st.prev = energy

        // Adaptive gain: normalise against the loudest recent transient, decaying so the bar
        // re-sensitises in quiet passages. This is what replaces the hand-tuned KICK_FLOOR — a soft
        // acoustic kick and a slammed EDM kick both fill the bar, without a magic constant per genre.
        st.fluxMax = Math.max(flux, st.fluxMax * FLUX_DECAY)
        const norm = st.fluxMax > MIN_FLUX ? Math.min(1, flux / st.fluxMax) : 0
        target = REST + norm * (1 - REST)
      } else {
        const bpm = track?.bpm > 0 ? track.bpm : 120
        const p = ((performance.now() / 1000) * bpm) / 60 % 1
        target = 0.52 + 0.2 * Math.pow(1 - p, 2.4)
      }
      st.level += (target - st.level) * (target > st.level ? ATTACK : RELEASE)
      const el = fillRef.current
      if (el) {
        // Quantise to whole lamp columns. A lamp is on or off — a partially-covered dot would fade in
        // at its edge and give away that this is a swept bar behind a mask rather than a real panel.
        const lvl = Math.min(1, Math.max(0, st.level))
        const cols = Math.round(lvl * MET_COLS)
        el.style.clipPath = `inset(0 ${(100 - (cols / MET_COLS) * 100).toFixed(3)}% 0 0)`
        el.style.filter = `brightness(${(0.8 + st.level * 0.55).toFixed(3)})`
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // track.id (not just bpm) so the detector re-arms on every song change — two tracks can share a
    // BPM, and the learned baseline/gain must not carry across.
  }, [open, track?.id, track?.bpm, engine])

  return (
    <div style={{
      // Slim accent strip (fixed ~40px), not a full grid row — leaves the BPM/Camelot pill the rest
      // of the column height so the circles fill their pill.
      flex: '0 0 auto', height: 48, borderRadius: 20, position: 'relative',
      background: CARD, boxShadow: `${TILE_SHADOW}, ${TILE_LIP}`,
      display: 'flex', alignItems: 'center', padding: '8px 15px',
    }}>
      {/* Recessed well. Left corners are squared off to 5px while the right stays a full pill — the
          scale reads left→right, so the flat end is where the meter starts and the round end is where
          it runs out. */}
      <div style={{
        position: 'relative', flex: 1, alignSelf: 'stretch', overflow: 'hidden',
        borderRadius: '5px 100px 100px 5px',
        background: '#000', border: `1px solid ${C.border}`, boxShadow: INSET,
      }}>
        {/* Dot-matrix panel. The mask lives HERE, on a wrapper pinned to the well — not on the fill.
            That's the load-bearing detail: mask-size is relative to the element it's on, so masking
            the fill itself would make the lamp grid stretch and slide every frame as the level moves.
            Pinned to the well, the lattice is fixed and the fill just sweeps beneath it, which is what
            makes lamps light up in place like a real panel. */}
        <div style={{ position: 'absolute', inset: 3, ...DOT_MASK }}>
          {/* Unlit lamps: the same gradient, heavily dimmed. A real LED meter shows its scale even
              when dark — you can make out where the red zone starts before you ever hit it — and that
              reads far better than a row of dead gray dots. */}
          <div style={{ position: 'absolute', inset: 0, background: METER_GRADIENT, opacity: 0.13 }} />
          {/* Lit lamps. The gradient spans the FULL well and is revealed by a clip — it is NOT a
              narrow element that grows. That distinction is the difference between a meter and a
              bug: painting the gradient on a width-animated element compresses the whole green→red
              ramp into whatever the level happens to be, so a 20%-full meter lights a RED lamp in
              column 5. (The old solid bar did exactly that; a smooth blur just hid it.) Anchored to
              the well, green sits at the left and red only ever lights near the top of the scale.
              The clip inset is quantised to whole lamp columns in the rAF loop. */}
          <div ref={fillRef} style={{
            position: 'absolute', inset: 0,
            background: METER_GRADIENT,
            clipPath: 'inset(0 36% 0 0)',
          }} />
        </div>
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
      display: 'flex', alignItems: 'center', gap: 12, padding: `${PAD} ${PAD_X}px`, borderRadius: 20, flexShrink: 0,
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
      borderRadius: 20, padding: `${PAD} ${PAD_X}px`,
      background: CARD, boxShadow: `${TILE_SHADOW}, ${TILE_LIP}`,
      // The padding was ALWAYS symmetric (16/16) — the badges hugged the bottom because the content
      // overran the tile and `overflow: hidden` clipped it straight through the bottom padding.
      // Measured: 102px of content in an 88px box, so the badges ended up 2px off the bottom edge
      // against 16px above the label. The 14px is reclaimed from the internal spacing below (NOT from
      // the tile's height — this row shares its band with the disc/visualizer, and growing it would
      // just move the squeeze onto them). `center` then splits whatever slack is left evenly.
      display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center',
    }}>
      <div style={{ fontFamily: FONT, fontSize: 10, fontWeight: 500, color: SUB, letterSpacing: '0.04em' }}>NEXT UP</div>
      {nextTrack ? (
        // marginTop:auto bottom-anchors this block against the tile's content floor — the exact same
        // anchor the empty state uses (flex:1 + justifyContent:flex-end below). Without it the block
        // floated on the tile's justifyContent:center, so the populated state sat a few px higher than
        // the empty one and its badge row drifted off the Compatible Keys badge line.
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <Thumb url={nextTrack.album_art_url} size={25} radius={5} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {nextTrack.name ?? 'Unknown'}
              </div>
              <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 500, color: SUB, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
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
        //
        // Bottom-anchored (flex-end) to mirror Compatible Keys next door, so BOTH of this tile's rows
        // land on their neighbour's baselines:
        //   • the subtitle's last line sits on the content-box floor → level with the key badges
        //   • "Add to a set" sits one sub-stack above it            → level with "compatible keys"
        // For the second to hold, everything BELOW the heading (this gap + the 2-line subtitle) must
        // match the height of Compatible Keys' label→floor stack (its 20px paddingTop + 25.5px badge
        // row). 12px + a 33px subtitle does that, and 12px is also what lifts the heading off the
        // subtitle — the pair used to be jammed together at a 3px gap purely because the row was too
        // short to allow anything else.
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'flex-end', gap: 6 }}>
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
      // 25px narrower than the disc above it, so NextUp (flex:'260 1 0') absorbs the 25px and grows.
      // This deliberately breaks the vertical column the tile used to form with PlaybackDisc — both
      // were exactly DISC_W — so the bento's left edge still lines up but its right edge no longer does.
      //
      // The 147px floor is load-bearing, not defensive padding. DISC_W is an 11.3vw clamp, so on a
      // narrow window it shrinks faster than the key badges can: the widest possible key set (three
      // 3-char Camelot codes, e.g. 10A/12A/11B) needs ~117px, and with 30px of tile padding that means
      // the tile can never go below ~147 without clipping them. Below ~1550px the floor takes over and
      // the tile simply stops shrinking — NextUp gets whatever is left, which is less than the full
      // 25px there, but nothing is ever cut off. (The old DISC_W width already clipped those tracks on
      // narrow windows; this fixes that too.)
      flexGrow: 0, flexShrink: 0, width: `max(147px, calc(${DISC_W} - 25px))`, height: '100%', minHeight: 0, overflow: 'hidden', boxSizing: 'border-box',
      borderRadius: 20, padding: `${PAD} ${PAD_X}px`,
      background: CARD, boxShadow: `${TILE_SHADOW}, ${TILE_LIP}`,
      display: 'flex', flexDirection: 'column',
    }}>
      {wheel ? (
        <>
          <div style={{ fontFamily: FONT, fontSize: F_COUNT, fontWeight: 500, color: '#fff', lineHeight: 1 }}>{keys.length}</div>
          {/* Label + badges are ONE bottom-anchored group (marginTop:auto on the group, not on the
              badge row). That's what lets this tile line up with NextUp next door in both of its
              states, and it's structural rather than a tuned number:
                • the badge row sits on the content-box floor  → same baseline as NextUp's badges
                • the label sits one badge-row above the floor → same baseline as "Add to a set"
              Anchoring from the BOTTOM is the point. The label used to be positioned from the top,
              trailing the big count — whose size is a vh clamp (F_COUNT) — so its baseline slid with
              the viewport while NextUp's heading, pinned from the floor, stayed put. They could only
              ever agree at one window size. Now neither depends on the count's height; the slack
              collects above the label instead, between it and the number. */}
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontFamily: FONT, fontSize: F_TILE_LABEL, fontWeight: 500, color: SUB }}>compatible keys</div>
            {/* This 20px is what LIFTS the label: the badges are pinned to the floor, so the space
                between them and the label is the only thing that decides how high the label sits.
                It was 4px, which is why the label sat almost on top of the badges. NextUp's matching
                heading→subtitle gap is set to keep the two headings on one line — see there. */}
            <div style={{ display: 'flex', gap: 4, paddingTop: 13, flexWrap: 'nowrap' }}>
              {keys.map((k) => <KeyBadge key={k.text} text={k.text} color={k.color} big />)}
            </div>
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

// —— Axis sliders (Decision Log #67) — read-only display ————————————————————————————————
// This tile sits in an `auto` row of the deck's non-scrolling grid, so ANY height it gains is taken
// straight out of the visualizer's 1fr and pushes the disc/BPM band (BENTO1) toward its 108px floor.
// The spacing below is therefore height-NEUTRAL by construction: SLIDER_PAD*2 + SLIDER_GAP sums to
// exactly what the old (asymmetric) top+bottom+gap summed to, at the clamp floor, the vh midpoint,
// and the ceiling alike:
//     old  top 20/2.6vh/28  +  bottom 13/1.6vh/16  +  gap 20/2.8vh/26  =  53 / 7.0vh / 70
//     new  pad 17/2.1vh/22  x2                     +  gap 19/2.8vh/26  =  53 / 7.0vh / 70
// The bug was that the old tile padded ~24px on top (sized to clear the floating value numbers) but
// only PAD (~14px) on the bottom, so the lower slider sat visibly nearer its edge than the upper one
// did to its. Equal padding puts both tracks the same distance from their respective edges — and the
// budget is reclaimed from the gap, not borrowed from neighbouring tiles.
// The gap gives up 5px and the padding absorbs it (2.5px per side), so the two sliders pull toward
// the tile's centre while its TOTAL height is unchanged — 2*PAD + GAP still sums to 53 / 7.0vh / 70,
// exactly as before. That matters because this tile sits in an `auto` grid row: growing it steals
// height from the visualizer's 1fr and squeezes the disc/BPM band, and shrinking it just leaves a
// hole. Height-neutral is the only way to move these two without disturbing anything else.
//
// The gap's floor can't follow all the way down: the lower slider's value number floats UP into the
// gap, so anything below its headroom (4px lead + line box, ~16px at small type) would collide with
// the upper slider's track. Hence the 16px floor — the full 5px shift lands from ~1080px up and
// tapers to 3px at a 600px window, where the number itself is the binding constraint.
const SLIDER_PAD = 'clamp(18.5px, 2.35vh, 24.5px)'
const SLIDER_GAP = 'clamp(16px, 2.3vh, 21px)'

// Every pole word that can ever land on each side of a track — low poles left, high poles right —
// across all four presets AND any custom axis pairing. "Electronic" and "Instrumental" are the
// current long poles, but nothing here hardcodes that.
const LOW_POLES = [...new Set(Object.values(FEATURE_POLES).map((p) => p.low))]
const HIGH_POLES = [...new Set(Object.values(FEATURE_POLES).map((p) => p.high))]

// Zero-height invisible twins of every pole word, rendered inside each label cell. A grid `auto`
// column sizes to the widest content across all its cells, so this locks each label column to the
// widest word in the vocabulary — measured with REAL font metrics — and the slider track ends up the
// same length on every preset. Previously the columns sized to whatever the ACTIVE preset's words
// were, so "Electronic/Acoustic" produced a visibly shorter track than "Chill/Intense".
//
// Done this way rather than as a hardcoded px min-width so it can't silently clip: change the type
// or add a feature to the vocabulary and the column re-measures itself.
function PoleSizer({ words }) {
  return (
    <span aria-hidden="true" style={{ display: 'block', height: 0, overflow: 'hidden', visibility: 'hidden' }}>
      {words.map((w) => <span key={w} style={{ display: 'block' }}>{w}</span>)}
    </span>
  )
}

// `value` positions the knob on a 0–100 scale; `display` is the number rendered above it. They
// differ for BPM, where the knob is normalised but the readout stays raw — see AxisSliders.
function ReadonlySlider({ value, display, color, leftLabel, rightLabel }) {
  const has = value != null && !Number.isNaN(value)
  const pct = has ? Math.max(0, Math.min(100, value)) : 0
  const shown = has ? Math.round(display ?? value) : '—'
  // Three grid cells rather than a self-contained row: the parent is a 3-column grid, so both
  // sliders share one auto-sized label column and their tracks stay flush with each other. A fixed
  // label width can't survive preset-driven labels — "Instrumental" and "Electronic" are far wider
  // than "Chill", and sizing the column for the longest would starve the track on every other preset.
  // Labels anchor to the OUTER edges (left cell left-aligned, right cell right-aligned) so a word's
  // starting edge is the same on every preset and the text doesn't shift when you switch presets.
  // The columns are a fixed width either way, so the track never changes length; this only decides
  // which side of the label column the ragged edge falls on.
  return (
    <>
      <span style={{ ...labelStyle, textAlign: 'left', whiteSpace: 'nowrap' }}>
        {leftLabel}
        <PoleSizer words={LOW_POLES} />
      </span>
      <div style={{ position: 'relative', height: 17 }}>
        {/* Recessed track well */}
        <div style={{ position: 'absolute', top: 3, bottom: 3, left: 0, right: 0, borderRadius: 100, background: '#060606', boxShadow: INSET }} />
        {/* Filled portion */}
        <div style={{ position: 'absolute', top: 3, bottom: 3, left: 0, width: `${pct}%`, borderRadius: 100, background: color, boxShadow: 'inset -1px -1px 3px 0px #373737, inset 2px 2px 2px 0px #000000' }} />
        {/* Knob */}
        <div style={{ position: 'absolute', top: '50%', left: `${pct}%`, transform: 'translate(-50%,-50%)', width: 20, height: 20, borderRadius: '50%', background: color, border: `2px solid ${C.border}`, boxShadow: 'inset -1px -1px 3px 0px #373737, inset 2px 2px 2px 0px #000000' }} />
        {/* Value above the knob — its centre is clamped ~16px inside the track so the number never
            pokes past the tile's padding at the extremes (0 / 100). `lineHeight: 1` is load-bearing:
            it's a single line, so the default ~1.3 line box is pure slack, and trimming it is what
            frees the ~4px per number that lets the padding go symmetric without growing the tile. */}
        <div style={{ position: 'absolute', bottom: 'calc(100% + 4px)', left: `clamp(16px, ${pct}%, calc(100% - 16px))`, transform: 'translateX(-50%)', fontFamily: FONT, fontSize: F_SLIDER_VAL, fontWeight: 700, lineHeight: 1, color, whiteSpace: 'nowrap' }}>{shown}</div>
      </div>
      <span style={{ ...labelStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
        {rightLabel}
        <PoleSizer words={HIGH_POLES} />
      </span>
    </>
  )
}

// The two sliders follow the active Explore By preset rather than hardcoding Energy/Mood (Decision
// Log #67 — "switchable presets that swap both sliders"). Top slider = the preset's Y axis, bottom =
// its X axis, matching how the compass and map lay the axes out, so a song's position on the map and
// its slider readings describe the same two features. `resolvePreset` also covers the 'custom' key,
// where poles come from whichever features the user picked in the dropdowns.
function AxisSliders({ track }) {
  const { activePreset, customXFeature, customYFeature } = usePlaylistStore()
  const p = resolvePreset(activePreset, customXFeature, customYFeature)

  // getFeatureValue normalises everything to 0–100 (BPM's 60–180 raw range included), which is what
  // the knob position needs. The readout above the knob shows the RAW value for BPM — a knob at 55%
  // labelled "55" would be nonsense on a 126 BPM track — and the 0–100 value for every other feature.
  //
  // getFeatureValue also substitutes 50 for a missing feature. That's right for placing a song on the
  // map but wrong here: it would render absent data as a confident mid-scale reading. So check the raw
  // field first and pass null through, which ReadonlySlider renders as "—" on an empty track.
  const readout = (feature) => {
    const raw = track[feature]
    if (raw == null || Number.isNaN(raw)) return { value: null, display: null }
    return { value: getFeatureValue(track, feature), display: feature === 'bpm' ? raw : getFeatureValue(track, feature) }
  }

  return (
    <div style={{
      borderRadius: 20, padding: `${SLIDER_PAD} ${PAD_X}px`, flexShrink: 0,
      background: CARD, boxShadow: `${TILE_SHADOW}, ${TILE_LIP}`,
      // 3-column grid — [label | track | label] — so both rows share one label column width and the
      // two tracks line up however long the active preset's pole words are.
      display: 'grid', gridTemplateColumns: 'auto 1fr auto',
      alignItems: 'center', columnGap: 12, rowGap: SLIDER_GAP,
    }}>
      {/* Y axis (vertical on the map) — Chill→Intense on Vibe, Slow→Fast on Dancefloor, etc. */}
      <ReadonlySlider {...readout(p.yFeature)} color={ACCENT2} leftLabel={p.yLow} rightLabel={p.yHigh} />
      {/* X axis (horizontal on the map) — Dark→Bright on Vibe, Mellow→Groovy on Dancefloor, etc. */}
      <ReadonlySlider {...readout(p.xFeature)} color={ACCENT} leftLabel={p.xLow} rightLabel={p.xHigh} />
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
      <AxisSliders track={track} />
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
