// Compatibility scoring — a pure utility (no side effects), importable anywhere. Given two tracks
// it returns a compatibility verdict from their BPM + Camelot key. Wire colors, the compatibility
// card, the wire-drag preview, and set_connections persistence all read from this one function so
// the same pair always scores identically (Decision Log #27–30).

import { keyRelationship } from './camelot'

// —— CAMELOT_WHEEL ————————————————————————————————————————————————————————————————
// Each of the 24 keys → its ADJACENT keys (same letter, ±1 on the wheel — circular, so 12A↔1A) and
// its PARALLEL key (same number, opposite letter). Built once as a flat lookup for the compatibility
// card, the future Deck View "compatible keys" tile, and anything else that needs neighbours without
// re-deriving the wheel math. Relationship *classification* still flows through camelot.keyRelationship
// so there is a single source of truth; this table is consistent with it by construction.
export const CAMELOT_WHEEL = (() => {
  const wheel = {}
  for (let n = 1; n <= 12; n++) {
    const prev = ((n + 10) % 12) + 1 // n−1 with wrap: 1→12
    const next = (n % 12) + 1         // n+1 with wrap: 12→1
    for (const letter of ['A', 'B']) {
      wheel[`${n}${letter}`] = {
        adjacent: [`${prev}${letter}`, `${next}${letter}`],
        parallel: `${n}${letter === 'A' ? 'B' : 'A'}`,
      }
    }
  }
  return wheel
})()

// Wire compatibility colors (Decision Log #30). Strong/mild are the exact Figma "Wire Colors"
// styles; weak is a softened, desaturated coral (not the Figma red #FF2B2B) so a weak match reads as
// information — "a distinct key change" — rather than an error.
export const WIRE_COLORS = { strong: '#1EFFB8', mild: '#F7CB29', weak: '#C4665A' }

// BPM tier from a (signed or unsigned) delta — thresholds on |delta| (Decision Log #28).
export function bpmTier(delta) {
  const d = Math.abs(delta)
  if (d <= 6) return 'strong'
  if (d <= 15) return 'mild'
  return 'weak'
}

// Camelot relationship → tier (Decision Log #29). same / adjacent = strong, parallel = mild,
// distant = weak.
const KEY_TIER = { same: 'strong', adjacent: 'strong', parallel: 'mild', distant: 'weak' }

// Weakest-link resolution (Decision Log #27): the overall tier is the worst of the contributing
// tiers, so any weak link drags the whole connection down.
const SEVERITY = { strong: 0, mild: 1, weak: 2 }
const TIER_BY_SEVERITY = ['strong', 'mild', 'weak']

// Score the transition a → b. Returns:
//   { tier, bpmDelta, keyRelationship, sourceKey, targetKey }
// bpmDelta is SIGNED (b − a) for display ("+4" / "−12"); tiering uses its magnitude. When a track
// has no Camelot data the key can't contribute and scoring falls back to BPM only, with
// keyRelationship = 'unknown' so the card can show "Key unknown" (Decision Log #32 key-unknown state).
export function scoreCompatibility(a, b) {
  const bpmKnown = a?.bpm != null && b?.bpm != null
  const bpmDelta = bpmKnown ? b.bpm - a.bpm : null

  const rel = keyRelationship(a?.camelot, b?.camelot) // 'same'|'adjacent'|'parallel'|'distant'|null

  const tiers = []
  if (bpmKnown) tiers.push(bpmTier(bpmDelta))
  if (rel) tiers.push(KEY_TIER[rel])

  // Weakest link across whatever data we have; with none at all, default to weak.
  const tier = tiers.length
    ? TIER_BY_SEVERITY[Math.max(...tiers.map((t) => SEVERITY[t]))]
    : 'weak'

  return {
    tier,
    bpmDelta,
    keyRelationship: rel ?? 'unknown',
    sourceKey: a?.camelot ?? null,
    targetKey: b?.camelot ?? null,
  }
}
