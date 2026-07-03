import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import {
  listPlaylists,
  getPlaylistTracks,
  createPlaylist,
  linkTracks,
  ensureDemoLibrary,
} from '../lib/playlists'
import { runImport, retryUnresolved } from '../lib/import'
import { saveSet } from '../lib/sets'

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

  // Active axis preset. 'custom' uses customXFeature/customYFeature.
  const [activePanel, setActivePanel] = useState(null)

  // Compass quadrant the map viewport centre is currently in.
  const [activeQuadrant, setActiveQuadrant] = useState(null) // 'TR'|'TL'|'BR'|'BL'|null
  const togglePanel = (id) => setActivePanel((prev) => (prev === id ? null : id))

  const [activePreset, setActivePresetKey] = useState('vibe')
  const [customXFeature, setCustomXFeature] = useState('mood')
  const [customYFeature, setCustomYFeature] = useState('energy')

  const setActivePreset = (key) => setActivePresetKey(key)
  const setCustomPreset = (xFeature, yFeature) => {
    setCustomXFeature(xFeature)
    setCustomYFeature(yFeature)
    setActivePresetKey('custom')
  }

  // —— Set builder ——————————————————————————————————————————————————————————————
  // Build mode is a state overlay on the map, bound to the "Set Creation" rail panel: the
  // panel is always open while building and not closeable (Decision Log #53). `chain` is the
  // ordered list of track ids (index 0 = head). It's non-destructive across panel toggles —
  // only Save or a playlist switch clears it.
  const buildMode = activePanel === 'sets'
  const [chain, setChain] = useState([]) // track ids, position 1..n
  // The incoming-socket edge chosen (by the snap) for each connected target, so the latched wire
  // lands where the drag preview showed it rather than snapping to a recomputed edge.
  const [inCardOverrides, setInCardOverrides] = useState({})
  const [savingSet, setSavingSet] = useState(false)

  // Clicking a song with an empty chain seats it as the head (Decision Log #38, #42). Once a
  // head exists, further songs join only by wiring (connectSong).
  const addHead = useCallback((trackId) => {
    if (!trackId) return
    setChain((prev) => (prev.length === 0 ? [trackId] : prev))
  }, [])

  // Latch a wire from the current tail to `targetId` (Decision Log #33 — sequential, one-to-one).
  // `inCardinal` is the target edge the wire snapped to. No-op if already in the chain.
  const connectSong = useCallback((targetId, inCardinal) => {
    if (!targetId) return
    setChain((prev) => (prev.includes(targetId) ? prev : [...prev, targetId]))
    if (inCardinal) setInCardOverrides((prev) => ({ ...prev, [targetId]: inCardinal }))
  }, [])

  const clearChain = useCallback(() => { setChain([]); setInCardOverrides({}) }, [])

  // Persist the set to Supabase, then clear the chain (Decision Log #57). Gated at ≥2 songs
  // (Decision Log #39) — the panel disables the button, this is the backstop.
  const saveCurrentSet = useCallback(async (name) => {
    if (chain.length < 2 || !activePlaylistId) return
    setSavingSet(true)
    try {
      const tracksById = Object.fromEntries(activeTracks.map((t) => [t.id, t]))
      await saveSet({ playlistId: activePlaylistId, name, chain, tracksById })
      setChain([])
      setInCardOverrides({})
    } catch (err) {
      console.error('[drift] saveSet failed:', err)
    } finally {
      setSavingSet(false)
    }
  }, [chain, activePlaylistId, activeTracks])

  // The map registers imperative controls (pan/highlight a track) here so the panel search —
  // which lives outside the map's ReactFlowProvider — can drive it (Decision Log #56).
  const mapControlsRef = useRef(null)
  const registerMapControls = useCallback((controls) => { mapControlsRef.current = controls }, [])
  const focusTrack = useCallback((trackId) => { mapControlsRef.current?.focusTrack?.(trackId) }, [])

  // A chain references ids from the active playlist — switching playlists invalidates it.
  useEffect(() => { setChain([]); setInCardOverrides({}) }, [activePlaylistId])

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
      // result shape: { mapped, unresolved, warnings }
      setReconciliation(result)
      setImportState('reconcile')
    } catch (err) {
      console.error('[drift] import failed:', err)
      setReconciliation({ mapped: [], unresolved: [], warnings: [] })
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
  // it into the mapped bucket. If the retry surfaces a version warning, add it to warnings.
  const retry = useCallback(async (originalText, artist, title) => {
    const track = await retryUnresolved(artist, title)
    if (!track) return false
    setReconciliation((prev) => {
      if (!prev) return prev
      const newWarning = track._meta?.versionWarning
        ? { originalText, ...track._meta.versionWarning }
        : null
      return {
        mapped: [...prev.mapped, track],
        unresolved: prev.unresolved.filter((u) => u.originalText !== originalText),
        warnings: newWarning
          ? [...(prev.warnings ?? []), newWarning]
          : (prev.warnings ?? []),
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
    activePanel,
    setActivePanel,
    togglePanel,
    activeQuadrant,
    setActiveQuadrant,
    activePreset,
    customXFeature,
    customYFeature,
    setActivePreset,
    setCustomPreset,
    buildMode,
    chain,
    inCardOverrides,
    addHead,
    connectSong,
    clearChain,
    saveCurrentSet,
    savingSet,
    registerMapControls,
    focusTrack,
  }

  return <PlaylistContext.Provider value={value}>{children}</PlaylistContext.Provider>
}

export function usePlaylistStore() {
  const ctx = useContext(PlaylistContext)
  if (!ctx) throw new Error('usePlaylistStore must be used within PlaylistProvider')
  return ctx
}
