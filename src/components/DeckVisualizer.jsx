import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { useAudio } from '../store/useAudioStore'
import { useAlbumColor } from './useAlbumColor'
import { C, INSET } from './import/tokens'

// Deck View hero visualizer (Slice 14, Decision Log #59) — raymarched ferrofluid on a fullscreen
// quad. All shading happens in the fragment shader (SDF raymarch, Blinn-Phong + fresnel + SDF-based
// AO); blob MOTION is integrated per-frame in JS (viscous cubed-sine orbits, audio vs cached-feature
// blending) and handed to the shader as a vec4 array, keeping map() — called ~90× per pixel — down
// to sphere SDFs and a smooth union.
//
// The model is the actual physics of ferrofluid: ONE liquid mass, magnetic attractors pulling its
// surface outward at specific points, surface tension resisting. It is never separate objects:
//   ONE SURFACE — the SDF is a single core sphere plus tapered CAPSULES (round cones) rooted
//          INSIDE it, smooth-min'ed with a small k. The arm is a region of the surface being
//          stretched toward an attractor — thick at the root, thin stretchy tendril at the tip —
//          with no seam where it meets the body. Tiny droplet spheres hover just past the longest
//          tips, nearly pinching free.
//   FLAT — everything lives on a front-facing XY plane (z is a hair of per-blob offset), viewed
//          head-on like the glass window of a ferrofluid speaker. The silhouette is the visual.
//   VISCOUS — the mass is suspended in a dense carrier fluid, and that drag is the whole feel:
//          each arm runs a real spring sim (position += velocity; velocity += error·stiffness −
//          velocity·damping) with LOW stiffness and HIGH damping, so extension builds gradually,
//          peaks AFTER the audio transient, and retracts slower still. Heavy, elegant, underwater.
//          Arm directions also drift in a slow global rotation, so the shape is never static.
//
// THE RULE: audio is the ONLY force that deforms the shape. There are no timers and no
// oscillators driving extension — the audio data IS the animation.
//   idle    → a calm, nearly spherical blob. Arms fully retracted, droplets absorbed inside the
//             body; the only motion is a barely-perceptible BPM breathing from cached data.
//   playing → each arm listens to its own frequency band (bass / low-mid / mid / high-mid): its
//             spring TARGET is that band's amplitude THIS FRAME, curved for contrast. A bass drop
//             makes the bass arm explode outward while the others stay small; a melodic passage
//             wakes the mid arms while the bass arm rests; quiet between beats → targets fall to
//             ~0 and every arm sinks back into the body. That per-band split is the organic
//             asymmetry. Droplets exist only on transients — a hard spike in a tip's band breaks
//             it free, and it is reeled back in as the envelope decays. Overall amplitude scales
//             the whole field, and the harder the arms pull, the thinner the core is stretched —
//             on climaxes the body looks like it's struggling to hold together.
// The springs (low stiffness, HIGH damping) are unchanged: the target leaps with the audio and
// the arm chases it through viscous drag — the lag between spike and visual peak is the liquid.
// The idle↔playing crossfade runs through `audio` (smoothed 0↔1) so play/pause never pops.

// ONE continuous surface: a core sphere + tapered capsule arms rooted inside it. Surface tension
// forbids sharp points: arms are fat rounded fingers (gentle base→tip taper, bulbous ends), short
// enough to read as stubby lobes bulging out of the body — at rest the mass is a lumpy blob with
// 2–3 rounded bumps, never a symmetrical star or urchin.
const CORE_R = 0.65
// th = spoke angle (rad, VERY irregularly spaced), band = the analyser bin range this arm listens
// to (its spring target IS that band's amplitude — no oscillators), g = band gain (higher bins
// carry less byte energy), base/tip = root and end radii (root overlaps the core → seamless
// joint; the tip stays fat), reach = extension travel, k / d = spring stiffness / damping in
// per-frame units — LOW k + HIGH d is the viscous drag. ph seeds the angular sway; z = plane offset.
const ARMS = [
  { th: 0.3, band: [0, 5], g: 1.5, ph: 0.0, base: 0.32, tip: 0.26, reach: 0.9, k: 0.07, d: 0.88, z: 0.04 },
  { th: 1.1, band: [5, 15], g: 1.7, ph: 2.1, base: 0.28, tip: 0.21, reach: 0.7, k: 0.09, d: 0.9, z: -0.03 },
  { th: 3.4, band: [15, 35], g: 1.9, ph: 4.4, base: 0.3, tip: 0.24, reach: 0.85, k: 0.05, d: 0.87, z: 0.02 },
  { th: 4.6, band: [35, 60], g: 2.2, ph: 1.2, base: 0.28, tip: 0.2, reach: 0.65, k: 0.08, d: 0.92, z: -0.05 },
]
// Two droplets hugging the tips of the two biggest arms — about to merge back in, never far off.
const TIPS = [
  { arm: 0, r: 0.13, z: 0.05 },
  { arm: 2, r: 0.11, z: -0.04 },
]

const VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

const FRAG = /* glsl */ `
precision highp float;

uniform vec2  uRes;        // drawing-buffer size (px)
uniform vec4  uCore;                    // xyz = body centre, w = body radius
uniform vec4  uArm[${ARMS.length}];     // xyz = arm tip position, w = tip radius
uniform float uArmBase[${ARMS.length}]; // arm root radius (sits inside the body)
uniform vec4  uTip[${TIPS.length}];     // xyz = droplet centre, w = radius
uniform float uValence;    // 0 dark/moody → 1 bright/energetic (smoothed mood)
uniform float uSpec;       // specular / rim intensity (amplitude when live, energy when idle)
uniform vec3  uAlbum;      // album-art accent colour (0..1), pre-lerped in JS on song switch
uniform float uAlbumMix;   // 0 = mood-palette fallback ↔ 1 = album-driven colour scheme

#define STEPS 80
#define EPS 0.0004
#define FAR 20.0

// Polynomial smooth min — the blobby merge (k ≈ 1 for heavy, liquid unions).
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float dot2(vec3 v) { return dot(v, v); }

// Exact tapered capsule / round cone (iq) — radius interpolates r1 (base) → r2 (tip). Being an
// exact SDF it stays safe under full-step marching even on steep tapers.
float sdRoundCone(vec3 p, vec3 a, vec3 b, float r1, float r2) {
  vec3 ba = b - a;
  float l2 = dot(ba, ba);
  float rr = r1 - r2;
  float a2 = max(l2 - rr * rr, 1e-4);
  float il2 = 1.0 / l2;
  vec3 pa = p - a;
  float y = dot(pa, ba);
  float z = y - l2;
  float x2 = dot2(pa * l2 - ba * y);
  float y2 = y * y * l2;
  float z2 = z * z * l2;
  float k = sign(rr) * rr * rr * x2;
  if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
  if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
  return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

// ONE continuous surface — a liquid body whose surface is pulled outward at attractor points.
// The arms are tapered capsules ROOTED INSIDE the body sphere, so the smooth-min only rounds the
// joint: no seam, just one mass stretched by the field and held together by surface tension.
// NO displacement of any kind — mercury-smooth.
float map(vec3 p) {
  float d = length(p - uCore.xyz) - uCore.w;
  for (int i = 0; i < ${ARMS.length}; i++) {
    d = smin(d, sdRoundCone(p, uCore.xyz, uArm[i].xyz, uArmBase[i], uArm[i].w), 0.18);
  }
  for (int i = 0; i < ${TIPS.length}; i++) {
    d = smin(d, length(p - uTip[i].xyz) - uTip[i].w, 0.14);
  }
  return d;
}

// Normal from the SDF gradient (central differences). The epsilon grows with ray distance — a
// footprint matched to the pixel keeps normals stable (too small = stepping artifacts on the
// smooth-min curvature, too large = softened tendril silhouettes). The field is analytically smooth
// now (no displacement), so it can be tight.
vec3 calcNormal(vec3 p, float t) {
  vec2 e = vec2(0.0005 + 0.0002 * t, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)));
}

// Cheap AO — the distance field sampled at four points along the normal.
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

// Mood palette: low = navy/purple/magenta, mid = teal/cyan/pink, high = orange/coral/hot pink.
vec3 pal3(vec3 lo, vec3 mi, vec3 hi) {
  vec3 c = mix(lo, mi, smoothstep(0.15, 0.5, uValence));
  return mix(c, hi, smoothstep(0.5, 0.85, uValence));
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;

  // Head-on, flat — like looking through the glass window of a ferrofluid speaker.
  vec3 ro = vec3(0.0, 0.0, 4.0);
  vec3 rd = normalize(vec3(uv, -2.1));

  // Background: a near-black void (#0A0A0A) with only a whisper of the album/mood tint at the
  // centre — the fluid floats in darkness and the speculars carry the light.
  vec3 tint = pal3(vec3(0.30, 0.16, 0.55), vec3(0.15, 0.45, 0.50), vec3(0.75, 0.35, 0.25));
  tint = mix(tint, uAlbum, uAlbumMix);
  float rr = length(uv * vec2(0.8, 1.0));
  vec3 bg = vec3(0.0392, 0.0392, 0.0392);
  bg += tint * 0.035 * exp(-rr * rr * 2.2);
  bg *= 1.0 - 0.18 * smoothstep(0.5, 1.5, rr);

  float t = 0.0;
  float d = FAR;
  for (int i = 0; i < STEPS; i++) {
    d = map(ro + rd * t);
    if (d < EPS || t > FAR) break;
    t += d; // full step — polynomial smin only underestimates distance, so this never overshoots
  }

  vec3 col = bg;
  if (d < EPS) {
    // Newton polish: two proportional steps land the hit exactly on the isosurface, killing the
    // distance-banding facets that a plain threshold exit leaves behind (no extra march steps).
    t += d;
    t += map(ro + rd * t);
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p, t);
    float ao = calcAO(p, n);

    vec3 l = normalize(vec3(0.55, 0.8, 0.55));
    float dif = clamp(dot(n, l), 0.0, 1.0);
    vec3 hv = normalize(l - rd);
    float spec = pow(clamp(dot(n, hv), 0.0, 1.0), 192.0); // mirror-tight — the wet ferrofluid glint
    // Second, broader glint from another direction: several smaller highlights across the curved
    // surface read as wet liquid; one glaring spotlight reads as plastic.
    vec3 l2 = normalize(vec3(-0.6, -0.25, 0.75));
    vec3 hv2 = normalize(l2 - rd);
    float spec2 = pow(clamp(dot(n, hv2), 0.0, 1.0), 64.0);
    float fre = pow(clamp(1.0 + dot(n, rd), 0.0, 1.0), 3.0);

    vec3 cA = pal3(vec3(0.05, 0.09, 0.32), vec3(0.03, 0.32, 0.36), vec3(0.92, 0.28, 0.08));
    vec3 cB = pal3(vec3(0.44, 0.14, 0.78), vec3(0.14, 0.70, 0.84), vec3(1.00, 0.22, 0.52));
    vec3 cC = pal3(vec3(0.90, 0.18, 0.60), vec3(0.98, 0.46, 0.64), vec3(1.00, 0.45, 0.78));
    vec3 cSpec = pal3(vec3(0.72, 0.84, 1.00), vec3(0.92, 0.98, 1.00), vec3(1.00, 0.86, 0.55));

    // Album-driven scheme (Slice 14 #3), ferrofluid treatment: DARK saturated fluid whose colour
    // shows mostly in the reflections. Faces sit near-black tinted by the cover, the iridescent
    // shift runs toward the saturated cover colour, and speculars use a brightness-NORMALISED
    // album hue — dark covers still throw bright coloured glints, bright covers go warm.
    // The accent is saturation-boosted first (muted covers otherwise read as mud); uAlbumMix
    // fades the whole scheme to the mood palette when no colour is available.
    float lum = dot(uAlbum, vec3(0.299, 0.587, 0.114));
    vec3 alb = clamp(mix(vec3(lum), uAlbum, 1.6), 0.0, 1.0);
    vec3 albHue = alb / max(max(alb.r, max(alb.g, alb.b)), 0.25);
    cA = mix(cA, alb * 0.3, uAlbumMix);
    cB = mix(cB, alb * 0.85, uAlbumMix);
    cC = mix(cC, pow(alb, vec3(0.55)) * 1.1, uAlbumMix);
    cSpec = mix(cSpec, mix(vec3(1.0), albHue, 0.45), uAlbumMix);

    // Iridescence — hue drifts across the surface with the normal, pushed to cC at grazing angles.
    // Kept restrained: dark liquid, not glowing alien.
    vec3 base = mix(cA, cB, clamp(0.5 + 0.5 * n.y + 0.25 * n.x, 0.0, 1.0));
    base = mix(base, cC, fre * 0.35);

    // Fake environment reflection — a vertical sky/floor gradient read through fresnel.
    vec3 env = mix(vec3(0.02, 0.02, 0.03), cSpec * 0.30, smoothstep(-0.5, 1.0, n.y));

    col = base * (0.12 + 0.55 * dif) * ao;      // dark fluid body
    col += env * fre * 0.55;
    col += cC * fre * fre * 0.22;               // subtle wet rim
    col += cSpec * spec * (0.45 + 0.8 * uSpec);  // primary glint — softened
    col += cSpec * spec2 * (0.18 + 0.3 * uSpec); // broad second lobe — spread wet highlights

    col = mix(col, bg, smoothstep(9.0, 14.0, t)); // distant lobes sink into the background
  }

  // Gentle tone curve — soft rolloff keeps highlights hot enough for the bloom threshold.
  col = col / (1.0 + col * 0.35);
  col = pow(col, vec3(0.92));
  gl_FragColor = vec4(col, 1.0);
}
`

const clamp01 = (v) => Math.min(1, Math.max(0, v))
// Attack/release smoothing: rise fast (hits land), fall slow (decay feels physical).
const ease = (cur, target, up, down) => cur + (target - cur) * (target > cur ? up : down)

// Average of analyser byte bins [from, to) normalised to 0..1.
function band(freq, from, to) {
  let s = 0
  for (let i = from; i < to; i++) s += freq[i]
  return s / ((to - from) * 255)
}

export default function DeckVisualizer({ track, open }) {
  const { engine } = useAudio()
  const hostRef = useRef(null)
  const stateRef = useRef(null)

  // Album-art accent (same extraction as the ambient glow / track bar): 'r, g, b' or null.
  const albumRgb = useAlbumColor(track?.album_art_url)

  // Cached features the ambient mode runs on; lerped toward inside the frame loop so song switches
  // glide (colour crossfade over ~500ms) instead of snapping.
  const featRef = useRef(null)
  featRef.current = {
    bpm: track?.bpm > 0 ? track.bpm : 120,
    energy: track?.energy != null ? clamp01(track.energy / 100) : 0.5,
    valence: track?.mood != null ? clamp01(track.mood / 100) : 0.5,
    album: albumRgb ? albumRgb.split(',').map((v) => Number(v) / 255) : null,
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
    const uniforms = {
      uRes: { value: new THREE.Vector2(1, 1) },
      uCore: { value: new THREE.Vector4(0, 0, 0, CORE_R) },
      uArm: { value: ARMS.map((a) => new THREE.Vector4(Math.cos(a.th) * 0.5, Math.sin(a.th) * 0.4, a.z, 0.1)) },
      uArmBase: { value: ARMS.map((a) => a.base) },
      uTip: { value: TIPS.map((ti) => new THREE.Vector4(0, 0, ti.z, ti.r)) },
      uValence: { value: f.valence },
      uSpec: { value: 0.45 + 0.5 * f.energy },
      uAlbum: { value: new THREE.Vector3(...(f.album ?? [0.5, 0.5, 0.55])) },
      uAlbumMix: { value: f.album ? 1 : 0 },
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

    // Subtle bloom (strength ~0.55) so the wet speculars glow; auto-cut below 50fps (see frame()).
    let composer = new EffectComposer(renderer)
    composer.setPixelRatio(pr)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.6)
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

    // Frame-loop state. Everything audio-reactive is smoothed here, then written to uniforms.
    const st = {
      last: 0,
      anim: Math.random() * 100,    // writhe clock, speed-warped by mids/energy/amplitude
      beat: 0,                      // beat phase, 1.0 per beat (BPM breathing)
      rot: Math.random() * 6.28,    // slow global rotation of the arm directions
      len: new Float32Array(ARMS.length),  // per-arm extension spring position (0 → ~1.35)
      lenV: new Float32Array(ARMS.length), // per-arm extension spring velocity
      armBand: new Float32Array(ARMS.length), // each arm's own frequency band, lightly eased
      pop: new Float32Array(TIPS.length),     // droplet break-free envelope (transient-fired)
      popPrev: new Float32Array(TIPS.length), // last frame's raw tip-band value (spike detection)
      pull: 0,                                // last frame's mean extension → core strain
      armTh: new Float32Array(ARMS.length),   // this frame's arm angles (droplets ride them)
      armLen: new Float32Array(ARMS.length),  // this frame's arm lengths
      armTipR: new Float32Array(ARMS.length), // this frame's arm tip radii
      bass: 0, mids: 0, highs: 0, amp: 0,
      audio: 0,                  // live-audio blend 0↔1
      kick: 0, prevBass: 0,      // transient envelope — raw bass delta; feeds arm targets + squash
      jit: 0,                    // slow stir phase for the tip droplets
      energy: f.energy, valence: f.valence, bpm: f.bpm,
      album: f.album ? [...f.album] : [0.5, 0.5, 0.55],
      albumMix: f.album ? 1 : 0,
      freq: null,
      frames: 0, fpsAcc: 0, fpsN: 0, bloomOn: true,
    }

    st.frame = (now) => {
      const dt = Math.min(0.05, st.last ? (now - st.last) / 1000 : 0.016)
      st.last = now

      // — audio bands (attack/release smoothed) —
      const an = engine.analyser
      const live = !!(engine.getSnapshot().playing && an)
      let tb = 0, tm = 0, th = 0
      if (live) {
        if (!st.freq || st.freq.length !== an.frequencyBinCount) st.freq = new Uint8Array(an.frequencyBinCount)
        an.getByteFrequencyData(st.freq)
        tb = band(st.freq, 0, 10)
        tm = band(st.freq, 10, 40)
        th = band(st.freq, 40, 80)
      }
      st.bass = ease(st.bass, tb, 0.6, 0.18)
      st.mids = ease(st.mids, tm, 0.45, 0.12)
      st.highs = ease(st.highs, th, 0.6, 0.2)
      st.amp = ease(st.amp, (tb + tm + th) / 3, 0.45, 0.1)
      st.audio += ((live ? 1 : 0) - st.audio) * 0.06
      // Kick detection on the RAW bass (pre-smoothing; analyser smoothing is lowered to 0.3 so
      // transients survive). Low threshold — EVERY kick drum should register, not just drops —
      // with the impulse scaled by how hard the transient hit.
      const jolt = tb - st.prevBass
      if (jolt > 0.06) st.kick = Math.max(st.kick, Math.min(1, jolt * 5))
      st.prevBass = tb
      // The envelope decays over ~350ms; it drives the impact squash and bloom flare only —
      // arm extension listens to the per-band amplitudes below, not to this.
      st.kick *= Math.exp(-dt * 5)

      // Per-arm frequency bands — each arm's spring target IS its band's amplitude right now.
      // The light ease kills single-frame FFT noise; all the visible lag comes from the springs.
      for (let i = 0; i < ARMS.length; i++) {
        const raw = live ? band(st.freq, ARMS[i].band[0], ARMS[i].band[1]) : 0
        st.armBand[i] = ease(st.armBand[i], raw, 0.7, 0.25)
      }
      // Droplet transients: a hard spike in a tip arm's band breaks its droplet free (envelope
      // → 1), and the decay reels it back into the tip. No spikes → no droplets, ever.
      for (let i = 0; i < TIPS.length; i++) {
        const raw = live ? band(st.freq, ARMS[TIPS[i].arm].band[0], ARMS[TIPS[i].arm].band[1]) : 0
        if (raw - st.popPrev[i] > 0.12) st.pop[i] = 1
        st.popPrev[i] = raw
        st.pop[i] *= Math.exp(-dt * 3.5)
      }

      // — cached features glide toward the open track's values —
      const ft = featRef.current
      st.energy += (ft.energy - st.energy) * 0.03
      st.valence += (ft.valence - st.valence) * 0.03
      st.bpm += (ft.bpm - st.bpm) * 0.08
      // Album colour: ~500ms crossfade on song switch. With no colour the mix fades to the mood
      // palette while the last colour is held (so the fade-out doesn't drift through gray).
      st.albumMix += ((ft.album ? 1 : 0) - st.albumMix) * 0.08
      if (ft.album) for (let i = 0; i < 3; i++) st.album[i] += (ft.album[i] - st.album[i]) * 0.08

      // — clocks. These drive only the core's slow drift and the arms' angular sway — never
      // extension. Idle they crawl (the resting blob is almost perfectly still); live they scale
      // with loudness so louder music also stirs the directions a little faster.
      const drive = (0.5 + 1.5 * st.amp) * st.audio + (1 - st.audio)
      const speed = 0.1 * (1 - st.audio) + (0.3 + 0.8 * st.mids) * drive * st.audio
      st.anim += dt * speed
      st.jit += dt * (1.5 + 2.5 * st.highs) * drive
      st.rot += dt * (0.02 + 0.08 * st.mids * st.audio) // slow drift of the arm directions
      st.beat += (dt * st.bpm) / 60

      // Body inflation: idle = the barely-perceptible BPM breathing (the ONLY idle motion);
      // live = bass swell + kick, and amplitude scales the WHOLE field (gScale) — quiet passages
      // visibly shrink and tighten, loud ones swell.
      const breathe = 0.5 - 0.5 * Math.cos(2 * Math.PI * (st.beat % 1))
      const ambScale = 1 + (0.05 + 0.05 * st.energy) * breathe * breathe
      const rs = ambScale + (1 + st.bass * 0.4 + st.kick * 0.3 - ambScale) * st.audio
      const gScale = 1 - st.audio + (0.88 + 0.42 * st.amp) * st.audio

      // Squash & stretch on impact — softened: viscous fluid deforms, it doesn't snap.
      const sq = st.kick * st.audio
      const sqX = 1 + 0.12 * sq
      const sqY = 1 - 0.18 * sq

      // — the core: heavy, barely wandering, never leaving centre. It is NOT a rigid anchor:
      // the harder the arms pull (mean extension, one frame behind), the thinner it stretches —
      // on climaxes the body visibly struggles to hold itself together.
      const t = st.anim
      const cx = Math.sin(t * 0.23) * 0.06 * sqX
      const cy = Math.cos(t * 0.19) * 0.05 * sqY
      const coreStrain = 1 - 0.22 * Math.min(1, st.pull) * st.audio
      uniforms.uCore.value.set(cx, cy, 0, CORE_R * rs * gScale * coreStrain)

      // — arms: REAL spring simulation per arm (position += velocity; velocity += error·stiffness
      // − velocity·damping), stiffness low, damping high, retraction stiffer-damped still. The
      // TARGET is pure audio: this frame's band amplitude, curved (pow 1.4) so quiet frames sit
      // near zero and loud ones leap — sound pushes the arm out, silence lets it sink back in.
      // The spring chasing that jumpy target through heavy drag is the entire viscous feel.
      // Idle target: a breathing lump so faint the resting blob reads as nearly still.
      const fs = Math.min(1.1, dt * 60) // frame-normalised spring step
      let pull = 0
      for (let i = 0; i < ARMS.length; i++) {
        const a = ARMS[i]
        const idleT = 0.05 + 0.05 * breathe
        const liveT = Math.min(1.35, Math.pow(st.armBand[i], 1.4) * a.g)
        const target = idleT * (1 - st.audio) + liveT * st.audio
        const err = target - st.len[i]
        const stiff = err > 0 ? a.k : a.k * 0.45 // retraction drags harder than extension
        st.lenV[i] += (err * stiff - st.lenV[i] * a.d) * fs
        st.len[i] += st.lenV[i] * fs

        const ext = Math.max(0, st.len[i])
        pull += ext
        const th = a.th + st.rot + Math.sin(t * 0.5 + a.ph * 2.3) * 0.12
        const len = (0.35 + ext * a.reach) * gScale
        // Rounded bulbous end: thins only slightly as it stretches — a fat finger, never a needle.
        const tipR = (a.tip - 0.06 * Math.min(1, ext)) * gScale
        uniforms.uArm.value[i].set(
          cx + Math.cos(th) * len * sqX,
          cy + Math.sin(th) * len * 0.78 * sqY, // elliptical field matches the tile aspect
          a.z,
          tipR,
        )
        uniforms.uArmBase.value[i] = a.base * rs * gScale
        st.armTh[i] = th
        st.armLen[i] = len
        st.armTipR[i] = tipR
      }

      st.pull = pull / ARMS.length // mean extension → next frame's core strain

      // — tip droplets: they exist ONLY on hard hits. A transient fires the pop envelope: the
      // droplet breaks free of the arm tip and shoots out, then the decay reels it back until it
      // is absorbed. Calm passages (and idle) have no droplets at all — they sit shrunken inside
      // the body.
      for (let i = 0; i < TIPS.length; i++) {
        const ti = TIPS[i]
        const pop = st.pop[i] * st.audio
        const out = Math.min(1, pop * 2) // 0 = buried in the tip → 1 = fully broken free
        const wob = Math.sin(st.jit + i * 2.6) * 0.08 * pop
        const th = st.armTh[ti.arm] + wob
        const r = ti.r * Math.min(1, 0.15 + pop * 1.4) * gScale
        const dist = st.armLen[ti.arm] - 0.15 * (1 - out) +
          (st.armTipR[ti.arm] + r + 0.5 * pop) * out
        uniforms.uTip.value[i].set(
          cx + Math.cos(th) * dist * sqX,
          cy + Math.sin(th) * dist * 0.78 * sqY,
          ti.z,
          r,
        )
      }
      uniforms.uValence.value = st.valence
      uniforms.uAlbum.value.set(st.album[0], st.album[1], st.album[2])
      uniforms.uAlbumMix.value = st.albumMix
      uniforms.uSpec.value = (0.45 + 0.5 * st.energy) * (1 - st.audio) + (0.5 + 2.2 * st.amp) * st.audio
      bloom.strength = 0.45 + (1.0 * st.amp + 0.3 * st.kick) * st.audio // loud moments flare

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
