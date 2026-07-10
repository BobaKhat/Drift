import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useAudio } from '../store/useAudioStore'

// Three.js particle visualizer (Slice 14, Decision #59 + #77). A radial field of additive-blended
// glowing points that runs off CACHED feature data — so it reacts for every visitor regardless of
// playback tier (#77). BPM drives the beat pulse + rotation, energy the spread + pulse amplitude,
// mood the colour ramp. When a preview is playing it layers the live AnalyserNode amplitude on top
// as a subtle enhancement. The rAF loop is gated on `active` (panel open) so a closed deck spends no
// GPU, and every Three resource is disposed on unmount.

const COUNT = 420

const clamp01 = (n) => Math.max(0, Math.min(1, n))

// Mean of a frequency-bin range from getByteFrequencyData (0–255), as a fraction of `scale` so each
// band lands ~0–1 in its typical energy range (bass runs hot, highs run cold).
function bandAvg(buf, lo, hi, scale) {
  const end = Math.min(hi, buf.length)
  let sum = 0
  for (let i = lo; i < end; i++) sum += buf[i]
  return clamp01(sum / Math.max(1, end - lo) / scale)
}
// mood 0→100 walks hue 265°(blue-purple) → 325°(magenta) → 385°=25°(orange), skipping the muddy
// green half of the wheel so low/high valence read as cool/warm. Used only as a fallback when the
// track has no vivid album-art colour.
const moodHue = (mood) => (265 + clamp01((mood ?? 50) / 100) * 120) % 360

// Parse an 'r, g, b' string (the cached album-art accent, same one that tints the glow + play button)
// into { h, s } fractions. Returns null when unparseable so the caller falls back to the mood hue.
function rgbStrToHS(str) {
  const m = typeof str === 'string' && str.match(/\d+/g)
  if (!m || m.length < 3) return null
  const [r, g, b] = m.slice(0, 3).map((v) => parseInt(v, 10) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h: h / 360, s }
}

// Soft round sprite (radial alpha falloff) so each point reads as a glow, not a hard dot.
function makeSprite() {
  const s = 64
  const cv = document.createElement('canvas')
  cv.width = cv.height = s
  const ctx = cv.getContext('2d')
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, s, s)
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export default function ParticleVisualizer({ track, active, artRgb }) {
  const { isPlaying, currentTrackId, engine } = useAudio()
  const mountRef = useRef(null)
  const glRef = useRef(null)       // { renderer, scene, camera, points, geometry, material, sprite, seeds, positions, colors }
  const rafRef = useRef(0)

  // Live params + audio read inside the rAF loop without rebuilding the scene.
  const paramsRef = useRef({ bpm: 120, energy: 50, mood: 50 })
  const audioRef = useRef({ playing: false, analyser: null, buf: null, on: false })

  useEffect(() => {
    paramsRef.current = {
      bpm: track?.bpm ?? 120,
      energy: track?.energy ?? 50,
      mood: track?.mood ?? 50,
      artRgb, // album-art accent → base particle colour (mood is the fallback)
    }
    // Recolour on track change / art-colour resolve (art or mood → hue, energy → brightness spread).
    const gl = glRef.current
    if (gl) writeColors(gl, paramsRef.current)
  }, [track?.id, track?.bpm, track?.energy, track?.mood, artRgb])

  useEffect(() => {
    // Only feed the analyser when THIS track is the one playing.
    audioRef.current.playing = isPlaying && currentTrackId === track?.id
    audioRef.current.analyser = engine?.analyser ?? null
    if (audioRef.current.analyser && !audioRef.current.buf) {
      audioRef.current.buf = new Uint8Array(audioRef.current.analyser.frequencyBinCount)
    }
  }, [isPlaying, currentTrackId, track?.id, engine])

  // —— Build + teardown (once) ————————————————————————————————————————————————————————
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const w = mount.clientWidth || 300
    const h = mount.clientHeight || 200

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(w, h)
    renderer.setClearColor(0x000000, 0) // transparent → the tile's #0F0F0F shows through
    mount.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 100)
    camera.position.z = 2.3

    // Per-particle seeds: a radial layout biased toward the centre (starburst), each with its own
    // pulse phase/speed + baked brightness.
    const seeds = new Float32Array(COUNT * 5) // angle, radius0, z, phase, speed
    const bright = new Float32Array(COUNT)
    for (let i = 0; i < COUNT; i++) {
      seeds[i * 5 + 0] = Math.random() * Math.PI * 2
      seeds[i * 5 + 1] = Math.pow(Math.random(), 0.6) // dense near centre
      seeds[i * 5 + 2] = (Math.random() - 0.5) * 0.4  // slight depth
      seeds[i * 5 + 3] = Math.random() * Math.PI * 2
      seeds[i * 5 + 4] = 0.6 + Math.random() * 0.8
      bright[i] = 0.45 + Math.random() * 0.55
    }

    const positions = new Float32Array(COUNT * 3)
    const colors = new Float32Array(COUNT * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))

    const sprite = makeSprite()
    const material = new THREE.PointsMaterial({
      size: 0.09,
      map: sprite,
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    })
    const points = new THREE.Points(geometry, material)
    scene.add(points)

    glRef.current = { renderer, scene, camera, points, geometry, material, sprite, seeds, bright, positions, colors }
    writeColors(glRef.current, paramsRef.current)

    const ro = new ResizeObserver(() => {
      const nw = mount.clientWidth || 1
      const nh = mount.clientHeight || 1
      renderer.setSize(nw, nh)
      camera.aspect = nw / nh
      camera.updateProjectionMatrix()
    })
    ro.observe(mount)

    return () => {
      ro.disconnect()
      cancelAnimationFrame(rafRef.current)
      geometry.dispose()
      material.dispose()
      sprite.dispose()
      renderer.dispose()
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement)
      glRef.current = null
    }
  }, [])

  // —— rAF loop, gated on `active` (panel open) ————————————————————————————————————————
  useEffect(() => {
    if (!active) return
    const gl = glRef.current
    if (!gl) return
    const start = performance.now()
    const posAttr = gl.geometry.getAttribute('position')

    const frame = (now) => {
      const t = (now - start) / 1000
      const { bpm, energy } = paramsRef.current
      const eFrac = clamp01(energy / 100)
      const beat = (bpm > 0 ? bpm : 120) / 60 // Hz
      const omega = beat * Math.PI * 2

      // PRIMARY reactive mode: split the live spectrum into bass/mid/high, each driving a distinct
      // behaviour. Bass → radial expansion/pulse, mid → turbulence, high → sparkle + brightness
      // flicker. When nothing is playing all three are 0 and the cached-feature ambient below drives.
      let bass = 0
      let mid = 0
      let high = 0
      const a = audioRef.current
      if (a.playing && a.analyser && a.buf) {
        a.analyser.getByteFrequencyData(a.buf)
        bass = bandAvg(a.buf, 0, 10, 205)   // ~0–215 Hz
        mid = bandAvg(a.buf, 10, 40, 160)   // ~215–860 Hz
        high = bandAvg(a.buf, 40, 256, 150) // ~860 Hz+ (headroom so drops spike vs. sit clipped)
      }

      const baseSpread = 0.55 + eFrac * 0.85 + bass * 0.32     // energy field + bass expansion
      const pulseAmp = (0.06 + eFrac * 0.2) + bass * 0.5       // bass drives the radial pulse
      const rot = t * (0.05 + beat * 0.03)                     // bpm → slow spin
      const turb = mid * 0.42                                  // mids → turbulence

      const seeds = gl.seeds
      const pos = gl.positions
      for (let i = 0; i < COUNT; i++) {
        const angle = seeds[i * 5 + 0]
        const r0 = seeds[i * 5 + 1]
        const z = seeds[i * 5 + 2]
        const phase = seeds[i * 5 + 3]
        const sp = seeds[i * 5 + 4]
        const pulse = Math.sin(t * omega * 0.5 + phase * sp)
        const r = r0 * baseSpread + pulse * pulseAmp * (0.4 + r0)
        const th = angle + rot
        let x = Math.cos(th) * r
        let y = Math.sin(th) * r
        if (turb) {
          x += Math.sin(t * 3.1 + phase * 7) * turb * (0.25 + r0 * 0.5)
          y += Math.cos(t * 2.7 + phase * 5) * turb * (0.25 + r0 * 0.5)
        }
        pos[i * 3 + 0] = x
        pos[i * 3 + 1] = y
        pos[i * 3 + 2] = z
      }
      posAttr.needsUpdate = true

      // Global brightness/size: beat breath (ambient) + bass body + high sparkle (fast flicker).
      const beatEnv = 0.5 + 0.5 * Math.sin(t * omega)
      const sparkle = high * (0.6 + Math.random() * 0.4)
      gl.material.size = 0.07 + eFrac * 0.05 + bass * 0.06 + high * 0.04
      gl.material.opacity = Math.min(1, 0.55 + 0.16 * beatEnv + bass * 0.12 + sparkle * 0.32)

      gl.renderer.render(gl.scene, gl.camera)
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafRef.current)
  }, [active])

  return <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
}

// Bake per-particle colour from the track's album-art accent (hue + saturation), falling back to the
// mood hue when no vivid colour was extracted. Energy adds a little per-particle lightness spread.
function writeColors(gl, params) {
  const art = rgbStrToHS(params.artRgb)
  const hue = art ? art.h : moodHue(params.mood) / 360
  // Nudge saturation up a touch (with a floor so a muted cover still reads as coloured, not grey).
  const sat = art ? Math.max(0.55, Math.min(0.95, art.s * 1.15)) : 0.8
  const eFrac = clamp01((params.energy ?? 50) / 100)
  const col = new THREE.Color()
  const colors = gl.colors
  for (let i = 0; i < COUNT; i++) {
    const light = 0.28 + gl.bright[i] * (0.28 + eFrac * 0.16)
    col.setHSL(hue, sat, Math.min(0.62, light))
    colors[i * 3 + 0] = col.r
    colors[i * 3 + 1] = col.g
    colors[i * 3 + 2] = col.b
  }
  gl.geometry.getAttribute('color').needsUpdate = true
}
