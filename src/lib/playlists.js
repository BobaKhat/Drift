import { supabase } from './supabase'
import { DEMO_PLAYLISTS, demoTrackRow } from '../data/demoLibrary'

// Playlist persistence. One playlist is active on the map at a time; switching swaps the
// visible songs. user_id is "demo" until auth lands. The map IS the song list — these
// helpers just manage which track rows belong to which playlist.

const DEMO_USER = 'demo'

const keyOf = (artist, name) => `${(artist || '').toLowerCase()}|||${(name || '').toLowerCase()}`

// List a user's playlists, each annotated with its song count.
export async function listPlaylists(userId = DEMO_USER) {
  const { data: playlists, error } = await supabase
    .from('playlists')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`listPlaylists failed: ${error.message}`)
  if (!playlists?.length) return []

  const { data: links } = await supabase
    .from('playlist_tracks')
    .select('playlist_id')
    .in('playlist_id', playlists.map((p) => p.id))

  const counts = {}
  ;(links || []).forEach((l) => { counts[l.playlist_id] = (counts[l.playlist_id] || 0) + 1 })
  return playlists.map((p) => ({ ...p, count: counts[p.id] || 0 }))
}

export async function createPlaylist(name, userId = DEMO_USER) {
  const { data, error } = await supabase
    .from('playlists')
    .insert({ name, user_id: userId })
    .select()
    .single()
  if (error) throw new Error(`createPlaylist failed: ${error.message}`)
  return data
}

// Resolve the full track rows for a playlist (via the join table).
export async function getPlaylistTracks(playlistId) {
  const { data, error } = await supabase
    .from('playlist_tracks')
    .select('track_id, tracks(*)')
    .eq('playlist_id', playlistId)
  if (error) throw new Error(`getPlaylistTracks failed: ${error.message}`)
  return (data || []).map((r) => r.tracks).filter(Boolean)
}

// Link tracks into a playlist, skipping any already present (V1: add-only, no removal).
export async function linkTracks(playlistId, trackIds) {
  if (!trackIds?.length) return
  const { data: existing } = await supabase
    .from('playlist_tracks')
    .select('track_id')
    .eq('playlist_id', playlistId)
  const have = new Set((existing || []).map((r) => r.track_id))
  const rows = trackIds
    .filter((id) => id && !have.has(id))
    .map((track_id) => ({ playlist_id: playlistId, track_id }))
  if (!rows.length) return
  const { error } = await supabase.from('playlist_tracks').insert(rows)
  if (error) throw new Error(`linkTracks failed: ${error.message}`)
}

// Look up existing track rows by name, chunked so the `in(...)` filter can't blow the URL length
// on a fresh-clone seed (the two demo playlists carry a few hundred names between them).
async function fetchTracksByName(names) {
  const out = []
  for (let i = 0; i < names.length; i += 50) {
    const { data, error } = await supabase
      .from('tracks')
      .select('*')
      .in('name', names.slice(i, i + 50))
    if (error) throw new Error(`demo track lookup failed: ${error.message}`)
    out.push(...(data || []))
  }
  return out
}

// Upsert baked demo track rows into the `tracks` cache; return a map keyed by artist|||name → the
// full row (with id) for every input row. Existing rows are reused, so re-seeding is a no-op.
async function upsertDemoTracks(rows) {
  const existing = await fetchTracksByName(rows.map((r) => r.name))
  const found = new Map(existing.map((t) => [keyOf(t.artist, t.name), t]))
  // Dedupe by artist|||name: a handful of tracks appear in both demo playlists, so the same row can
  // arrive twice — insert each new track once, then both playlists link to the shared id.
  const toInsert = []
  const queued = new Set()
  for (const r of rows) {
    const k = keyOf(r.artist, r.name)
    if (found.has(k) || queued.has(k)) continue
    queued.add(k)
    toInsert.push({ ...r, analyzed_at: new Date().toISOString() })
  }

  let inserted = []
  if (toInsert.length) {
    const { data, error } = await supabase.from('tracks').insert(toInsert).select()
    if (error) throw new Error(`demo tracks insert failed: ${error.message}`)
    inserted = data
  }

  return new Map([...existing, ...inserted].map((t) => [keyOf(t.artist, t.name), t]))
}

// Idempotently ensure BOTH demo playlists (src/data/demoLibrary.json) exist for the demo user,
// seeding tracks from the baked JSON with no external API calls. Returns the default playlist
// ("Demo 1") so the caller can load it on the map; the switcher lists both.
export async function ensureDemoLibrary(userId = DEMO_USER) {
  const { data: existing } = await supabase
    .from('playlists')
    .select('*')
    .eq('user_id', userId)
  const byName = new Map((existing || []).map((p) => [p.name, p]))

  // Only touch the tracks cache for playlists we still have to create.
  const missing = DEMO_PLAYLISTS.filter((cfg) => !byName.has(cfg.name))
  if (missing.length) {
    const trackMap = await upsertDemoTracks(missing.flatMap((cfg) => cfg.tracks.map(demoTrackRow)))
    for (const cfg of missing) {
      const playlist = await createPlaylist(cfg.name, userId)
      const ids = cfg.tracks
        .map((t) => trackMap.get(keyOf(t.artist, t.name))?.id)
        .filter(Boolean)
      await linkTracks(playlist.id, ids)
      byName.set(cfg.name, playlist)
    }
  }

  const def = DEMO_PLAYLISTS.find((c) => c.default) || DEMO_PLAYLISTS[0]
  return byName.get(def.name)
}
