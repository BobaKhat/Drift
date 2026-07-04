import { supabase } from './supabase'
import { scoreCompatibility } from './compatibility'

// Set persistence. "Save & Complete" writes the whole set in three tables (Decision Log #57, #89):
//   sets             — the set itself, tied to its parent playlist
//   set_tracks       — one row per song: connected chain (is_connected=true, group_id=null) plus
//                      every orphan group (is_connected=false, group_id=<group id>) — Slice 9 #3
//   set_connections  — one row per wire, for the chain AND each orphan group's retained wires
//
// The cut is non-destructive (Decision Log #35): orphans survive the save so the set can be
// reopened with its disconnected groups intact. Each connection stores its REAL compatibility now
// (Slice 11 / Decision Log #27–29): the same scoreCompatibility() the wires and card use.

// One set_connections row for consecutive songs a→b, carrying the computed compatibility. Key
// relationship is stored as one of same/adjacent/parallel/distant, or null when a key is unknown.
function connRow(setId, aId, bId, tracksById) {
  const { tier, bpmDelta, keyRelationship } = scoreCompatibility(tracksById[aId], tracksById[bId])
  return {
    set_id: setId,
    source_track_id: aId,
    target_track_id: bId,
    bpm_delta: bpmDelta,
    key_relationship: keyRelationship === 'unknown' ? null : keyRelationship,
    compatibility_tier: tier,
  }
}

export async function saveSet({ playlistId, name, chain, orphanGroups = [], tracksById, userId = 'demo' }) {
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

  // Connected chain rows first, then orphan rows (positions continue past the chain; group_id ties
  // each orphan to its group).
  const trackRows = chain.map((trackId, i) => ({
    set_id: set.id,
    track_id: trackId,
    position: i + 1,
    is_connected: true,
    group_id: null,
  }))
  let pos = chain.length
  for (const grp of orphanGroups) {
    for (const trackId of grp.tracks) {
      pos += 1
      trackRows.push({ set_id: set.id, track_id: trackId, position: pos, is_connected: false, group_id: grp.id })
    }
  }
  const { error: trackErr } = await supabase.from('set_tracks').insert(trackRows)
  if (trackErr) throw new Error(`saveSet: set_tracks failed: ${trackErr.message}`)

  // Chain wires, then each orphan group's retained internal wires.
  const connRows = []
  for (let i = 0; i < chain.length - 1; i++) {
    connRows.push(connRow(set.id, chain[i], chain[i + 1], tracksById))
  }
  for (const grp of orphanGroups) {
    for (let i = 0; i < grp.tracks.length - 1; i++) {
      connRows.push(connRow(set.id, grp.tracks[i], grp.tracks[i + 1], tracksById))
    }
  }
  if (connRows.length) {
    const { error: connErr } = await supabase.from('set_connections').insert(connRows)
    if (connErr) throw new Error(`saveSet: set_connections failed: ${connErr.message}`)
  }

  return set
}
