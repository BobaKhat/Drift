import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { useAudio } from '../store/useAudioStore'
import { useAlbumColor } from './useAlbumColor'
import { C, INSET } from './import/tokens'

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
// THE PHYSICS — a Chladni plate's displacement is a sum of sin·sin modes. Nodal lines are where
// displacement = 0. Sand is driven DOWN the gradient of displacement², i.e. away from the violently
// shaking antinodes and toward the still lines. That single force is the whole effect.
//
// The two things that stop it from looking like a math diagram are in the velocity pass and matter
// more than the Chladni math itself — see AGITATION and STICTION there.

const TEX = 256                    // texture edge; TEX² particles
const PARTICLE_COUNT = TEX * TEX   // 65,536
const PLATE_R = 1.8                // the plate's physical radius; also the x/y normaliser for the modes
const EDGE_R = 1.75                // grains are contained just inside the rim
const SPAWN_R = 1.70

// Bass transients (CPU) → a decaying kick (GPU) that briefly throws extra dust off the plate.
const BASS_ONSET = 0.15
const BASS_JUMP = 0.08

const FALLBACK_RGB = [0.5, 0.53, 0.62] // neutral slate when no album colour is available

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

// Deterministic per song: same track, same figure, every time. `complexity` is passed in rather than
// derived so a mid-song drop can ask for a busier version of THIS song's figure — same hash, so the
// same fingerprint, just wound tighter.
function selectModeForTrack(track, complexity) {
  const c = clamp01(complexity ?? complexityOf(track))
  const lo = 2.0 + c * 2.0   // chill ≈ 2, intense ≈ 4
  const hi = lo + 2.5

  const seed = String(track?.id ?? `${track?.name ?? ''}${track?.artist ?? ''}`)
  const rnd = mulberry32(hashStr(seed))
  const pick = () => lo + rnd() * (hi - lo)

  // Non-integer mode numbers on purpose. An integer mode makes sin(PI*n*x) vanish at x = ±1, i.e.
  // the plate's whole square boundary becomes a nodal line and sand piles along the rim. Off-integer
  // modes break that, so the figure sits INSIDE the disc — which is both what the reference photos
  // look like and, conveniently, less sand parked in the cropped-off edge.
  return { n: pick(), m: pick(), p: pick(), q: pick() }
}

const sameMode = (a, b) => !!a && !!b && a.n === b.n && a.m === b.m && a.p === b.p && a.q === b.q

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

// The mode field, shared by BOTH simulation passes. A mode is packed as vec4(n, m, p, q): two sin·sin
// terms, which is the classic (n,m)+(p,q) superposition that produces the curved, interlocking
// Chladni figures rather than a plain checkerboard. The two terms carry DIFFERENT weights (uAmpA,
// uAmpB) — at equal weight the figure comes out symmetric under x↔y and looks machined.
const FIELD = /* glsl */ `
#define PI 3.14159265359

uniform vec4 uOldMode;         // (n, m, p, q) — the figure we're leaving
uniform vec4 uNewMode;         // (n, m, p, q) — the figure we're heading to
uniform float uModeTransition; // 0 = fully old, 1 = fully new
uniform float uAmpA;
uniform float uAmpB;

float chladni(vec2 p, vec4 md) {
  return uAmpA * sin(PI * md.x * p.x) * sin(PI * md.y * p.y)
       + uAmpB * sin(PI * md.z * p.x) * sin(PI * md.w * p.y);
}

// Plate displacement. Both modes are always INTEGER eigenmodes; what moves is the blend between
// them. A linear combination of two solutions is itself a solution, so every intermediate frame is
// still a physically real displacement field — the plate is simply ringing at two modes at once,
// which is exactly what a real plate does while it's being driven from one resonance to another.
// The gradient must be taken on this blended sum, not per-mode.
float fieldAt(vec2 p) {
  return mix(chladni(p, uOldMode), chladni(p, uNewMode), uModeTransition);
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

#define PLATE_R ${PLATE_R.toFixed(2)}
#define EDGE_R ${EDGE_R.toFixed(2)}

// Migration: acceleration toward the nodal lines, per frame at 60fps. Budget from the TARGET SPEED,
// not from the force: xz damping keeps 97% per frame, so a constant force compounds to F/(1-0.97) =
// 33F. A grain should cross a cell in a couple of seconds — ~0.012 units/frame — so F ≈ 0.0004.
#define MIGRATE 0.0004

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

// The outer margin where the rim's inward restoring force acts. It starts well outside the body of
// the figure (the plate runs to 1.75) so it drains the edge without compressing the pattern. Pull it
// in much further — a pull from, say, 1.2 covers 55% of the disc's AREA and would squeeze the outer
// nodal lines inward into a false ring.
#define RIM_SOFT 1.63
#define RIM_RETURN 0.0004

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

  vec2 pp = position.xz / PLATE_R;   // plate coords, -1..1

  // —— Displacement and the gradient of its square, by forward difference on the SUMMED field.
  float e = 0.005;
  float d = fieldAt(pp);
  float dx = fieldAt(pp + vec2(e, 0.0));
  float dy = fieldAt(pp + vec2(0.0, e));
  vec2 grad = 2.0 * d * vec2(dx - d, dy - d) / e;

  // Normalised displacement, -1..1 regardless of the term weights, so the vibration and agitation
  // below stay independent of how the field happens to be scaled.
  float dn = d / (uAmpA + uAmpB + 0.001);

  // The surface this grain rests on: the plate, plus whatever sand has piled up here.
  float floorY = pileHeight(dn, phase);

  // —— 1. MIGRATION toward the nodal lines. The raw gradient magnitude scales with PI*n and with
  // the mode weights, so at high modes it runs into the hundreds — feeding it in raw would fling
  // grains off the plate the instant a hi-hat pushed the modes up. Take the DIRECTION from the
  // gradient and a saturating 0..1 magnitude from it, so the force has a hard ceiling.
  float gm = length(grad);
  float sat = gm / (gm + 4.0);
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

  // —— 2. AGITATION. The 0.3 floor is the important term: it keeps jostling grains that are already
  // ON a line (where |dn| = 0 and the vibration term below is silent), and that is what gives the
  // line its width and its ragged edge instead of a hairline.
  float drive = mix(0.15, 1.0, uAmplitude) + uBassImpulse * 0.6;  // idle floor keeps the sand alive
  float ag = AGITATION * drive * (0.3 + 0.7 * abs(dn)) / mass;
  velocity.xz += hash22(vUv * 137.0 + uTime * 13.7) * ag * fs;

  // —— 3. VERTICAL BOUNCE. Grains sitting on a violently moving part of the plate get thrown off it;
  // grains on a nodal line never leave the surface. |dn| is the local shake amplitude, so the
  // airborne dust appears exactly over the antinodes and the lines stay crisp.
  if (position.y < floorY + 0.01) {
    float vibeAmp = abs(dn) * (uAmplitude + uBassImpulse * 0.8) * 0.05;
    float vibeHz = 3.0 + uBass * 8.0;
    velocity.y += max(sin(uTime * vibeHz + phase * 6.2831) * vibeAmp, 0.0) / mass;

    // Idle: the plate is never quite still. A trembling surface, no migration. Depth from the
    // track's cached energy, so a loud song still reads as a loud song sitting paused.
    velocity.y += sin(uTime * 1.0 + phase * 6.2831) * uAmbient * uIdle;
  }

  // —— 3b. HIGHS → surface shimmer. Fine, fast, everywhere: a hi-hat section makes the whole plate
  // tremble at grain scale without touching the macro figure.
  velocity.y += sin(uTime * 12.0 + phase * 50.0) * uHighs * 0.003 * fs;

  // —— 3c. BASS TRANSIENT → the plate gets hit. Grains jump off the surface. The coefficient looks
  // tiny because uBassImpulse is applied EVERY frame while it decays (×0.9/frame ⇒ ~10 frames of
  // contribution), so the impulse a grain actually receives is ~10× what is written here: ≈0.04 up,
  // which arcs it to about 0.1 above the plate. Budget the integral, not the frame.
  velocity.y += uBassImpulse * 0.004 / mass * fs;

  // The horizontal kick is RANDOM per grain, not radially outward. A struck plate throws sand up and
  // rattles it; it does not blow it away from the centre. An outward-only shove is a DC pump — every
  // kick drives grains toward the rim, nothing drives them back, and over a few minutes of music the
  // sand ratchets into the edge and the figure visibly hollows out. This is a shake, and it sums to
  // zero.
  velocity.xz += hash22(vUv * 71.3 + uTime * 7.1) * uBassImpulse * 0.0015 * fs / mass;

  // —— 4. Gravity, and the landing. The grain lands on the PILE, not on the plate: floorY rises
  // toward the nodal lines, so arriving grains come to rest on top of the ones already there.
  velocity.y -= 0.008 * fs;

  if (position.y + velocity.y * fs < floorY) {
    velocity.y *= -0.15;    // sand barely bounces; it mostly just lands
    velocity.xz *= 0.85;    // and skids to a stop when it does
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

#define PLATE_R ${PLATE_R.toFixed(2)}
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
  float dn = fieldAt(position.xz / PLATE_R) / (uAmpA + uAmpB + 0.001);
  position.y = max(position.y, pileHeight(dn, phase));

  float r = length(position.xz);
  if (r > EDGE_R) position.xz *= EDGE_R / r;

  gl_FragColor = vec4(position, phase);   // w = phase, a per-grain constant
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

void main() {
  vec4 posData = texture2D(uPositionTexture, aRef);
  vec4 velData = texture2D(uVelocityTexture, aRef);

  vHeight = posData.y;
  vSpeed = length(velData.xyz);
  float mass = velData.w;

  vec4 mvPosition = modelViewMatrix * vec4(posData.xyz, 1.0);
  float depth = -mvPosition.z;

  // True perspective sizing. NOT a hardcoded pixel constant: gl_PointSize is in DEVICE pixels, so
  // "size * (15.0 / -mvPosition.z)" bakes in the canvas resolution — the same grain would come out
  // half as big, relative to the plate, on a retina panel as on a standard one, and the sand would
  // change texture with the window. uSizeScale is height/(2·tan(fov/2)) in device px, so uSize is a
  // world DIAMETER and a grain holds its physical size at any resolution or DPR.
  //
  // Mass doubles as size variance — heavier grains are bigger — and airborne grains swell a touch so
  // the dust over the antinodes reads as dust rather than as noise.
  float world = uSize * (0.75 + mass * 0.4)
              * (1.0 + smoothstep(0.0, 0.10, posData.y) * 0.8)
              * (1.0 + vSpeed * 2.0);
  gl_PointSize = clamp(world * uSizeScale / max(depth, 0.001), 1.0, 8.0);

  gl_Position = projectionMatrix * mvPosition;
}
`

// Opaque, lit grains. Every grain is a sphere impostor: the normal is reconstructed from the point
// coord so a directional key light rakes across each one. That, plus depth-sorted occlusion, is
// what separates "sand" from "glowing dots" — under additive blending a pile just gets brighter,
// whereas real sand piles get SHADED, and the near grains hide the ones behind them.
const POINTS_FRAG = /* glsl */ `
precision highp float;

uniform vec3 uColor;      // album accent
uniform vec3 uLightDir;   // key light, view-space-ish

varying float vHeight;
varying float vSpeed;

void main() {
  // Sphere impostor: turn the square point sprite into a lit ball.
  vec3 normal;
  normal.xy = gl_PointCoord * 2.0 - 1.0;
  normal.y = -normal.y;                       // gl_PointCoord's y runs down the screen
  float r2 = dot(normal.xy, normal.xy);
  if (r2 > 1.0) discard;                      // hard circular edge — no soft glow halo
  normal.z = sqrt(1.0 - r2);

  float diffuse = max(dot(normal, uLightDir), 0.0);
  float lighting = 0.3 + diffuse * 0.7;       // ambient + key

  // ALBUM FIRST. The grains take the record's colour — 75% of it — with a warm sand base left under
  // it so they still read as a material rather than as coloured light.
  //
  // uColor is normalised to full value before mixing, and that guard matters: a dominant colour is
  // often DARK (moody covers, black-heavy art), and mixing 75% of a near-black toward the grains
  // would paint near-black sand onto a near-black plate — the figure would simply vanish for those
  // records. Dividing by the largest channel keeps the album's HUE and saturation exactly, and only
  // lifts its brightness; the directional light below is what puts the shading back.
  vec3 sand = vec3(0.75, 0.72, 0.68);
  float peak = max(uColor.r, max(uColor.g, uColor.b));
  vec3 albumHue = uColor / max(peak, 0.001);
  vec3 color = mix(sand, albumHue, 0.75) * lighting;

  color += diffuse * vec3(0.08, 0.06, 0.03);              // warm highlight on the lit side
  color += smoothstep(0.0, 0.10, vHeight) * 0.15;         // airborne grains catch more light
  color += smoothstep(0.0, 0.05, vSpeed) * 0.05;

  // Fully opaque. Density now reads as COVERAGE (more grains hide more plate), the way sand works —
  // not as summed luminance. This is the whole point of dropping additive blending.
  gl_FragColor = vec4(color, 1.0);
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

    // NO tone mapping. ACES earned its place when the grains were additive and the dense lines summed
    // far past 1.0 — it rolled that overflow into a highlight instead of clipping. The grains are
    // opaque now, so nothing ever exceeds 1.0, and all ACES would do is crush the sand's midtones:
    // a 0.78 grain lands around 0.6 and the whole plate reads muddy. OutputPass still runs, for the
    // sRGB conversion.
    renderer.toneMapping = THREE.NoToneMapping

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
    // The distance keeps the CROPPED framing chosen earlier: the rim projects to ~1.16 in NDC, so
    // the disc runs off the top and bottom and the panel shows a close-up of a larger plate. A
    // fully-contained disc would need ~4.9 here, but it only fills 93% of the panel height and the
    // ceiling on an uncropped plate is about +7% — so containment costs a fifth of the size. If the
    // whole rim should be visible instead, this one number goes to 4.9 and nothing else changes.
    //
    // Because the rim now sits outside the frame, the circular containment at EDGE_R is load-bearing:
    // without it, outward-driven grains would pile into a hard arc just off-screen. Fixed; no
    // OrbitControls.
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 50)
    camera.position.set(0, 3.85, 0)
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
    const m0 = f.mode
    const vec4Of = (md) => new THREE.Vector4(md.n, md.m, md.p, md.q)
    const fieldUniforms = {
      uOldMode: { value: vec4Of(m0) },
      uNewMode: { value: vec4Of(m0) },
      uModeTransition: { value: 1 },
      uAmpA: { value: 1.0 },
      uAmpB: { value: 0.6 },   // unequal, or the figure comes out symmetric and looks machined
    }

    const velocityMat = new THREE.ShaderMaterial({
      uniforms: {
        ...fieldUniforms,
        uPositionTexture: { value: null },
        uVelocityTexture: { value: null },
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

    // —— The plate. Almost black: it exists to give the sand a surface and an edge, nothing more.
    // Drawn opaque and below the grains so it wins the depth test against nothing and simply sits
    // there. The sand is the only thing in the frame that is meant to be looked at.
    const plateGeo = new THREE.CircleGeometry(1.85, 96)
    const plateMat = new THREE.MeshBasicMaterial({ color: 0x0e0e10 })
    const plate = new THREE.Mesh(plateGeo, plateMat)
    plate.rotation.x = -Math.PI / 2
    plate.position.y = -0.005
    scene.add(plate)

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(dummyPos, 3))
    geometry.setAttribute('aRef', new THREE.BufferAttribute(refs, 2))

    const pointsMat = new THREE.ShaderMaterial({
      uniforms: {
        uPositionTexture: { value: posA.texture },
        uVelocityTexture: { value: velA.texture },
        uColor: { value: new THREE.Color(c0[0], c0[1], c0[2]) },
        uLightDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
        // A grain is a couple of device pixels across. 65k of them over a ~600px disc means a bare
        // patch is genuinely sparse, while a nodal pile covers its ground completely — which, with
        // opaque grains, is now what makes a line read as solid: coverage, not summed light.
        uSize: { value: 0.009 },
        uSizeScale: { value: 1000 }, // real value set by resize()
      },
      vertexShader: POINTS_VERT,
      fragmentShader: POINTS_FRAG,
      // Opaque sand, not glowing energy. NormalBlending + depthWrite means a grain in front HIDES
      // the grain behind it, so a pile has a surface and a silhouette instead of just getting
      // brighter. transparent:false keeps it in the opaque pass, where the depth buffer does the
      // sorting for free — with 65k points there is no correct back-to-front order to sort into
      // anyway, and every alpha value this shader emits is exactly 1.0.
      blending: THREE.NormalBlending,
      transparent: false,
      depthWrite: true,
      depthTest: true,
    })

    const points = new THREE.Points(geometry, pointsMat)
    points.frustumCulled = false
    scene.add(points)

    // —— Post. Bloom is now barely there: it exists to take the hard digital edge off the brightest
    // grains, nothing more. The old strong bloom was compensating for additive blending; opaque lit
    // sand doesn't glow, and a plate that glows stops reading as a material.
    let composer = new EffectComposer(renderer)
    composer.setPixelRatio(pr)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.2, 0.3, 0.85)
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

      // — per-track glide: album colour crossfades.
      const ca = ft.album ?? FALLBACK_RGB
      for (let i = 0; i < 3; i++) st.album[i] += (ca[i] - st.album[i]) * 0.08

      // — the field. These uniform objects are SHARED by both simulation materials (same references),
      // so writing them once here updates the velocity pass and the position pass together.
      const om = st.previousMode
      const nm = st.activeMode
      fieldUniforms.uOldMode.value.set(om.n, om.m, om.p, om.q)
      fieldUniforms.uNewMode.value.set(nm.n, nm.m, nm.p, nm.q)
      fieldUniforms.uModeTransition.value = st.transition

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

      let t = st.posRead; st.posRead = st.posWrite; st.posWrite = t
      t = st.velRead; st.velRead = st.velWrite; st.velWrite = t

      bloom.strength = 0.2 + 0.08 * st.amp * st.audio

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
      posSeed.dispose()
      velSeed.dispose()
      copyMat.dispose()
      velocityMat.dispose()
      positionMat.dispose()
      quadGeo.dispose()
      plateGeo.dispose()
      plateMat.dispose()
      geometry.dispose()
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
        position: 'relative', height: '100%', minHeight: 0, borderRadius: 20, overflow: 'hidden',
        background: '#0A0A0A', border: `1px solid ${C.border}`, boxShadow: INSET,
      }}
    />
  )
}
