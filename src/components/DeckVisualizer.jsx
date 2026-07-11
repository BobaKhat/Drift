import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { useAudio } from '../store/useAudioStore'
import { useAlbumColor } from './useAlbumColor'
import { C, INSET } from './import/tokens'

// Deck View hero visualizer (Slice 14, V6 — GPGPU particle field). 65,536 additive points whose
// physics run entirely in fragment shaders. The CPU never touches a particle: it uploads uniforms,
// swaps ping-pong render targets, and draws.
//
// PIPELINE — three float textures, 256×256, one texel per particle:
//   home   (static)  each particle's rest position, written once. The spring reads it.
//   pos    (A/B)     xyz = live position, w = life.
//   vel    (A/B)     xyz = live velocity, w = mass (per-particle force scale).
// Each frame: velocity pass reads (pos, vel, home) → writes vel'; position pass reads (pos, vel')
// → writes pos'; the Points vertex shader then samples pos' to place its vertices. Then swap.
// Velocity is written first so position always integrates the velocity computed THIS frame.
//
// MOTION MODEL — displacement from home, always spring-damped back to rest. Audio forces:
//   BASS  → radial shockwaves. Transients (detected on the CPU) spawn expanding wave fronts that
//           lift particles as the ridge sweeps past their rest radius — motion travels THROUGH the
//           field rather than pumping it uniformly.
//   MIDS  → a slowly rotating directional current, weighted toward the centre.
//   HIGHS → per-particle micro-turbulence from inlined simplex noise.
// No audio → a slow breathing undulation. Cached BPM scales its rate, cached energy its amplitude.
//
// Additive blending is the whole look: overlapping points sum instead of occluding, so density
// reads as luminosity and the field becomes a volume rather than confetti.

const TEX = 256                    // texture edge; TEX² particles
const PARTICLE_COUNT = TEX * TEX   // 65,536
const DISC_RADIUS = 1.8            // rest disc; particles are contained just outside it
const BOUND = 1.9                  // soft containment radius

// Bass transient detection (CPU) → shockwaves (GPU).
const MAX_WAVES = 3
const WAVE_SPEED = 2.6      // units/sec the front travels outward
const WAVE_LIFETIME = 0.85  // seconds — a wave has crossed the field and died by now
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

// —— Ashima 3D simplex noise (MIT). Inlined; the highs turbulence and the idle drift both read it.
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
// The boundary is handled here too (predictively): the pass that OWNS velocity is the only one
// that can reflect it, so it looks one step ahead and flips the radial component before the
// position pass can push the particle through the wall.
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
uniform float uIdle;            // 1 = silent, 0 = playing — crossfades the ambient drift
uniform float uIdleAmp;         // cached track energy
uniform float uIdleHz;          // cached track BPM / 120
uniform vec3  uWaves[${MAX_WAVES}]; // x = front radius, y = strength, z = fade (0 = slot empty)

${SIMPLEX}

// Force scaling, and why these numbers are so much smaller than they look like they should be:
// damping retains 94% of velocity per frame, so a force F applied every frame settles at velocity
// F/(1-0.94) ≈ 17F, and the spring parks the particle where SPRING_K * displacement = F — i.e. at
// displacement F/0.06 ≈ 17F. A "reasonable-looking" F of 0.12 therefore means a 2-unit resting
// displacement, which throws the whole field out of the chamber. Every coefficient below is
// budgeted from the displacement it should produce: D ≈ F / SPRING_K.
#define SPRING_K 0.06
#define DAMPING 0.94
#define WAVE_WIDTH 0.4
#define MAX_SPEED 0.22   // per-frame hard ceiling — nothing can ever escape, whatever the audio does
#define BOUND ${BOUND.toFixed(2)}

varying vec2 vUv;

void main() {
  vec4 pos = texture2D(uPositionTexture, vUv);
  vec4 vel = texture2D(uVelocityTexture, vUv);
  vec4 home = texture2D(uHomeTexture, vUv);

  vec3 position = pos.xyz;
  vec3 velocity = vel.xyz;
  vec3 homePos = home.xyz;
  float mass = vel.w;              // 0.6..1.4 — lighter grains are flung further by the same force

  // Frame-normalised step: forces below are tuned in per-frame units at 60fps.
  float fs = clamp(uDeltaTime * 60.0, 0.0, 1.6);
  float restDist = length(homePos.xz);
  float force = 1.0 / mass;

  // 1. Damping — bleed velocity every frame so motion settles instead of ringing forever.
  velocity *= pow(DAMPING, fs);

  // 2. Spring back to home. This is the only thing holding the field together; every audio force
  //    below is a displacement the spring will eventually undo.
  vec3 displacement = position - homePos;
  velocity += -displacement * SPRING_K * fs;

  // 3. BASS → radial shockwaves. Each live wave is a ring travelling outward from the centre; a
  //    particle is lifted while the ring is passing over its REST radius (so the wave sweeps the
  //    field at a constant speed rather than dragging displaced particles along with it). This is
  //    an impulse, not a sustained force — a particle sits inside the ring for only ~9 frames — so
  //    it buys a bigger coefficient than the steady forces below, but not by much.
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    vec3 w = uWaves[i];
    if (w.z <= 0.0) continue;
    float prox = smoothstep(WAVE_WIDTH, 0.0, abs(restDist - w.x));
    velocity.y += prox * w.y * w.z * 0.008 * force * fs; // → peak lift ≈ 0.4 units
  }

  // 4. MIDS → a coherent current whose direction rotates slowly. Strongest at the centre, so the
  //    inner field shears against a near-static rim instead of the whole disc sliding.
  float angle = uTime * 0.3;
  vec2 flowDir = vec2(cos(angle), sin(angle));
  float centerWeight = 1.0 - smoothstep(0.0, ${DISC_RADIUS.toFixed(2)}, restDist);
  velocity.xz += flowDir * uMids * centerWeight * 0.012 * force * fs; // → drift ≈ 0.3 units

  // 5. HIGHS → micro-turbulence. Sampled on POSITION so the noise field is something the particles
  //    move through; deterministic, so it shimmers rather than pops.
  vec3 noiseInput = position * 3.0 + uTime * 1.5;
  vec3 turbulence = vec3(
    snoise(noiseInput),
    snoise(noiseInput + 100.0),
    snoise(noiseInput + 200.0)
  );
  velocity += turbulence * uHighs * 0.003 * force * fs; // → jitter ≈ 0.05 units

  // 6. IDLE → a slow breathing undulation that fades out as audio comes in. BPM sets its rate,
  //    track energy its amplitude, so a loaded-but-paused song still reads as itself.
  if (uIdle > 0.01) {
    float phase = uTime * 0.4 * uIdleHz + homePos.x * 2.0 + homePos.z * 2.0;
    float amp = uIdle * uIdleAmp * fs;
    velocity.y += sin(phase) * 0.002 * amp;
    velocity.xz += vec2(sin(uTime * 0.2), cos(uTime * 0.25)) * 0.001 * amp;
  }

  // 7. Speed ceiling. The forces above are budgeted to stay well under this; it exists so that a
  //    pathological input (three waves landing on one particle, a long dt after a tab restore)
  //    can't integrate into an escape velocity the spring will never claw back.
  float speed = length(velocity);
  if (speed > MAX_SPEED) velocity *= MAX_SPEED / speed;

  // 8. Soft containment. Look ahead one step: if this velocity would carry the particle past the
  //    wall, kill the outward component and bounce a little of it back inward.
  vec3 predicted = position + velocity * uDeltaTime * 60.0;
  float r = length(predicted.xz);
  if (r > BOUND) {
    vec2 outward = predicted.xz / r;
    float radialV = dot(velocity.xz, outward);
    if (radialV > 0.0) velocity.xz -= outward * radialV * 1.3; // reflect at 30% restitution
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

#define BOUND ${BOUND.toFixed(2)}

varying vec2 vUv;

void main() {
  vec4 pos = texture2D(uPositionTexture, vUv);
  vec4 vel = texture2D(uVelocityTexture, vUv);

  vec3 position = pos.xyz + vel.xyz * uDeltaTime * 60.0;

  // Hard backstop. The velocity pass already reflects at the wall; this only catches the case
  // where a huge dt (tab restore) would otherwise teleport a particle outside the chamber.
  float r = length(position.xz);
  if (r > BOUND) position.xz *= BOUND / r;
  position.y = clamp(position.y, -0.6, 1.6);

  gl_FragColor = vec4(position, pos.w);
}
`

// —— Render pass. The vertex shader reads its position out of the simulation texture; the CPU-side
// position attribute is a dummy that only exists so three knows how many points to draw.
const POINTS_VERT = /* glsl */ `
precision highp float;

uniform sampler2D uPositionTexture;
uniform float uSizeScale;  // viewportHeightPx / (2 * tan(fov/2)) — the world→pixel projection factor
uniform float uSize;       // particle diameter in WORLD units
uniform float uBass;

attribute vec2 aRef;   // this particle's texel address

varying float vLife;
varying float vDepth;

void main() {
  vec4 posData = texture2D(uPositionTexture, aRef);
  vLife = posData.w;

  vec4 mvPosition = modelViewMatrix * vec4(posData.xyz, 1.0);
  vDepth = -mvPosition.z;

  // True perspective sizing: a particle of a fixed WORLD size projects to uSize*uSizeScale/depth
  // pixels. This is what makes near particles bigger than far ones and gives the field real depth
  // — a size expression that bottoms out on its clamp at every depth renders as flat static.
  // uSizeScale is already in device pixels, so no pixelRatio factor here.
  float world = uSize * (1.0 + uBass * 0.35) * (0.7 + vLife * 0.6); // life doubles as size variance
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
varying float vDepth;

void main() {
  // Soft radial falloff — a hard-edged dot would alias into confetti under additive blending.
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;

  vec3 baseColor = mix(vec3(0.85, 0.8, 0.75), uColor, 0.35);

  // Fade with distance so the far edge of the field dissolves into the backplate rather than
  // ending on a crisp line.
  float depthFade = smoothstep(8.0, 2.5, vDepth);

  // Under AdditiveBlending the pixel gains color * alpha, so alpha IS this particle's share of the
  // final exposure — and 65k points overlap many-deep. It has to stay tiny (~0.05): brightness is
  // supposed to come from DENSITY summing, not from any single point. Crank this and the field
  // instantly saturates to a flat white blob.
  float falloff = smoothstep(0.5, 0.0, d);
  float alpha = falloff * uExposure * (0.6 + uBass * 0.5) * vLife * depthFade;

  gl_FragColor = vec4(baseColor, alpha);
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

    // Simulation textures must be renderable AND filterable-as-data. Full float is the target;
    // half float is the fallback on GPUs without EXT_color_buffer_float (positions stay in a ±2
    // range where half-float precision is still ~1e-3, so the field holds together).
    const gl = renderer.getContext()
    const canFloat = !!gl.getExtension('EXT_color_buffer_float')
    const DATA_TYPE = canFloat ? THREE.FloatType : THREE.HalfFloatType

    const f = featRef.current
    const c0 = f.album ?? FALLBACK_RGB

    const scene = new THREE.Scene()

    // Raking camera: high enough to read the disc, low enough that vertical displacement from a
    // bass wave is legible against the background. Pulled back far enough that the 3.6-unit-wide
    // field sits inside the frame with margin (closer, and bloom pushes it off every edge).
    // Fixed — no OrbitControls.
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 50)
    camera.position.set(0, 3.0, 4.6)
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

    // —— Seed data. Homes are a jittered disc: uniform areal density (sqrt of a uniform) with a
    // random angle, so the field reads as material rather than a plotted spiral. y ≈ 0 with a
    // whisper of noise so the rest plane isn't perfectly flat.
    const homeData = new Float32Array(PARTICLE_COUNT * 4)
    const posData = new Float32Array(PARTICLE_COUNT * 4)
    const velData = new Float32Array(PARTICLE_COUNT * 4)
    const refs = new Float32Array(PARTICLE_COUNT * 2)
    const dummyPos = new Float32Array(PARTICLE_COUNT * 3)

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const ang = Math.random() * Math.PI * 2
      // Jittered disc, but NOT uniform areal density: pow(u, 0.5) would spread the field evenly and
      // render as flat static with a hard cut-out edge. A lower exponent piles particles toward the
      // centre, so overlap (= brightness) falls off from a dense core — the field reads as a mass
      // with a bright middle instead of a sheet of sand.
      const rad = Math.pow(Math.random(), 0.42) * DISC_RADIUS
      const x = Math.cos(ang) * rad
      const z = Math.sin(ang) * rad
      // A little vertical scatter: a perfectly flat plane of points can't read as a volume, and the
      // depth variation gives near/far particles different sizes even at rest.
      const y = (Math.random() + Math.random() - 1) * 0.07

      const i4 = i * 4
      homeData[i4] = x
      homeData[i4 + 1] = y
      homeData[i4 + 2] = z
      homeData[i4 + 3] = 1
      posData[i4] = x
      posData[i4 + 1] = y
      posData[i4 + 2] = z
      // life = per-particle alpha. Faded out across the outer rim so the field dissolves into the
      // dark instead of ending on the hard circular edge that a bounded disc otherwise shows.
      const edge = 1 - Math.min(1, Math.max(0, (rad / DISC_RADIUS - 0.72) / 0.28))
      posData[i4 + 3] = (0.55 + Math.random() * 0.45) * (edge * edge * (3 - 2 * edge))
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

    // —— The field itself.
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(dummyPos, 3))
    geometry.setAttribute('aRef', new THREE.BufferAttribute(refs, 2))

    const pointsMat = new THREE.ShaderMaterial({
      uniforms: {
        uPositionTexture: { value: posA.texture },
        uColor: { value: new THREE.Color(c0[0], c0[1], c0[2]) },
        uBass: { value: 0 },
        // Size and exposure trade against each other: bigger points overlap more (which is what
        // FUSES 65k dots into a field instead of a sandpaper texture), so exposure has to come
        // down as size goes up or the whole thing saturates to white.
        uExposure: { value: 0.13 },
        uSize: { value: 0.036 },
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

    // —— Stage: a dark disc and a thin rim, sunk just under the rest plane. Deliberately almost
    // invisible — the particles are the only light source, and anything brighter than this reads
    // as a lit dish with beads sitting in it.
    //
    // The album tint is applied by MULTIPLYING the accent down, never by lerping a near-black
    // toward it: colour maths here happens in LINEAR space, where a black base is ~0.001 and the
    // accent is ~0.5, so even a 5% lerp lands 29× above the base and turns the stage into a
    // visible grey dish. Scale the accent instead — the hue survives, the darkness does too.
    const albumColor = new THREE.Color(c0[0], c0[1], c0[2])
    const plateMat = new THREE.MeshBasicMaterial({
      color: albumColor.clone().multiplyScalar(0.03),
      transparent: true,
      opacity: 0.5,
    })
    const plate = new THREE.Mesh(new THREE.CircleGeometry(2.0, 64), plateMat)
    plate.rotation.x = -Math.PI / 2
    plate.position.y = -0.05
    const rimMat = new THREE.MeshBasicMaterial({
      color: albumColor.clone().multiplyScalar(0.09),
      transparent: true,
      opacity: 0.18, // any brighter and the ring reads as the lip of a bowl the particles sit in
    })
    const rim = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.05, 64), rimMat)
    rim.rotation.x = -Math.PI / 2
    rim.position.y = -0.04
    scene.add(plate, rim)

    // —— Post: bloom is what turns overlapping additive points into light. Auto-cut below a
    // sustained 50fps (see frame()).
    let composer = new EffectComposer(renderer)
    composer.setPixelRatio(pr)
    composer.addPass(new RenderPass(scene, camera))
    // Threshold sits below the density of a resting clump (not just the bright wave crests), so the
    // field glows at idle instead of only lighting up on a bass hit.
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.6, 0.45)
    composer.addPass(bloom)

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

    // Frame-loop state. THE RULE: audio is the only thing that drives displacement; the spring
    // always pulls back to home. No motion beyond the idle undulation without sound.
    const st = {
      last: 0,
      time: 0,      // seconds — noise + flow + idle clock
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

      // — bass transients spawn shockwaves (on a rising edge or a jump, NOT every loud frame).
      if (st.audio > 0.1 && ((bass > BASS_ONSET && st.prevBass <= BASS_ONSET) || bass - st.prevBass > BASS_JUMP)) {
        spawnWave(bass)
      }
      st.prevBass = bass

      // — advance the wave fronts. front = radius reached; fade = strength remaining.
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

      // — draw the field from the texture we just wrote, then swap.
      pointsMat.uniforms.uPositionTexture.value = st.posWrite.texture
      pointsMat.uniforms.uBass.value = bass
      pointsMat.uniforms.uColor.value.setRGB(st.album[0], st.album[1], st.album[2])
      // Stage picks up the same crossfading accent, scaled right down (see the tint note above).
      plateMat.color.setRGB(st.album[0] * 0.03, st.album[1] * 0.03, st.album[2] * 0.03)
      rimMat.color.setRGB(st.album[0] * 0.09, st.album[1] * 0.09, st.album[2] * 0.09)

      let t = st.posRead; st.posRead = st.posWrite; st.posWrite = t
      t = st.velRead; st.velRead = st.velWrite; st.velWrite = t

      bloom.strength = 0.5 + 0.25 * st.amp * st.audio // 0.5 at rest → 0.75 on loud passages

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
      plate.geometry.dispose()
      plateMat.dispose()
      rim.geometry.dispose()
      rimMat.dispose()
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
