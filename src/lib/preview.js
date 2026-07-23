import { supabase } from './supabase'
import { getVerifiedItunesMatch } from './itunes'

// Lazy resolver + cache for a track's 30-second preview URL (Slice 13, Decision #76). Mirrors the
// album-art model: a preview is looked up at most once, persisted to Supabase (tracks.preview_url),
// and reused for the rest of the session. Resolving lazily (only the open deck + the next chain song
// ever look one up) is far cheaper than a bulk backfill across the 160+ song library.

// Session cache keyed by track id. Stores `null` too — a track resolved with no preview shouldn't be
// re-fetched (its play button stays disabled for the session).
const previewCache = new Map() // id -> url | null

// Registered by usePlaylistStore so a lazy preview lookup can also push newly-discovered album art
// into the live `activeTracks` state — self-healing art with no separate backfill pass.
let onArtResolved = null
export function setArtResolvedHandler(fn) { onArtResolved = fn }

// Best-effort persist. Wrapped so a missing preview_url column or unreachable Supabase never breaks
// playback — the in-memory cache still serves the current session.
async function persist(id, url) {
  if (!id) return
  try {
    await supabase.from('tracks').update({ preview_url: url }).eq('id', id)
  } catch {
    /* ignore — playback works from the cache regardless */
  }
}

// Best-effort art write-back: the SAME verified result that resolved playback also carries album
// art, so a track with a null album_art_url gets it for free. Only fires when the caller had no art
// yet (never overwrites an existing cover). Notifies the registered handler on success so the UI
// updates without a reload.
async function persistArt(id, url) {
  if (!id || !url) return
  try {
    const { error } = await supabase.from('tracks').update({ album_art_url: url }).eq('id', id)
    if (!error) onArtResolved?.(id, url)
  } catch {
    /* ignore — art backfill is best-effort, playback already succeeded */
  }
}

// Resolve a track's preview URL. Order: `force` skips every cache (used to refresh an expired Deezer
// token); otherwise the stored tracks.preview_url, then the session cache, then a fresh iTunes→Deezer
// lookup (which is persisted + cached). Returns a URL, or null when the track has no preview.
export async function resolvePreview(track, { force = false } = {}) {
  if (!track) return null
  if (!force) {
    if (track.preview_url) return track.preview_url
    if (previewCache.has(track.id)) return previewCache.get(track.id)
  }
  const { albumArtUrl, previewUrl: url } = await getVerifiedItunesMatch(track.artist, track.name, {
    album: track.album ?? null,
    duration: track.duration ?? null,
  })
  previewCache.set(track.id, url)
  await persist(track.id, url)
  if (!track.album_art_url && albumArtUrl) await persistArt(track.id, albumArtUrl)
  return url
}
