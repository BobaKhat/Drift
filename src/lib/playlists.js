import { supabase } from './supabase'
import { demoTrackRows } from '../data/demoLibrary'

// Playlist persistence. One playlist is active on the map at a time; switching swaps the
// visible songs. user_id is "demo" until auth lands. The map IS the song list — these
// helpers just manage which track rows belong to which playlist.

const DEMO_USER = 'demo'
const DEMO_NAME = 'Demo Library'

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

// Upsert the baked demo tracks into the `tracks` cache and return their full rows (with ids).
async function upsertDemoTracks() {
  const rows = demoTrackRows()
  const { data: existing } = await supabase
    .from('tracks')
    .select('*')
    .in('name', rows.map((r) => r.name))

  const found = new Map((existing || []).map((t) => [keyOf(t.artist, t.name), t]))
  const toInsert = rows
    .filter((r) => !found.has(keyOf(r.artist, r.name)))
    .map((r) => ({ ...r, analyzed_at: new Date().toISOString() }))

  let inserted = []
  if (toInsert.length) {
    const { data, error } = await supabase.from('tracks').insert(toInsert).select()
    if (error) throw new Error(`demo tracks insert failed: ${error.message}`)
    inserted = data
  }

  const all = new Map([...(existing || []), ...inserted].map((t) => [keyOf(t.artist, t.name), t]))
  return rows.map((r) => all.get(keyOf(r.artist, r.name))).filter(Boolean)
}

// Idempotently ensure the "Demo Library" playlist exists for the demo user and return it.
export async function ensureDemoLibrary(userId = DEMO_USER) {
  const { data: existing } = await supabase
    .from('playlists')
    .select('*')
    .eq('user_id', userId)
    .eq('name', DEMO_NAME)
    .limit(1)
  if (existing?.[0]) return existing[0]

  const tracks = await upsertDemoTracks()
  const playlist = await createPlaylist(DEMO_NAME, userId)
  await linkTracks(playlist.id, tracks.map((t) => t.id))
  return playlist
}
