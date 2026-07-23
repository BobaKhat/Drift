// Pre-baked demo library — two real, curated EDM playlists exported from Supabase (the same rows a
// real import produces, with all audio features, album art, and 30-second preview URLs already
// resolved). The data lives in demoLibrary.json; this module just shapes it for the tracks cache.
//
// The demo path (ensureDemoLibrary() in src/lib/playlists.js) seeds these into Supabase with NO
// SoundNet/iTunes calls and NO import pipeline — every field is already baked in, so it's instant.
//
// Feature scales match the Drift schema: energy/mood/danceability/acousticness/instrumentalness/
// speechiness/liveness are 0–100, bpm is raw, loudness is dB, duration is sec.

import demoData from './demoLibrary.json'

// [{ key, name, default, tracks: [row, …] }]. "House & Tech House" (default) loads first; the
// PlaylistPanel switcher exposes "Melodic & Euphoric" as the second option.
export const DEMO_PLAYLISTS = demoData.playlists

// Shape a baked demo track into a row that matches the Supabase `tracks` schema (so it upserts and
// plots like any imported track). Art + preview URLs are already full URLs in the JSON.
export function demoTrackRow(t) {
  return {
    ...t,
    source: 'demo',
    status: 'analyzed',
    missing_features: null,
  }
}

// Flat list of demo album-art URLs across both playlists — the decorative import mini-map falls back
// to these so there's always a pool of real covers to scatter, even on a first-ever import.
export function demoArtUrls() {
  return DEMO_PLAYLISTS.flatMap((p) => p.tracks.map((t) => t.album_art_url)).filter(Boolean)
}
