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

// Monotonic id for orphan groups — stable across re-renders so React keys and map hover-grouping
// don't shift when a group is added or dissolved.
let _groupSeq = 0
const nextGroupId = () => `g${++_groupSeq}`

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

  // Set Builder panel minimize (Slice 9 final #5): collapse the panel to a thin bottom tab for full
  // map visibility while staying in build mode. Reset whenever the active panel changes so switching
  // panels always lands on the expanded view.
  const [setBuilderMinimized, setSetBuilderMinimized] = useState(false)
  const toggleSetBuilderMinimized = useCallback(() => setSetBuilderMinimized((m) => !m), [])

  // Compass quadrant the map viewport centre is currently in.
  const [activeQuadrant, setActiveQuadrant] = useState(null) // 'TR'|'TL'|'BR'|'BL'|null
  const togglePanel = (id) => { setSetBuilderMinimized(false); setActivePanel((prev) => (prev === id ? null : id)) }

  // Deck View (Slice 12): a right-side bento panel opened by clicking a song on the map (Decision
  // Log #6, #69). Independent of the left rail panel — the two can coexist (dual-panel edge case,
  // Decision Log #10). Holds the id of the track whose deck is open (null = closed). One at a time.
  const [deckTrackId, setDeckTrackId] = useState(null)
  const openDeck = useCallback((trackId) => { if (trackId) setDeckTrackId(trackId) }, [])
  const closeDeck = useCallback(() => setDeckTrackId(null), [])
  // Clicking the same song that's already open toggles the deck closed; a different song switches to it.
  const toggleDeck = useCallback((trackId) => {
    if (!trackId) return
    setDeckTrackId((prev) => (prev === trackId ? null : trackId))
  }, [])

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
  const [chain, setChain] = useState([]) // track ids, position 1..n (index 0 = head)
  // Disconnected/orphan groups (Decision Log #35, #45). Each is `{ id, tracks: [ids] }`, an ordered
  // sub-chain that keeps its internal wires after a cut. Multiple groups coexist. Non-destructive:
  // songs only leave a group by being re-wired into the chain (connectSong) or dissolved.
  const [orphanGroups, setOrphanGroups] = useState([])
  const [savingSet, setSavingSet] = useState(false)

  // Flow mode (Slice 10): a presentation toggle over the built set. OFF = build view (all songs,
  // non-chain dimmed, compatibility-colored wires). ON = present view (only the chain lit, everything
  // else near-invisible, uniform dark wires with a traveling strobe). Only meaningful with a chain, so
  // it resets whenever we leave build mode or the chain loses its head.
  const [flowMode, setFlowMode] = useState(false)
  const toggleFlowMode = useCallback(() => setFlowMode((f) => !f), [])
  useEffect(() => { if (!buildMode || chain.length === 0) setFlowMode(false) }, [buildMode, chain.length])

  // Read the freshest chain/orphanGroups synchronously from user-triggered actions (unlink/reorder/
  // connect) that also update the other slice — avoids nesting one setState inside another's updater
  // and gives connectSong the current groups when a wire released from an old drag closure fires.
  const chainRef = useRef(chain)
  useEffect(() => { chainRef.current = chain }, [chain])
  const orphanGroupsRef = useRef(orphanGroups)
  useEffect(() => { orphanGroupsRef.current = orphanGroups }, [orphanGroups])

  // Clicking a song with an empty chain seats it as the head (Decision Log #38, #42). Once a
  // head exists, further songs join only by wiring (connectSong).
  const addHead = useCallback((trackId) => {
    if (!trackId) return
    setChain((prev) => (prev.length === 0 ? [trackId] : prev))
  }, [])

  // Latch a wire from the current tail to `targetId` (Decision Log #33 — sequential, one-to-one).
  // The socket pair is optimized geometrically at render time (Slice 9 #1), so no snap edge is
  // stored. If `targetId` belongs to an orphan group, the WHOLE group rejoins the chain in its
  // retained order (Slice 9 r3 #6) — its internal wires were kept precisely so reconnecting any
  // member absorbs the segment [group...] appended after the current tail, and the group is dropped.
  const connectSong = useCallback((targetId) => {
    if (!targetId) return
    const grp = orphanGroupsRef.current.find((g) => g.tracks.includes(targetId))
    if (grp) {
      setChain((prev) => [...prev, ...grp.tracks.filter((t) => !prev.includes(t))])
      setOrphanGroups((groups) => groups.filter((g) => g.id !== grp.id))
    } else {
      setChain((prev) => (prev.includes(targetId) ? prev : [...prev, targetId]))
    }
  }, [])

  // Sever the wire AFTER the song at `index` (Decision Log #35, Slice 9 #2). Downstream songs
  // orphan as one group, keeping their wires to each other. The tail row is a no-op (nothing
  // downstream). Unlinking the head is special: song #2 re-anchors as the new head and the former
  // head becomes a solo orphan.
  const unlinkAfter = useCallback((index) => {
    const prev = chainRef.current
    if (index < 0 || index >= prev.length || index === prev.length - 1) return
    if (index === 0) {
      const former = prev[0]
      setChain(prev.slice(1))
      setOrphanGroups((g) => [...g, { id: nextGroupId(), tracks: [former] }])
      return
    }
    const downstream = prev.slice(index + 1)
    setChain(prev.slice(0, index + 1))
    setOrphanGroups((g) => [...g, { id: nextGroupId(), tracks: downstream }])
  }, [])

  // Re-sequence the connected chain by drag-to-reorder (Decision Log #47). Wires re-cascade
  // automatically since the map derives them from chain order. Whatever lands at index 0 is head.
  const reorderChain = useCallback((from, to) => {
    setChain((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }, [])

  // Dissolve an orphan group — removes every song in it from the set entirely (Slice 9 #3).
  const dissolveGroup = useCallback((groupId) => {
    setOrphanGroups((groups) => groups.filter((g) => g.id !== groupId))
  }, [])

  const clearChain = useCallback(() => { setChain([]); setOrphanGroups([]) }, [])

  // Explicitly start a fresh set — clears the chain + orphans and drops the "saved" flag (Slice 9
  // r3 #3). Distinct from clearChain so the panel can also reset its own button state.
  const savedRef = useRef(false)
  const newSet = useCallback(() => { savedRef.current = false; setChain([]); setOrphanGroups([]) }, [])

  // Persist the set to Supabase (Decision Log #57), gated at ≥2 songs (Decision Log #39). Unlike
  // earlier slices this DOES NOT clear the chain (Slice 9 r3 #3): the saved set stays visible on the
  // map + panel so the user can review and copy it. It's cleared only by starting a new set (newSet)
  // or exiting → re-entering build mode. Returns true on success, false on failure.
  const saveCurrentSet = useCallback(async (name) => {
    if (chain.length < 2 || !activePlaylistId) return false
    setSavingSet(true)
    try {
      const tracksById = Object.fromEntries(activeTracks.map((t) => [t.id, t]))
      await saveSet({ playlistId: activePlaylistId, name, chain, orphanGroups, tracksById })
      savedRef.current = true // mark for the clear-on-re-entry effect; chain stays on screen
      return true
    } catch (err) {
      console.error('[drift] saveSet failed:', err)
      return false
    } finally {
      setSavingSet(false)
    }
  }, [chain, orphanGroups, activePlaylistId, activeTracks])

  // Re-entering build mode after a save starts a clean slate (Slice 9 r3 #3). We clear on the
  // transition INTO 'sets' when the previous set was saved, so leaving to peek elsewhere and coming
  // back gives a fresh set — but a save you're still viewing stays put.
  const prevBuildRef = useRef(buildMode)
  useEffect(() => {
    const entered = buildMode && !prevBuildRef.current
    prevBuildRef.current = buildMode
    if (entered && savedRef.current) { savedRef.current = false; setChain([]); setOrphanGroups([]) }
  }, [buildMode])

  // The map registers imperative controls (pan/highlight a track) here so the panel search —
  // which lives outside the map's ReactFlowProvider — can drive it (Decision Log #56).
  const mapControlsRef = useRef(null)
  const registerMapControls = useCallback((controls) => { mapControlsRef.current = controls }, [])
  const focusTrack = useCallback((trackId) => { mapControlsRef.current?.focusTrack?.(trackId) }, [])

  // A chain references ids from the active playlist — switching playlists invalidates it. The open
  // deck likewise points at a track in the old playlist, so it closes on a swap.
  useEffect(() => { setChain([]); setOrphanGroups([]); setDeckTrackId(null) }, [activePlaylistId])

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
    setBuilderMinimized,
    toggleSetBuilderMinimized,
    activeQuadrant,
    setActiveQuadrant,
    activePreset,
    customXFeature,
    customYFeature,
    setActivePreset,
    setCustomPreset,
    buildMode,
    flowMode,
    toggleFlowMode,
    chain,
    orphanGroups,
    addHead,
    connectSong,
    unlinkAfter,
    reorderChain,
    dissolveGroup,
    clearChain,
    newSet,
    saveCurrentSet,
    savingSet,
    registerMapControls,
    focusTrack,
    deckTrackId,
    openDeck,
    closeDeck,
    toggleDeck,
  }

  return <PlaylistContext.Provider value={value}>{children}</PlaylistContext.Provider>
}

export function usePlaylistStore() {
  const ctx = useContext(PlaylistContext)
  if (!ctx) throw new Error('usePlaylistStore must be used within PlaylistProvider')
  return ctx
}
