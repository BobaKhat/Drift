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
export function titlesMatch(requested, found, threshold = 0.5) {
  return titleSimilarity(requested, found) >= threshold
}
