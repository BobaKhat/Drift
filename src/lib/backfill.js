import { supabase } from './supabase'
import { getVerifiedItunesMatch } from './itunes'

// Module-level guard so the backfill runs at most once per session (survives React StrictMode's
// double effect invocation and any re-mounts).
let started = false

// One-time, best-effort album-art backfill. Runs quietly in the background on app load: finds Supabase
// tracks with a null album_art_url (saved before the iTunes/Deezer art resolver existed, or that missed
// at import time), re-resolves each via the VERIFIED lookup (getVerifiedItunesMatch — same artist/title/
// duration + version verification as the pipeline and preview resolver), and writes back any hit. Using
// the verified lookup (not the old loose getAlbumArt top-hit) is essential: for remix-heavy tracks the
// loose lookup writes a WRONG cover that then permanently shadows the correct verified art. No UI,
// non-blocking, single summary log. Rows that still miss keep null → the music-note placeholder. Wrapped
// in try/catch so a missing/unreachable Supabase (e.g. unconfigured env) fails silently.
export async function backfillMissingArt() {
  if (started) return
  started = true
  try {
    const { data: rows, error } = await supabase
      .from('tracks')
      .select('id, artist, name, album, duration')
      .is('album_art_url', null)
    if (error || !rows?.length) return

    let resolved = 0
    let failed = 0
    for (const row of rows) {
      try {
        const { albumArtUrl: art } = await getVerifiedItunesMatch(row.artist, row.name, {
          album: row.album ?? null,
          duration: row.duration ?? null,
        })
        if (art) {
          const { error: upErr } = await supabase
            .from('tracks')
            .update({ album_art_url: art })
            .eq('id', row.id)
          if (upErr) throw upErr
          resolved++
        }
      } catch (err) {
        failed++
        console.log(`[backfill] failed for "${row.artist} - ${row.name}" (${err?.message ?? 'error'})`)
      }
      await new Promise((r) => setTimeout(r, 250)) // gentle pacing on the iTunes/Deezer proxies
    }
    console.log(`[backfill] Backfill complete: ${resolved} resolved, ${failed} failed`)
  } catch (err) {
    console.log(`[backfill] skipped (${err?.message ?? 'error'})`)
  }
}
