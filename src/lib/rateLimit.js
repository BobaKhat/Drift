// Tiny client-side pacing gate. External APIs (SoundNet, Spotify page scrapes) throttle
// bursts, and the importer kicks off many lookups at once. createPacer returns an async
// gate that every call awaits before hitting the network: each caller reserves the next
// time slot synchronously, so concurrent callers queue deterministically and requests end
// up spaced >= minIntervalMs apart — independent of how fast the browser fires them.
//
// (This is why the import only failed with DevTools closed: open DevTools slowed requests
// enough to dodge the limit; the gate removes the timing dependence entirely.)

export function createPacer(minIntervalMs) {
  let nextSlot = 0
  return async function pace() {
    const now = Date.now()
    const start = Math.max(now, nextSlot)
    nextSlot = start + minIntervalMs
    const wait = start - now
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  }
}
