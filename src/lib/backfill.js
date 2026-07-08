import { supabase } from './supabase'
import { getAlbumArt } from './itunes'

// Module-level guard so the backfill runs at most once per session (survives React StrictMode's
// double effect invocation and any re-mounts).
let started = false

// One-time, best-effort album-art backfill. Runs quietly in the background on app load: finds Supabase
// tracks with a null album_art_url (saved before the iTunes/Deezer art resolver existed, or that missed
// at import time), re-resolves each via the cleaned-query getAlbumArt (first artist + stripped title,
// iTunes → Deezer), and writes back any hit. No UI, non-blocking, single summary log. Rows that still
// miss keep null → the music-note placeholder. Wrapped in try/catch so a missing/unreachable Supabase
// (e.g. unconfigured env) fails silently instead of surfacing to the app.
export async function backfillMissingArt() {
  if (started) return
  started = true
  try {
    const { data: rows, error } = await supabase
      .from('tracks')
      .select('id, artist, name')
      .is('album_art_url', null)
    if (error || !rows?.length) return

    let resolved = 0
    for (const row of rows) {
      const art = await getAlbumArt(row.artist, row.name)
      if (art) {
        const { error: upErr } = await supabase
          .from('tracks')
          .update({ album_art_url: art })
          .eq('id', row.id)
        if (!upErr) resolved++
      }
      await new Promise((r) => setTimeout(r, 150)) // gentle pacing on the iTunes/Deezer proxies
    }
    console.log(`[backfill] Resolved art for ${resolved} of ${rows.length} tracks with missing art`)
  } catch (err) {
    console.log(`[backfill] skipped (${err?.message ?? 'error'})`)
  }
}
