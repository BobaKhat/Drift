// Title similarity for mismatch detection. SoundNet fuzzy-matches on artist and will return
// SOME track's features even for a fake/misspelled title (e.g. "ODESZA – Dumbo" returns a
// real ODESZA track). We corroborate against iTunes' actual matched title and reject matches
// whose titles barely overlap the requested one.

// Normalize a title into comparable words, dropping "(feat. …)", "[remix]", and "- Suffix"
// noise so "Say My Name" and "Say My Name (feat. Zyra)" compare as the same core title.
function titleWords(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ') // (feat. x), [remix]
    .replace(/\s[-–—]\s.*/g, ' ')     // "- Remix", "- Radio Edit", "- VIP Mix"
    .replace(/[^a-z0-9\s]/g, ' ')     // strip punctuation
    .split(/\s+/)
    .filter(Boolean)
}

// Fraction of the REQUESTED title's words that appear in the FOUND title (0–1).
export function titleSimilarity(requested, found) {
  const a = titleWords(requested)
  const b = new Set(titleWords(found))
  if (a.length === 0 || b.size === 0) return 0
  const hits = a.filter((w) => b.has(w)).length
  return hits / a.length
}

// True when the found title sufficiently corroborates the requested title.
// Also accepts substring containment: "Commas" ⊂ "Fuck Up Some Commas" (clean title variant).
export function titlesMatch(requested, found, threshold = 0.5) {
  if (titleSimilarity(requested, found) >= threshold) return true
  const a = (requested || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const b = (found    || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a))
}
