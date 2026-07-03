// Camelot key helpers. Colors are programmatically generated across a blue → purple → pink →
// teal arc, deliberately avoiding green/amber/red which are reserved for wire compatibility
// (Decision Log #32). A and B variants of a wheel position share the same hue, so the color
// encodes the number (1–12) only, not the letter.

// Parse "8B" / "6a" → { num: 8, letter: 'B' }, or null when the value isn't a Camelot key.
function parseCamelot(camelot) {
  if (!camelot) return null
  const m = String(camelot).trim().match(/^(\d{1,2})\s*([abAB])$/)
  if (!m) return null
  const num = parseInt(m[1], 10)
  if (num < 1 || num > 12) return null
  return { num, letter: m[2].toUpperCase() }
}

// Hue arc 170°→320° (teal → cyan → blue → purple → pink), skipping the green/amber/red band.
export function camelotColor(camelot) {
  const parsed = parseCamelot(camelot)
  if (!parsed) return '#848484' // unknown key — neutral gray, matches "—" states
  const hue = 170 + ((parsed.num - 1) / 11) * 150
  return `hsl(${Math.round(hue)}, 70%, 62%)`
}

// Relationship between two Camelot keys for set_connections.key_relationship. Thresholds follow
// Decision Log #29 (same / adjacent on the wheel / parallel A↔B / else distant). Returns null if
// either key is unknown — those connections fall back to BPM-only assessment in Slice 11.
export function keyRelationship(aCamelot, bCamelot) {
  const a = parseCamelot(aCamelot)
  const b = parseCamelot(bCamelot)
  if (!a || !b) return null
  if (a.num === b.num && a.letter === b.letter) return 'same'
  if (a.letter === b.letter) {
    const diff = Math.abs(a.num - b.num)
    if (diff === 1 || diff === 11) return 'adjacent' // 11 = wrap (12↔1)
  }
  if (a.num === b.num && a.letter !== b.letter) return 'parallel'
  return 'distant'
}
