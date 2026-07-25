// Per-browser identity for personal data — NOT auth. 'demo' is a shared, permanent bucket every
// visitor can read (Demo 1 / Demo 2); this id is what tags a browser's OWN imports so they never
// collide with 'demo' or another visitor's data. A fresh/incognito browser has no stored id yet,
// so it generates a new one on the spot with nothing owned under it — which is exactly what keeps
// anonymous visitors scoped to demo-only.
const USER_ID_KEY = 'drift:user_id'
const SAW_DEMO_KEY = 'drift:saw_demo'

export function getUserId() {
  let id = localStorage.getItem(USER_ID_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(USER_ID_KEY, id)
  }
  return id
}

// Tracks whether THIS browser has previously chosen "explore the demo library" from the welcome
// screen, so a returning visitor skips straight back to it instead of re-seeing welcome — without
// that, the welcome check (scoped to the user's own rows) would never find demo's shared rows.
export function hasSeenDemo() {
  return localStorage.getItem(SAW_DEMO_KEY) === 'true'
}

export function markSeenDemo() {
  localStorage.setItem(SAW_DEMO_KEY, 'true')
}
