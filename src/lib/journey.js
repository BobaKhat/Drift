// Journey — a deterministic, text-only summary of the vibe arc of a connected set.
//
// Given the ordered array of connected-chain tracks (is_connected === true, by position), this
// produces a 1–4 sentence narrative of how the set moves — where it builds, where it turns, how it
// lands — plus a compressed arrow line ("groovy → euphoric peak-time → light and easy") for the pill.
// No AI, no LLM, no persistence: pure template fill over energy + mood (valence) + danceability, all
// on the 0–100 scale, recomputed on the fly every time the chain changes. The SAME chain in the SAME
// order MUST always yield the exact same text, so nothing here reads Math.random() or the clock —
// every word choice is keyed off the data itself (delta / cluster index run through modulo arithmetic).
//
// Kept UI-free on purpose: JourneyTrigger calls generateJourneyNarrative(tracks) and renders the
// result. Returns { summary, compressed } or null (fewer than 2 tracks that carry energy).
//
// The vocabulary — vibe clusters, NOT energy tiers:
//  • Every track is classified into one multi-dimensional VIBE CLUSTER from its energy + mood +
//    danceability combined — "euphoric peak-time", "deep and atmospheric", "groovy" — descriptors that
//    sound like how people talk about music, not abstract single-axis tiers. Clusters use RAW values.
//  • Energy (smoothed, 8-pt noise floor) still drives the SHAPE of the set (ascending / peak / valley /
//    steady / oscillating) and which transitions are worth highlighting — but the words are clusters.
//  • A "vibe shift without an energy shift" (mood or danceability swings ≥30 while energy stays flat)
//    is caught separately so a flat-energy set that actually changes character isn't called "steady".
//  • BANNED from every output: "moderate", "balanced", "neutral", "rolling", "locked in", "full send",
//    "simmering", "driving", "warming up". None of the vocab below contains them.

// A track-to-track energy delta this small or smaller counts as "steady" — no real direction change —
// so tiny wobbles never get narrated. Applies ONLY to direction/shape detection; vibe clusters read
// raw values.
const NOISE = 8

// —— Vibe clusters ——————————————————————————————————————————————————————————————————————————————
// Each track lands in exactly one cluster from its energy + mood + danceability. Evaluated first-match:
// energy band first (high >60 / low <40 / mid 40–60), then mood (bright >60 / dark <40 / neutral 40–60),
// with danceability breaking the mid band before mood does. Missing mood/danceability degrade gracefully
// to energy-only labels (rare — we already require energy to be present).
function clusterOf(e, m, d) {
  const hasMood = m != null && Number.isFinite(m)
  const hasDance = d != null && Number.isFinite(d)

  if (!hasMood) {
    if (e > 60) return 'high-energy'
    if (e < 40) return 'low-energy'
    return 'mid-energy'
  }

  if (e > 60) {
    if (m > 60) return 'euphoric peak-time'
    if (m < 40) return 'dark and heavy'
    return 'high-energy'
  }
  if (e < 40) {
    if (m > 60) return 'light and easy'
    if (m < 40) return 'deep and atmospheric'
    return 'low-key'
  }
  // Mid energy (40–60): danceability decides first, then mood.
  if (hasDance && d > 60) return 'groovy'
  if (m > 60) return 'warm and bright'
  if (m < 40) return 'dark and brooding'
  return 'cruising'
}

// Energy tier for the coarse "how far apart" read used by the 2-track template. low 0 / mid 1 / high 2.
function energyTier(e) {
  if (e > 60) return 2
  if (e < 40) return 0
  return 1
}

// —— Word banks ——————————————————————————————————————————————————————————————————————————————————
// Transition verbs connect two clusters in prose; the option is picked by |energy delta| % count so the
// same move always reads the same. Sharp jumps get their own harder verbs.
const VERBS = {
  rising: ['builds into', 'pushes up into', 'lifts into'],
  falling: ['comes down to', 'eases into', 'drops into', 'winds down to'],
  holding: ['holds at', 'stays in', 'settles into'],
  jumpUp: ['jumps to', 'kicks into', 'launches into'],
  jumpDown: ['drops to', 'flips to', 'crashes into'],
}

// Deterministic index helper — modulo on the actual data value, never random.
const idx = (val, len) => (len <= 1 ? 0 : ((Math.abs(Math.round(val)) % len) + len) % len)

function transitionVerb(fromE, toE, sharp) {
  const delta = toE - fromE
  let arr
  if (sharp) arr = delta >= 0 ? VERBS.jumpUp : VERBS.jumpDown
  else if (delta > NOISE) arr = VERBS.rising
  else if (delta < -NOISE) arr = VERBS.falling
  else arr = VERBS.holding
  return arr[idx(delta, arr.length)]
}

// Cluster names that already imply a high or low energy level. Used to catch a transition verb that
// fights its destination — "comes down to high-energy", "builds into deep and atmospheric" — and swap
// in a neutral arrival verb instead. Mid clusters (groovy, cruising, …) imply no direction, so any verb
// reads fine into them.
const HIGH_CLUSTERS = new Set(['euphoric peak-time', 'dark and heavy', 'high-energy'])
const LOW_CLUSTERS = new Set(['light and easy', 'deep and atmospheric', 'low-key', 'low-energy'])
const ARRIVAL = ['settles into', 'lands at', 'ends up at']

// A transition verb into `cluster` that won't contradict the name's implied energy. A downward move into
// a high-named cluster (or an upward move into a low-named one) is a contradiction, so we use a neutral
// arrival verb; otherwise the normal directional verb stands.
function verbToCluster(fromE, toE, cluster, sharp) {
  const delta = toE - fromE
  const down = sharp ? delta < 0 : delta < -NOISE
  const up = sharp ? delta > 0 : delta > NOISE
  if ((down && HIGH_CLUSTERS.has(cluster)) || (up && LOW_CLUSTERS.has(cluster))) {
    return ARRIVAL[idx(delta, ARRIVAL.length)]
  }
  return transitionVerb(fromE, toE, sharp)
}

// Magnitude descriptor by absolute delta, chosen by delta % (option count).
function magnitude(delta) {
  const d = Math.abs(delta)
  let arr
  if (d <= 15) arr = ['subtle shift', 'slight drift', 'gentle move']
  else if (d <= 35) arr = ['solid push', 'clear shift', 'noticeable move']
  else if (d <= 55) arr = ['big swing', 'sharp shift', 'real jump']
  else arr = ['massive flip', 'dramatic shift', 'huge leap']
  return arr[idx(d, arr.length)]
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length
const avgOrNull = (a) => {
  const v = a.filter((x) => x != null && Number.isFinite(x))
  return v.length ? avg(v) : null
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

// —— Trajectory analysis (energy drives the shape) ——————————————————————————————————————————————
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

  // Monotonic runs — maximal same-direction stretches (steady breaks a run), ranked by magnitude ×
  // track-count. runs[0] is the strongest movement, runs[1] the second.
  const runs = []
  let i = 0
  while (i < dirs.length) {
    if (dirs[i] === 0) { i++; continue }
    const dir = dirs[i]
    let j = i
    while (j < dirs.length && dirs[j] === dir) j++
    runs.push({
      start: i,             // track index the run starts on
      end: j,               // track index the run lands on
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

// Overall shape. Arc shapes (peak/valley) and clear trends (ascending/descending) are checked before
// steady so a real rise/fall with a small range isn't flattened; steady is a genuinely tight range; a
// noisy trajectory is oscillating, sub-tiered by how much of the interior reverses. Short chains (<6)
// need a higher reversal ratio to count as oscillating — their ratios are naturally noisier.
function classify(a) {
  const { n, reversals, startE, endE, max, min, maxIdx, minIdx, range, net } = a
  const interiorMax = maxIdx > 0 && maxIdx < n - 1
  const interiorMin = minIdx > 0 && minIdx < n - 1

  if (interiorMax && max - Math.max(startE, endE) >= 15 && reversals <= 3) return { shape: 'peak' }
  if (interiorMin && Math.min(startE, endE) - min >= 15 && reversals <= 3) return { shape: 'valley' }
  if (net >= 15 && reversals <= 2) return { shape: 'ascending' }
  if (net <= -15 && reversals <= 2) return { shape: 'descending' }
  if (range <= 20) return { shape: 'steady' }

  const ratio = n > 2 ? reversals / (n - 2) : 0
  const floor = n < 6 ? 0.6 : 0.4
  if (ratio < floor) {
    if (net >= 8) return { shape: 'ascending' }
    if (net <= -8) return { shape: 'descending' }
    if (interiorMax) return { shape: 'peak' }
    if (interiorMin) return { shape: 'valley' }
    return { shape: 'steady' }
  }
  return { shape: 'oscillating', tier: ratio >= 0.7 ? 'wild' : ratio >= 0.55 ? 'moderate' : 'mild' }
}

// —— Dedup ———————————————————————————————————————————————————————————————————————————————————————
// Whether the sharpest jump is worth narrating as its own sentence: it must be notable AND fall outside
// the strongest run's span, so we never describe the same transition twice. (We only ever narrate the
// single strongest run, so the "two overlapping runs" case is handled by construction.)
function sharpIsDistinct(a) {
  const { run, sharp } = a
  if (Math.abs(sharp.delta) < 12) return false
  if (run && sharp.idx >= run.start && sharp.idx <= run.end - 1) return false
  return true
}

// —— Vibe shift without an energy shift ——————————————————————————————————————————————————————————
// The largest mood or danceability swing (≥30) across any contiguous window where energy never strays
// more than 15 points. Catches sets the energy-only shape would call "steady" but that really change
// character. Deterministic: scans all windows, keeps the biggest magnitude (mood ties break to mood).
function detectVibeShift(energies, moods, dances) {
  const n = energies.length
  let best = null
  for (let i = 0; i < n; i++) {
    let emin = energies[i]
    let emax = energies[i]
    for (let j = i + 1; j < n; j++) {
      emin = Math.min(emin, energies[j])
      emax = Math.max(emax, energies[j])
      if (emax - emin > 15) break // energy left the flat band — window ends here
      if (moods[i] != null && moods[j] != null) {
        const md = moods[j] - moods[i]
        if (Math.abs(md) >= 30 && (!best || Math.abs(md) > best.mag)) {
          best = { type: 'mood', mag: Math.abs(md), dir: md > 0 ? 'bright' : 'dark', i, j }
        }
      }
      if (dances[i] != null && dances[j] != null) {
        const dd = dances[j] - dances[i]
        if (Math.abs(dd) >= 30 && (!best || Math.abs(dd) > best.mag)) {
          best = { type: 'dance', mag: Math.abs(dd), dir: dd > 0 ? 'up' : 'down', i, j }
        }
      }
    }
  }
  return best
}

function shiftPhrase(shift, n) {
  const pos = positional(Math.round((shift.i + shift.j) / 2), n)
  if (shift.type === 'mood') return `the mood ${shift.dir === 'bright' ? 'brightens' : 'darkens'} ${pos}`
  return `the groove ${shift.dir === 'up' ? 'picks up' : 'pulls back'} ${pos}`
}

// —— Short chains ————————————————————————————————————————————————————————————————————————————————
function twoTrack(energies, clusters) {
  const c0 = clusters[0]
  const c1 = clusters[1]
  if (c0 === c1) return `Two tracks, same vibe — both ${c0}.`
  const tiersApart = Math.abs(energyTier(energies[0]) - energyTier(energies[1]))
  if (tiersApart >= 2) return `${cap(c0)} straight into ${c1}. A hard cut.`
  return `${cap(c0)} into ${c1} — a ${magnitude(energies[1] - energies[0])}.`
}

function threeTrack(energies, clusters) {
  const [c0, c1, c2] = clusters
  const v1 = verbToCluster(energies[0], energies[1], c1)
  const v2 = verbToCluster(energies[1], energies[2], c2)
  const net = energies[2] - energies[0]
  const feel = net > NOISE ? 'It climbs the whole way.'
    : net < -NOISE ? 'It comes down by the end.'
    : 'It circles right back to where it started.'
  // Collapse repeated consecutive clusters so a flat run never reads "X, verb Y, verb Y".
  if (c0 === c1 && c1 === c2) {
    return `Three tracks, all ${c0}. ${Math.abs(net) > NOISE ? feel : 'It holds right there the whole way.'}`
  }
  if (c1 === c2) return `${cap(c0)}, ${v1} ${c1} and holds there. ${feel}`
  if (c0 === c1) return `${cap(c0)} to open, then ${v2} ${c2}. ${feel}`
  return `${cap(c0)}, ${v1} ${c1}, ${v2} ${c2}. ${feel}`
}

// —— Shape templates (4+ tracks) —————————————————————————————————————————————————————————————————
// Each returns an array of sentences (falsy dropped). Wording is deterministic; where a cluster opens a
// sentence it is capitalized, everything else uses fixed literals so grammar never fractures.
function buildAscending(a, energies, clusters) {
  const { n, sharp } = a
  const start = clusters[0]
  const end = clusters[n - 1]

  // Same cluster start to finish — name it once, describe the intensity climb, don't rename.
  // Subject is "steepest climb" (never a magnitude-bank noun) so it can't echo the descriptor.
  if (start === end) {
    return [
      `A set that builds.`,
      `Opens ${start} and keeps pushing harder from there without leaving that lane.`,
      sharpIsDistinct(a) ? `The steepest climb comes ${positional(sharp.idx + 1, n)} — a ${magnitude(sharp.delta)}.` : null,
      `Finishes at the top with nowhere left to climb.`,
    ]
  }

  const jumpEnd = clusters[sharp.idx + 1]
  // When the jump lands somewhere new, name that cluster via the verb (no magnitude, so the verb never
  // echoes a magnitude noun like "jumps to … a real jump"); otherwise fall back to the magnitude.
  const jump = sharpIsDistinct(a)
    ? (jumpEnd === end
        ? `The steepest climb comes ${positional(sharp.idx + 1, n)} — a ${magnitude(sharp.delta)}.`
        : `The steepest climb comes ${positional(sharp.idx + 1, n)} — it ${verbToCluster(energies[sharp.idx], energies[sharp.idx + 1], jumpEnd, true)} ${jumpEnd}.`)
    : null
  return [
    `A set that builds.`,
    `Opens ${start} and ${verbToCluster(energies[0], energies[n - 1], end)} ${end} by the end.`,
    jump,
    `Finishes at the top with nowhere left to climb.`,
  ]
}

function buildDescending(a, energies, clusters) {
  const { n, sharp } = a
  const start = clusters[0]
  const end = clusters[n - 1]

  // Same cluster start to finish — name it once, describe the release, don't rename.
  if (start === end) {
    return [
      `Opens ${start} and lets the energy come down from there.`,
      `A slow release — it eases off without ever leaving that lane.`,
    ]
  }

  const isSharp = sharpIsDistinct(a) && Math.abs(sharp.delta) > 30
  if (isSharp) {
    const jumpEnd = clusters[sharp.idx + 1]
    return [
      `Opens ${start} and lets the energy come down from there.`,
      `There's a sharp moment ${positional(sharp.idx + 1, n)} where it ${verbToCluster(energies[sharp.idx], energies[sharp.idx + 1], jumpEnd, true)} ${jumpEnd}.`,
      // Don't re-name the same cluster the sharp moment already landed on.
      jumpEnd === end ? null : `Lands ${end}.`,
    ]
  }
  return [
    `Opens ${start} and lets the energy come down from there.`,
    `A slow release — ${verbToCluster(energies[0], energies[n - 1], end)} ${end}, nice and gradual.`,
  ]
}

function buildPeak(a, energies, clusters) {
  const { n, maxIdx } = a
  const start = clusters[0]
  const peak = clusters[maxIdx]
  const end = clusters[n - 1]
  const pos = positional(maxIdx, n)
  // "steepest moment" avoids echoing a "sharp shift" magnitude descriptor.
  const drop = sharpIsDistinct(a)
    ? `The drop after the peak is the steepest moment — a ${magnitude(a.sharp.delta)}.`
    : null

  let line
  if (start === peak && peak === end) {
    // All three the same cluster — name it once, then describe only the intensity arc.
    line = `${cap(start)} from start to finish, but the intensity isn't flat — it builds through the first half, peaks ${pos}, then eases back.`
  } else if (start === peak) {
    // Don't re-name the cluster at the peak; describe the climb within it.
    line = `Starts ${start} and keeps building to a peak ${pos}, then ${verbToCluster(energies[maxIdx], energies[n - 1], end)} ${end} by the close.`
  } else if (peak === end) {
    // Don't re-name the cluster at the close; it holds there.
    line = `Starts ${start}, ${verbToCluster(energies[0], energies[maxIdx], peak)} ${peak} ${pos}, and stays there through the close.`
  } else {
    line = `Starts ${start}, ${verbToCluster(energies[0], energies[maxIdx], peak)} ${peak} ${pos}, then ${verbToCluster(energies[maxIdx], energies[n - 1], end)} ${end} by the close.`
  }
  return [`This one's a build that pays off.`, line, drop]
}

function buildValley(a, energies, clusters) {
  const { n, minIdx } = a
  const start = clusters[0]
  const valley = clusters[minIdx]
  const end = clusters[n - 1]
  const pos = positional(minIdx, n)
  const entry = Math.abs(energies[minIdx] - energies[0])
  const recovery = Math.abs(energies[n - 1] - energies[minIdx])
  const tail = recovery > entry ? `The comeback hits harder than the opening.` : null

  let line
  if (start === valley && valley === end) {
    // All three the same cluster — name it once, describe the intensity sag.
    line = `${cap(start)} throughout — the energy sags ${pos} and climbs back out, dipping in intensity without ever changing character.`
  } else if (start === valley) {
    // Don't re-name the cluster at the dip; it's the same ground as the opening.
    line = `Opens ${start} and sags ${pos} before climbing back out to ${end}.`
  } else if (valley === end) {
    // Don't re-name the cluster at the dip; describe it, then name where it recovers to.
    line = `Opens ${start}, dips ${pos}, then climbs back out to ${end}.`
  } else {
    line = `Opens ${start}, dips into ${valley} ${pos}, then climbs back out to ${end}.`
  }
  return [line, tail]
}

function buildSteady(a, energies, clusters, moods, dances) {
  const dom = clusterOf(avg(energies), avgOrNull(moods), avgOrNull(dances))
  const shift = detectVibeShift(energies, moods, dances)
  return [
    `This set picks a lane and stays there — ${dom} from open to close, no big swings.`,
    shift ? `The energy holds but ${shiftPhrase(shift, a.n)}.` : `Consistent energy, consistent vibe.`,
  ]
}

// A one-sentence description of the strongest run in cluster terms — shared by the oscillating tiers.
// Always names where the run goes: both its start and end cluster ("pushes up from groovy into euphoric
// peak-time"), or, when it never leaves one cluster, that single cluster.
function runSentence(a, energies, clusters, lead) {
  const { run, n } = a
  if (!run) return null
  const from = clusters[run.start]
  const to = clusters[run.end]
  const pos = positional(run.start, n)
  // A run that starts and ends in the same cluster is an intensity move, not a change of vibe.
  if (from === to) {
    return `${lead} ${run.direction === 'up' ? 'ramps up' : 'pulls back'} within ${to} ${pos}.`
  }
  return run.direction === 'up'
    ? `${lead} pushes up from ${from} into ${to} ${pos}.`
    : `${lead} slides from ${from} down to ${to} ${pos}.`
}

// The deduplicated sharpest-jump sentence for oscillating sets — only when it's a distinct region.
function flipSentence(a, energies, clusters) {
  if (!sharpIsDistinct(a)) return null
  const { sharp, n } = a
  const from = clusters[sharp.idx]
  const to = clusters[sharp.idx + 1]
  // Same cluster either side of the jump — describe the size, don't name it twice. "jolt" as the subject
  // so it never echoes a magnitude descriptor.
  if (from === to) {
    return `The biggest jolt comes ${positional(sharp.idx + 1, n)} — a ${magnitude(sharp.delta)} within ${to}.`
  }
  return `The sharpest moment ${verbToCluster(energies[sharp.idx], energies[sharp.idx + 1], to, true)} ${to} from ${from} ${positional(sharp.idx + 1, n)}.`
}

function buildOscillating(a, energies, clusters) {
  const { run, reversals: N } = a
  if (a.tier === 'mild') {
    // runSentence now names the run's start and end clusters, so it carries the poles itself — no
    // separate "shifts between X and Y" line (which would name the same two clusters again).
    return [
      `This set likes to move, never sitting in one place too long.`,
      runSentence(a, energies, clusters, 'Its longest run'),
      `Keeps things interesting without going off the rails.`,
    ]
  }
  if (a.tier === 'moderate') {
    return [
      `A set that keeps changing its mind — ${N} direction changes.`,
      runSentence(a, energies, clusters, 'Its strongest move'),
      flipSentence(a, energies, clusters),
      `Built on contrast.`,
    ]
  }
  // wild
  return [
    `This set can't sit still — ${N} direction changes, always moving.`,
    runSentence(a, energies, clusters, 'Its longest run'),
    flipSentence(a, energies, clusters),
    `A set built on contrast — this one keeps you guessing.`,
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

// —— Arrow pill ——————————————————————————————————————————————————————————————————————————————————
// Max 3 waypoints in cluster names: start → most notable inflection → end. Consecutive duplicates
// dropped; if all collapse to one, a single cluster name is shown.
function arrow(labels) {
  const out = []
  for (const l of labels) if (l && out[out.length - 1] !== l) out.push(l)
  return out.slice(0, 3).join(' → ')
}

function compressedFor(shape, clusters, a) {
  const start = clusters[0]
  const end = clusters[a.n - 1]
  switch (shape) {
    case 'peak': return arrow([start, clusters[a.maxIdx], end])
    case 'valley': return arrow([start, clusters[a.minIdx], end])
    case 'steady': return arrow([start, end]) // collapses to one word when unchanged
    case 'oscillating': {
      const extremeIdx = Math.abs(a.max - a.startE) >= Math.abs(a.startE - a.min) ? a.maxIdx : a.minIdx
      return arrow([start, clusters[extremeIdx], end])
    }
    default: // ascending / descending
      return arrow([start, end])
  }
}

// —— Public API ——————————————————————————————————————————————————————————————————————————————————
// Ordered connected-chain tracks → { summary, compressed } | null. Tracks missing energy are dropped
// (no interpolation); mood/danceability may be missing and degrade gracefully. Below 2 valid tracks
// returns null so the caller hides the trigger.
export function generateJourneyNarrative(tracks) {
  if (!Array.isArray(tracks)) return null

  const valid = tracks.filter((t) => t && t.energy != null && Number.isFinite(t.energy))
  if (valid.length < 2) return null

  const energies = valid.map((t) => t.energy)
  const moods = valid.map((t) => (t.mood != null && Number.isFinite(t.mood) ? t.mood : null))
  const dances = valid.map((t) => (t.danceability != null && Number.isFinite(t.danceability) ? t.danceability : null))
  const clusters = energies.map((e, i) => clusterOf(e, moods[i], dances[i]))
  const n = energies.length

  if (n === 2) {
    return { summary: twoTrack(energies, clusters), compressed: arrow([clusters[0], clusters[1]]) }
  }
  if (n === 3) {
    return { summary: threeTrack(energies, clusters), compressed: arrow([clusters[0], clusters[1], clusters[2]]) }
  }

  const a = analyze(energies)
  const cls = classify(a)
  Object.assign(a, cls)
  const summary = BUILDERS[cls.shape](a, energies, clusters, moods, dances).filter(Boolean).join(' ')
  const compressed = compressedFor(cls.shape, clusters, a)
  return { summary, compressed }
}
