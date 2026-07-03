import { supabase } from './supabase'
import { keyRelationship } from './camelot'

// Set persistence. "Save & Complete" writes the whole set in three tables (Decision Log #57, #89):
//   sets             — the set itself, tied to its parent playlist
//   set_tracks       — one row per chain song, position = 1-based order (1 = head)
//   set_connections  — one row per wire between consecutive songs
//
// Slice 8 stores real bpm_delta / key_relationship but a placeholder compatibility_tier of
// 'strong' — real scoring arrives in Slice 11.

export async function saveSet({ playlistId, name, chain, tracksById, userId = 'demo' }) {
  if (!chain || chain.length < 2) {
    throw new Error('saveSet requires at least 2 songs (Decision Log #39)')
  }

  const now = new Date().toISOString()
  const { data: set, error: setErr } = await supabase
    .from('sets')
    .insert({ playlist_id: playlistId, name: name || 'Untitled Set', user_id: userId, created_at: now, updated_at: now })
    .select()
    .single()
  if (setErr) throw new Error(`saveSet: create set failed: ${setErr.message}`)

  const trackRows = chain.map((trackId, i) => ({
    set_id: set.id,
    track_id: trackId,
    position: i + 1,
    is_connected: true,
    group_id: null,
  }))
  const { error: trackErr } = await supabase.from('set_tracks').insert(trackRows)
  if (trackErr) throw new Error(`saveSet: set_tracks failed: ${trackErr.message}`)

  const connRows = []
  for (let i = 0; i < chain.length - 1; i++) {
    const a = tracksById[chain[i]]
    const b = tracksById[chain[i + 1]]
    connRows.push({
      set_id: set.id,
      source_track_id: chain[i],
      target_track_id: chain[i + 1],
      bpm_delta: a?.bpm != null && b?.bpm != null ? Math.abs(b.bpm - a.bpm) : null,
      key_relationship: keyRelationship(a?.camelot, b?.camelot),
      compatibility_tier: 'strong', // placeholder — Slice 11
    })
  }
  if (connRows.length) {
    const { error: connErr } = await supabase.from('set_connections').insert(connRows)
    if (connErr) throw new Error(`saveSet: set_connections failed: ${connErr.message}`)
  }

  return set
}
