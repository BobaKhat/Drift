import { useEffect } from 'react'
import DriftMap from './components/DriftMap'
import LeftNav from './components/LeftNav'
import DeckPanel from './components/DeckPanel'
import ImportFlow from './components/import/ImportFlow'
import ImportStatus from './components/import/ImportStatus'
import { PlaylistProvider, usePlaylistStore } from './store/usePlaylistStore'
import { AudioProvider } from './store/useAudioStore'
import { backfillMissingArt } from './lib/backfill'

function DriftApp() {
  const { activeTracks } = usePlaylistStore()

  // One-time background backfill of album art for Supabase tracks with a null album_art_url.
  // Fire-and-forget: no UI, non-blocking; results show on the next load. Guarded to run once.
  useEffect(() => { backfillMissingArt() }, [])

  return (
    // AudioProvider sits inside PlaylistProvider (it reads the set chain + open deck) and wraps the
    // Deck, which drives 30-second preview playback (Slice 13).
    <AudioProvider>
      {/* Map is always mounted behind everything — no empty-map state. */}
      <DriftMap tracks={activeTracks} />
      <LeftNav />
      {/* Deck View — right-side bento panel, opens on a song click (Slice 12). */}
      <DeckPanel />
      <ImportFlow />
      {/* Non-blocking two-pass import status chip — lives outside ImportFlow's modal scrim so it can
          show over the live, interactive map during the background pass. */}
      <ImportStatus />
    </AudioProvider>
  )
}

export default function App() {
  return (
    <PlaylistProvider>
      <DriftApp />
    </PlaylistProvider>
  )
}
