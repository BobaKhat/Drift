import { useEffect } from 'react'
import DriftMap from './components/DriftMap'
import LeftNav from './components/LeftNav'
import ImportFlow from './components/import/ImportFlow'
import { PlaylistProvider, usePlaylistStore } from './store/usePlaylistStore'
import { backfillMissingArt } from './lib/backfill'

function DriftApp() {
  const { activeTracks } = usePlaylistStore()

  // One-time background backfill of album art for Supabase tracks with a null album_art_url.
  // Fire-and-forget: no UI, non-blocking; results show on the next load. Guarded to run once.
  useEffect(() => { backfillMissingArt() }, [])

  return (
    <>
      {/* Map is always mounted behind everything — no empty-map state. */}
      <DriftMap tracks={activeTracks} />
      <LeftNav />
      <ImportFlow />
    </>
  )
}

export default function App() {
  return (
    <PlaylistProvider>
      <DriftApp />
    </PlaylistProvider>
  )
}
