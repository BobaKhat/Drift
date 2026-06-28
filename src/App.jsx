import DriftMap from './components/DriftMap'
import LeftNav from './components/LeftNav'
import ImportFlow from './components/import/ImportFlow'
import { PlaylistProvider, usePlaylistStore } from './store/usePlaylistStore'

function DriftApp() {
  const { activeTracks } = usePlaylistStore()

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
