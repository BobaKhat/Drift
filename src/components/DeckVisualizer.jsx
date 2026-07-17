import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { useAudio } from '../store/useAudioStore'
import { useAlbumColor } from './useAlbumColor'
import { C } from './import/tokens'

// Deck View hero visualizer (Slice 14, V8 — Chladni cymatics). 65,536 grains of sand on a
// vibrating plate. The plate's resonant modes are driven by the music's frequency peaks; grains
// migrate off the shaking regions and pile up along the nodal lines, where the plate is still.
// Physics run entirely in fragment shaders; the CPU only analyses audio, uploads uniforms, swaps
// ping-pong render targets, and draws.
//
// PIPELINE — two float texture PAIRS, 256×256, one texel per grain:
//   pos  (A/B)  xyz = live position (y = height above the plate), w = phase offset for vibration.
//   vel  (A/B)  xyz = live velocity, w = mass (per-grain force scale). Both are carried through
//               their pass untouched, so they act as per-particle constants.
// Each frame: velocity pass reads (pos, vel) → writes vel'; position pass reads (pos, vel') →
// writes pos'; the Points shaders sample BOTH to place, size and colour their vertices. Then swap.
// There is no home texture — grains have no rest position. They go wherever the current pattern's
// nodal lines are, and when the music moves the pattern, they migrate with it.
//
// THE PHYSICS — the plate is a DISC, so it rings in the CIRCULAR eigenmodes: a Bessel radial profile
// J_n(k·r) times an angular cosine cos(nθ + φ). Nodal lines are where displacement = 0, and for this
// field that set is a union of concentric CIRCLES (the zeros of J_n) and radial DIAMETERS (the zeros of
// the cosine) — so the plate draws rings, spokes and, where two modes interfere, rosettes. Sand is
// driven DOWN the gradient of displacement², i.e. away from the violently shaking antinodes and toward
// the still lines. That single force is the whole effect.
//
// The two things that stop it from looking like a math diagram are in the velocity pass and matter
// more than the Chladni math itself — see AGITATION and STICTION there.

const TEX = 256                    // texture edge; TEX² particles
const PARTICLE_COUNT = TEX * TEX   // 65,536
const PLATE_R = 1.8                // the plate's physical radius; the span the density map covers
const EDGE_R = 1.75                // grains are contained just inside the rim
const SPAWN_R = 1.70

// FIELD_R — the radius the mode field is normalised to, and it is deliberately NOT the plate radius.
//
// k is a zero of J_n, so J_n(k·r) vanishes at r = 1 BY CONSTRUCTION: whatever we divide by here becomes
// the figure's outermost nodal circle, and sand piles on it. Divide by PLATE_R and that circle lands at
// 1.8 — outside EDGE_R (1.75), where the position pass hard-clamps the grains. Every grain in the outer
// margin would then be seeking a nodal line it can never physically arrive at, and would spend the song
// pressed against the containment wall: a permanent smear of sand around the rim, on every track, eaten
// out of the figure.
//
// Set inside the rim's soft margin instead and the ring lands ON the plate. The outermost nodal circle
// becomes part of the figure rather than a wall artefact, and the margin beyond it stays dark — which is
// what the photographs of real circular plates look like.
const FIELD_R = 1.6
const DENSITY_TEX = 64             // density splat target; deliberately coarse — see DENSITY_VERT

// Bass transients (CPU) → a decaying kick (GPU) that briefly throws extra dust off the plate.
const BASS_ONSET = 0.15
const BASS_JUMP = 0.08

const FALLBACK_RGB = [0.5, 0.53, 0.62] // neutral slate when no album colour is available
const BG = 0x0a0a0a                    // matches the panel; there is no plate, so this IS the backdrop

// GLOW — flat across the catalogue. It used to scale with the track's cached energy, and that is
// deliberately gone: the sand should read as luminous on every record, not just the loud ones. The
// song is still legible in the FIGURE (mode selection is energy- and hash-driven and untouched) and
// in how hard the plate is being shaken; it is no longer legible in how brightly the grains burn.
//
// This drives the grains' own emission — the emissive term and the edge softness. It does NOT set the
// bloom any more; see below.
const GLOW = 1.0

// BLOOM — hand-tuned, and deliberately NOT derived from GLOW. Emission and bloom pull in opposite
// directions here and the single knob was hiding that. Emission is what makes a GRAIN look hot; bloom
// is what smears that heat into the black between the nodal lines, and past a certain strength it
// fills the cells and the figure stops being readable at all. The pattern is the subject, so the
// bloom is set to whatever still leaves the gaps empty, and the grains are made hot by the emissive
// instead — where the light stays ON the sand rather than spilling off it.
//
// Threshold stays low (only the brightest cores bloom at all); strength and radius are what got pulled
// back. Strength gets a small live-audio term on top of this each frame.
const BLOOM_STRENGTH = 0.228
const BLOOM_RADIUS = 0.04375
const BLOOM_THRESHOLD = 0.67

// —— THE BASS PULSE. Two terms, fired off the same decaying transient that already drives the hop, so a
// kick lands as ONE event: the sand jumps, the grains warm, and the glow breathes out around them.
//
// These are deliberately set for a LONG SIT. The brief is a breath of light on the kick, not a camera
// flash — this thing is on screen for the length of a record, and a hard strobe at 120bpm is 2Hz of
// full-frame luminance swing straight into the viewer's eyes for half an hour. Anything that reads as
// impressive in a five-second demo is the wrong answer here.
//
// BLOOM_PULSE lifts the strength 0.228 → 0.288 at the peak of a kick (+26%), decaying out over ~0.37s. It
// stays close to the baseline on purpose: 0.228 is not an arbitrary number but the level tuned to leave
// the gaps between the nodal lines EMPTY (see BLOOM_STRENGTH), and a bloom that closes those gaps does
// not merely look bright, it erases the figure. This brushes past that line for a moment rather than
// vaulting over it.
//
// BASS_FLASH is the same event on the grains themselves. It emits the ALBUM'S colour, not white — see
// the note where it is applied. It compounds with the bloom by design, and where it actually lands is
// not where you would expect.
const BLOOM_PULSE = 0.06
const BASS_FLASH = 0.08

// —— The lighting rig. Three lights, no shadows (65k points cannot afford a shadow map, and sand at
// this scale self-shadows into the fake AO term rather than casting). Directions are in the point
// sprite's space: +x right, +y up the screen, +z toward the camera.
const KEY_DIR = [0.5, 0.9, 0.3]      // warm, strong, high
const KEY_COLOR = [1.0, 0.95, 0.88]
const KEY_I = 0.85
const FILL_DIR = [-0.4, 0.5, -0.2]   // cool, soft, opposite — keeps the shadow side off pure black
const FILL_COLOR = [0.85, 0.9, 1.0]
const FILL_I = 0.25
const RIM_COLOR = [1.0, 0.95, 0.9]   // Fresnel edge light; directionless by design (see POINTS_FRAG)
const RIM_I = 0.4

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]).normalize()
const rgb = (a) => new THREE.Vector3(a[0], a[1], a[2])

const clamp01 = (v) => Math.min(1, Math.max(0, v))

// Average of analyser byte bins [from, to) normalised to 0..1.
function band(freq, from, to) {
  let s = 0
  for (let i = from; i < to; i++) s += freq[i]
  return s / ((to - from) * 255)
}

// MODE SELECTION — two axes, deliberately separated.
//
//   HOW BUSY the figure is  ← the track's audio features. A slow, calm record gets a big open
//                             figure; a fast, loud one gets a fine, intricate one. This is the part
//                             that has to stay musically honest.
//   WHICH figure it is      ← a hash of the track's identity. This is what a feature-only selector
//                             cannot give you: two 160bpm techno records have near-identical
//                             features and would otherwise land on the same shape forever. They are
//                             different songs, so they get different shapes.
//
// Features alone can't separate a catalogue (every dance record clusters); a hash alone would hand a
// folk ballad the busiest plate on the wall. Together: complexity picks the RANGE the mode numbers
// live in, the hash picks the exact numbers inside it.

// How busy. Energy leads, tempo backs it.
function complexityOf(track) {
  const bpmNorm = clamp01((((track?.bpm > 0 ? track.bpm : 120) - 70) / 110))
  return clamp01((track?.energy ?? 50) / 100) * 0.6 + bpmNorm * 0.4
}

function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i)
    h |= 0 // keep it a 32-bit int
  }
  return h
}

// mulberry32 — a tiny well-mixed PRNG. It exists here because slicing four values out of ONE 32-bit
// hash by dividing (abs/1e3, /1e6, /1e9 …) doesn't work: a 32-bit int tops out at ~2.1e9, so the
// /1e9 slice only ever yields 0, 1 or 2 and that mode number silently pins to the bottom of its
// range on every track in the library. Seeding a generator gives four genuinely independent draws.
function mulberry32(a) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Zeros of J_n — row n, column m is the m-th zero. This is what sets a mode's RADIAL spacing: the
// shader evaluates J_n(k·r) with r normalised to 1 at FIELD_R, so choosing k = the m-th zero clamps the
// plate's boundary to a nodal circle and lays m-1 more rings inside it. m = 1 gives a single ring at the
// rim; m = 4 gives four rings marching in toward the centre.
const BESSEL_ZEROS = [
  [2.4048, 5.5201, 8.6537, 11.7915],   // J0
  [3.8317, 7.0156, 10.1735, 13.3237],  // J1
  [5.1356, 8.4172, 11.6198, 14.7960],  // J2
  [6.3802, 9.7610, 13.0152, 16.2235],  // J3
  [7.5883, 11.0647, 14.3725, 17.6160], // J4
  [8.7715, 12.3386, 15.7002, 18.9801], // J5
  [9.9361, 13.5893, 17.0038, 20.3208], // J6
]

// max |J_n| over x ≥ 0 — the height of each function's tallest hump, and the reason the weights below
// get divided by it. J0 peaks at 1.0 (at the origin); every higher order is flatter, down to 0.35 at
// n = 6. Left alone, that means the field's amplitude quietly COLLAPSES as the angular mode number
// climbs — and |displacement| is not just the figure, it is what the vertical bounce, the agitation and
// the pile height all read as "how hard is the plate shaking HERE". A busy 6-spoke figure would come out
// with a third of the life of a simple ring. Dividing the peak out makes every mode ring at full scale.
//
// The first hump always falls on the plate: it sits at x ≈ 1.8…7.5 for n = 1…6, and the smallest k we
// ever pair with a given n is that n's FIRST zero, which by definition is further out than its first
// peak. So every mode genuinely attains ±1 somewhere inside the disc.
const BESSEL_PEAK = [1.0, 0.5819, 0.4865, 0.4344, 0.3996, 0.3742, 0.3541]

// Deterministic per song: same track, same figure, every time. `complexity` is passed in rather than
// derived so a mid-song drop can ask for a busier version of THIS song's figure — same hash, so the
// same fingerprint, just wound tighter.
function selectModeForTrack(track, complexity) {
  const c = clamp01(complexity ?? complexityOf(track))

  const seed = String(track?.id ?? `${track?.name ?? ''}${track?.artist ?? ''}`)
  const rnd = mulberry32(hashStr(seed))

  // ANGULAR mode number n — the count of nodal DIAMETERS, i.e. how many spokes the star has. n = 0 is a
  // pure bullseye (no angular variation at all), n = 5 a five-pointed rosette.
  //
  // Integer, and it has to be: cos(n·θ) only closes on itself going round the disc for whole n, and a
  // fractional one would tear the figure open along the θ = ±π seam. (The old rectangular field wanted
  // the opposite — deliberately NON-integer modes, to keep its nodal lines off the plate's square
  // boundary. That problem does not exist here: the boundary is a circle and FIELD_R puts it inside the
  // sand, so the boundary nodal line is a feature rather than a rim trap.)
  const maxN = Math.floor(2 + c * 4)   // chill: 0–2 spokes. intense: up to 6.
  const n1 = Math.floor(rnd() * (maxN + 1))
  let n2 = Math.floor(rnd() * (maxN + 1))

  // RADIAL mode number m — which zero of J_n we clamp the rim to, so: how many concentric rings.
  const maxM = Math.floor(1 + c * 3)   // chill: 1 ring. intense: up to 4.
  const m1 = Math.floor(rnd() * maxM)
  const m2 = Math.floor(rnd() * maxM)

  // Two IDENTICAL modes are not a superposition. cos(nθ+φ₁) + cos(nθ+φ₂) collapses by the sum-to-product
  // identity into a SINGLE cosine at a third phase, so the figure would silently fall back to one pure
  // eigenmode and lose all the interference structure the second term is here for. Rotate the second
  // term's spoke count off the first when they collide — which is not a rare accident to guard against
  // out of tidiness: a chill track draws m from a range of ONE, so it happens to a third of them.
  if (n1 === n2 && m1 === m2) n2 = (n2 + 1) % (maxN + 1)

  // Phase — rotates each term around the disc. Continuous, so two tracks that land on the same n and m
  // still get visibly different figures: the terms rotate against each other and interfere differently.
  const phi1 = rnd() * Math.PI * 2
  const phi2 = rnd() * Math.PI * 2

  // WEIGHTS, and they do two jobs at once.
  //
  // Unequal on purpose — at 50/50 the two terms interfere symmetrically and the figure comes out looking
  // machined. And normalised to sum to 1, then divided by each mode's Bessel peak, so the shader's field
  // function hands back a displacement ALREADY in -1..1 with no amplitude uniform of its own to divide
  // out. Everything downstream that reads |displacement| gets a number on a fixed scale, whatever mode
  // the track happens to have drawn.
  const a1 = 1.0
  const a2 = 0.5 + rnd() * 0.5
  const w = a1 + a2

  return {
    n1, k1: BESSEL_ZEROS[n1][m1], phi1, s1: (a1 / w) / BESSEL_PEAK[n1],
    n2, k2: BESSEL_ZEROS[n2][m2], phi2, s2: (a2 / w) / BESSEL_PEAK[n2],
  }
}

const MODE_KEYS = ['n1', 'k1', 'phi1', 's1', 'n2', 'k2', 'phi2', 's2']
const sameMode = (a, b) => !!a && !!b && MODE_KEYS.every((k) => a[k] === b[k])

// —— GPGPU passes. All render a fullscreen quad; vUv is the particle's texel address.
const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

// Seeds a target from a CPU-built DataTexture (used once, to prime pos/vel A and B).
const COPY_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uSource;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(uSource, vUv); }
`

// The mode field, shared by BOTH simulation passes.
//
// A figure is TWO circular eigenmodes superimposed, each packed into a vec4 as (n, k, φ, s):
//   n  angular mode number — the spoke count. Integer, 0..6.
//   k  the m-th zero of J_n — sets the rings. J_n(k·r) is zero at r = 1 and m-1 times inside it.
//   φ  phase — rotates the term around the disc.
//   s  weight, pre-divided by max|J_n| on the CPU (see BESSEL_PEAK). The pair is normalised so the
//      field comes back in -1..1 already, with no amplitude uniform for the shader to divide out.
//
// One mode alone is a real Chladni figure but a sterile one; two interfering is where the asymmetric,
// curved, interlocking patterns come from. Their weights are deliberately unequal — see the CPU side.
const FIELD = /* glsl */ `
uniform vec4 uOldA; uniform vec4 uOldB;   // the figure we're leaving
uniform vec4 uNewA; uniform vec4 uNewB;   // the figure we're heading to
uniform float uModeTransition;            // 0 = fully old, 1 = fully new

// —— BESSEL J_n, and it is the entire reason this file exists in its current form. A circular plate's
// eigenmodes are Bessel functions of the radius, not sines of x and y, and no amount of tuning a sin·sin
// field will bend its nodal set into rings — that field is separable in x and y, so its nodal lines are
// stuck on a rectangular lattice however the mode numbers are moved.
//
// J0 and J1 are the standard Abramowitz & Stegun rational approximations: a polynomial in x² below
// x = 8, an asymptotic amplitude/phase form above it. Everything up to J6 is built off them.
float besselJ0(float x) {
  float ax = abs(x);
  if (ax < 8.0) {
    float y = x * x;
    float ans1 = 57568490574.0 + y * (-13362590354.0 + y * (651619640.7
              + y * (-11214424.18 + y * (77392.33017 + y * (-184.9052456)))));
    float ans2 = 57568490411.0 + y * (1029532985.0 + y * (9494680.718
              + y * (59272.64853 + y * (267.8532712 + y * 1.0))));
    return ans1 / ans2;
  }
  float z = 8.0 / ax;
  float y = z * z;
  float xx = ax - 0.785398164;
  float p0 = 1.0 + y * (-0.1098628627e-2 + y * (0.2734510407e-4
           + y * (-0.2073370639e-5 + y * 0.2093887211e-6)));
  float q0 = -0.1562499995e-1 + y * (0.1430488765e-3 + y * (-0.6911147651e-5
           + y * (0.7621095161e-6 - y * 0.934935152e-7)));
  return sqrt(0.636619772 / ax) * (p0 * cos(xx) - z * q0 * sin(xx));
}

float besselJ1(float x) {
  float ax = abs(x);
  if (ax < 8.0) {
    float y = x * x;
    float ans1 = x * (72362614232.0 + y * (-7895059235.0 + y * (242396853.1
              + y * (-2972611.439 + y * (15704.48260 + y * (-30.16036606))))));
    float ans2 = 144725228442.0 + y * (2300535178.0 + y * (18583304.74
              + y * (99447.43394 + y * (376.9991397 + y * 1.0))));
    return ans1 / ans2;
  }
  float z = 8.0 / ax;
  float y = z * z;
  float xx = ax - 2.356194491;
  float p1 = 1.0 + y * (0.183105e-2 + y * (-0.3516396496e-4
           + y * (0.2457520174e-5 + y * (-0.240337019e-6))));
  float q1 = 0.04687499995 + y * (-0.2002690873e-3 + y * (0.8449199096e-5
           + y * (-0.88228987e-6 + y * 0.105787412e-6)));
  float ans = sqrt(0.636619772 / ax) * (p1 * cos(xx) - z * q1 * sin(xx));
  return x < 0.0 ? -ans : ans;
}

// The ascending series. This is NOT a fast path — it is the only thing that makes the recurrence below
// usable at all, and leaving it out is the single easiest way to wreck this shader.
//
// The recurrence J_{n+1} = (2n/x)·J_n - J_{n-1} multiplies its input error by 2n/x at every step. For
// x >= n that factor is ≤ 2 and it is harmless. For x << n — which is the whole MIDDLE OF THE PLATE,
// where the argument k·r goes to zero — it is a catastrophic-cancellation machine: at x = 0.1 it turns
// the ~1e-7 error in a float32 J0 into an O(0.1) answer for J6, whose true value is 1e-11. That is not a
// rounding artefact you can squint past. It is a large false displacement painted over the centre of
// every high-order figure, and the sand would dutifully organise around it.
//
// So: recurrence only where it is stable, and the series everywhere else. The series converges fast and
// without cancellation exactly where the recurrence does not (its largest term is ~1.3 against a sum of
// ~0.25 at the very worst point, x = n = 6), and the two agree to ~5 digits at the x = n handover, so
// the field is continuous across the seam.
float besselSeries(float n, float x) {
  float h = x * 0.5;
  float term = 1.0;
  for (int i = 1; i <= 6; i++) {          // term = h^n / n!
    if (float(i) > n) break;
    term *= h / float(i);
  }
  float sum = term;
  float h2 = h * h;
  for (int m = 1; m <= 8; m++) {          // T_m = T_{m-1} · -h² / (m(m+n))
    term *= -h2 / (float(m) * (n + float(m)));
    sum += term;
  }
  return sum;
}

// n is an integer 0..6 and x = k·r is never negative, so there is no sign or high-order handling here
// beyond the stability split.
float besselJ(float n, float x) {
  if (n < 0.5) return besselJ0(x);
  if (n < 1.5) return besselJ1(x);
  if (x < n) return besselSeries(n, x);

  float jPrev = besselJ0(x);
  float jCurr = besselJ1(x);
  for (int i = 1; i < 6; i++) {
    if (float(i) >= n) break;
    float jNext = (2.0 * float(i) / x) * jCurr - jPrev;
    jPrev = jCurr;
    jCurr = jNext;
  }
  return jCurr;
}

// The plate's displacement at a point: two eigenmodes, each a Bessel radial profile times an angular
// cosine. The nodal set — where this is zero — is a union of concentric CIRCLES (the zeros of J_n, laid
// out by k) and radial DIAMETERS (the zeros of the cosine, counted by n), which is the whole upgrade:
// rings, spokes, and the curved rosettes that appear where the two terms interfere.
float circularChladni(vec2 p, vec4 a, vec4 b) {
  float r = length(p);
  // atan(0, 0) is undefined and would hand back a NaN that propagates into the grain's velocity and
  // never leaves. Guarding it costs nothing and loses nothing: at this radius an n >= 1 term is ~0
  // anyway (J_n vanishes like r^n at the origin) and an n = 0 term has no angular dependence at all, so
  // there is no angle the field could be sensitive to here.
  float th = r > 1e-4 ? atan(p.y, p.x) : 0.0;

  return besselJ(a.x, a.y * r) * cos(a.x * th + a.z) * a.w
       + besselJ(b.x, b.y * r) * cos(b.x * th + b.z) * b.w;
}

// Plate displacement, already normalised to -1..1 (the CPU pre-scales the weights). Both endpoints are
// real eigenmode superpositions, and a linear combination of two solutions is itself a solution, so
// every intermediate frame of a crossfade is still a displacement field a real plate could hold — the
// plate is simply ringing at both figures at once, which is exactly what one does while being driven
// from one resonance to another. The gradient must be taken on this blended sum, not per-mode.
//
// The two guards are not micro-optimisation. Settled is the state the plate is in almost all of the
// time, and skipping the dead mode there halves the Bessel work in both simulation passes — which is
// most of the frame's cost. uModeTransition is a uniform, so the branch is coherent across every
// fragment on the GPU and is genuinely free.
float fieldAt(vec2 p) {
  if (uModeTransition >= 1.0) return circularChladni(p, uNewA, uNewB);
  if (uModeTransition <= 0.0) return circularChladni(p, uOldA, uOldB);
  return mix(circularChladni(p, uOldA, uOldB), circularChladni(p, uNewA, uNewB), uModeTransition);
}

// Height of the sand pile at a point. Grains that reach a nodal line don't all lie flat at y=0 —
// they stack, and the stack is what turns a line into a RIDGE you can read from a raked camera.
// Per-grain phase scatters the rest height so the ridge has a rough, granular top instead of a
// moulded plastic one.
float pileHeight(float disp, float phase) {
  float nearNode = 1.0 - smoothstep(0.0, 0.12, abs(disp));
  return nearNode * 0.05 * (0.35 + phase * 1.3);
}
`

// VELOCITY PASS — every force lives here. Reads pos/vel, writes the new velocity.
const VELOCITY_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uPositionTexture;
uniform sampler2D uVelocityTexture;
uniform sampler2D uDensityTexture;  // 64×64 splat of where the grains currently are
uniform float uTime;
uniform float uDeltaTime;
uniform float uBass;
uniform float uMids;
uniform float uHighs;
uniform float uAmplitude;     // overall audio energy 0..1 — how hard the plate is being driven
uniform float uBassImpulse;   // decaying bass-transient burst 0..1
uniform float uAmbient;       // cached-energy tremble for when nothing is playing
uniform float uIdle;          // 1 = silent, 0 = playing

${FIELD}

#define FIELD_R ${FIELD_R.toFixed(2)}
#define EDGE_R ${EDGE_R.toFixed(2)}
#define PLATE_SPAN ${(PLATE_R * 2).toFixed(2)}

// Migration: acceleration toward the nodal lines, per frame at 60fps. Budget from the TARGET SPEED,
// not from the force: xz damping keeps 97% per frame, so a constant force compounds to F/(1-0.97) =
// 33F. A grain crossing a cell in a couple of seconds wants ~0.012 units/frame, which is F ≈ 0.0004.
//
// This runs at 1.5× that. The extra is bought to CLEAR THE CELLS: migration and AGITATION are in
// equilibrium, and the balance point sets both how wide a nodal line is and how much loose sand hangs
// between the lines. At the budgeted force the figure was legible but hazy — enough strays mid-cell to
// grey out the gaps, and with the bloom on, that haze filled them in. Winding migration up biases the
// equilibrium toward the lines: they tighten and the cells empty.
//
// What this does NOT fix is the grains stranded at the antinode PEAKS, where grad(d²) vanishes and
// STICTION pins them regardless of how strong this is (see STICTION — those strays are on purpose).
// If the cells still are not clean enough, STICTION is the knob, not this one.
#define MIGRATE 0.0006

// AGITATION — the plate is shaking, so grains random-walk. This is not a garnish: without it every
// grain settles onto the mathematical zero of the field and the plate renders as clean one-pixel
// vector curves — a diagram, not an experiment. A line's WIDTH is the equilibrium between the
// migration force pulling grains in and this jitter pushing them out, which is exactly how it works
// on a real plate. Scaled by amplitude, so loud passages throw up dust and quiet ones sharpen.
#define AGITATION 0.0026

// STICTION — a grain won't slide until the force on it beats friction. The payoff is the strays:
// grad(d²) = 2d·grad(d) vanishes at the antinode PEAKS as well as on the nodal lines, so grains
// stranded mid-cell have almost nothing pushing them anywhere and simply sit there, which is where
// the scattered grains between the lines come from. Drop this to 0 and the cells go sterile; push it
// past ~0.35 and so many grains strand that the cells fog over and the figure loses its edge.
#define STICTION 0.24

// GRAD_SAT — the half-saturation point of the migration force (see MIGRATION below, where the raw
// gradient is turned into a 0..1 magnitude by gm/(gm + GRAD_SAT)). It was 4.0 under the old field and
// it CANNOT stay there, because the two fields' gradients are not on remotely the same scale.
//
// The gradient of a sin·sin field scales with π·n, so with mode numbers in 2…8 it never fell below ~6.
// The gradient of a Bessel field scales with k, and k is a zero of J_n — which for the simplest figure
// this thing can draw, a single bare ring (n = 0, m = 1), is 2.4. A field that gentle produces grad(d²)
// under 1.0, which at the old half-saturation lands at sat ≈ 0.2: BELOW the stiction gate for most of
// the grains. The simple figures — exactly the ones a chill record gets, and the ones that most need to
// read cleanly — would simply never form. The sand would sit where it spawned.
//
// 0.6 is where the new field reproduces the old one's behaviour, and the quantity held fixed to get
// there is the fraction of the plate whose gradient beats the stiction gate — i.e. how much of it the
// sand can actually be DRIVEN across. Swept over a synthetic catalogue against the old field as the
// baseline, that fraction comes out at a median of 0.69 (old: 0.72) and a 95th percentile of 0.82 (old:
// 0.80), so the equilibrium between this, AGITATION and SPREAD — and therefore the WIDTH of a nodal
// line — carries over intact.
//
// It is tempting to keep winding this down, since smaller means stronger migration and tighter lines.
// Don't: by 0.1 the drivable fraction is past 0.9, which means almost nothing is left stranded, and the
// grains stranded mid-cell are not a defect. They are the scattered sand between the lines, and they
// are the whole difference between a photograph and a vector plot. STICTION is the knob for cell
// cleanliness; this one only sets whether the figure forms at all.
#define GRAD_SAT 0.6

// The outer margin where the rim's inward restoring force acts. It starts well outside the body of
// the figure (the plate runs to 1.75) so it drains the edge without compressing the pattern. Pull it
// in much further — a pull from, say, 1.2 covers 55% of the disc's AREA and would squeeze the outer
// nodal lines inward into a false ring.
#define RIM_SOFT 1.63
#define RIM_RETURN 0.0004

// SPREADING — grains push each other sideways, so a nodal line is a BAND with a thick core and
// sparse shoulders, not a hairline. Read as a gradient off the density splat and applied against
// MIGRATE: at a saturated gradient this is comparable to the seek force, so the pile widens until
// its own density gradient flattens and the two balance. That equilibrium IS the line's width.
//
// The raw gradient is unusable as a force. Density is an unbounded additive accumulation (65k grains
// splatting into 4k texels — a packed nodal line reads several units per texel), so scaling it by a
// constant, as the obvious formulation does, produces forces two orders of magnitude past MIGRATE and
// blows the plate apart on the first frame the sand gets anywhere near organised. Same fix as the
// migration force below it: DIRECTION from the gradient, saturating 0..1 magnitude.
#define SPREAD 0.0003
#define DENS_STEP 0.02

// Gravity, lowered from 0.008 so a hop reads. Hang time is 2v/g frames: a bass hop leaves the
// surface at ~0.06/frame, so 24 frames ≈ 0.4s in the air, peaking ~0.35 units up.
#define GRAVITY 0.005

// The two hops. Both are budgeted as an INTEGRAL, not a per-frame force, and both are gated to
// grounded grains — which is also what makes them self-limiting: a grain only receives the kick for
// the one or two frames before it leaves the surface, and then it is ballistic.
#define TRANS_HOP 0.030   // song change: grains stranded far off the incoming figure jump for it
#define BASS_HOP 0.018    // kick drum: grains over the antinodes LAUNCH, grains on the lines don't

varying vec2 vUv;

// Cheap per-grain, per-frame white noise.
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
}

void main() {
  vec4 pos = texture2D(uPositionTexture, vUv);
  vec4 vel = texture2D(uVelocityTexture, vUv);

  vec3 position = pos.xyz;
  vec3 velocity = vel.xyz;
  float phase = pos.w;   // 0..1, desynchronises the vertical bounce
  float mass = vel.w;    // 0.7..1.3 — light grains migrate faster and bounce higher

  // Forces below are tuned in per-frame units at 60fps.
  float fs = clamp(uDeltaTime * 60.0, 0.0, 2.0);

  vec2 pp = position.xz / FIELD_R;   // field coords: r = 1 is the figure's outermost nodal circle

  // —— Displacement and the gradient of its square, by forward difference on the SUMMED field.
  float e = 0.005;
  float d = fieldAt(pp);
  float dx = fieldAt(pp + vec2(e, 0.0));
  float dy = fieldAt(pp + vec2(0.0, e));
  vec2 grad = 2.0 * d * vec2(dx - d, dy - d) / e;

  // Displacement is already -1..1: the mode weights are pre-normalised on the CPU, and each is divided
  // by its own Bessel peak, so the vibration and agitation below read the same scale on every figure.
  float dn = d;

  // The surface this grain rests on: the plate, plus whatever sand has piled up here.
  float floorY = pileHeight(dn, phase);

  // —— 1. MIGRATION toward the nodal lines. The raw gradient magnitude scales with PI*n and with
  // the mode weights, so at high modes it runs into the hundreds — feeding it in raw would fling
  // grains off the plate the instant a hi-hat pushed the modes up. Take the DIRECTION from the
  // gradient and a saturating 0..1 magnitude from it, so the force has a hard ceiling.
  float gm = length(grad);
  float sat = gm / (gm + GRAD_SAT);
  bool sliding = length(velocity.xz) > 0.002;   // already moving → kinetic, not static, friction

  float r = length(position.xz);
  bool nearRim = r > RIM_SOFT;

  // The music no longer chooses the FIGURE — it drives how hard the plate is being shaken, and so
  // how urgently the sand seeks it. Loud passages: grains hunt the nodal lines fast. Sparse ones:
  // they drift. Mids (melody, vocals) sharpen the seek further; a mid-heavy section visibly pulls
  // the figure into focus. The 0.5 floor is what lets the pattern still form while paused.
  //
  // The transition term is the recovery: while the field is crossfading to a new figure the sand has
  // to cross the plate, and at the normal seek rate it doesn't all get there before the music moves
  // on. 4× at the start of a crossfade, easing to 1× once settled.
  float seek = (0.5 + uAmplitude * 1.2) * (1.0 + uMids * 0.5)
             * (1.0 + (1.0 - uModeTransition) * 3.0);

  // STICTION is suspended at the rim. Static friction is what strands grains mid-cell (the point of
  // it), but a grain pressed against the rim wall sits where the field's gradient is weakest, so the
  // gate never opens and it is pinned there FOREVER. That turns the rim into a one-way trap.
  if (gm > 1e-6 && (sat > STICTION * mass || sliding || nearRim)) {
    velocity.xz -= (grad / gm) * (MIGRATE * seek * sat / mass) * fs;
  }

  // —— 1b. SPREADING — push down the density gradient, away from where the sand already is. This is
  // the grain-on-grain contact the simulation otherwise has no notion of at all: without it, every
  // grain's equilibrium is the same mathematical curve and the entire pile collapses onto a line with
  // no width, which no real plate has ever produced.
  vec2 duv = position.xz / PLATE_SPAN + 0.5;
  float dL = texture2D(uDensityTexture, duv - vec2(DENS_STEP, 0.0)).r;
  float dR = texture2D(uDensityTexture, duv + vec2(DENS_STEP, 0.0)).r;
  float dD = texture2D(uDensityTexture, duv - vec2(0.0, DENS_STEP)).r;
  float dU = texture2D(uDensityTexture, duv + vec2(0.0, DENS_STEP)).r;
  vec2 dgrad = vec2(dR - dL, dU - dD);
  float dgm = length(dgrad);
  if (dgm > 1e-5) {
    float dsat = dgm / (dgm + 2.0);
    velocity.xz -= (dgrad / dgm) * (SPREAD * dsat / mass) * fs;
  }

  // —— 2. AGITATION. The 0.3 floor is the important term: it keeps jostling grains that are already
  // ON a line (where |dn| = 0 and the vibration term below is silent), and that is what gives the
  // line its ragged edge.
  float drive = mix(0.15, 1.0, uAmplitude) + uBassImpulse * 0.6;  // idle floor keeps the sand alive
  float ag = AGITATION * drive * (0.3 + 0.7 * abs(dn)) / mass;
  velocity.xz += hash22(vUv * 137.0 + uTime * 13.7) * ag * fs;

  // —— 3. THE SURFACE. Everything below acts only on grains in CONTACT with it. The grounded gate
  // is what keeps a hop ballistic: a grain that has left the plate is in free flight and cannot be
  // pushed further up by a surface that is no longer touching it. Ungate any of these and the kick
  // keeps compounding for as long as the condition holds — the transition hop in particular sums to
  // ~40 frames of force and fires the entire plate's worth of sand into the camera.
  bool grounded = position.y < floorY + 0.01;

  if (grounded) {
    // 3a. VERTICAL BOUNCE. Grains sitting on a violently moving part of the plate get thrown off it;
    // grains on a nodal line never leave the surface. |dn| is the local shake amplitude, so the
    // airborne dust appears exactly over the antinodes and the lines stay crisp.
    float vibeAmp = abs(dn) * (uAmplitude + uBassImpulse * 0.8) * 0.05;
    float vibeHz = 3.0 + uBass * 8.0;
    velocity.y += max(sin(uTime * vibeHz + phase * 6.2831) * vibeAmp, 0.0) / mass;

    // 3b. MICRO-VIBRATION. The plate is being driven, so its surface is never still and neither is
    // anything resting on it. Amplitude-scaled, so it is the difference between sand that is settled
    // and sand that is settled ON SOMETHING RUNNING. Sub-visible per frame; the read is that the
    // figure breathes rather than sitting there like a printed image.
    velocity.y += sin(uTime * 10.0 + phase * 40.0) * uAmplitude * 0.003 * fs / mass;

    // Highs → fine shimmer. A hi-hat section makes the whole plate tremble at grain scale without
    // touching the macro figure.
    velocity.y += sin(uTime * 18.0 + phase * 60.0) * uHighs * 0.002 * fs / mass;

    // 3c. TRANSITION HOP. While the field is crossfading, a grain sitting far from the INCOMING
    // figure's nodal lines is standing on a part of the plate that is about to start shaking hard —
    // so it jumps. This is what makes a song change read as an event: the sand visibly leaps and
    // re-lands rather than sliding across the plate like filings under a magnet.
    if (uModeTransition < 0.98) {
      float newDn = circularChladni(pp, uNewA, uNewB);
      velocity.y += abs(newDn) * TRANS_HOP * (1.0 - uModeTransition) * fs / mass;
    }

    // 3d. BASS TRANSIENT → the plate gets HIT and the sand launches, hardest over the antinodes. The
    // 0.2 floor keeps a kick faintly felt even on the lines, where |dn| = 0.
    //
    // How much a grain actually receives is NOT uBassImpulse's full decay envelope, and it is worth
    // being precise about that because it is what makes this constant safe to push. The kick is gated on
    // the grounded flag, and a launched grain clears the surface within a frame or two — after which it is
    // ballistic and this term can no longer reach it. So it collects one or two frames of force, not the
    // ~10 the envelope lasts. That is a self-limiter: the kick cannot compound into an escape velocity
    // however hard it is driven, which is exactly what the ungated version of this would do.
    //
    // At 0.018 a bass hit throws an antinode grain to ~0.36 world units, against the ~0.03 it is already
    // bouncing at between kicks — a ~12× jump, and unmistakably a LAUNCH rather than a shuffle. The
    // camera looks straight down from 4.4, so that height reads as the grain swelling and brightening
    // into the lens (point size goes as 1/depth, and there is a 2.2× airborne swell on top). Grains ON
    // the nodal lines rise 0.005 and stay put, so the figure itself holds through the hit.
    velocity.y += uBassImpulse * (0.2 + 0.8 * abs(dn)) * BASS_HOP * fs / mass;

    // Idle: the plate is never quite still. A trembling surface, no migration. Depth from the
    // track's cached energy, so a loud song still reads as a loud song sitting paused.
    velocity.y += sin(uTime * 1.0 + phase * 6.2831) * uAmbient * uIdle;
  }

  // —— 3e. XZ MICRO-JITTER — grains shuffling in place. Unlike the vertical terms this one is not
  // gated: it is small enough not to disturb a ballistic arc, and gating it would make airborne
  // grains fall in unnaturally straight lines.
  velocity.x += sin(uTime * 7.3 + phase * 31.0) * uAmplitude * 0.001 * fs;
  velocity.z += cos(uTime * 8.7 + phase * 37.0) * uAmplitude * 0.001 * fs;

  // The horizontal kick is RANDOM per grain, not radially outward. A struck plate throws sand up and
  // rattles it; it does not blow it away from the centre. An outward-only shove is a DC pump — every
  // kick drives grains toward the rim, nothing drives them back, and over a few minutes of music the
  // sand ratchets into the edge and the figure visibly hollows out. This is a shake, and it sums to
  // zero.
  velocity.xz += hash22(vUv * 71.3 + uTime * 7.1) * uBassImpulse * 0.0015 * fs / mass;

  // —— 4. Gravity, and the landing. The grain lands on the PILE, not on the plate: floorY rises
  // toward the nodal lines, so arriving grains come to rest on top of the ones already there.
  velocity.y -= GRAVITY * fs;

  if (position.y + velocity.y * fs < floorY) {
    velocity.y *= -0.2;     // sand barely bounces; it mostly just lands
    velocity.xz *= 0.8;     // and skids to a stop when it does
  }

  // —— 5. Rim. This used to be a wall that both killed 80% of a grain's speed AND left it sitting in
  // the weakest part of the field, where stiction pinned it. Grains went in and never came out, so
  // every song change ratcheted a few more percent of the sand into the edge and the figure thinned.
  //
  // Now it drains instead of collecting: a soft inward restoring force across the outer margin, and
  // the wall merely CANCELS outward motion rather than reflecting and absorbing it — grains keep
  // their tangential speed and slide along the rim until the field or this force takes them back in.
  // The margin starts at RIM_SOFT, well outside the body of the figure, so the pattern itself is
  // untouched.
  if (nearRim) {
    vec2 outward = position.xz / max(r, 1e-5);
    velocity.xz -= outward * smoothstep(RIM_SOFT, EDGE_R, r) * RIM_RETURN * fs / mass;
    float vOut = dot(velocity.xz, outward);
    if (vOut > 0.0) velocity.xz -= outward * vOut;   // stop at the wall; don't bounce, don't absorb
  }

  // —— 6. Friction. XZ is the plate's surface drag, Y is air.
  velocity.xz *= pow(0.97, fs);
  velocity.y *= pow(0.99, fs);

  gl_FragColor = vec4(velocity, mass);
}
`

// POSITION PASS — pure integration, plus the hard surfaces. The velocity pass has already turned
// the velocity around at the floor and the rim; these clamps only keep a large dt from tunnelling
// a grain through either.
const POSITION_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uPositionTexture;
uniform sampler2D uVelocityTexture;
uniform float uDeltaTime;

${FIELD}

#define FIELD_R ${FIELD_R.toFixed(2)}
#define EDGE_R ${EDGE_R.toFixed(2)}

varying vec2 vUv;

void main() {
  vec4 pos = texture2D(uPositionTexture, vUv);
  vec4 vel = texture2D(uVelocityTexture, vUv);

  vec3 position = pos.xyz + vel.xyz * clamp(uDeltaTime * 60.0, 0.0, 2.0);

  // The resting surface is the pile, not the bare plate — so this pass has to evaluate the field
  // too. One extra field sample per grain (no gradient), which is cheap, and it has to happen HERE:
  // the velocity pass can only turn a grain around, it can't stop it tunnelling through the pile on
  // a long frame.
  float phase = pos.w;
  float dn = fieldAt(position.xz / FIELD_R);
  position.y = max(position.y, pileHeight(dn, phase));

  float r = length(position.xz);
  if (r > EDGE_R) position.xz *= EDGE_R / r;

  gl_FragColor = vec4(position, phase);   // w = phase, a per-grain constant
}
`

// —— DENSITY SPLAT PASS. Draws every grain as a soft blob into a 64×64 additive target, producing a
// coarse map of where the sand currently IS. The velocity pass reads its gradient and pushes grains
// downhill, which is the only thing in the simulation that knows grains cannot occupy the same space.
//
// It is deliberately low resolution. This is a crowding term, not a collision solver — 64×64 over the
// plate makes one texel ≈ 0.056 world units, a few grain diameters, which is the scale at which
// "there is already sand here" is the right question. Higher resolution would resolve individual
// grains and start modelling contacts, which is both wrong and unaffordable at 65k particles.
const DENSITY_VERT = /* glsl */ `
precision highp float;

uniform sampler2D uPositionTexture;

attribute vec2 aRef;

#define PLATE_SPAN ${(PLATE_R * 2).toFixed(2)}

void main() {
  vec4 posData = texture2D(uPositionTexture, aRef);

  // Straight from plate XZ to clip space — no camera. The density map is a top-down orthographic
  // image of the plate, always, regardless of what the display camera happens to be doing.
  vec2 plateUV = posData.xz / PLATE_SPAN + 0.5;
  gl_Position = vec4(plateUV * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 3.0;   // device px in the 64×64 target ⇒ a splat radius of ~0.08 world units
}
`

const DENSITY_FRAG = /* glsl */ `
precision highp float;

void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(smoothstep(0.5, 0.0, d) * 0.02, 0.0, 0.0, 1.0);
}
`

// —— Render pass. The vertex shader reads position AND velocity out of the simulation textures; the
// CPU-side position attribute is a dummy that only exists so three knows how many points to draw.
const POINTS_VERT = /* glsl */ `
precision highp float;

uniform sampler2D uPositionTexture;
uniform sampler2D uVelocityTexture;
uniform float uSizeScale;  // viewportHeightPx / (2 * tan(fov/2)) — the world→pixel projection factor
uniform float uSize;       // grain diameter in WORLD units

attribute vec2 aRef;   // this particle's texel address

varying float vHeight;
varying float vSpeed;
varying float vRand;   // per-grain material seed — see below

void main() {
  vec4 posData = texture2D(uPositionTexture, aRef);
  vec4 velData = texture2D(uVelocityTexture, aRef);

  float phase = posData.w;   // 0..1, a per-grain constant
  vHeight = posData.y;
  vSpeed = length(velData.xyz);

  // A SECOND independent random, not phase again. phase already drives the grain's size class below
  // AND its rest height in the pile, so reusing it for colour and roughness would correlate all
  // three: every large grain would also be the palest and sit highest, and the sand would come out
  // visibly sorted rather than mixed. Hashing the texel address costs nothing and is decorrelated.
  vRand = fract(sin(dot(aRef, vec2(12.9898, 78.233))) * 43758.5453);

  vec4 mvPosition = modelViewMatrix * vec4(posData.xyz, 1.0);
  float depth = -mvPosition.z;

  // SIZE CLASSES, not a uniform spread. Real sand is graded: mostly fines, some medium, a few coarse
  // grains. A flat random distribution reads as noise; a graded one reads as a material. The 60/30/10
  // split is what makes a close look at the pile show individual big grains sitting proud of it.
  //
  // Size correlates with phase, and so does the pile's rest height — which is a happy accident worth
  // keeping: in a vibrated granular bed the large grains rise to the top (the Brazil-nut effect), and
  // that is exactly what this produces.
  float sizeClass;
  if (phase < 0.6)      sizeClass = 0.8 + phase * 0.3;          // 60% fines
  else if (phase < 0.9) sizeClass = 1.0 + (phase - 0.6) * 1.0;  // 30% medium
  else                  sizeClass = 1.3 + (phase - 0.9) * 2.0;  // 10% coarse

  // True perspective sizing. NOT a hardcoded pixel constant: gl_PointSize is in DEVICE pixels, so
  // "size * (15.0 / -mvPosition.z)" bakes in the canvas resolution — the same grain would come out
  // half as big, relative to the plate, on a retina panel as on a standard one, and the sand would
  // change texture with the window. uSizeScale is height/(2·tan(fov/2)) in device px, so uSize is a
  // world DIAMETER and a grain holds its physical size at any resolution or DPR.
  //
  // Airborne and moving grains swell, so the dust thrown off the antinodes reads as dust rather than
  // as noise, and a grain caught mid-hop is the thing your eye goes to.
  float world = uSize * sizeClass
              * (1.0 + smoothstep(0.0, 0.10, posData.y) * 1.2)
              * (1.0 + vSpeed * 1.5);
  gl_PointSize = clamp(world * uSizeScale / max(depth, 0.001), 1.0, 10.0);

  gl_Position = projectionMatrix * mvPosition;
}
`

// Lit grains under a three-point studio rig. Every grain is a sphere impostor: the normal is
// reconstructed from the point coord, so the lights rake across each one individually and a grain has
// a bright side, a dark side and a specular hit. That, plus depth-sorted occlusion, is what separates
// "sand" from "glowing dots" — under additive blending a pile just gets brighter, whereas a real pile
// gets SHADED, and the near grains hide the ones behind them.
//
// The lights are declared in the point sprite's own space (+x right, +y up, +z toward the camera),
// not world space. There is no correct world-space answer for an impostor — the geometry is a lie —
// and screen-space light directions are what a C4D render of this shot would look like anyway,
// because the camera is locked overhead and never moves.
const POINTS_FRAG = /* glsl */ `
precision highp float;

uniform vec3 uColor;        // album accent
uniform float uGlow;        // GLOW — constant across the catalogue; drives emissive and edge softness
uniform float uBassImpulse; // the decaying bass transient, 0..1 — the same one that drives the hop

#define BASS_FLASH ${BASS_FLASH.toFixed(2)}

uniform vec3 uKeyDir;    uniform vec3 uKeyColor;    uniform float uKeyI;
uniform vec3 uFillDir;   uniform vec3 uFillColor;   uniform float uFillI;
uniform vec3 uRimColor;  uniform float uRimI;

varying float vHeight;
varying float vSpeed;
varying float vRand;

// HIGHLIGHT ROLLOFF, and the reason there is no tone mapping on the renderer. This is now the single
// most load-bearing line in the shader: with GLOW flat at 1.0, EVERY record's grains sum past 1.0
// where the sand is dense (emissive + key + rim + airborne runs past 2.0 on a lit airborne grain),
// so the whole catalogue depends on this behaving rather than just the loud end of it.
//
// Clipping that overflow is not a cosmetic problem. Everything above 1.0 clamps to the SAME white, so
// the per-grain brightness variation this entire shader exists to produce is erased exactly where the
// sand is densest, and the nodal lines render as one flat white mass. The grains stop being grains.
//
// ACES on the renderer would fix the clipping and cost more than it saves — it is a filmic curve that
// pulls the MIDS down too (a 0.78 grain lands near 0.6), and the sand goes muddy everywhere to solve
// a problem the highlights have. This is a knee instead: below K it is completely transparent, so the
// shaded body of every grain is untouched; above K, a smooth asymptote to 1.0 that keeps hot grains
// ORDERED rather than equal. That ordering is what still reads as texture inside a blown-out pile.
vec3 rolloff(vec3 c) {
  const float K = 0.8;
  vec3 over = max(c - K, 0.0);
  return min(c, vec3(K)) + (1.0 - K) * (over / (over + (1.0 - K)));
}

void main() {
  // Sphere impostor: turn the square point sprite into a ball.
  vec2 cc = gl_PointCoord * 2.0 - 1.0;
  cc.y = -cc.y;                          // gl_PointCoord's y runs down the screen
  float r2 = dot(cc, cc);
  if (r2 > 1.0) discard;
  vec3 normal = vec3(cc, sqrt(1.0 - r2));

  const vec3 viewDir = vec3(0.0, 0.0, 1.0);   // the camera, in sprite space

  // —— BASE COLOUR. ALBUM FIRST: the grains take 75% of the record's colour, over a sand base that
  // keeps them reading as a material rather than as coloured light.
  //
  // uColor is normalised to full value before mixing, and that guard is load-bearing: a dominant
  // album colour is very often DARK (moody covers, black-heavy art), and mixing 75% of a near-black
  // into the grains would paint near-black sand onto a near-black background — the figure would
  // simply vanish for those records. Dividing by the largest channel preserves the album's HUE and
  // saturation exactly and only lifts its brightness; the lighting below puts the shading back.
  float peak = max(uColor.r, max(uColor.g, uColor.b));
  vec3 albumHue = uColor / max(peak, 0.001);

  vec3 baseSand = mix(vec3(0.78, 0.74, 0.68), vec3(0.72, 0.70, 0.66), step(0.5, vRand));
  vec3 baseColor = mix(baseSand, albumHue, 0.75) * (0.85 + vRand * 0.3);

  // —— MATERIAL. Roughness varies per grain, which is the whole reason the pile glitters: at uniform
  // roughness every grain takes the specular identically and the highlight becomes a flat sheen
  // across the whole plate. Varied, only some grains catch the key at the right angle at any moment,
  // and the pile sparkles the way a real one does.
  float roughness = 0.65 + vRand * 0.2;
  float specPower = mix(80.0, 20.0, roughness);      // smoother grains: tighter, brighter hit
  float specIntensity = mix(0.5, 0.15, roughness);

  // —— KEY. Warm, strong, high.
  float keyDiff = max(dot(normal, uKeyDir), 0.0);
  vec3 keyHalf = normalize(uKeyDir + viewDir);
  float keySpec = pow(max(dot(normal, keyHalf), 0.0), specPower) * specIntensity;
  vec3 lit = (baseColor * keyDiff + keySpec) * uKeyColor * uKeyI;

  // —— FILL. Cool, soft, opposite. It exists to stop the unlit side of every grain going to pure
  // black, which is what makes a naive one-light impostor read as a flat crescent rather than a ball.
  lit += baseColor * max(dot(normal, uFillDir), 0.0) * uFillColor * uFillI;

  // —— RIM. A Fresnel edge light, tinted with the album. It has no direction: at grain scale a rim
  // light IS just "the edges are brighter", and giving it a direction would only make half the grains
  // in the pile disagree about where the back of the studio is.
  float rimFresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);
  lit += rimFresnel * uRimColor * uRimI * mix(vec3(1.0), albumHue, 0.5);

  lit += baseColor * 0.12;   // ambient — nothing in a lit room is ever fully black

  // —— ENVIRONMENT. A one-line fake: reflect the view off the normal and look up a vertical gradient
  // (bright above, dark to the sides). Scaled by the INVERSE of roughness, so it only touches the
  // smooth grains. Not a mirror — just enough sheen that the grains feel like they are sitting under
  // something rather than floating in a void.
  vec3 refl = reflect(-viewDir, normal);
  vec3 envColor = mix(vec3(0.02), vec3(0.15, 0.14, 0.13), refl.z * 0.5 + 0.5);
  lit = mix(lit, lit + envColor, (1.0 - roughness) * 0.3);

  // —— EMISSIVE. The sand is lit from within, on every record equally (uGlow is a constant now). The
  // grain emits its OWN hue — no white mixed in — so the record's colour stays pure.
  //
  // The one hard requirement is that every song actually glows: the bloom is a luminance high-pass, and
  // hues carry wildly different luminance weights (red 0.299, green 0.587, blue only 0.114), so a dark
  // or deep-blue cover can emit its true colour and still sit entirely under the cut, glowing not at all.
  // Earlier passes tried to fix this per-hue — a warmth-gated white mix for reds, an inverse-luminance
  // boost for blues — and it was both fiddly and still left the darkest covers under the threshold.
  //
  // Replace all of it with one guarantee applied to the FINAL emissive: a luminance floor. Anything too
  // dim to bloom is scaled up until it just clears the threshold, preserving its hue exactly; anything
  // already bright enough passes through untouched. Red, blue, purple, dark brown — every case, one rule.
  vec3 emissive = albumHue * uGlow * 0.3;

  float emissiveLuma = dot(emissive, vec3(0.299, 0.587, 0.114));
  float minLuma = 0.35;   // solidly above the bloom threshold, so dark covers glow clearly
  if (emissiveLuma < minLuma && emissiveLuma > 0.001) {
    emissive *= minLuma / emissiveLuma;
  }
  lit += emissive;

  // —— THE BASS PULSE. The grain is struck, so it brightens and fades — in the ALBUM'S colour, not in
  // white. It was white, on the theory that a struck thing flashes white-hot; but this fires on every
  // kick, several times a bar, forever, and a white term on that duty cycle does not read as an impact.
  // It reads as the record's colour being rhythmically rinsed out of the picture. The pulse should make
  // the sand more ITSELF for a moment, not less.
  //
  // Flat across every grain, NOT scaled by |displacement|. Scaling it would confine the flash to the
  // antinodes — that is, to the empty cells BETWEEN the nodal lines — and light the gaps rather than the
  // figure.
  //
  // Where this actually lands is not where you would guess, and the highlight knee at the bottom of this
  // shader is why. A grain already sitting on a nodal line is up against the knee's asymptote and
  // brightens by ~2%; a launched airborne one, not at all. They are at the ceiling and there is no more
  // white left to give them. What moves is the BOTTOM of the range — a stray in a dark cell lifts ~32% —
  // and the MIDDLE, where +0.08 carries a narrow band of grains (~6% of the brightness range) up over the
  // 0.67 bloom threshold they were sitting just under, so slightly more of the plate blooms on the same
  // frame that the bloom itself is 32% stronger. The pulse you see is mostly that. It is NOT the hot
  // grains getting hotter, which is worth knowing before anyone tries to tune it by watching them.
  //
  // And do not wind this up to brighten the nodal lines directly. Their headroom is gone by design: past
  // the knee everything clips to the SAME white, and the per-grain variation this entire shader exists to
  // produce would be erased exactly where the sand is densest. The figure would "flash" by dissolving
  // into a flat white mass, which is the one thing the knee is there to prevent.
  lit += albumHue * uBassImpulse * BASS_FLASH;

  // Airborne grains catch more light — ON THEIR OWN SURFACE. This used to add flat white, and that was
  // the single biggest thing washing the colour out of the picture: a grain thrown off an antinode was
  // being handed +0.3 of pure white, which is as much light as the entire emissive term, and it landed
  // on precisely the sand the eye tracks. It got worse when the bass hop was tripled, because that put
  // far more of the plate in the air on every kick. A grain lifted into the key light does not turn
  // white; it is simply better lit, in the colour it already was. Multiplying baseColor instead of
  // adding white says that, and it costs nothing — the coefficient goes 0.3 → 0.45 to hold the same
  // brightness lift, so airborne sand still reads as distinctly hotter than the settled figure.
  lit += baseColor * smoothstep(0.0, 0.08, vHeight) * 0.45;
  lit += smoothstep(0.0, 0.10, vSpeed) * 0.1 * albumHue;    // and moving ones smear a little

  // Fake AO: grains down in the bed are shadowed by their neighbours; grains proud of it are not.
  lit *= 0.85 + smoothstep(0.0, 0.03, vHeight) * 0.15;

  // —— EDGE. Antialiasing, and a material cue — a glowing grain has a softer silhouette than an inert
  // one, because light bleeds past its edge. Tied to uGlow so it stays in step with the emissive; at
  // GLOW = 1.0 that is a fixed 0.7, i.e. the outer 30% of every grain feathers.
  float alpha = smoothstep(1.0, mix(0.85, 0.7, uGlow), sqrt(r2));

  gl_FragColor = vec4(rolloff(lit), alpha);
}
`

export default function DeckVisualizer({ track, open }) {
  const { engine } = useAudio()
  const hostRef = useRef(null)
  const stateRef = useRef(null)

  // Album-art accent (same extraction as the ambient glow / track bar): 'r, g, b' or null.
  const albumRgb = useAlbumColor(track?.album_art_url)

  // Per-track values, read by the frame loop. THE FIGURE COMES FROM HERE — from the track's cached
  // SoundNet features, not from the FFT. Live audio is broadly the same shape for every dance record
  // ever made (a bass lump, a mid hump, some highs), which is precisely why driving mode selection
  // from it made every song look identical. The cached features are different per song by
  // definition, so that is what the figure is keyed to; the FFT's job is reduced to how hard the
  // plate shakes.
  const featRef = useRef(null)
  featRef.current = {
    id: track?.id ?? null,
    album: albumRgb ? albumRgb.split(',').map((v) => Number(v) / 255) : null,
    mode: selectModeForTrack(track),
    complexity: complexityOf(track),
    // Cached energy also sets how much the sand trembles while paused: a loud song reads as a loud
    // song even sitting still.
    ambient: clamp01((track?.energy ?? 50) / 100) * 0.003,
  }

  // Build the Three.js pipeline once per mount.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    } catch {
      return // no WebGL → leave the dark tile
    }
    const pr = Math.min(window.devicePixelRatio, 2)
    renderer.setPixelRatio(pr)

    // NO tone mapping — but no longer because nothing overflows. A loud track's emissive + rim +
    // airborne terms DO push grains past 1.0; that overflow is handled by the highlight knee at the
    // end of POINTS_FRAG, which leaves the midtones alone. A global ACES curve here would instead
    // pull every grain in the catalogue down (a 0.78 grain lands near 0.6, and the sand reads muddy)
    // to solve a problem only the loud end has. OutputPass still runs, for the sRGB conversion.
    renderer.toneMapping = THREE.NoToneMapping
    renderer.setClearColor(BG, 1)

    // Simulation textures must be renderable AND filterable-as-data. Full float is the target;
    // half float is the fallback on GPUs without EXT_color_buffer_float (positions stay within ±2
    // where half-float precision is ~1e-3, far finer than a grain).
    const gl = renderer.getContext()
    const canFloat = !!gl.getExtension('EXT_color_buffer_float')
    const DATA_TYPE = canFloat ? THREE.FloatType : THREE.HalfFloatType

    const f = featRef.current
    const c0 = f.album ?? FALLBACK_RGB

    const scene = new THREE.Scene()

    // Straight down. A Chladni figure IS a 2D shape lying on the surface, and any rake foreshortens
    // it into an ellipse — the pattern is the subject, so the pattern gets the undistorted view.
    //
    // The distance FRAMES the figure, and the whole figure is now inside the frame. The tile is
    // landscape (~16:9 and wider), so the VERTICAL axis is the one that crops: at a 45° vertical fov
    // the frame shows ±d·tan(22.5°) = ±0.414·d world units, and the sand is hard-clamped at EDGE_R
    // (1.75) by the position pass. So containment is one inequality — 0.414·d > 1.75, i.e. d > 4.23.
    // At 4.4 the sand rim lands at ~96% of the half-height: contained, with a little air around it.
    //
    // This used to sit at 3.85, which put the rim at 110% of the half-height and sliced the disc flat
    // along the top and bottom edges. That was a deliberate crop back when a 1.85-radius PLATE mesh
    // sat under the sand and the shot was a close-up of a larger object — the plate is gone, so the
    // crop was just clipping the subject.
    //
    // The circular clamp at EDGE_R stays load-bearing regardless: it is what stops outward-driven
    // grains piling into a hard arc at the boundary. Fixed camera; no OrbitControls.
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50)
    camera.position.set(0, 4.4, 0)
    // Looking straight down, the view direction is parallel to the DEFAULT up vector (0,1,0), and
    // lookAt's cross product degenerates — the camera's orientation is undefined and the scene can
    // come out blank or arbitrarily rolled. Re-point up along -Z first so "up the screen" means
    // "away from the viewer across the plate".
    camera.up.set(0, 0, -1)
    camera.lookAt(0, 0, 0)

    // —— GPGPU scaffolding: one fullscreen quad, reused by every simulation pass.
    const quadScene = new THREE.Scene()
    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const quadGeo = new THREE.PlaneGeometry(2, 2)
    const quadMesh = new THREE.Mesh(quadGeo, new THREE.MeshBasicMaterial())
    quadScene.add(quadMesh)

    const makeTarget = () => new THREE.WebGLRenderTarget(TEX, TEX, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: DATA_TYPE,
      depthBuffer: false,
      stencilBuffer: false,
    })
    const posA = makeTarget()
    const posB = makeTarget()
    const velA = makeTarget()
    const velB = makeTarget()

    // The density target, and the two things about it that are NOT free choices:
    //
    // HALF float, not full, even where full float is available for the simulation. The splat pass
    // additively BLENDS into this target, and blending into a 32-bit float attachment needs
    // EXT_float_blend — which is not universal, and where it is missing the blend is silently dropped
    // and the density map comes out as the last grain drawn rather than the sum of all of them. Half
    // float blending is core in WebGL2. The values here run 0..~10 with no precision demands.
    //
    // LINEAR filtering, unlike the simulation targets: the velocity pass reads this at four offset
    // taps to take a gradient, and nearest filtering would quantise that gradient into 64 steps
    // across the plate — grains would feel a staircase and visibly snap to texel boundaries.
    const densityTarget = new THREE.WebGLRenderTarget(DENSITY_TEX, DENSITY_TEX, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    })

    // —— Seed data. Grains start scattered evenly across the bare plate, with no pattern at all;
    // the first few seconds of playback are the sand FINDING the figure, which is the whole trick
    // and is worth seeing. sqrt(u) for the radius, or they bunch at the centre.
    const posData = new Float32Array(PARTICLE_COUNT * 4)
    const velData = new Float32Array(PARTICLE_COUNT * 4)
    const refs = new Float32Array(PARTICLE_COUNT * 2)
    const dummyPos = new Float32Array(PARTICLE_COUNT * 3)

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2
      const radius = Math.sqrt(Math.random()) * SPAWN_R
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius

      const i4 = i * 4
      posData[i4] = x
      posData[i4 + 1] = 0          // on the plate surface
      posData[i4 + 2] = z
      posData[i4 + 3] = Math.random()          // phase — desynchronises the bounce
      velData[i4] = 0
      velData[i4 + 1] = 0
      velData[i4 + 2] = 0
      velData[i4 + 3] = 0.7 + Math.random() * 0.6  // mass

      const col = i % TEX
      const row = Math.floor(i / TEX)
      refs[i * 2] = (col + 0.5) / TEX
      refs[i * 2 + 1] = (row + 0.5) / TEX

      const i3 = i * 3
      dummyPos[i3] = x
      dummyPos[i3 + 1] = 0
      dummyPos[i3 + 2] = z
    }

    const makeData = (arr) => {
      const t = new THREE.DataTexture(arr, TEX, TEX, THREE.RGBAFormat, THREE.FloatType)
      t.minFilter = THREE.NearestFilter
      t.magFilter = THREE.NearestFilter
      t.needsUpdate = true
      return t
    }
    const posSeed = makeData(posData)
    const velSeed = makeData(velData)

    const copyMat = new THREE.ShaderMaterial({
      uniforms: { uSource: { value: null } },
      vertexShader: QUAD_VERT,
      fragmentShader: COPY_FRAG,
      depthTest: false,
      depthWrite: false,
    })

    const blit = (material, target) => {
      quadMesh.material = material
      renderer.setRenderTarget(target)
      renderer.render(quadScene, quadCamera)
      renderer.setRenderTarget(null)
    }

    // Prime BOTH halves of each ping-pong pair, so nothing ever samples an uninitialised target.
    copyMat.uniforms.uSource.value = posSeed
    blit(copyMat, posA)
    blit(copyMat, posB)
    copyMat.uniforms.uSource.value = velSeed
    blit(copyMat, velA)
    blit(copyMat, velB)

    // —— Simulation materials. Both passes evaluate the SAME field, so they share one set of field
    // uniform objects by reference — the frame loop writes them once and both passes see it. Two
    // copies would be a standing invitation for the position pass to clamp grains to a pile computed
    // from a field the velocity pass isn't using.
    // A figure needs TWO vec4s — one per superimposed eigenmode — so old and new cost four between
    // them. There is no separate amplitude pair any more: the weights live in the .w of each vec4, and
    // are already normalised and peak-divided by selectModeForTrack.
    const m0 = f.mode
    const termA = (md) => new THREE.Vector4(md.n1, md.k1, md.phi1, md.s1)
    const termB = (md) => new THREE.Vector4(md.n2, md.k2, md.phi2, md.s2)
    const fieldUniforms = {
      uOldA: { value: termA(m0) },
      uOldB: { value: termB(m0) },
      uNewA: { value: termA(m0) },
      uNewB: { value: termB(m0) },
      uModeTransition: { value: 1 },
    }

    const velocityMat = new THREE.ShaderMaterial({
      uniforms: {
        ...fieldUniforms,
        uPositionTexture: { value: null },
        uVelocityTexture: { value: null },
        uDensityTexture: { value: densityTarget.texture },
        uTime: { value: 0 },
        uDeltaTime: { value: 0.016 },
        uBass: { value: 0 },
        uMids: { value: 0 },
        uHighs: { value: 0 },
        uAmplitude: { value: 0 },
        uBassImpulse: { value: 0 },
        uAmbient: { value: f.ambient },
        uIdle: { value: 1 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: VELOCITY_FRAG,
      depthTest: false,
      depthWrite: false,
    })

    const positionMat = new THREE.ShaderMaterial({
      uniforms: {
        ...fieldUniforms,   // same objects, by reference — see above
        uPositionTexture: { value: null },
        uVelocityTexture: { value: null },
        uDeltaTime: { value: 0.016 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: POSITION_FRAG,
      depthTest: false,
      depthWrite: false,
    })

    // There is NO plate. The Chladni figure is the subject and it is the entire subject — a disc
    // under it is a stage, and a stage tells you that you are looking at a rendering of an
    // experiment. The sand hangs in the dark instead, and the pattern has to carry the frame alone.

    // ONE geometry, TWO Points objects: the display pass and the density splat. They share the same
    // buffers (an Object3D can only have one parent, so they cannot be the same object, but the
    // 65k-vertex geometry is not duplicated).
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(dummyPos, 3))
    geometry.setAttribute('aRef', new THREE.BufferAttribute(refs, 2))

    const densityMat = new THREE.ShaderMaterial({
      uniforms: { uPositionTexture: { value: null } },
      vertexShader: DENSITY_VERT,
      fragmentShader: DENSITY_FRAG,
      blending: THREE.AdditiveBlending,   // the whole point: overlapping grains SUM
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    const densityScene = new THREE.Scene()
    const densityPoints = new THREE.Points(geometry, densityMat)
    densityPoints.frustumCulled = false   // the shader writes gl_Position directly; three's bounds are meaningless here
    densityScene.add(densityPoints)

    const pointsMat = new THREE.ShaderMaterial({
      uniforms: {
        uPositionTexture: { value: posA.texture },
        uVelocityTexture: { value: velA.texture },
        uColor: { value: new THREE.Color(c0[0], c0[1], c0[2]) },
        uGlow: { value: GLOW },   // constant; nothing writes this after construction
        uBassImpulse: { value: 0 },
        uKeyDir: { value: v3(KEY_DIR) },
        uKeyColor: { value: rgb(KEY_COLOR) },
        uKeyI: { value: KEY_I },
        uFillDir: { value: v3(FILL_DIR) },
        uFillColor: { value: rgb(FILL_COLOR) },
        uFillI: { value: FILL_I },
        uRimColor: { value: rgb(RIM_COLOR) },
        uRimI: { value: RIM_I },
        // A grain is a couple of device pixels across. 65k of them over a ~600px figure means a bare
        // patch is genuinely sparse, while a nodal pile covers its ground completely — which is what
        // makes a line read as solid: coverage, not summed light.
        uSize: { value: 0.009 },
        uSizeScale: { value: 1000 }, // real value set by resize()
      },
      vertexShader: POINTS_VERT,
      fragmentShader: POINTS_FRAG,
      // NormalBlending + depthWrite. A grain in front HIDES the grain behind it, so a pile has a
      // surface and a silhouette instead of just getting brighter — additive blending is what makes
      // particle systems look like energy instead of matter, and this is matter. The glow comes from
      // the emissive term and the bloom, not from summing luminance.
      //
      // transparent:true only because the fragment shader feathers the last 15% of each grain's
      // radius for antialiasing; the interior is fully opaque and depth still does the occlusion, so
      // the lack of a back-to-front sort (impossible at 65k points) costs nothing but the edge pixels.
      blending: THREE.NormalBlending,
      transparent: true,
      depthWrite: true,
      depthTest: true,
    })

    const points = new THREE.Points(geometry, pointsMat)
    points.frustumCulled = false
    scene.add(points)

    // —— Post. Bloom is fixed at construction (see BLOOM_* — it is hand-tuned against the figure's
    // readability, not derived from GLOW). Only strength moves at runtime, and only with the live
    // audio, so the plate breathes without the gaps ever filling in.
    let composer = new EffectComposer(renderer)
    composer.setPixelRatio(pr)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(256, 256), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD,
    )
    composer.addPass(bloom)
    composer.addPass(new OutputPass())

    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;'
    host.appendChild(renderer.domElement)

    const resize = () => {
      const w = host.clientWidth
      const h = host.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      composer?.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      // Grain size is a world diameter; this is the factor that projects it to device pixels at
      // depth 1. Recomputed here because it depends on the drawing-buffer height.
      const fovRad = (camera.fov * Math.PI) / 180
      pointsMat.uniforms.uSizeScale.value = (h * pr) / (2 * Math.tan(fovRad / 2))
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)

    // Frame-loop state.
    const st = {
      last: 0,
      time: 0,
      audio: 0,     // live-audio blend 0↔1, smoothed so play/pause never pops
      amp: 0,       // overall amplitude
      prevBass: 0,
      album: [...c0],
      freq: null,
      // Mode state: the figure we're showing, the one we're leaving, and how far between.
      activeMode: m0,
      previousMode: m0,
      transition: 1,          // 1 = settled on activeMode
      trackId: null,          // song-change detection
      baseMode: m0,           // the track's own figure, before any in-song energy shift
      shift: 0,               // -1 breakdown / 0 normal / +1 drop
      shiftHeld: 0,
      smoothedEnergy: 0,
      impulse: 0,             // decaying bass transient
      posRead: posA, posWrite: posB, velRead: velA, velWrite: velB,
      frames: 0, fpsAcc: 0, fpsN: 0, bloomOn: true,
    }

    // Start a crossfade to `mode`, unless it's already what we're showing or heading to. Guarded on
    // transition >= 1: we keep exactly ONE old mode, so interrupting a live crossfade would have to
    // snap the half-blended field to a new baseline, and the sand would visibly jump.
    const requestMode = (mode) => {
      // Compared by VALUE, not identity: selectModeForTrack mints a fresh object on every call, so
      // an identity check would fire a pointless crossfade to the figure we're already showing.
      if (!mode || sameMode(mode, st.activeMode) || st.transition < 1) return
      st.previousMode = st.activeMode
      st.activeMode = mode
      st.transition = 0
    }

    st.frame = (now) => {
      const dt = Math.min(0.05, st.last ? (now - st.last) / 1000 : 0.016)
      st.last = now
      st.time += dt

      // — audio: fresh every frame. Analyser smoothing 0.15 (snappy) so hits arrive as spikes.
      const an = engine.analyser
      const live = !!(engine.getSnapshot().playing && an)
      if (live) {
        if (!st.freq || st.freq.length !== an.frequencyBinCount) st.freq = new Uint8Array(an.frequencyBinCount)
        an.getByteFrequencyData(st.freq)
      }
      st.audio += ((live ? 1 : 0) - st.audio) * 0.06
      const bass = live ? band(st.freq, 0, 4) : 0
      const mids = live ? band(st.freq, 4, 13) : 0
      const highs = live ? band(st.freq, 13, 32) : 0
      // Weighted toward bass — that's what a plate would actually feel.
      st.amp += (clamp01(bass * 0.5 + mids * 0.3 + highs * 0.2) - st.amp) * 0.25

      const ft = featRef.current

      // — MODE SELECTION happens on SONG CHANGE, not per frame. The figure is a property of the
      // track, so it is computed once from cached features and then simply held.
      if (ft.id !== st.trackId) {
        st.trackId = ft.id
        st.baseMode = ft.mode
        st.shift = 0
        st.shiftHeld = 0
        st.smoothedEnergy = ft.complexity   // don't fire a false "drop" on the first second
        requestMode(ft.mode)
      }

      // — WITHIN a song, the pattern only moves on a big, SUSTAINED energy shift — a drop or a
      // breakdown, judged against THIS track's own baseline rather than an absolute level. A
      // breakdown in a banger and the loudest moment of a ballad are different things, and keying off
      // the track's own energy is what keeps them different. The 2-second smoothing (0.01/frame) and
      // the 1-second dwell are what stop a single loud bar from re-throwing the figure.
      if (live) {
        st.smoothedEnergy += (st.amp - st.smoothedEnergy) * (1 - Math.pow(1 - 0.01, dt * 60))
        const delta = st.smoothedEnergy - ft.complexity
        const wantShift = Math.abs(delta) > 0.3 ? Math.sign(delta) : 0
        if (wantShift !== st.shift) {
          st.shiftHeld += dt
          if (st.shiftHeld > 1.0) {
            st.shift = wantShift
            st.shiftHeld = 0
            // Same song, same hash — so the drop winds THIS track's own figure tighter (or a
            // breakdown opens it out) instead of swapping in some other song's shape.
            requestMode(selectModeForTrack(track, ft.complexity + wantShift * 0.25))
          }
        } else {
          st.shiftHeld = 0
        }
      }

      // — and CROSSFADE THE FIELD, not the mode numbers. Sliding the numbers themselves would put the
      // plate at fractional modes for most of its life — fields that no plate can actually ring at.
      // Blending the two fields keeps both endpoints real eigenmodes, and the blend is itself a
      // legitimate superposition, so the nodal lines still move continuously across the plate and the
      // grains still ride along — but every frame is a shape a real plate could hold.
      if (st.transition < 1) st.transition = Math.min(1, st.transition + dt / 0.6)

      // — bass transients → the plate gets hit (a rising edge, not every loud frame).
      if (st.audio > 0.1 && bass > BASS_ONSET && bass - st.prevBass > BASS_JUMP) {
        st.impulse = 1
      }
      st.prevBass = bass
      st.impulse *= Math.pow(0.9, dt * 60)

      // — per-track glide: album colour crossfades rather than cuts.
      const ca = ft.album ?? FALLBACK_RGB
      for (let i = 0; i < 3; i++) st.album[i] += (ca[i] - st.album[i]) * 0.08

      // — the field. These uniform objects are SHARED by both simulation materials (same references),
      // so writing them once here updates the velocity pass and the position pass together.
      const om = st.previousMode
      const nm = st.activeMode
      fieldUniforms.uOldA.value.set(om.n1, om.k1, om.phi1, om.s1)
      fieldUniforms.uOldB.value.set(om.n2, om.k2, om.phi2, om.s2)
      fieldUniforms.uNewA.value.set(nm.n1, nm.k1, nm.phi1, nm.s1)
      fieldUniforms.uNewB.value.set(nm.n2, nm.k2, nm.phi2, nm.s2)
      fieldUniforms.uModeTransition.value = st.transition

      // — DENSITY first, from the positions the velocity pass is about to read. It must be rebuilt
      // every frame and it must NOT accumulate across frames: this is a snapshot of where the sand is
      // right now, and a running total would be a heat map of everywhere it has ever been — the
      // repulsion would then push grains out of regions that emptied minutes ago.
      //
      // Cleared to BLACK explicitly, not to the renderer's clear colour. That colour is the panel's
      // near-black #0a0a0a, whose red channel is 0.039 — a uniform density floor across the whole
      // plate. It would cancel out of the gradient and do no harm, but it is the kind of thing that
      // stops being harmless the moment anyone reads the raw density value instead of its gradient.
      densityMat.uniforms.uPositionTexture.value = st.posRead.texture
      renderer.setClearColor(0x000000, 1)
      renderer.setRenderTarget(densityTarget)
      renderer.render(densityScene, quadCamera)
      renderer.setRenderTarget(null)
      renderer.setClearColor(BG, 1)

      // — simulate. Velocity first: the position pass integrates the velocity written this frame.
      const vu = velocityMat.uniforms
      vu.uTime.value = st.time
      vu.uDeltaTime.value = dt
      vu.uBass.value = bass
      vu.uMids.value = mids
      vu.uHighs.value = highs
      vu.uAmplitude.value = st.amp * st.audio
      vu.uBassImpulse.value = st.impulse
      vu.uAmbient.value = ft.ambient
      vu.uIdle.value = 1 - st.audio
      vu.uPositionTexture.value = st.posRead.texture
      vu.uVelocityTexture.value = st.velRead.texture
      blit(velocityMat, st.velWrite)

      const pu = positionMat.uniforms
      pu.uDeltaTime.value = dt
      pu.uPositionTexture.value = st.posRead.texture
      pu.uVelocityTexture.value = st.velWrite.texture // fresh velocity, not last frame's
      blit(positionMat, st.posWrite)

      // — draw from the textures we just wrote, then swap.
      pointsMat.uniforms.uPositionTexture.value = st.posWrite.texture
      pointsMat.uniforms.uVelocityTexture.value = st.velWrite.texture
      pointsMat.uniforms.uColor.value.setRGB(st.album[0], st.album[1], st.album[2])
      pointsMat.uniforms.uBassImpulse.value = st.impulse

      let t = st.posRead; st.posRead = st.posWrite; st.posWrite = t
      t = st.velRead; st.velRead = st.velWrite; st.velWrite = t

      // — bloom BREATHES with the live audio, and FLASHES on the kick. Threshold and radius are still
      // fixed at construction; strength is the only bloom value that moves.
      //
      // Two separate terms, doing two different jobs. The amplitude term is the breath: small, sustained,
      // never enough to close the gaps between the nodal lines on a loud bar. The impulse term is the
      // flash: large, and gone in a tenth of a second (see BLOOM_PULSE).
      //
      // It rides st.impulse — the SAME decaying transient that drives the hop and the grains' emissive —
      // rather than a second envelope of its own. A parallel one with its own decay would be two sources
      // of truth for a single physical event, free to drift apart, and the kick has to land as ONE thing:
      // the sand jumps, the grains go white-hot and the glow blooms on the same frame, or it reads as
      // three effects that happen to be near each other rather than as an impact.
      bloom.strength = BLOOM_STRENGTH + 0.06 * st.amp * st.audio + BLOOM_PULSE * st.impulse

      if (st.bloomOn && composer) composer.render()
      else renderer.render(scene, camera)

      // FPS guard: past the warmup, average ~1.5s windows; a sustained miss of the 50fps budget
      // cuts bloom permanently (the raw field must stand on its own).
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
      posA.dispose()
      posB.dispose()
      velA.dispose()
      velB.dispose()
      densityTarget.dispose()
      posSeed.dispose()
      velSeed.dispose()
      copyMat.dispose()
      velocityMat.dispose()
      positionMat.dispose()
      densityMat.dispose()
      quadGeo.dispose()
      geometry.dispose()   // shared by `points` and `densityPoints` — one dispose, not two
      pointsMat.dispose()
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
        // Deliberately OUTSIDE the neomorphic system. This tile is a screen, not a mounted gauge: no cast,
        // no bevel, no shadow of any kind — it sits flush in the panel and its edge is a plain 1px border.
        // That makes it the one place in the deck where a border rather than a shadow draws the edge, and
        // that is the point: a shadow would put it in the room with the gauges, and a screen is a hole in
        // the panel. Do not "fix" the inconsistency by giving this a tile recipe.
        // The face stays #0A0A0A rather than the tiles' TILE_BG: the canvas hides it whenever there IS a
        // canvas, so the only moments it paints are the frame before mount and the no-WebGL fallback
        // below — both of which want the dark void this tile reads as, not a lit grey slab.
        position: 'relative', height: '100%', minHeight: 0, borderRadius: 20, overflow: 'hidden',
        background: '#0A0A0A', border: `1px solid ${C.border}`,
      }}
    />
  )
}
