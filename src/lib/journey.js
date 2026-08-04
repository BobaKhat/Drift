// Journey — a deterministic, text-only summary of the energy/vibe arc of a connected set.
//
// Given the ordered array of connected-chain tracks (is_connected === true, by position), this
// produces a 1–4 sentence narrative of how the set moves — where it builds, where it turns, how it
// lands — plus a compressed arrow line ("simmering → peak energy → down-tempo") for the trigger pill.
// No AI, no LLM, no persistence: pure template fill over energy + mood (0–100), recomputed on the fly
// every time the chain changes. The SAME chain in the SAME order MUST always yield the exact same text,
// so nothing here reads Math.random() or the clock — every word choice is keyed off the data itself
// (energy / mood / delta run through modulo arithmetic; template variants off the start-energy tier).
//
// Kept UI-free on purpose: the map component calls generateJourneyNarrative(tracks) and renders the
// result. Returns { summary, compressed } or null (fewer than 2 tracks with both features).
//
// Design notes on the vocabulary (the deliberate shape of this engine):
//  • Energy is bucketed into FOUR tiers, and the label a track gets depends on the DIRECTION it was
//    entered from — a track at 55 reads "building" when climbed into and "coming down but still moving"
//    when dropped into. Only the very first and last track use static (direction-free) labels.
//  • Mood is a modifier on energy, mentioned ONLY when it's off-centre: <40 dark, >60 bright, else
//    silent. Never standalone.
//  • BANNED from every output: "moderate", "balanced", "neutral". None of the vocab below contains them.
//  • Direction-aware phrases are used only in clause/appositive positions where any phrase form reads
//    cleanly; the named vibe slots (start/end/peak/trough, flip endpoints) take the static labels, which
//    are all clean noun/adjective phrases, so the prose never fractures grammatically.

// A track-to-track energy delta this small or smaller counts as "steady" — no real direction change —
// so tiny wobbles never get narrated. Applies only to direction detection (reversals, runs, holding);
// raw values still drive bucketing.
const NOISE = 8

// —— Energy tiers ————————————————————————————————————————————————————————————————————————————
// 0 Low <35 · 1 Low-mid 35–<50 · 2 Mid-high 50–70 · 3 High >70.
function tierOf(e) {
  if (e < 35) return 0
  if (e < 50) return 1
  if (e <= 70) return 2
  return 3
}

// Static labels — first and last track only. Two options per tier, chosen by energy % 2.
const STATIC = {
  0: ['deep and low', 'down-tempo'],
  1: ['simmering', 'warming up'],
  2: ['driving', 'locked in'],
  3: ['full send', 'peak energy'],
}

// Direction-aware labels — every interior track, chosen by tier + how it was entered (rising/falling/
// holding). A `null` cell is a rare combination (e.g. rising *into* a Low tier) and falls back to the
// static label. Multi-option cells pick by energy % (option count).
const DIRECTIONAL = {
  0: { rising: null,                              falling: ['winding down', 'pulling way back'],  holding: ['keeping it low', 'staying in the pocket'] },
  1: { rising: ['starting to push', 'the energy creeps in'], falling: ['easing off', 'cooling down'], holding: ['cruising', 'holding steady'] },
  2: { rising: ['building', 'the energy picks up'], falling: ['coming down but still moving'],       holding: ['locked in', 'keeping pace'] },
  3: { rising: ['going off', 'hits hard'],         falling: null,                                    holding: ['relentless', "doesn't let up"] },
}

// Mood adjectives — modifier only, and only when mood is off-centre.
const MOOD_DARK = ['dark', 'heavy', 'moody']
const MOOD_BRIGHT = ['bright', 'euphoric', 'uplifting']

// Deterministic index helpers — modulo on the actual data value, never random.
const idx = (val, len) => (len <= 1 ? 0 : ((Math.abs(Math.round(val)) % len) + len) % len)

function staticLabel(e) {
  const opts = STATIC[tierOf(e)]
  return opts[idx(e, opts.length)]
}

function directionalLabel(e, dir) {
  const cell = DIRECTIONAL[tierOf(e)][dir]
  if (!cell) return staticLabel(e) // rare combination → static fallback
  return cell[idx(e, cell.length)]
}

function moodAdj(m) {
  if (m < 40) return MOOD_DARK[idx(m, MOOD_DARK.length)]
  if (m > 60) return MOOD_BRIGHT[idx(m, MOOD_BRIGHT.length)]
  return null // 40–60: omit
}

// Attach a mood adjective to an energy label. When the label already contains "and" ("deep and low"),
// join with a comma instead so we never stack "dark and deep and low".
function joinMood(adj, base) {
  if (!adj) return base
  return base.includes(' and ') ? `${adj}, ${base}` : `${adj} and ${base}`
}

// A named "vibe" — static energy label with the mood modifier when notable. Clean grammar in any slot.
function vibe(energies, moods, i) {
  return joinMood(moodAdj(moods[i]), staticLabel(energies[i]))
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length

// Smoothed direction between two values.
function dirBetween(a, b) {
  const d = b - a
  if (d > NOISE) return 'rising'
  if (d < -NOISE) return 'falling'
  return 'holding'
}

// Relative position language. Never track numbers.
function positional(i, n) {
  const f = n > 1 ? i / (n - 1) : 0
  if (f < 0.25) return 'early on'
  if (f < 0.4) return 'in the first half'
  if (f < 0.6) return 'around the midpoint'
  if (f < 0.75) return 'in the back half'
  return 'toward the end'
}

// Magnitude descriptor by absolute delta, chosen by delta % (option count).
function magnitude(delta) {
  const d = Math.abs(delta)
  let arr
  if (d <= 15) arr = ['subtle shift', 'slight lean', 'gentle drift']
  else if (d <= 35) arr = ['solid push', 'clear drop', 'noticeable climb']
  else if (d <= 55) arr = ['big swing', 'sharp drop', 'real surge']
  else arr = ['massive flip', 'dramatic shift', 'huge leap']
  return arr[idx(d, arr.length)]
}

// —— Trajectory analysis ————————————————————————————————————————————————————————————————————
function analyze(energies) {
  const n = energies.length

  // Smoothed per-segment directions (+1 / -1 / 0).
  const dirs = []
  for (let i = 0; i < n - 1; i++) {
    const d = energies[i + 1] - energies[i]
    dirs.push(Math.abs(d) <= NOISE ? 0 : d > 0 ? 1 : -1)
  }

  // Reversals — flips between rising and falling, ignoring steady segments.
  let reversals = 0
  let last = 0
  for (const s of dirs) {
    if (s === 0) continue
    if (last !== 0 && s !== last) reversals++
    last = s
  }

  // Monotonic runs — maximal same-direction stretches (steady breaks a run). Ranked by magnitude ×
  // track-count.
  const runs = []
  let i = 0
  while (i < dirs.length) {
    if (dirs[i] === 0) { i++; continue }
    const dir = dirs[i]
    let j = i
    while (j < dirs.length && dirs[j] === dir) j++
    runs.push({
      start: i,
      end: j, // track index the run lands on
      direction: dir === 1 ? 'up' : 'down',
      magnitude: Math.abs(energies[j] - energies[i]),
      length: j - i + 1,
    })
    i = j
  }
  runs.sort((a, b) => b.magnitude * b.length - a.magnitude * a.length)

  // Sharpest single track-to-track jump (raw values).
  let sharp = { idx: 0, delta: 0 }
  for (let k = 0; k < n - 1; k++) {
    const d = energies[k + 1] - energies[k]
    if (Math.abs(d) > Math.abs(sharp.delta)) sharp = { idx: k, delta: d }
  }

  const startE = energies[0]
  const endE = energies[n - 1]
  const max = Math.max(...energies)
  const min = Math.min(...energies)

  return {
    n, reversals, runs, run: runs[0] || null, sharp,
    startE, endE, max, min,
    maxIdx: energies.indexOf(max),
    minIdx: energies.indexOf(min),
    range: max - min,
    net: endE - startE,
  }
}

// Overall shape. Steady wins on a tight range; the arc shapes (peak/valley) are checked before pure
// direction so a rise-then-fall isn't mislabeled; a noisy trajectory is oscillating, sub-tiered by how
// much of the interior reverses. Short chains (<6) need a higher reversal ratio before counting as
// oscillating — their ratios are naturally noisier. A low-reversal set with no strong trend falls back
// to its gentle lean.
function classify(a) {
  const { n, reversals, startE, endE, max, min, maxIdx, minIdx, range, net } = a
  const interiorMax = maxIdx > 0 && maxIdx < n - 1
  const interiorMin = minIdx > 0 && minIdx < n - 1

  if (range <= 20) return { shape: 'steady' }
  if (interiorMax && max - Math.max(startE, endE) >= 15 && reversals <= 3) return { shape: 'peak' }
  if (interiorMin && Math.min(startE, endE) - min >= 15 && reversals <= 3) return { shape: 'valley' }
  if (net >= 15 && reversals <= 2) return { shape: 'ascending' }
  if (net <= -15 && reversals <= 2) return { shape: 'descending' }

  const ratio = n > 2 ? reversals / (n - 2) : 0
  const mildFloor = n < 6 ? 0.6 : 0.4
  if (ratio < mildFloor) {
    if (net >= 8) return { shape: 'ascending' }
    if (net <= -8) return { shape: 'descending' }
    if (interiorMax) return { shape: 'peak' }
    if (interiorMin) return { shape: 'valley' }
    return { shape: 'steady' }
  }
  return { shape: 'oscillating', tier: ratio >= 0.7 ? 'wild' : ratio >= 0.55 ? 'moderate' : 'mild' }
}

// —— Dedup (Step 8) —————————————————————————————————————————————————————————————————————————
// Whether the sharpest jump is worth narrating as its own sentence: it must be notable AND fall outside
// the strongest run's span, so we never describe the same transition twice.
function sharpIsDistinct(a) {
  const { run, sharp } = a
  if (Math.abs(sharp.delta) < 12) return false
  if (run && sharp.idx >= run.start && sharp.idx <= run.end - 1) return false
  return true
}

// A direction-aware clause for the track a run lands on — used inside em-dash appositives where any
// phrase form (gerund or full clause) reads cleanly. Mood is intentionally left off here; it lives in
// the static vibe slots so a clause never collides with an adjective.
function runClause(a, energies) {
  const { run } = a
  const dir = run.direction === 'up' ? 'rising' : 'falling'
  return directionalLabel(energies[run.end], dir)
}

// —— Short chains ————————————————————————————————————————————————————————————————————————————
function twoTrack(energies) {
  const t0 = tierOf(energies[0])
  const t1 = tierOf(energies[1])
  const diff = Math.abs(t0 - t1)
  const s0 = staticLabel(energies[0])
  const s1 = staticLabel(energies[1])
  if (diff === 0) return `Same energy, different song — both sitting ${s0}.`
  if (diff === 1) return `${cap(s0)} into ${s1} — a ${magnitude(energies[1] - energies[0])} ${energies[1] > energies[0] ? 'up' : 'down'}.`
  return `${cap(s0)} straight into ${s1}. A hard cut — no transition, just a flip.`
}

function threeTrack(energies, moods) {
  const s0 = staticLabel(energies[0])
  const s2 = staticLabel(energies[2])
  const mid = directionalLabel(energies[1], dirBetween(energies[0], energies[1]))
  const net = energies[2] - energies[0]
  const overall = net > NOISE ? 'It climbs overall.' : net < -NOISE ? 'It winds down by the end.' : 'It circles right back.'
  return `${cap(s0)} to open, then ${mid}, landing ${s2}. ${overall}`
}

// —— Shape templates (4+ tracks) ————————————————————————————————————————————————————————————
// Each returns an array of sentences (falsy dropped). Variant selection, where a shape offers openings,
// is keyed on the start-energy tier so the same set always renders the same variant.
function buildAscending(a, energies, moods) {
  const startTier = tierOf(energies[0])
  const openings = [
    `Starts ${vibe(energies, moods, 0)} and works its way up.`,
    `Opens ${vibe(energies, moods, 0)} and keeps pushing higher.`,
    `Already ${vibe(energies, moods, 0)} early, and it just keeps climbing.`,
    `Starts ${vibe(energies, moods, 0)} and somehow finds another gear.`,
  ]
  const mid = sharpIsDistinct(a)
    ? `There's a moment ${positional(a.sharp.idx + 1, a.n)} where it really kicks into gear.`
    : a.run ? `${cap(positional(a.run.end, a.n))}, ${runClause(a, energies)} — no stalling.` : null
  return [openings[startTier], mid, `Ends ${vibe(energies, moods, a.n - 1)}, nowhere left to climb.`]
}

function buildDescending(a, energies, moods) {
  const startTier = tierOf(energies[0])
  const openings = [
    `Opens ${vibe(energies, moods, 0)} and sinks lower from there.`,
    `Opens ${vibe(energies, moods, 0)} and eases down from there.`,
    `Opens ${vibe(energies, moods, 0)} and lets the energy come down from there.`,
    `Opens ${vibe(energies, moods, 0)} and lets the energy come down from there.`,
  ]
  const tex = a.run && a.run.end > 0 && a.run.end < a.n - 1
    ? `${cap(positional(a.run.end, a.n))}, ${runClause(a, energies)}.`
    : null
  const release = Math.abs(a.sharp.delta) <= 25
    ? 'A slow release — never off a cliff, just easing back.'
    : `A sharp pullback ${positional(a.sharp.idx + 1, a.n)} resets the whole mood.`
  return [openings[startTier], tex, release, `Lands ${vibe(energies, moods, a.n - 1)}.`]
}

function buildPeak(a, energies, moods) {
  const s = vibe(energies, moods, 0)
  const peak = vibe(energies, moods, a.maxIdx)
  const end = vibe(energies, moods, a.n - 1)
  const drop = sharpIsDistinct(a)
    ? `The drop after the peak hits fast — ${magnitude(a.sharp.delta)} in just a couple tracks.`
    : null
  return [
    `This one's a slow build that pays off.`,
    `Starts ${s}, pulls up through the first half, peaks ${positional(a.maxIdx, a.n)} at ${peak}, then eases back to ${end}.`,
    drop,
  ]
}

function buildValley(a, energies, moods) {
  const s = vibe(energies, moods, 0)
  const trough = vibe(energies, moods, a.minIdx)
  const end = vibe(energies, moods, a.n - 1)
  const entry = Math.abs(energies[a.minIdx] - energies[0])
  const recovery = Math.abs(energies[a.n - 1] - energies[a.minIdx])
  return [
    `Opens ${s}, dips ${positional(a.minIdx, a.n)} into ${trough}, then climbs back out.`,
    recovery > entry ? 'The comeback hits harder than the opening.' : null,
    `Ends ${end}.`,
  ]
}

function buildSteady(a, energies, moods) {
  const v = joinMood(moodAdj(avg(moods)), staticLabel(avg(energies)))
  const drift = a.range > 10 && a.range <= 20
    ? `There's a subtle ${a.net >= 0 ? 'upward' : 'downward'} drift, but nothing that breaks the groove.`
    : null
  return [
    `Locked in from start to finish — this set picks a lane and stays there.`,
    `${cap(v)} throughout, no big swings.`,
    drift,
  ]
}

function buildOscillating(a, energies, moods) {
  const lowS = staticLabel(a.min)
  const highS = staticLabel(a.max)
  const N = a.reversals
  const flip = sharpIsDistinct(a)
    ? `Flips from ${vibe(energies, moods, a.sharp.idx)} to ${vibe(energies, moods, a.sharp.idx + 1)} ${positional(a.sharp.idx + 1, a.n)}.`
    : null

  if (a.tier === 'mild') {
    const run = a.run ? `Its longest run ${a.run.direction === 'up' ? 'builds' : 'pulls back'} ${positional(a.run.start, a.n)} — ${runClause(a, energies)}.` : null
    return [
      `This set likes to move. It shifts between ${lowS} and ${highS} a few times, never sitting still for long.`,
      run,
      `Keeps things interesting without going off the rails.`,
    ]
  }
  if (a.tier === 'moderate') {
    const run = a.run ? `Its strongest move ${a.run.direction === 'up' ? 'climbs' : 'drops'} ${positional(a.run.start, a.n)} — ${runClause(a, energies)}.` : null
    return [
      `A set that keeps changing its mind — ${N} direction changes across the chain.`,
      run,
      flip,
      `Built on contrast, not consistency.`,
    ]
  }
  // wild
  const run = a.run ? `Its longest run ${a.run.direction === 'up' ? 'surges' : 'sinks'} ${positional(a.run.start, a.n)} — ${runClause(a, energies)}.` : null
  return [
    `A set that can't sit still — changes direction ${N} times and keeps you guessing.`,
    run,
    flip,
    `This one's built on contrast.`,
  ]
}

const BUILDERS = {
  ascending: buildAscending,
  descending: buildDescending,
  peak: buildPeak,
  valley: buildValley,
  steady: buildSteady,
  oscillating: buildOscillating,
}

// —— Arrow pill —————————————————————————————————————————————————————————————————————————————
// Max 3 waypoints, lowercase static labels, consecutive duplicates dropped. Never moderate/balanced/
// neutral (the static vocab has none).
function arrow(labels) {
  const out = []
  for (const l of labels) if (out[out.length - 1] !== l) out.push(l)
  return out.slice(0, 3).join(' → ')
}

function compressedFor(shape, energies, a) {
  switch (shape) {
    case 'peak': return arrow([staticLabel(a.startE), staticLabel(a.max), staticLabel(a.endE)])
    case 'valley': return arrow([staticLabel(a.startE), staticLabel(a.min), staticLabel(a.endE)])
    case 'steady': return staticLabel(avg(energies))
    case 'oscillating': {
      const extreme = Math.abs(a.max - a.startE) >= Math.abs(a.startE - a.min) ? a.max : a.min
      return arrow([staticLabel(a.startE), staticLabel(extreme), staticLabel(a.endE)])
    }
    default: // ascending / descending
      return arrow([staticLabel(a.startE), staticLabel(a.endE)])
  }
}

// —— Public API ——————————————————————————————————————————————————————————————————————————————
// Ordered connected-chain tracks → { summary, compressed } | null. Tracks missing energy OR mood are
// dropped (no interpolation); below 2 valid tracks returns null so the caller hides the trigger.
export function generateJourneyNarrative(tracks) {
  if (!Array.isArray(tracks)) return null

  const valid = tracks.filter(
    (t) => t && t.energy != null && t.mood != null && Number.isFinite(t.energy) && Number.isFinite(t.mood)
  )
  if (valid.length < 2) return null

  const energies = valid.map((t) => t.energy)
  const moods = valid.map((t) => t.mood)
  const n = energies.length

  if (n === 2) {
    return { summary: twoTrack(energies), compressed: arrow([staticLabel(energies[0]), staticLabel(energies[1])]) }
  }
  if (n === 3) {
    return { summary: threeTrack(energies, moods), compressed: arrow([staticLabel(energies[0]), staticLabel(energies[1]), staticLabel(energies[2])]) }
  }

  const a = analyze(energies)
  const cls = classify(a)
  Object.assign(a, cls)
  const summary = BUILDERS[cls.shape](a, energies, moods).filter(Boolean).join(' ')
  const compressed = compressedFor(cls.shape, energies, a)
  return { summary, compressed }
}
