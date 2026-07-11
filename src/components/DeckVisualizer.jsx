import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { useAudio } from '../store/useAudioStore'
import { useAlbumColor } from './useAlbumColor'
import { C, INSET } from './import/tokens'

// Deck View hero visualizer (Slice 14, V3) — raymarched SDF ferrofluid on a fullscreen quad,
// modeled on the Dakd Jung / Soundkt ferrofluid speakers: dark glossy liquid suspended in a
// chamber, violently reshaped by sound. ONE continuous mass that deforms, elongates, splits and
// reforms — never a fixed sphere sprouting arms, never separate balls orbiting.
//
// PEER-BLOB ARCHITECTURE — there is no special "core" that sits at origin. Eight sphere blobs are
// peers; the resting sphere is the EMERGENT union of all of them overlapping at center. When audio
// plays, each blob is pulled outward along its own direction and the whole mass distorts: the
// center of gravity lurches toward the loudest band, and the entire body squashes/stretches along
// the dominant-frequency axis — so even the "middle" of the shape never holds still.
//
// Physics model — three forces:
//   MAGNETIC (= audio)   the only outward force. Each blob listens to one frequency band; that
//                        band's amplitude THIS FRAME sets the blob's target distance from origin
//                        and swells its radius. No audio → every target is 0 → resting sphere.
//                        No oscillators, no timers, no pre-programmed motion.
//   SURFACE TENSION      the smooth-min union, tiered: primaries/secondaries merge with fat
//                        k=0.40 bridges (taffy, not spikes) and capped extension so the main
//                        mass holds together; tertiaries (k=0.35) only ever lump the surface;
//                        satellites hang on thin k=0.15 necks — the ONLY pieces that detach.
//   VISCOUS DRAG         ASYMMETRIC — the signature ferrofluid feel. The liquid SNAPS toward a
//                        field change (stiff, lightly damped attack, allowed to overshoot) and
//                        OOZES back when the force drops (weak, heavily damped decay). If attack
//                        and decay feel the same speed, the physics are wrong.
//
// Per-song identity: a seeded RNG (hash of BPM + energy + mood) perturbs every blob's direction
// (golden-angle spread ±15–25°), radius (±15%) and stiffness (±10%), so two songs stretch in
// different directions even at identical volume. Song changes morph the configuration over 800ms.

// Tiered amplitude→distance curves (V3.1 §cohesion). Extension is capped per tier so the mass
// holds together: primaries are the big blobs that deform the main body but rarely separate,
// secondaries can form visible necks/peninsulas, tertiaries NEVER leave the mass (surface lumps
// only). Only the satellites are allowed to fully detach.
const CURVE_PRI = [[0, 0], [0.3, 0.2], [0.5, 0.45], [0.75, 0.7], [1, 0.95]]
const CURVE_SEC = [[0, 0], [0.3, 0.25], [0.5, 0.55], [0.75, 0.85], [1, 1.15]]
const CURVE_TER = [[0, 0], [0.3, 0.15], [0.5, 0.35], [0.75, 0.55], [1, 0.7]]

// The eight peers. rest = resting radius, band = analyser bins [from, to) the blob listens to,
// g = band gain (higher bins carry less byte energy, boosted to reach the same 0..1 range),
// curve/maxD = tiered extension mapping and hard cap (cohesion pull can never exceed it),
// z = flat-plane offset (all motion is XY; viewed head-on like the chamber's glass window).
const BLOBS = [
  { rest: 0.5, band: [0, 4], g: 1.0, curve: CURVE_PRI, maxD: 0.95, z: 0.05 }, // primary A — sub-bass / kick
  { rest: 0.45, band: [4, 12], g: 1.15, curve: CURVE_PRI, maxD: 0.95, z: -0.04 }, // primary B — bass
  { rest: 0.4, band: [12, 30], g: 1.4, curve: CURVE_SEC, maxD: 1.15, z: 0.03 }, // secondary A — low-mids
  { rest: 0.38, band: [30, 60], g: 1.7, curve: CURVE_SEC, maxD: 1.15, z: -0.05 }, // secondary B — high-mids
  { rest: 0.3, band: [60, 90], g: 2.0, curve: CURVE_TER, maxD: 0.7, z: 0.02 }, // tertiary A — presence
  { rest: 0.28, band: [90, 128], g: 2.4, curve: CURVE_TER, maxD: 0.7, z: -0.03 }, // tertiary B — highs
]
// Satellite droplets ride their parent blob's direction: invisible below parent amplitude 0.55,
// bud at the parent's tip above it, detach with a visible gap above 0.80.
const SATS = [
  { parent: 0, rest: 0.12, z: 0.09 },
  { parent: 3, rest: 0.1, z: -0.08 },
]
const N = BLOBS.length + SATS.length

// Asymmetric spring constants (per-frame units at 60fps; frame-normalised in the loop).
// `keep` is the velocity fraction retained each frame. Simulated numerically: attack reaches its
// target in ~3 frames (~50ms) with ~15% overshoot — the blob PUNCHES outward on a kick and
// bounces; decay takes ~50 frames to fall halfway — it oozes back through the carrier fluid.
// That ~15× asymmetry IS the ferrofluid feel: snap to the field, ooze back when it drops.
const ATK = { k: 0.32, keep: 0.63 }
const DEC = { k: 0.08, keep: 0.15 }
const SAT_DEC_KEEP = 0.22 // satellites keep more return velocity — they wobble and trail behind

const VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const FRAG = /* glsl */ `
precision highp float;

uniform vec2  uRes;         // drawing-buffer size (px)
uniform vec4  uBlob[${N}];  // xyz = blob centre, w = radius (satellites last, 0 = absorbed)
uniform vec3  uStretch;     // xy = dominant-frequency axis (unit), z = stretch amount 0..1
uniform vec3  uAlbum;       // album accent (0..1), pre-lerped in JS — tints chamber/rim/speculars,
                            // NEVER the fluid body (real ferrofluid is near-black)
uniform float uSpecI;       // specular intensity (tracks overall amplitude)
uniform float uMaxAmp;      // loudest band this frame — scales the surface turbulence
uniform float uTime;        // seconds — slow drift of the surface noise

#define STEPS 80
#define EPS 0.0005
#define FAR 20.0
#define K_PRI 0.40
#define K_TER 0.35
#define K_SAT 0.15

// Polynomial smooth min — the surface tension. K_PRI is tuned so two separating blobs drag a
// THICK ROUNDED BRIDGE of liquid between them (taffy being pulled): lower would thin it to a
// spike, higher would flatten the motion into bumps on a sphere.
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Squash-and-stretch: a whole-space transform along the dominant-frequency axis, so during loud
// passages even the merged middle of the mass becomes an ellipse.
vec3 stretched(vec3 p) {
  float sPar = 1.0 + uStretch.z * 0.2;
  float sPerp = 1.0 - uStretch.z * 0.1;
  float par = dot(p.xy, uStretch.xy);
  vec2 perp = p.xy - uStretch.xy * par;
  return vec3(uStretch.xy * (par / sPar) + perp / sPerp, p.z);
}

// ONE continuous surface: eight peer sphere-blobs smooth-min'ed together. The resting sphere is
// their overlap at origin — no blob is special. Bridge thickness is tiered: primaries and
// secondaries (1–3) merge with fat k=0.40 bridges so the main mass holds together aggressively,
// tertiaries (4–5) with 0.35, and only the satellites (6–7) hang on thin k=0.15 necks that can
// cleanly detach.
float blobs(vec3 q) {
  float d = length(q - uBlob[0].xyz) - uBlob[0].w;
  for (int i = 1; i < 4; i++) d = smin(d, length(q - uBlob[i].xyz) - uBlob[i].w, K_PRI);
  for (int i = 4; i < ${BLOBS.length}; i++) d = smin(d, length(q - uBlob[i].xyz) - uBlob[i].w, K_TER);
  for (int i = ${BLOBS.length}; i < ${N}; i++) d = smin(d, length(q - uBlob[i].xyz) - uBlob[i].w, K_SAT);
  return d;
}

// Marching field — the sample point is warped with low-frequency trig noise before the sphere
// distances, so the silhouette is irregular and lumpy like real fluid, not a union of ovals.
// Amplitude-scaled: near-smooth at idle (a calm drop, strength 0.015), visibly turbulent when
// loud (0.12) — the quiet↔loud contrast survives. The warp steepens the field's gradient by up
// to ~1 + ns·3, so d is rescaled to stay a conservative marching bound.
float map(vec3 p) {
  vec3 q = stretched(vec3(p.x, p.y * 1.15, p.z)); // gravity cheat: liquid settles wider than tall
  float ns = mix(0.015, 0.12, uMaxAmp);
  float wt = uTime * 0.4;
  vec3 w = q;
  w.x += ns * sin(q.y * 2.5 + wt * 1.1) * cos(q.z * 1.75 + wt * 0.8);
  w.y += ns * sin(q.z * 2.5 + wt * 0.9) * cos(q.x * 2.0 + wt * 1.2);
  w.z += ns * 0.3 * sin(q.x * 2.5 + wt * 0.7);
  float sPerp = 1.0 - uStretch.z * 0.1;
  return blobs(w) * sPerp / (1.15 * (1.0 + ns * 3.0)); // /1.15 keeps the y-compressed field a bound
}

// Unwarped field for normals: the warp is low-frequency, so the smooth gradient is a close match
// to the true one — and keeping the time-evolving noise out of the normals keeps the specular
// highlights stable instead of shimmering.
float mapSmooth(vec3 p) {
  return blobs(stretched(vec3(p.x, p.y * 1.15, p.z))) * (1.0 - uStretch.z * 0.1);
}

// Normal from the SDF gradient — central differences, eps 0.001, on the UNWARPED field.
vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    mapSmooth(p + e.xyy) - mapSmooth(p - e.xyy),
    mapSmooth(p + e.yxy) - mapSmooth(p - e.yxy),
    mapSmooth(p + e.yyx) - mapSmooth(p - e.yyx)));
}

// Cheap AO — the distance field sampled at four points along the normal. Darkens the bridge
// crotches where liquid folds back on itself.
float calcAO(vec3 p, vec3 n) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 1; i <= 4; i++) {
    float h = 0.04 + 0.05 * float(i);
    occ += (h - map(p + n * h)) * sca;
    sca *= 0.65;
  }
  return clamp(1.0 - 1.8 * occ, 0.0, 1.0);
}

// One Blinn-Phong lobe from a point light.
float glint(vec3 lp, vec3 p, vec3 n, vec3 rd, float shin) {
  vec3 l = normalize(lp - p);
  vec3 h = normalize(l - rd);
  return pow(clamp(dot(n, h), 0.0, 1.0), shin);
}

// The speaker chamber — everything a ray that misses the fluid sees. A glowing backplate disc
// at z = -1.5 (radius 1.8, soft spotlight falloff) framed by a thin dark metallic rim, like the
// Dakd Jung / Soundkt speakers. The near-black fluid reads as a silhouette against this glow —
// that back-lit contrast is the whole premium look. The plate carries the album tint per song.
vec3 chamber(vec3 ro, vec3 rd) {
  vec3 col = vec3(0.02); // void outside the chamber
  float t = (-1.5 - ro.z) / rd.z;
  if (t <= 0.0) return col;
  vec2 pp = (ro + rd * t).xy;
  float r = length(pp);

  // Backplate: soft off-white with the album tint, brighter at centre like a spotlight. Peaks
  // ~0.62 — below the bloom threshold, so it illuminates without blowing out.
  vec3 plate = mix(vec3(0.85, 0.85, 0.82), uAlbum, 0.15);
  float spot = 0.18 + 0.55 * exp(-r * r * 0.55);
  col = mix(col, plate * spot, smoothstep(1.80, 1.74, r));

  // Rim: thin dark metallic ring around the plate edge with a soft upper-left sheen — gives the
  // chamber a physical lip the fluid sits inside.
  float ring = smoothstep(1.74, 1.80, r) * (1.0 - smoothstep(1.90, 1.96, r));
  vec2 nrm = pp / max(r, 1e-4);
  vec3 ringCol = vec3(0.10) + vec3(0.10) * pow(clamp(dot(nrm, normalize(vec2(-0.55, 0.8))), 0.0, 1.0), 4.0);
  col = mix(col, ringCol, ring);
  return col;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;

  // Head-on, flat — like looking through the glass window of a ferrofluid speaker chamber.
  vec3 ro = vec3(0.0, 0.0, 4.0);
  vec3 rd = normalize(vec3(uv, -2.1));

  // Everything behind the fluid is the chamber: glowing backplate + metallic rim.
  vec3 bg = chamber(ro, rd);

  float t = 0.0;
  float d = FAR;
  for (int i = 0; i < STEPS; i++) {
    d = map(ro + rd * t);
    if (d < EPS || t > FAR) break;
    t += d; // full step — polynomial smin only underestimates distance, never overshoots
  }

  vec3 col = bg;
  if (d < EPS) {
    // Newton polish: two proportional steps land the hit exactly on the isosurface, killing the
    // distance-banding facets a plain threshold exit leaves behind.
    t += d;
    t += map(ro + rd * t);
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    float ao = calcAO(p, n);

    // Real ferrofluid is near-black — the album colour lives in the chamber, rim and specular
    // tint, never in the body. Two lights only (upper-left sweep + lower-right fill) at
    // shininess 256: sharp environmental reflections, not polka-dot glints; the backplate glow
    // does the rim/fill work a third light was faking.
    vec3 surf = vec3(0.012, 0.012, 0.014);
    vec3 specTint = mix(vec3(1.0), uAlbum, 0.15);
    vec3 rim = mix(vec3(0.15), uAlbum, 0.3);
    vec3 plateTint = mix(vec3(0.85, 0.85, 0.82), uAlbum, 0.15);

    float dif = clamp(dot(n, normalize(vec3(0.55, 0.8, 0.55))), 0.0, 1.0);
    float s0 = glint(vec3(-2.2, 2.2, 2.8), p, n, rd, 256.0);
    float s1 = glint(vec3(2.3, -1.8, 2.2), p, n, rd, 256.0);

    // Fresnel — SUBTLE. Just enough to read the silhouette edges, not alien-glow.
    float fre = pow(clamp(1.0 + dot(n, rd), 0.0, 1.0), 3.0);

    col = surf * (0.15 + 0.55 * dif) * ao;                       // near-black fluid body
    col += vec3(0.008);                                           // ambient — barely there; the chamber does the contrast
    col += rim * fre * 0.72;                                      // desaturated album edge glow
    col += plateTint * fre * fre * 0.22;                          // backplate glow wrapping the silhouette
    col += specTint * (s0 * 1.0 + s1 * 0.45) * 1.4 * (0.5 + 0.9 * uSpecI);
  }

  // Gentle tone curve — soft rolloff keeps highlights hot enough for the bloom threshold.
  col = col / (1.0 + col * 0.35);
  col = pow(col, vec3(0.92));
  gl_FragColor = vec4(col, 1.0);
}
`

const clamp01 = (v) => Math.min(1, Math.max(0, v))
const smooth01 = (v) => { const x = clamp01(v); return x * x * (3 - 2 * x) }

// Average of analyser byte bins [from, to) normalised to 0..1.
function band(freq, from, to) {
  let s = 0
  for (let i = from; i < to; i++) s += freq[i]
  return s / ((to - from) * 255)
}

// Band amplitude → blob target distance, piecewise-linear through the blob's tier curve
// (CURVE_PRI/SEC/TER above): 0 = merged into the mass, low = surface bulge, high = extended
// limb with a bridge back to the body. Caps differ per tier so the mass never scatters.
function ampToDist(curve, a) {
  for (let i = 1; i < curve.length; i++) {
    if (a <= curve[i][0]) {
      const [a0, d0] = curve[i - 1]
      const [a1, d1] = curve[i]
      return d0 + ((a - a0) * (d1 - d0)) / (a1 - a0)
    }
  }
  return curve[curve.length - 1][1]
}

// —— Per-song configuration (V3 §per-song blob directions) ————————————————————————————
// Deterministic per track: BPM + energy + mood hash → mulberry32 stream → each blob gets a
// golden-angle direction perturbed ±15–25°, a radius multiplier (0.85–1.15) and a stiffness
// multiplier (0.90–1.10). Two songs deform in visibly different directions and proportions.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function songConfig(track) {
  const bpm = Math.round(track?.bpm > 0 ? track.bpm : 120)
  const energy = Math.round(track?.energy ?? 50)
  const mood = Math.round(track?.mood ?? 50)
  const rng = mulberry32(((bpm * 73856093) ^ (energy * 19349663) ^ (mood * 83492791)) >>> 0)
  const golden = 2.39996 // 137.5°
  const a0 = rng() * Math.PI * 2
  const ang = [], rmul = [], kmul = []
  for (let i = 0; i < BLOBS.length; i++) {
    ang.push(a0 + i * golden + (rng() * 2 - 1) * (0.26 + rng() * 0.17)) // ±15–25° perturbation
    rmul.push(0.85 + rng() * 0.3)
    kmul.push(0.9 + rng() * 0.2)
  }
  return { ang, rmul, kmul }
}

// The fluid body is always near-black (set in the shader); the album colour only tints the
// chamber backplate (15%), the fresnel rim (30%) and the speculars (15%) — mixed in GLSL from
// this one raw accent, lerped over ~500ms on song change.
const FALLBACK_RGB = [0.5, 0.53, 0.62] // neutral slate when no album colour is available

export default function DeckVisualizer({ track, open }) {
  const { engine } = useAudio()
  const hostRef = useRef(null)
  const stateRef = useRef(null)

  // Album-art accent (same extraction as the ambient glow / track bar): 'r, g, b' or null.
  const albumRgb = useAlbumColor(track?.album_art_url)

  // Per-track targets, lerped toward inside the frame loop: colours crossfade over ~500ms, the
  // seeded blob configuration morphs over ~800ms — song switches glide, never snap.
  const featRef = useRef(null)
  featRef.current = {
    breatheHz: track?.bpm > 0 ? track.bpm / 60 : 0.5, // idle breathing rate — beat-synced
    album: albumRgb ? albumRgb.split(',').map((v) => Number(v) / 255) : null,
    cfg: songConfig(track),
  }

  // Build the Three.js pipeline once per mount.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' })
    } catch {
      return // no WebGL → leave the dark tile
    }
    const pr = Math.min(window.devicePixelRatio, 2)
    renderer.setPixelRatio(pr)
    // The shader outputs display-referred colour already; without this the composer's final copy
    // (colorspace_fragment in newer three) sRGB-encodes it a second time and washes everything out.
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace

    const f = featRef.current
    const c0 = f.album ?? FALLBACK_RGB
    const uniforms = {
      uRes: { value: new THREE.Vector2(1, 1) },
      uBlob: {
        value: [
          ...BLOBS.map((b) => new THREE.Vector4(0, 0, b.z, b.rest)),
          ...SATS.map((s) => new THREE.Vector4(0, 0, s.z, 0)),
        ],
      },
      uStretch: { value: new THREE.Vector3(0, 0, 0) },
      uAlbum: { value: new THREE.Vector3(...c0) },
      uSpecI: { value: 0.5 },
      uMaxAmp: { value: 0 },
      uTime: { value: 0 },
    }
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms,
      depthTest: false, depthWrite: false,
    })
    const geometry = new THREE.PlaneGeometry(2, 2)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    const scene = new THREE.Scene()
    scene.add(mesh)
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    // Subtle bloom so the wet speculars glow; auto-cut below a sustained 50fps (see frame()).
    let composer = new EffectComposer(renderer)
    composer.setPixelRatio(pr)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.4, 0.6)
    composer.addPass(bloom)

    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;'
    host.appendChild(renderer.domElement)

    const buf = new THREE.Vector2()
    const resize = () => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      composer?.setSize(w, h)
      uniforms.uRes.value.copy(renderer.getDrawingBufferSize(buf))
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)

    // Frame-loop state. THE RULE: audio is the only force that moves blobs outward. The asymmetric
    // springs below are the sole integrator — no oscillators, no timers, no motion without sound.
    const st = {
      last: 0,
      rot: Math.random() * 6.28, // slow global drift of all directions together (rad)
      breath: 0,                 // idle breathing phase (beat-synced sine)
      audio: 0,                  // live-audio blend 0↔1, smoothed so play/pause never pops
      amp: 0,                    // overall amplitude (specular intensity + bloom)
      breatheHz: f.breatheHz,
      // per-blob simulation
      bAmp: new Float32Array(BLOBS.length),  // this frame's band amplitude (raw, 0..1)
      rAmp: new Float32Array(BLOBS.length),  // fast-eased amplitude for the radius pulse
      tgt: new Float32Array(BLOBS.length),   // audio targets, cohesion-adjusted before the springs
      pos: new Float32Array(BLOBS.length),   // spring position: distance from origin
      vel: new Float32Array(BLOBS.length),
      px: new Float32Array(BLOBS.length),    // this frame's raw XY (pre-shift, pre-squish)
      py: new Float32Array(BLOBS.length),
      rad: new Float32Array(BLOBS.length),   // this frame's radius
      satPos: new Float32Array(SATS.length),
      satVel: new Float32Array(SATS.length),
      domX: 0, domY: 0,          // smoothed dominant-frequency vector (squash-and-stretch axis)
      time: 0,                   // surface-noise clock (seconds)
      maxAmp: 0,                 // eased loudest band — surface turbulence amount
      // per-song configuration, lerped toward featRef's target (~800ms morph)
      cfg: {
        ang: [...f.cfg.ang],
        rmul: [...f.cfg.rmul],
        kmul: [...f.cfg.kmul],
      },
      // album accent, lerped (~500ms crossfade)
      album: [...c0],
      freq: null,
      frames: 0, fpsAcc: 0, fpsN: 0, bloomOn: true,
    }

    st.frame = (now) => {
      const dt = Math.min(0.05, st.last ? (now - st.last) / 1000 : 0.016)
      st.last = now
      const fs = Math.min(1.1, dt * 60) // frame-normalised spring step

      // — audio: each blob's band amplitude, read fresh every frame. Analyser smoothing is 0.15
      // (very snappy) so individual drum hits arrive as spikes; the springs shape the motion.
      const an = engine.analyser
      const live = !!(engine.getSnapshot().playing && an)
      if (live) {
        if (!st.freq || st.freq.length !== an.frequencyBinCount) st.freq = new Uint8Array(an.frequencyBinCount)
        an.getByteFrequencyData(st.freq)
      }
      st.audio += ((live ? 1 : 0) - st.audio) * 0.06
      let ampSum = 0
      for (let i = 0; i < BLOBS.length; i++) {
        const b = BLOBS[i]
        st.bAmp[i] = live ? clamp01(band(st.freq, b.band[0], b.band[1]) * b.g) : 0
        // Radius pulse uses a fast ease so the silhouette swells rather than strobing.
        st.rAmp[i] += (st.bAmp[i] - st.rAmp[i]) * (st.bAmp[i] > st.rAmp[i] ? 0.5 : 0.25)
        ampSum += st.bAmp[i]
      }
      st.amp += (ampSum / BLOBS.length - st.amp) * 0.25

      // — per-track targets glide in: colours ~500ms, seeded blob configuration ~800ms (the shape
      // visibly morphs between songs), breathing rate follows the cached BPM.
      const ft = featRef.current
      st.breatheHz += (ft.breatheHz - st.breatheHz) * 0.08
      const cf = Math.min(1, dt * 4) // ≈800ms morph
      for (let i = 0; i < BLOBS.length; i++) {
        const da = ((ft.cfg.ang[i] - st.cfg.ang[i] + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI
        st.cfg.ang[i] += da * cf
        st.cfg.rmul[i] += (ft.cfg.rmul[i] - st.cfg.rmul[i]) * cf
        st.cfg.kmul[i] += (ft.cfg.kmul[i] - st.cfg.kmul[i]) * cf
      }
      const ca = ft.album ?? FALLBACK_RGB
      for (let i = 0; i < 3; i++) st.album[i] += (ca[i] - st.album[i]) * 0.08

      // — clocks: the global direction drift (barely perceptible within one preview) and the idle
      // breathing phase. Neither ever extends a blob.
      st.rot += dt * 0.03
      st.breath += dt * st.breatheHz
      const breathe = 0.03 * Math.sin(st.breath * 2 * Math.PI) * (1 - st.audio)

      // — audio targets (tiered curves), then NEIGHBOR COHESION: real fluid redistributes
      // pressure, so when the dominant blob punches outward, blobs whose directions are near it
      // get ~18% of its displacement added to their own targets (cosine falloff — the opposite
      // side barely feels it). The whole mass leans toward the kick instead of one arm poking
      // out. Additive to each blob's own audio target, capped at its tier's max extension.
      let mi = 0
      for (let i = 1; i < BLOBS.length; i++) if (st.bAmp[i] > st.bAmp[mi]) mi = i
      st.time += dt
      st.maxAmp += (st.bAmp[mi] - st.maxAmp) * (st.bAmp[mi] > st.maxAmp ? 0.4 : 0.15)
      for (let i = 0; i < BLOBS.length; i++) {
        st.tgt[i] = ampToDist(BLOBS[i].curve, st.bAmp[i]) * st.audio
      }
      for (let i = 0; i < BLOBS.length; i++) {
        if (i === mi) continue
        const fall = Math.max(0, Math.cos(st.cfg.ang[i] - st.cfg.ang[mi]))
        st.tgt[i] = Math.min(BLOBS[i].maxD, st.tgt[i] + 0.18 * st.tgt[mi] * fall)
      }

      // — springs: the cohesion-adjusted target drives ASYMMETRIC dynamics — stiff/lightly-damped
      // attack (snaps outward, overshoots), weak/heavily-damped decay (oozes back). Per-song
      // stiffness multipliers give each track its own micro-timing.
      for (let i = 0; i < BLOBS.length; i++) {
        const target = st.tgt[i]
        const attacking = target > st.pos[i]
        const k = (attacking ? ATK.k : DEC.k) * st.cfg.kmul[i]
        st.vel[i] += (target - st.pos[i]) * k * fs
        st.vel[i] *= Math.pow(attacking ? ATK.keep : DEC.keep, fs)
        st.pos[i] += st.vel[i] * fs

        const th = st.cfg.ang[i] + st.rot
        const dist = Math.max(0, st.pos[i])
        st.px[i] = Math.cos(th) * dist
        st.py[i] = Math.sin(th) * dist
        // Louder = the blob itself swells (mass visually breathes); idle = beat-synced breathing.
        st.rad[i] = BLOBS[i].rest * st.cfg.rmul[i] * (1 + st.rAmp[i] * 0.3) + breathe
      }

      // — center-of-mass sway: the whole body lurches toward the loudest band's side (kick hits
      // shove it toward the sub-bass blob, hat-heavy passages drift it the other way). Clamped to
      // ±0.15 so the mass never leaves frame; zero when idle.
      let mx = 0, my = 0, mw = 0
      for (let i = 0; i < BLOBS.length; i++) {
        mx += st.px[i] * st.rad[i]
        my += st.py[i] * st.rad[i]
        mw += st.rad[i]
      }
      const shx = Math.max(-0.15, Math.min(0.15, (mx / mw) * 0.5)) * st.audio
      const shy = Math.max(-0.15, Math.min(0.15, (my / mw) * 0.5)) * st.audio

      // — squash-and-stretch axis: toward the dominant blob, smoothed so dominance handoffs
      // rotate the axis instead of popping it. The shader elongates the WHOLE mass 1+0.2a along
      // it and squashes 1−0.1a across it — the merged middle becomes an ellipse.
      const domTh = st.cfg.ang[mi] + st.rot
      st.domX += (Math.cos(domTh) * st.bAmp[mi] - st.domX) * 0.12 * fs
      st.domY += (Math.sin(domTh) * st.bAmp[mi] - st.domY) * 0.12 * fs
      const domLen = Math.hypot(st.domX, st.domY)
      if (domLen > 1e-4) {
        uniforms.uStretch.value.set(st.domX / domLen, st.domY / domLen, Math.min(1, domLen) * st.audio)
      } else {
        uniforms.uStretch.value.set(0, 0, 0)
      }

      // 0.8 vertical squish matches the tile's landscape aspect so long extensions don't clip.
      for (let i = 0; i < BLOBS.length; i++) {
        uniforms.uBlob.value[i].set(st.px[i] + shx, (st.py[i] + shy) * 0.8, BLOBS[i].z, st.rad[i])
      }

      // — satellites: pure threshold on the parent blob's amplitude. Below 0.55 → radius 0,
      // absorbed. 0.55+ → buds out just past the parent's tip. 0.80+ → a gap opens and it visibly
      // detaches. Same asymmetric springs, but less decay damping — they wobble and trail behind.
      for (let i = 0; i < SATS.length; i++) {
        const s = SATS[i]
        const pi = s.parent
        const amp = st.bAmp[pi]
        const appear = smooth01((amp - 0.55) / 0.1)
        const free = smooth01((amp - 0.8) / 0.1)
        const tip = Math.max(0, st.pos[pi]) + BLOBS[pi].rest * st.cfg.rmul[pi] * 0.7
        // 1.35 cap: satellites are the furthest-flung pieces, but even they stay in frame.
        const target = Math.min(1.35, tip + s.rest + 0.2 * free) * appear * st.audio
        const attacking = target > st.satPos[i]
        st.satVel[i] += (target - st.satPos[i]) * (attacking ? ATK.k : DEC.k) * fs
        st.satVel[i] *= Math.pow(attacking ? ATK.keep : SAT_DEC_KEEP, fs)
        st.satPos[i] += st.satVel[i] * fs

        const th = st.cfg.ang[pi] + st.rot
        const dist = Math.max(0, st.satPos[i])
        uniforms.uBlob.value[BLOBS.length + i].set(
          Math.cos(th) * dist + shx,
          (Math.sin(th) * dist + shy) * 0.8,
          s.z,
          s.rest * appear * st.audio,
        )
      }

      uniforms.uAlbum.value.set(st.album[0], st.album[1], st.album[2])
      uniforms.uSpecI.value = 0.5 * (1 - st.audio) + (0.4 + 1.6 * st.amp) * st.audio
      uniforms.uMaxAmp.value = st.maxAmp * st.audio
      uniforms.uTime.value = st.time
      bloom.strength = 0.32 + 0.18 * st.amp * st.audio // stays within 0.3–0.5

      if (st.bloomOn && composer) composer.render()
      else renderer.render(scene, camera)

      // FPS guard: past the shader-compile warmup, average ~1.5s windows; a sustained miss of the
      // 50fps budget cuts bloom permanently (the raw shader must stand on its own).
      st.frames++
      if (st.bloomOn && st.frames > 40) {
        st.fpsAcc += dt
        st.fpsN++
        if (st.fpsN >= 90) {
          if (st.fpsN / st.fpsAcc < 50) {
            st.bloomOn = false
            composer.dispose()
            composer = null
          }
          st.fpsAcc = 0
          st.fpsN = 0
        }
      }
    }
    stateRef.current = st

    return () => {
      ro.disconnect()
      stateRef.current = null
      geometry.dispose()
      material.dispose()
      bloom.dispose()
      composer?.dispose()
      renderer.dispose()
      host.removeChild(renderer.domElement)
    }
  }, [engine])

  // The rAF loop only runs while the deck is open — a closed panel burns zero GPU (last frame
  // persists on the canvas for the slide-out).
  useEffect(() => {
    const st = stateRef.current
    if (!open || !st) return
    st.last = 0 // don't integrate the time the panel spent closed
    let raf = requestAnimationFrame(function tick(now) {
      raf = requestAnimationFrame(tick)
      stateRef.current?.frame(now)
    })
    return () => cancelAnimationFrame(raf)
  }, [open, engine])

  return (
    <div
      ref={hostRef}
      style={{
        position: 'relative', height: '100%', minHeight: 0, borderRadius: 20, overflow: 'hidden',
        background: '#0A0A0A', border: `1px solid ${C.border}`, boxShadow: INSET,
      }}
    />
  )
}
