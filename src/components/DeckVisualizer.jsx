import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { useAudio } from '../store/useAudioStore'
import { useAlbumColor } from './useAlbumColor'
import { C, INSET } from './import/tokens'

// Deck View hero visualizer (Slice 14, V7 — GPGPU particle sculpture). 65,536 additive points
// suspended in empty dark space. No stage, no chamber, no plate — the field IS the visualizer.
// Physics run entirely in fragment shaders; the CPU only uploads uniforms, swaps ping-pong render
// targets, and draws.
//
// PIPELINE — three float textures, 256×256, one texel per particle:
//   home   (static)  each particle's rest position on a solid sphere. The spring reads it.
//   pos    (A/B)     xyz = live position, w = life (per-particle alpha).
//   vel    (A/B)     xyz = live velocity, w = mass (per-particle force scale).
// Each frame: velocity pass reads (pos, vel, home) → writes vel'; position pass reads (pos, vel')
// → writes pos'; the Points shaders sample BOTH to place, size and colour their vertices. Then swap.
//
// MOTION MODEL — curl noise is the primary driver, not radial displacement. The curl of a noise
// field is divergence-free: particles swirl AROUND each other instead of clumping or exploding,
// which is the difference between "fluid" and "firework". Each audio band drives curl at a
// different spatial scale — bass makes the big vortexes, highs the surface shimmer.
//
// The spring back to home is deliberately WEAK (0.015). A stiff spring snaps the field back before
// a shape can form; a weak one lets the cloud hold the silhouette of the last beat for a second or
// two before it dissolves. The field is supposed to have memory. Particles may leave the home
// sphere entirely — that's where the drama lives — and only drift back once they stray past the
// soft boundary.
//
// Additive blending is the whole look: overlapping points sum instead of occluding, so density
// reads as luminosity and the cloud becomes a volume rather than confetti.

const TEX = 256                    // texture edge; TEX² particles
const PARTICLE_COUNT = TEX * TEX   // 65,536
const HOME_RADIUS = 1.2            // rest sphere
// The soft bound has to sit INSIDE the camera's visible half-extent (4.5 * tan(25°) ≈ 2.1 world
// units at z=0). Park it further out and a cloud that reaches the boundary simply fills the panel
// edge to edge — the silhouette leaves the frame and the whole thing reads as fog, not an object.
const SOFT_BOUND = 1.7             // beyond this a pull begins — NOT a wall; particles may pass it
const HARD_BOUND = 2.6             // backstop for pathological dt only

// Bass transient detection (CPU) → expanding shells (GPU).
const MAX_WAVES = 3
const WAVE_SPEED = 1.8      // units/sec the shell travels outward
const WAVE_LIFETIME = 1.1   // seconds — the shell has crossed the field and died by now
const BASS_ONSET = 0.15     // absolute threshold for a cold onset
const BASS_JUMP = 0.08      // rise-over-previous-frame that also counts as a transient

const FALLBACK_RGB = [0.5, 0.53, 0.62] // neutral slate when no album colour is available

const clamp01 = (v) => Math.min(1, Math.max(0, v))

// Average of analyser byte bins [from, to) normalised to 0..1.
function band(freq, from, to) {
  let s = 0
  for (let i = from; i < to; i++) s += freq[i]
  return s / ((to - from) * 255)
}

// —— Ashima 3D simplex noise (MIT). Inlined; curl noise differentiates it six ways per sample.
const SIMPLEX = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 Cc = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, Cc.yyy));
  vec3 x0 = v - i + dot(i, Cc.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + Cc.xxx;
  vec3 x2 = x0 - i2 + Cc.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`

// —— GPGPU passes. All three render a fullscreen quad; vUv is the particle's texel address.
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

// VELOCITY PASS — every force lives here. Reads pos/vel/home, writes the new velocity.
const VELOCITY_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uPositionTexture;
uniform sampler2D uVelocityTexture;
uniform sampler2D uHomeTexture;
uniform float uTime;
uniform float uDeltaTime;
uniform float uBass;
uniform float uMids;
uniform float uHighs;
uniform float uIdle;            // 1 = silent, 0 = playing — crossfades the ambient breathing
uniform float uIdleAmp;         // cached track energy
uniform float uIdleHz;          // cached track BPM / 120
uniform vec3  uWaves[${MAX_WAVES}]; // x = shell radius, y = strength, z = fade (0 = slot empty)

${SIMPLEX}

// Curl of a scalar noise field replicated across all three potential components. The result is
// divergence-free — no sources, no sinks — so the flow advects particles around vortex cores
// instead of piling them up. Six noise taps: one central difference per axis.
//
// Raw curl of Ashima simplex runs |curl| ≈ 3; the 0.3 scale brings a typical vector back to ~1 so
// the force coefficients below can be read as "units per frame" directly.
vec3 curlNoise(vec3 p) {
  const float e = 0.01;
  const float inv = 1.0 / (2.0 * e);

  float dndx = (snoise(p + vec3(e, 0.0, 0.0)) - snoise(p - vec3(e, 0.0, 0.0))) * inv;
  float dndy = (snoise(p + vec3(0.0, e, 0.0)) - snoise(p - vec3(0.0, e, 0.0))) * inv;
  float dndz = (snoise(p + vec3(0.0, 0.0, e)) - snoise(p - vec3(0.0, 0.0, e))) * inv;

  return vec3(dndy - dndz, dndz - dndx, dndx - dndy) * 0.3;
}

// THE TUNING KNOBS. Spring is intentionally an order of magnitude weaker than a "settled" system
// wants: at 0.015 a particle displaced 1 unit takes ~1.5s to come home, which is exactly the
// lingering the art direction asks for. Anything ≥0.03 and the field stops holding shapes.
#define SPRING_K 0.015
#define DAMPING 0.96
#define MAX_SPEED 0.05   // per-frame ceiling — a pathological input can't reach escape velocity

// Curl amplitudes per band. Bass runs at the LARGEST feature size (lowest scale) so it makes the
// big silhouette-changing vortexes; highs run finest so they only ripple the surface.
//
// These look absurdly small, and they have to be. Damping retains 96% of velocity per frame, so a
// force applied every frame compounds toward F/(1-0.96) = 25F before the flow field turns it — a
// force of 0.08 is a terminal speed of 2 units/frame, which disperses the entire cloud past the
// boundary in a handful of frames and leaves a uniform fog with no silhouette. Budget from the
// TARGET SPEED instead: a dramatic-but-legible particle moves ~0.03 units/frame, so F ≈ 0.03/25.
#define AMBIENT_AMP 0.0015
#define BASS_AMP    0.0100
#define MIDS_AMP    0.0060
#define HIGHS_AMP   0.0040
#define BASS_PUSH   0.0040   // outward radial shove on top of the bass swirl

#define SOFT_BOUND ${SOFT_BOUND.toFixed(2)}

varying vec2 vUv;

void main() {
  vec4 pos = texture2D(uPositionTexture, vUv);
  vec4 vel = texture2D(uVelocityTexture, vUv);
  vec4 home = texture2D(uHomeTexture, vUv);

  vec3 position = pos.xyz;
  vec3 velocity = vel.xyz;
  vec3 homePos = home.xyz;
  float mass = vel.w;              // 0.6..1.4 — lighter grains are carried further by the same flow

  // Frame-normalised step: forces below are tuned in per-frame units at 60fps.
  float fs = clamp(uDeltaTime * 60.0, 0.0, 1.6);
  float force = 1.0 / mass;

  float dist = length(position);
  vec3 radialDir = normalize(position + 0.0001); // +eps: a particle exactly at the origin has no direction

  // 1. Damping — coasting, not friction. 0.96 lets motion carry across beats.
  velocity *= pow(DAMPING, fs);

  // 2. Weak spring back to home. Not a restoring force so much as a slow tide: it decides where the
  //    cloud eventually returns to, not where it is right now.
  velocity += -(position - homePos) * SPRING_K * fs;

  // 3. CURL NOISE — the primary motion driver. Sampled on POSITION, so the noise is a flow field the
  //    particles travel THROUGH; the shape of the field is what they trace out.
  vec3 flow = curlNoise(position * 1.5 + uTime * 0.3) * AMBIENT_AMP;

  // BASS → large-scale swirl. Low noise scale = features bigger than the cloud itself, so whole
  // lobes of the sphere get dragged in different directions and the silhouette changes.
  if (uBass > 0.01) {
    flow += curlNoise(position * 0.6 + uTime * 0.5) * uBass * BASS_AMP;
    flow += radialDir * uBass * BASS_PUSH; // and the cloud breathes outward against the soft bound
  }

  // MIDS → medium-scale turbulence. The offsets decorrelate each band's noise field from the others.
  if (uMids > 0.01) {
    flow += curlNoise(position * 2.0 + uTime * 0.8 + 50.0) * uMids * MIDS_AMP;
  }

  // HIGHS → fine-scale sparkle. Small features, fast evolution: reads as shimmer on the surface
  // rather than motion of the mass.
  if (uHighs > 0.01) {
    flow += curlNoise(position * 4.0 + uTime * 2.0 + 100.0) * uHighs * HIGHS_AMP;
  }

  velocity += flow * force * fs;

  // 4. BASS TRANSIENTS → expanding spherical shells. Detected on the CPU (a rising edge, not every
  //    loud frame) and pushed outward from the centre as a travelling front, so a kick visibly
  //    swells the cloud from the inside out instead of pumping the whole volume at once.
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    vec3 w = uWaves[i];
    if (w.z <= 0.0) continue;
    float prox = smoothstep(0.45, 0.0, abs(dist - w.x));
    velocity += radialDir * prox * w.y * w.z * 0.004 * force * fs;
  }

  // 5. IDLE → a slow breathing pulse that fades out as audio comes in. BPM sets its rate, cached
  //    track energy its depth, so a loaded-but-paused song still reads as itself.
  if (uIdle > 0.01) {
    float breath = sin(uTime * 0.5 * uIdleHz);
    velocity += radialDir * breath * 0.0015 * uIdle * uIdleAmp * fs;
  }

  // 6. Speed ceiling. The coefficients above are budgeted to stay under this; it exists so that a
  //    stack of transients or a long dt after a tab restore can't fling the cloud off screen.
  float speed = length(velocity);
  if (speed > MAX_SPEED) velocity *= MAX_SPEED / speed;

  // 7. SOFT boundary — gravity, not a wall. Particles are allowed well outside the home sphere;
  //    past SOFT_BOUND they feel an increasing pull home, so the cloud has an edge it can bulge
  //    through and be drawn back from. Bouncing here would read as a container.
  if (dist > SOFT_BOUND) {
    velocity -= radialDir * (dist - SOFT_BOUND) * 0.06 * fs;
  }

  gl_FragColor = vec4(velocity, vel.w);
}
`

// POSITION PASS — pure integration. Reads the velocity the pass above just wrote.
const POSITION_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D uPositionTexture;
uniform sampler2D uVelocityTexture;
uniform float uDeltaTime;

#define HARD_BOUND ${HARD_BOUND.toFixed(2)}

varying vec2 vUv;

void main() {
  vec4 pos = texture2D(uPositionTexture, vUv);
  vec4 vel = texture2D(uVelocityTexture, vUv);

  vec3 position = pos.xyz + vel.xyz * uDeltaTime * 60.0;

  // Backstop only. The soft pull in the velocity pass is what actually shapes the field; this
  // catches the case where a huge dt (tab restore) teleports a particle into the next county.
  float r = length(position);
  if (r > HARD_BOUND) position *= HARD_BOUND / r;

  gl_FragColor = vec4(position, pos.w);
}
`

// —— Render pass. The vertex shader reads position AND velocity out of the simulation textures; the
// CPU-side position attribute is a dummy that only exists so three knows how many points to draw.
const POINTS_VERT = /* glsl */ `
precision highp float;

uniform sampler2D uPositionTexture;
uniform sampler2D uVelocityTexture;
uniform float uSizeScale;  // viewportHeightPx / (2 * tan(fov/2)) — the world→pixel projection factor
uniform float uSize;       // particle diameter in WORLD units

attribute vec2 aRef;   // this particle's texel address

varying float vLife;
varying float vSpeed;
varying float vDepth;

void main() {
  vec4 posData = texture2D(uPositionTexture, aRef);
  vec4 velData = texture2D(uVelocityTexture, aRef);

  vLife = posData.w;
  vSpeed = length(velData.xyz);

  vec4 mvPosition = modelViewMatrix * vec4(posData.xyz, 1.0);
  vDepth = -mvPosition.z;

  // True perspective sizing: a particle of a fixed WORLD size projects to uSize*uSizeScale/depth
  // pixels. This is what gives the cloud real depth — a size expression that bottoms out on its
  // clamp at every depth renders as flat static. uSizeScale is already in device pixels.
  //
  // Moving particles swell: the fast ones streaking out of a vortex are the ones that should draw
  // the eye, and size is what separates them from the resting mass behind them.
  float world = uSize * (1.0 + vSpeed * 6.0) * (0.7 + vLife * 0.6); // life doubles as size variance
  gl_PointSize = clamp(world * uSizeScale / max(vDepth, 0.001), 1.0, 12.0);

  gl_Position = projectionMatrix * mvPosition;
}
`

const POINTS_FRAG = /* glsl */ `
precision highp float;

uniform vec3 uColor;      // album accent
uniform float uBass;
uniform float uExposure;  // per-particle contribution — THE tuning knob for the whole look

varying float vLife;
varying float vSpeed;
varying float vDepth;

void main() {
  // Soft radial falloff — a hard-edged dot would alias into confetti under additive blending.
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;

  // Speed is the only colour variation in the field, and it has to be there: a monochrome cloud
  // reads as a texture, while a cloud whose fast regions burn hotter reads as something with
  // energy moving through it. Slow particles keep the album tint; fast ones bleach toward white.
  //
  // The album accent has to carry more than half the mix. Additive summing pushes every deep
  // sight-line toward white on its own, so a tint that's only a minority of the base colour
  // survives nowhere except the thin edges — the cloud comes out grey and the album is lost.
  vec3 baseColor = mix(vec3(0.75, 0.72, 0.66), uColor, 0.6);
  float speedGlow = smoothstep(0.0, 0.06, vSpeed) * 0.5;
  vec3 finalColor = baseColor + speedGlow;

  // Fade with distance so the far side of the cloud dissolves into the dark rather than ending on
  // a crisp line.
  float depthFade = smoothstep(9.0, 2.5, vDepth);

  // Under AdditiveBlending the pixel gains color * alpha, so alpha IS this particle's share of the
  // final exposure — and 65k points overlap many-deep through the middle of a sphere. It has to
  // stay tiny: brightness is supposed to come from DENSITY summing, not from any single point.
  // Crank this and the cloud instantly saturates to a flat white blob.
  float falloff = smoothstep(0.5, 0.0, d);
  float alpha = falloff * uExposure * (0.6 + uBass * 0.5) * vLife * depthFade;

  gl_FragColor = vec4(finalColor, alpha);
}
`

export default function DeckVisualizer({ track, open }) {
  const { engine } = useAudio()
  const hostRef = useRef(null)
  const stateRef = useRef(null)

  // Album-art accent (same extraction as the ambient glow / track bar): 'r, g, b' or null.
  const albumRgb = useAlbumColor(track?.album_art_url)

  // Per-track targets, lerped toward inside the frame loop so song switches glide, never snap.
  const featRef = useRef(null)
  featRef.current = {
    album: albumRgb ? albumRgb.split(',').map((v) => Number(v) / 255) : null,
    idleAmp: 0.6 + clamp01((track?.energy ?? 50) / 100) * 0.9,
    idleHz: (track?.bpm > 0 ? track.bpm : 120) / 120,
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

    // ACES is what OutputPass applies to the accumulated HDR sum. Three disables in-material tone
    // mapping while rendering to a render target, so this fires exactly once, at the end of the
    // chain, on the summed image — which is the only place it can do any good (tone-mapping each
    // particle before the additive blend would roll off nothing, since the clipping happens in the
    // framebuffer, not in the fragment).
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0

    // Simulation textures must be renderable AND filterable-as-data. Full float is the target;
    // half float is the fallback on GPUs without EXT_color_buffer_float (positions stay in a ±3.4
    // range where half-float precision is still ~1e-3, so the field holds together).
    const gl = renderer.getContext()
    const canFloat = !!gl.getExtension('EXT_color_buffer_float')
    const DATA_TYPE = canFloat ? THREE.FloatType : THREE.HalfFloatType

    const f = featRef.current
    const c0 = f.album ?? FALLBACK_RGB

    const scene = new THREE.Scene()

    // Face-on camera with a whisper of elevation. The viewer looks INTO the cloud, not down at it:
    // a raked camera turns any particle field into a surface with a horizon, and that's the "science
    // demo on a plate" read we're specifically avoiding. Pulled back just far enough that a bass
    // hit can bulge the cloud without clipping the frame. Fixed — no OrbitControls.
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50)
    camera.position.set(0, 0.3, 4.5)
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

    // —— Seed data. Homes fill the VOLUME of a sphere, not its surface.
    //
    // The radius exponent is the single most important number in the whole seed. cbrt(u) gives
    // TRUE uniform volume density — and renders as a flat grey dust ball, because a sphere of
    // evenly-spread points has almost no density gradient to read as light. Pushing the exponent up
    // packs particles toward the middle, so overlap (= brightness under additive blending) falls off
    // from a hot core to a wispy edge, which is what makes the cloud read as a luminous OBJECT
    // rather than a cloud of sand. 0.5 is the compromise: still a filled volume, but with a core.
    const homeData = new Float32Array(PARTICLE_COUNT * 4)
    const posData = new Float32Array(PARTICLE_COUNT * 4)
    const velData = new Float32Array(PARTICLE_COUNT * 4)
    const refs = new Float32Array(PARTICLE_COUNT * 2)
    const dummyPos = new Float32Array(PARTICLE_COUNT * 3)

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1) // uniform on the sphere, not bunched at the poles
      const rad = Math.pow(Math.random(), 0.45) * HOME_RADIUS
      const sinPhi = Math.sin(phi)
      const x = rad * sinPhi * Math.cos(theta)
      const y = rad * sinPhi * Math.sin(theta)
      const z = rad * Math.cos(phi)

      const i4 = i * 4
      homeData[i4] = x
      homeData[i4 + 1] = y
      homeData[i4 + 2] = z
      homeData[i4 + 3] = 1
      posData[i4] = x
      posData[i4 + 1] = y
      posData[i4 + 2] = z
      // life = per-particle alpha. Faded across the outer half so the sphere dissolves into the dark
      // instead of ending on the hard silhouette edge a bounded volume otherwise shows. The fade
      // starts early (0.45R) and is squared: the silhouette should be a suggestion, not a boundary.
      const edge = 1 - clamp01((rad / HOME_RADIUS - 0.45) / 0.55)
      const fade = edge * edge * (3 - 2 * edge)
      posData[i4 + 3] = (0.45 + Math.random() * 0.55) * (0.15 + fade * 0.85)
      velData[i4] = 0
      velData[i4 + 1] = 0
      velData[i4 + 2] = 0
      velData[i4 + 3] = 0.6 + Math.random() * 0.8   // mass

      const col = i % TEX
      const row = Math.floor(i / TEX)
      refs[i * 2] = (col + 0.5) / TEX
      refs[i * 2 + 1] = (row + 0.5) / TEX

      const i3 = i * 3
      dummyPos[i3] = x
      dummyPos[i3 + 1] = y
      dummyPos[i3 + 2] = z
    }

    const makeData = (arr) => {
      const t = new THREE.DataTexture(arr, TEX, TEX, THREE.RGBAFormat, THREE.FloatType)
      t.minFilter = THREE.NearestFilter
      t.magFilter = THREE.NearestFilter
      t.needsUpdate = true
      return t
    }
    const homeTexture = makeData(homeData)
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

    // —— Simulation materials.
    const velocityMat = new THREE.ShaderMaterial({
      uniforms: {
        uPositionTexture: { value: null },
        uVelocityTexture: { value: null },
        uHomeTexture: { value: homeTexture },
        uTime: { value: 0 },
        uDeltaTime: { value: 0.016 },
        uBass: { value: 0 },
        uMids: { value: 0 },
        uHighs: { value: 0 },
        uIdle: { value: 1 },
        uIdleAmp: { value: f.idleAmp },
        uIdleHz: { value: f.idleHz },
        uWaves: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector3()) },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: VELOCITY_FRAG,
      depthTest: false,
      depthWrite: false,
    })

    const positionMat = new THREE.ShaderMaterial({
      uniforms: {
        uPositionTexture: { value: null },
        uVelocityTexture: { value: null },
        uDeltaTime: { value: 0.016 },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: POSITION_FRAG,
      depthTest: false,
      depthWrite: false,
    })

    // —— The field itself. Nothing else is in the scene: no plate, no rim, no container. The cloud
    // floats in the clear colour and the only light in the frame comes from the particles.
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(dummyPos, 3))
    geometry.setAttribute('aRef', new THREE.BufferAttribute(refs, 2))

    const pointsMat = new THREE.ShaderMaterial({
      uniforms: {
        uPositionTexture: { value: posA.texture },
        uVelocityTexture: { value: velA.texture },
        uColor: { value: new THREE.Color(c0[0], c0[1], c0[2]) },
        uBass: { value: 0 },
        // Size and exposure trade against each other: bigger points overlap more (which is what
        // FUSES 65k dots into a volume instead of a sandpaper texture), so exposure has to come
        // down as size goes up or the whole thing saturates to white.
        //
        // Deliberately set so the core sums to WELL OVER 1.0. That's only safe because the composer
        // accumulates in a half-float target and OutputPass tone-maps the sum (see below): the core
        // rolls off into a highlight instead of clipping. Tuned against the deepest sight-line —
        // through the middle of a solid sphere — not the average one.
        uExposure: { value: 0.075 },
        uSize: { value: 0.05 },
        uSizeScale: { value: 1000 }, // real value set by resize()
      },
      vertexShader: POINTS_VERT,
      fragmentShader: POINTS_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    })

    const points = new THREE.Points(geometry, pointsMat)
    points.frustumCulled = false
    scene.add(points)

    // —— Post. THE WHOLE CHAIN IS HDR, and it has to be: 65k additive points sum far past 1.0 through
    // the core of the sphere, and in an LDR buffer that sum CLIPS — the core becomes a flat white
    // paper cutout with no gradient, and no per-particle exposure value can fix it (lower it enough
    // to stop the clip and the body of the cloud goes to grey mush). EffectComposer's targets are
    // half-float, so the sum is preserved; OutputPass then tone-maps it at the very end, rolling the
    // core off into a hot highlight while the mid-body keeps its gradient. Bloom sits between them
    // and therefore reads TRUE HDR luminance — its threshold is above 1.0, in the region only the
    // dense core reaches, so the cloud glows from its middle instead of smearing into a fog.
    let composer = new EffectComposer(renderer)
    composer.setPixelRatio(pr)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.7, 1.1)
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
      // Point size is a world diameter; this is the factor that projects it to device pixels at
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
      time: 0,      // seconds — noise + idle clock
      audio: 0,     // live-audio blend 0↔1, smoothed so play/pause never pops
      amp: 0,       // overall amplitude → bloom strength
      prevBass: 0,  // last frame's bass, for transient detection
      waves: Array.from({ length: MAX_WAVES }, () => ({ active: false, age: 0, strength: 0 })),
      idleAmp: f.idleAmp,
      idleHz: f.idleHz,
      album: [...c0],
      freq: null,
      // Ping-pong cursors.
      posRead: posA, posWrite: posB, velRead: velA, velWrite: velB,
      frames: 0, fpsAcc: 0, fpsN: 0, bloomOn: true,
    }

    const spawnWave = (strength) => {
      let slot = st.waves.find((w) => !w.active)
      if (!slot) slot = st.waves.reduce((o, w) => (w.age > o.age ? w : o), st.waves[0]) // recycle oldest
      slot.active = true
      slot.age = 0
      slot.strength = strength
    }

    st.frame = (now) => {
      const dt = Math.min(0.05, st.last ? (now - st.last) / 1000 : 0.016)
      st.last = now
      st.time += dt

      // — audio: fresh every frame. Analyser smoothing 0.15 (snappy) so hits arrive as spikes.
      // fftSize 256 → 128 bins; the field reacts to the lower spectrum where musical energy lives.
      const an = engine.analyser
      const live = !!(engine.getSnapshot().playing && an)
      if (live) {
        if (!st.freq || st.freq.length !== an.frequencyBinCount) st.freq = new Uint8Array(an.frequencyBinCount)
        an.getByteFrequencyData(st.freq)
      }
      st.audio += ((live ? 1 : 0) - st.audio) * 0.06
      const bass = live ? band(st.freq, 0, 4) : 0    // sub-bass + bass
      const mids = live ? band(st.freq, 4, 13) : 0   // low/high mids
      const highs = live ? band(st.freq, 13, 32) : 0 // presence/highs
      st.amp += ((bass + mids + highs) / 3 - st.amp) * 0.25

      // — per-track glide: album colour crossfades, cached idle params ease in.
      const ft = featRef.current
      const ca = ft.album ?? FALLBACK_RGB
      for (let i = 0; i < 3; i++) st.album[i] += (ca[i] - st.album[i]) * 0.08
      st.idleAmp += (ft.idleAmp - st.idleAmp) * 0.05
      st.idleHz += (ft.idleHz - st.idleHz) * 0.05

      // — bass transients spawn shells (on a rising edge or a jump, NOT every loud frame).
      if (st.audio > 0.1 && ((bass > BASS_ONSET && st.prevBass <= BASS_ONSET) || bass - st.prevBass > BASS_JUMP)) {
        spawnWave(bass)
      }
      st.prevBass = bass

      // — advance the shells. x = radius reached; z = strength remaining.
      const wu = velocityMat.uniforms.uWaves.value
      for (let i = 0; i < MAX_WAVES; i++) {
        const w = st.waves[i]
        if (w.active) {
          w.age += dt
          if (w.age > WAVE_LIFETIME) w.active = false
        }
        if (w.active) {
          wu[i].set(w.age * WAVE_SPEED, w.strength, 1 - w.age / WAVE_LIFETIME)
        } else {
          wu[i].set(0, 0, 0)
        }
      }

      // — simulate. Velocity first: the position pass integrates the velocity written this frame.
      const vu = velocityMat.uniforms
      vu.uTime.value = st.time
      vu.uDeltaTime.value = dt
      vu.uBass.value = bass
      vu.uMids.value = mids
      vu.uHighs.value = highs
      vu.uIdle.value = 1 - st.audio
      vu.uIdleAmp.value = st.idleAmp
      vu.uIdleHz.value = st.idleHz
      vu.uPositionTexture.value = st.posRead.texture
      vu.uVelocityTexture.value = st.velRead.texture
      blit(velocityMat, st.velWrite)

      const pu = positionMat.uniforms
      pu.uDeltaTime.value = dt
      pu.uPositionTexture.value = st.posRead.texture
      pu.uVelocityTexture.value = st.velWrite.texture // fresh velocity, not last frame's
      blit(positionMat, st.posWrite)

      // — draw the field from the textures we just wrote, then swap. The render pass reads velocity
      // too: speed drives point size and the hot-white glow on fast particles.
      pointsMat.uniforms.uPositionTexture.value = st.posWrite.texture
      pointsMat.uniforms.uVelocityTexture.value = st.velWrite.texture
      pointsMat.uniforms.uBass.value = bass
      pointsMat.uniforms.uColor.value.setRGB(st.album[0], st.album[1], st.album[2])

      let t = st.posRead; st.posRead = st.posWrite; st.posWrite = t
      t = st.velRead; st.velRead = st.velWrite; st.velWrite = t

      bloom.strength = 0.6 + 0.25 * st.amp * st.audio // 0.6 at rest → 0.85 on loud passages

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
      homeTexture.dispose()
      posSeed.dispose()
      velSeed.dispose()
      copyMat.dispose()
      velocityMat.dispose()
      positionMat.dispose()
      quadGeo.dispose()
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
