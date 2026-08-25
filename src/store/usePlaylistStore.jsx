import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import {
  listPlaylists,
  getPlaylistTracks,
  createPlaylist,
  linkTracks,
  renamePlaylist,
  ensureDemoLibrary,
} from '../lib/playlists'
import { parseInput, runImport, retryUnresolved, acceptVersion as acceptVersionLib } from '../lib/import'
import { saveSet } from '../lib/sets'
import { setArtResolvedHandler } from '../lib/preview'
import { getUserId, hasSeenDemo, markSeenDemo } from '../lib/identity'

// Central app state for the playlist model + import flow.
// One playlist is active on the map at a time; the import flow is a small state machine:
//   null → welcome → steps → progress → reconcile → (active playlist on map)
//   null → progress(demo) → (Demo Library on map)

const PlaylistContext = createContext(null)

// Monotonic id for orphan groups — stable across re-renders so React keys and map hover-grouping
// don't shift when a group is added or dissolved.
let _groupSeq = 0
const nextGroupId = () => `g${++_groupSeq}`

// Default title for the playlist a paste-import auto-creates up front (the user can rename it from the
// reconciliation panel if one shows). Matches the old reconcile card's default: "Import – Aug 20".
const defaultImportName = () =>
  `Import – ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

// How long the status chip holds its completion read ("N of TOTAL mapped") before dismissing.
const DONE_CHIP_MS = 1800

export function PlaylistProvider({ children }) {
  // Stable per-browser id for this visitor's own data — separate from the shared 'demo' bucket
  // (Bug fix: personal imports must never be tagged 'demo', or every visitor querying 'demo' sees
  // them, and the shared bucket's permanent rows make the welcome-screen check never fire).
  const [userId] = useState(() => getUserId())
  const [playlists, setPlaylists] = useState([])
  const [activePlaylistId, setActivePlaylistId] = useState(null)
  const [activeTracks, setActiveTracks] = useState([])
  const [loading, setLoading] = useState(true)

  // Preview resolution (src/lib/preview.js) is self-healing for art: when a lazy lookup finds album
  // art for a track that had none, it persists to Supabase and calls back here so the map/deck reflect
  // the new cover immediately, without a reload.
  useEffect(() => {
    setArtResolvedHandler((id, url) => {
      setActiveTracks((prev) => prev.map((t) => (t.id === id ? { ...t, album_art_url: url } : t)))
    })
    return () => setArtResolvedHandler(null)
  }, [])

  const [importState, setImportState] = useState(null) // null|'welcome'|'steps'|'progress'|'reconcile'
  const [progress, setProgress] = useState({ current: 0, total: 0, name: '' })
  const [reconciliation, setReconciliation] = useState(null) // { mapped, unresolved }

  // Live import (see runPaste): `importing` flips the map into incremental-append mode so each
  // resolved track lands as its own animated node instead of a whole-map repopulation.
  //
  // The status chip is driven by ONE monotonic counter: `importMapped` = songs actually plotted on
  // the map so far (never decreases), out of `importTotal` = songs pasted (fixed for the run). The
  // chip shows "N of TOTAL" while mapping, then holds a completion read. `plottedIdsRef` dedups the
  // count against duplicate input lines. importPlaylistIdRef records which playlist the run belongs
  // to (a playlist switch = "navigated away").
  const [importing, setImporting] = useState(false)
  const [importPhase, setImportPhase] = useState(null) // null|'mapping'|'done'
  const [importTotal, setImportTotal] = useState(0)
  const [importMapped, setImportMapped] = useState(0)
  const importPlaylistIdRef = useRef(null)
  const plottedIdsRef = useRef(new Set())
  const doneChipTimer = useRef(null)

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
  //
  // buildMode TRAILS the panel instead of flipping synchronously with the click. Engaging it is
  // expensive — the map re-decorates every song node with wiring sockets/dimming and drops React
  // Flow's node virtualization — and doing that on the same frame the panel starts its 300ms slide
  // dropped the slide's frames (the "rough open"). So we arm it ~320ms later, after the slide settles.
  // Two payoffs: the slide runs unblocked, and rapid on/off toggling keeps cancelling the timer so the
  // heavy switch never engages during a flurry (that stacking used to stall the renderer). Leaving the
  // panel drops build mode immediately — the map returns to its normal view as the panel retracts.
  const [buildMode, setBuildMode] = useState(false)
  useEffect(() => {
    if (activePanel !== 'sets') { setBuildMode(false); return }
    const t = setTimeout(() => setBuildMode(true), 320)
    return () => clearTimeout(t)
  }, [activePanel])
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

  // Sever the wire AFTER the song at `index` (Decision Log #35, Slice 9 #2). The rule is anchored on
  // the head: the side of the cut still connected to the head KEEPS anchor status, and the side that
  // lost its path back to the head is cut loose. The upstream remainder [0..index] stays the chain.
  // What happens downstream depends on how many songs were cut off:
  //   • 2+ songs  → they orphan together as one group, keeping their internal wires (non-destructive).
  //   • 1 song    → a lone song is NOT an orphan group; it simply leaves the set and returns to the
  //                 map as an unselected node (reconnect it later like any library track). This is why
  //                 you only ever see a "Disconnected" group of 2 or more.
  // Cutting head→#2 with a longer tail is index 0 of the group rule: the head survives as a 1-song
  // chain (still haloed, since headId = chain[0]) and songs #2..n orphan together. The tail row is a
  // no-op (nothing downstream).
  const unlinkAfter = useCallback((index) => {
    const prev = chainRef.current
    if (index < 0 || index >= prev.length || index === prev.length - 1) return
    const downstream = prev.slice(index + 1)
    setChain(prev.slice(0, index + 1))
    if (downstream.length >= 2) {
      setOrphanGroups((g) => [...g, { id: nextGroupId(), tracks: downstream }])
    }
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

  // Remove the lone anchor from the set. Only meaningful while the chain is a single head with nothing
  // wired after it — the trash affordance in the panel is shown only then (once a second song latches,
  // that row shows the unlink glyph instead). The song simply leaves the set and returns to the map as
  // an unselected node, the same fate as a single unlinked downstream song (see unlinkAfter). Guarded to
  // a ≤1 chain so it can never silently wipe a real multi-song set. No confirmation — it's a one-click
  // re-seat to undo (Decision Log #44: head actions are recoverable, no modal).
  const removeHead = useCallback(() => { setChain((prev) => (prev.length <= 1 ? [] : prev)) }, [])

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
      await saveSet({ playlistId: activePlaylistId, name, chain, orphanGroups, tracksById, userId })
      savedRef.current = true // mark for the clear-on-re-entry effect; chain stays on screen
      return true
    } catch (err) {
      console.error('[drift] saveSet failed:', err)
      return false
    } finally {
      setSavingSet(false)
    }
  }, [chain, orphanGroups, activePlaylistId, activeTracks, userId])

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

  // Combines this browser's own rows with the shared demo bucket — the switcher (PlaylistPanel)
  // lists both. An anonymous/incognito browser owns nothing, so this resolves to demo-only.
  const refreshPlaylists = useCallback(async () => {
    const pls = await listPlaylists([userId, 'demo'])
    setPlaylists(pls)
    return pls
  }, [userId])

  // Live map append: link a freshly-resolved track into the import playlist and push
  // it onto the map so it renders as its own node with the entrance animation. Deduped by id — a
  // cascade can re-resolve a row that's already plotted, and a track must never double-plot.
  const appendTrackLive = useCallback(async (playlistId, track) => {
    try {
      await linkTracks(playlistId, [track.id])
    } catch (err) {
      console.error('[drift] live link failed:', err)
    }
    setActiveTracks((prev) => (prev.some((t) => t.id === track.id) ? prev : [...prev, track]))
  }, [])

  // Plot a track AND advance the status-chip's monotonic "mapped" counter — but only once per unique
  // track id (duplicate pasted lines resolve to the same row and must not double-count). This is the
  // sole path that increments importMapped, so the chip's "N of TOTAL" reflects songs truly on the map.
  const plotAndCount = useCallback((playlistId, track) => {
    appendTrackLive(playlistId, track)
    if (!plottedIdsRef.current.has(track.id)) {
      plottedIdsRef.current.add(track.id)
      setImportMapped((n) => n + 1)
    }
  }, [appendTrackLive])

  // Clear the completion-chip timer if the whole app unmounts.
  useEffect(() => () => { clearTimeout(doneChipTimer.current) }, [])

  // Initial load: welcome only fires when THIS browser (by userId) has no library of its own and
  // hasn't previously chosen to browse demo. Must NOT be decided from the combined list above —
  // demo's rows are permanent and shared, so checking "any rows at all" would never be empty and
  // welcome would never show for anyone.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const pls = await refreshPlaylists()
        if (cancelled) return
        const own = pls.filter((p) => p.user_id === userId)
        if (own.length > 0) {
          await activate(own[0].id)
        } else if (hasSeenDemo()) {
          const demoPls = pls.filter((p) => p.user_id === 'demo')
          if (demoPls.length > 0) await activate(demoPls[0].id)
          else setImportState('welcome')
        } else {
          setImportState('welcome')
        }
      } catch (err) {
        console.error('[drift] init failed:', err)
        setImportState('welcome')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [refreshPlaylists, activate, userId])

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

  // Wrap up an import: report the hit count, leave the map (already populated) as the interactive
  // surface, and surface any leftovers (unresolved + version warnings) in the reconciliation panel.
  // A fully-resolved import shows no panel — the map is the result.
  const finishImport = useCallback(({ mappedCount, unresolved, warnings }) => {
    console.log(`[drift] import complete — hits: ${mappedCount}, unresolved: ${unresolved.length}`)
    setImporting(false)
    // Hold the chip on its completion read ("N of TOTAL mapped") for a beat, then dismiss it.
    setImportPhase('done')
    clearTimeout(doneChipTimer.current)
    doneChipTimer.current = setTimeout(() => setImportPhase(null), DONE_CHIP_MS)
    // The song counts in the switcher were fetched at creation (before live linking) — refresh so the
    // import playlist shows its real count now that every hit has been linked.
    refreshPlaylists()
    if (unresolved.length > 0 || warnings.length > 0) {
      setReconciliation({ mappedCount, unresolved, warnings })
      setImportState('reconcile')
    }
  }, [refreshPlaylists])

  // Paste → live import. One fast V1 sweep plots hits on the map as they land; when it finishes the
  // map is fully interactive. V1 misses go to the reconciliation panel, where the per-track Retry
  // runs the V2–V4 cascade on demand — there is no automatic background pass. See src/lib/import.js.
  const runPaste = useCallback(async (text) => {
    clearTimeout(doneChipTimer.current)
    setReconciliation(null)

    // Seed the status chip's counter: TOTAL = songs pasted (fixed), mapped = 0 (climbs as songs plot).
    const total = parseInput(text).length
    plottedIdsRef.current = new Set()
    setImportTotal(total)
    setImportMapped(0)

    try {
      // Create (or reuse, for "import more") the playlist up front so hits can link + plot.
      const target = importTargetRef.current
      let playlistId = target
      if (!playlistId) {
        const playlist = await createPlaylist(defaultImportName(), userId)
        playlistId = playlist.id
      }
      importPlaylistIdRef.current = playlistId
      setImporting(true)         // map switches into incremental-append mode
      setImportPhase('mapping')
      await activate(playlistId) // the map's live destination (empty for a fresh playlist)
      await refreshPlaylists()
      setImportState(null)       // dismiss the paste modal — the map is the surface now

      // —— Fast V1 sweep. Each hit plots + advances the chip's "N of TOTAL". ——
      const result = await runImport(text, {
        onTrack: (track) => plotAndCount(playlistId, track),
      })

      finishImport({
        mappedCount: result.mapped.length,
        unresolved: result.unresolved,
        warnings: result.warnings,
      })
    } catch (err) {
      console.error('[drift] import failed:', err)
      setImporting(false)
      setImportPhase(null)
      setImportState(null)
    }
  }, [userId, activate, refreshPlaylists, plotAndCount, finishImport])

  // Demo path: instant, persisted, tagged user_id='demo'.
  const loadDemo = useCallback(async () => {
    setProgress({ current: 0, total: 1, name: 'Demo library' })
    setImportState('progress')
    try {
      const playlist = await ensureDemoLibrary('demo')
      markSeenDemo()
      await refreshPlaylists()
      await activate(playlist.id)
    } catch (err) {
      console.error('[drift] demo load failed:', err)
    } finally {
      closeImport()
    }
  }, [refreshPlaylists, activate, closeImport])

  // Reconciliation "Done": the playlist is already created, populated and on the
  // map — the panel only exists to review leftovers. So Done just applies a rename (if the user
  // retitled the auto-created playlist) and closes. Mapped tracks were linked live as they resolved.
  const finishReconcile = useCallback(async (name) => {
    try {
      const playlistId = importPlaylistIdRef.current ?? activePlaylistId
      const current = playlists.find((p) => p.id === playlistId)?.name
      if (playlistId && name && name !== current) {
        await renamePlaylist(playlistId, name)
        await refreshPlaylists()
      }
    } catch (err) {
      console.error('[drift] finishReconcile rename failed:', err)
    } finally {
      closeImport()
    }
  }, [activePlaylistId, playlists, refreshPlaylists, closeImport])

  // Retry one edited unresolved row (matched by its original pasted line). On success the track
  // links + plots on the map live (same path as an import hit), leaves the unresolved list, and any
  // version warning it surfaced is added to the panel.
  const retry = useCallback(async (originalText, artist, title) => {
    const track = await retryUnresolved(artist, title)
    if (!track) return false
    const playlistId = importPlaylistIdRef.current ?? activePlaylistId
    if (playlistId) await appendTrackLive(playlistId, track)
    setReconciliation((prev) => {
      if (!prev) return prev
      const newWarning = track._meta?.versionWarning
        ? { originalText, ...track._meta.versionWarning }
        : null
      return {
        ...prev,
        mappedCount: (prev.mappedCount ?? 0) + 1,
        unresolved: prev.unresolved.filter((u) => u.originalText !== originalText),
        warnings: newWarning
          ? [...(prev.warnings ?? []), newWarning]
          : (prev.warnings ?? []),
      }
    })
    return true
  }, [activePlaylistId, appendTrackLive])

  // "Use this version" on a version-mismatch row: re-run the lookup accepting the SoundNet match as-is
  // (overriding the duration guard) and stamping user_accepted_version on the row. On success the track
  // links + plots live and leaves the unresolved list — same path as a retry, minus the version warning.
  const acceptVersion = useCallback(async (originalText, artist, title) => {
    const track = await acceptVersionLib(artist, title)
    if (!track) return false
    const playlistId = importPlaylistIdRef.current ?? activePlaylistId
    if (playlistId) await appendTrackLive(playlistId, track)
    setReconciliation((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        mappedCount: (prev.mappedCount ?? 0) + 1,
        unresolved: prev.unresolved.filter((u) => u.originalText !== originalText),
      }
    })
    return true
  }, [activePlaylistId, appendTrackLive])

  const value = {
    playlists,
    activePlaylistId,
    activeTracks,
    loading,
    importState,
    progress,
    reconciliation,
    importing,
    importPhase,
    importTotal,
    importMapped,
    setActivePlaylist,
    openImport,
    closeImport,
    goImportStep,
    runPaste,
    loadDemo,
    finishReconcile,
    retry,
    acceptVersion,
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
    removeHead,
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
