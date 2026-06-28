import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import {
  listPlaylists,
  getPlaylistTracks,
  createPlaylist,
  linkTracks,
  ensureDemoLibrary,
} from '../lib/playlists'
import { runImport, retryUnresolved } from '../lib/import'

// Central app state for the playlist model + import flow.
// One playlist is active on the map at a time; the import flow is a small state machine:
//   null → welcome → steps → progress → reconcile → (active playlist on map)
//   null → progress(demo) → (Demo Library on map)

const PlaylistContext = createContext(null)

export function PlaylistProvider({ children }) {
  const [playlists, setPlaylists] = useState([])
  const [activePlaylistId, setActivePlaylistId] = useState(null)
  const [activeTracks, setActiveTracks] = useState([])
  const [loading, setLoading] = useState(true)

  const [importState, setImportState] = useState(null) // null|'welcome'|'steps'|'progress'|'reconcile'
  const [progress, setProgress] = useState({ current: 0, total: 0, name: '' })
  const [reconciliation, setReconciliation] = useState(null) // { mapped, unresolved }

  // When "Import more" targets the current playlist, this holds its id (null = create new).
  const importTargetRef = useRef(null)

  const activate = useCallback(async (playlistId) => {
    const tracks = await getPlaylistTracks(playlistId)
    setActivePlaylistId(playlistId)
    setActiveTracks(tracks)
    return tracks
  }, [])

  const refreshPlaylists = useCallback(async () => {
    const pls = await listPlaylists('demo')
    setPlaylists(pls)
    return pls
  }, [])

  // Initial load: open the welcome flow if the user has no playlists yet.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const pls = await refreshPlaylists()
        if (cancelled) return
        if (pls.length === 0) {
          setImportState('welcome')
        } else {
          await activate(pls[0].id)
        }
      } catch (err) {
        console.error('[drift] init failed:', err)
        setImportState('welcome')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [refreshPlaylists, activate])

  const setActivePlaylist = useCallback(async (playlistId) => {
    try {
      await activate(playlistId)
    } catch (err) {
      console.error('[drift] failed to load playlist:', err)
    }
  }, [activate])

  const openImport = useCallback((state = 'welcome', targetPlaylistId = null) => {
    importTargetRef.current = targetPlaylistId
    setReconciliation(null)
    setImportState(state)
  }, [])

  const closeImport = useCallback(() => {
    setImportState(null)
    setReconciliation(null)
    setProgress({ current: 0, total: 0, name: '' })
  }, [])

  // Pure view transition between welcome ↔ steps (preserves import target/reconciliation).
  const goImportStep = useCallback((state) => setImportState(state), [])

  // Paste → analyze → reconcile.
  const runPaste = useCallback(async (text) => {
    setProgress({ current: 0, total: 0, name: '' })
    setImportState('progress')
    try {
      const result = await runImport(text, setProgress)
      setReconciliation(result)
      setImportState('reconcile')
    } catch (err) {
      console.error('[drift] import failed:', err)
      setReconciliation({ mapped: [], unresolved: [] })
      setImportState('reconcile')
    }
  }, [])

  // Demo path: instant, persisted, tagged user_id='demo'.
  const loadDemo = useCallback(async () => {
    setProgress({ current: 0, total: 1, name: 'Demo Library' })
    setImportState('progress')
    try {
      const playlist = await ensureDemoLibrary('demo')
      await refreshPlaylists()
      await activate(playlist.id)
    } catch (err) {
      console.error('[drift] demo load failed:', err)
    } finally {
      closeImport()
    }
  }, [refreshPlaylists, activate, closeImport])

  // Reconciliation "Done": persist the new (or targeted) playlist and load it on the map.
  const finishReconcile = useCallback(async (name, mappedTrackIds) => {
    try {
      const target = importTargetRef.current
      let playlistId = target
      if (!playlistId) {
        const playlist = await createPlaylist(name || 'Import', 'demo')
        playlistId = playlist.id
      }
      await linkTracks(playlistId, mappedTrackIds)
      await refreshPlaylists()
      await activate(playlistId)
    } catch (err) {
      console.error('[drift] finishReconcile failed:', err)
    } finally {
      closeImport()
    }
  }, [refreshPlaylists, activate, closeImport])

  // Retry one edited unresolved row (matched by its original pasted line); on success move
  // it into the mapped bucket.
  const retry = useCallback(async (originalText, artist, title) => {
    const track = await retryUnresolved(artist, title)
    if (!track) return false
    setReconciliation((prev) => {
      if (!prev) return prev
      return {
        mapped: [...prev.mapped, track],
        unresolved: prev.unresolved.filter((u) => u.originalText !== originalText),
      }
    })
    return true
  }, [])

  const value = {
    playlists,
    activePlaylistId,
    activeTracks,
    loading,
    importState,
    progress,
    reconciliation,
    setActivePlaylist,
    openImport,
    closeImport,
    goImportStep,
    runPaste,
    loadDemo,
    finishReconcile,
    retry,
  }

  return <PlaylistContext.Provider value={value}>{children}</PlaylistContext.Provider>
}

export function usePlaylistStore() {
  const ctx = useContext(PlaylistContext)
  if (!ctx) throw new Error('usePlaylistStore must be used within PlaylistProvider')
  return ctx
}
