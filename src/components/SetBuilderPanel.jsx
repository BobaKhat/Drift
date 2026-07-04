import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { usePlaylistStore } from '../store/usePlaylistStore'
import { C, FONT, INSET, EXTRUSION, ACCENT1_FILL, ACTIVE_GLOW } from './import/tokens'
import { camelotColor } from '../lib/camelot'
import { formatSetMeta } from '../lib/setChain'

// The Set Builder panel (Figma node 658:407). Always open while building, not closeable
// (Decision Log #53). Renders: title, library-scoped search (Decision Log #56), the connected
// chain list with the head accented, drag-to-reorder (Slice 9 #4/#6), per-row unlink (Slice 9 #2),
// the "Disconnected" orphan-group section (Slice 9 #3, styled to Figma), a Copy Tracklist button
// (Slice 9 #5), and "Save & Complete" gated at ≥2 songs (Decision Log #39, #57).

const ACCENT = C.accent1
const ACCENT2 = C.accent2 // #4B6AE5 — the Disconnected section's accent (matches Figma)
const HEAD_BG = 'rgba(242,127,55,0.2)'
const ORPHAN_BG = 'rgba(75,106,229,0.2)' // Figma group container fill

// Compact row metrics (Slice 9 #8) — smaller art + tighter padding than Slice 8 so more songs fit.
const ROW_ART = 36
const ROW_PY = 8
const ROW_GAP = 5

function MagnifierIcon({ color }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="7.5" cy="7.5" r="5" stroke={color} strokeWidth="1.6" />
      <line x1="11.4" y1="11.4" x2="15.5" y2="15.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

// 6-dot drag grip — the drag-to-reorder handle on connected rows (Slice 9 #6). Exact Figma SVG
// (Slice 9 final #6): a 2×3 dot grid, #4B4B4B.
function GripDots({ onPointerDown }) {
  return (
    <div
      onPointerDown={onPointerDown}
      style={{ display: 'flex', flexShrink: 0, cursor: 'grab', padding: '4px 5px', margin: '-4px -5px', touchAction: 'none' }}
    >
      <svg width="6" height="10" viewBox="0 0 6 10" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M1 0C1.26522 0 1.51957 0.105357 1.70711 0.292893C1.89464 0.480429 2 0.734784 2 1C2 1.26522 1.89464 1.51957 1.70711 1.70711C1.51957 1.89464 1.26522 2 1 2C0.734784 2 0.480429 1.89464 0.292893 1.70711C0.105357 1.51957 0 1.26522 0 1C0 0.734784 0.105357 0.480429 0.292893 0.292893C0.480429 0.105357 0.734784 0 1 0ZM2 5C2 4.73478 1.89464 4.48043 1.70711 4.29289C1.51957 4.10536 1.26522 4 1 4C0.734784 4 0.480429 4.10536 0.292893 4.29289C0.105357 4.48043 0 4.73478 0 5C0 5.26522 0.105357 5.51957 0.292893 5.70711C0.480429 5.89464 0.734784 6 1 6C1.26522 6 1.51957 5.89464 1.70711 5.70711C1.89464 5.51957 2 5.26522 2 5ZM2 9C2 8.73478 1.89464 8.48043 1.70711 8.29289C1.51957 8.10536 1.26522 8 1 8C0.734784 8 0.480429 8.10536 0.292893 8.29289C0.105357 8.48043 0 8.73478 0 9C0 9.26522 0.105357 9.51957 0.292893 9.70711C0.480429 9.89464 0.734784 10 1 10C1.26522 10 1.51957 9.89464 1.70711 9.70711C1.89464 9.51957 2 9.26522 2 9ZM6 5C6 4.73478 5.89464 4.48043 5.70711 4.29289C5.51957 4.10536 5.26522 4 5 4C4.73478 4 4.48043 4.10536 4.29289 4.29289C4.10536 4.48043 4 4.73478 4 5C4 5.26522 4.10536 5.51957 4.29289 5.70711C4.48043 5.89464 4.73478 6 5 6C5.26522 6 5.51957 5.89464 5.70711 5.70711C5.89464 5.51957 6 5.26522 6 5ZM5 8C5.26522 8 5.51957 8.10536 5.70711 8.29289C5.89464 8.48043 6 8.73478 6 9C6 9.26522 5.89464 9.51957 5.70711 9.70711C5.51957 9.89464 5.26522 10 5 10C4.73478 10 4.48043 9.89464 4.29289 9.70711C4.10536 9.51957 4 9.26522 4 9C4 8.73478 4.10536 8.48043 4.29289 8.29289C4.48043 8.10536 4.73478 8 5 8ZM6 1C6 0.734784 5.89464 0.480429 5.70711 0.292893C5.51957 0.105357 5.26522 0 5 0C4.73478 0 4.48043 0.105357 4.29289 0.292893C4.10536 0.480429 4 0.734784 4 1C4 1.26522 4.10536 1.51957 4.29289 1.70711C4.48043 1.89464 4.73478 2 5 2C5.26522 2 5.51957 1.89464 5.70711 1.70711C5.89464 1.51957 6 1.26522 6 1Z" fill="#4B4B4B" />
      </svg>
    </div>
  )
}

// Break-a-link glyph shown at a connected row's right edge — severs the wire after this song
// (Slice 9 #2). Hidden on the tail row. Exact Figma SVG (Slice 9 final #6), #4B4B4B stroke.
function UnlinkGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path d="M11.75 15.5V14M5.75 10.25L10.25 5.75M7.25 3.5L7.59725 3.098C8.3006 2.39475 9.25452 1.9997 10.2491 1.99977C11.2438 1.99984 12.1976 2.39502 12.9009 3.09837C13.6041 3.80173 13.9992 4.75564 13.9991 5.75027C13.999 6.74489 13.6039 7.69875 12.9005 8.402L12.5 8.75M8.75 12.5L8.45225 12.9005C7.7405 13.6038 6.78022 13.9982 5.77963 13.9982C4.77903 13.9982 3.81875 13.6038 3.107 12.9005C2.75609 12.5538 2.47748 12.1409 2.28733 11.6857C2.09717 11.2306 1.99926 10.7422 1.99926 10.2489C1.99926 9.75558 2.09717 9.26719 2.28733 8.81202C2.47748 8.35685 2.75609 7.94395 3.107 7.59725L3.5 7.25M14 11.75H15.5M0.5 4.25H2M4.25 0.5V2" stroke="#4B4B4B" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SongThumb({ url, size = ROW_ART }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 5, overflow: 'hidden', flexShrink: 0 }}>
      {url ? (
        <img src={url} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: 'rgba(255,255,255,0.3)' }}>♪</div>
      )}
    </div>
  )
}

// Shared metadata column (BPM + Camelot) for both connected and orphan rows.
function TrackMeta({ track }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
      <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 500, color: '#fff', whiteSpace: 'nowrap' }}>
        {track?.bpm != null ? `${Math.round(track.bpm)} Bpm` : '—'}
      </span>
      {/* Camelot keys are colored in the set-builder panel rows (the gray rule applies to map
          cards only); '—' when unknown falls back to Text/Secondary. */}
      <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 500, color: camelotColor(track?.camelot) }}>
        {track?.camelot ?? '—'}
      </span>
    </div>
  )
}

function RowText({ track }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {track?.name ?? 'Unknown'}
      </div>
      <div style={{ fontFamily: FONT, fontSize: 11, color: C.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {track?.artist ?? ''}
      </div>
    </div>
  )
}

// A connected-song row. The head (position 1) gets the orange accent (Decision Log #55). The grip
// drags to reorder; the unlink glyph severs the wire after this song (hidden on the tail); clicking
// the row body pans + highlights the song on the map (Slice 9 #4). `shift` slides the row to open a
// gap during a reorder; `lifted` styles the row being carried.
function ChainRow({ track, index, isHead, isTail, shift, lifted, onGripDown, onUnlink, onOpen }) {
  return (
    <div
      onClick={onOpen}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: `${ROW_PY}px 10px`, borderRadius: 10,
        background: isHead ? HEAD_BG : C.card,
        border: `1px solid ${isHead ? ACCENT : C.border}`,
        cursor: 'pointer', userSelect: 'none',
        transform: lifted ? `translateY(${shift}px) scale(1.04)` : `translateY(${shift}px)`,
        boxShadow: lifted ? '0 14px 30px rgba(0,0,0,0.6)' : 'none',
        zIndex: lifted ? 20 : 1,
        position: 'relative',
        opacity: lifted ? 0.97 : 1,
        pointerEvents: lifted ? 'none' : 'auto',
        transition: lifted ? 'none' : 'transform 180ms cubic-bezier(0.2,0,0,1), box-shadow 160ms ease',
      }}
    >
      <GripDots onPointerDown={(e) => { e.stopPropagation(); onGripDown(e, index) }} />
      <SongThumb url={track?.album_art_url} />
      <RowText track={track} />
      <TrackMeta track={track} />
      {isTail ? (
        <div style={{ width: 16, flexShrink: 0 }} />
      ) : (
        <div
          onClick={(e) => { e.stopPropagation(); onUnlink(index) }}
          title="Unlink — orphans everything after this song"
          style={{ display: 'flex', cursor: 'pointer', opacity: 0.85, flexShrink: 0 }}
        >
          <UnlinkGlyph />
        </div>
      )}
    </div>
  )
}

// An orphan row inside a Disconnected group — a normal card row (matches Figma 658:547: solid
// #222224 border, #141416 fill), clickable to locate on the map. No grip: orphans can't be
// reordered within their group, so the drag handle only appears on connected chain rows (r4 #1).
function OrphanRow({ track, onOpen }) {
  return (
    <div
      onClick={onOpen}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: `${ROW_PY}px 10px`, borderRadius: 10,
        background: C.card, border: `1px solid ${C.border}`,
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      <SongThumb url={track?.album_art_url} />
      <RowText track={track} />
      <TrackMeta track={track} />
    </div>
  )
}

// One orphan group ("1 of N" + Dissolve) in Figma's accent-2 blue dashed container (658:541).
function OrphanGroup({ group, label, tracksById, onDissolve, onOpen }) {
  // Default COLLAPSED (Slice 9 final #4) — the user expands a group's chevron to reveal its songs.
  const [collapsed, setCollapsed] = useState(true)
  const [hover, setHover] = useState(false)
  const rows = group.tracks.map((id) => tracksById[id]).filter(Boolean)
  return (
    <div style={{
      border: `1px dashed ${ACCENT2}`, borderRadius: 10, padding: 10,
      background: ORPHAN_BG, display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      {/* Group header: "1 of N" + Dissolve (both Text/Secondary per Figma) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={() => setCollapsed((c) => !c)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        >
          <svg width="9" height="6" viewBox="0 0 9 6" fill="none" style={{ transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 160ms ease' }}>
            <path d="M1 1.5L4.5 4.5L8 1.5" stroke={C.textSecondary} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 500, color: C.textSecondary }}>{label}</span>
        </button>
        <button
          onClick={() => onDissolve(group.id)}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          title="Remove these songs from the set entirely"
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: FONT, fontSize: 12, fontWeight: 500, color: hover ? '#fff' : C.textSecondary, transition: 'color 140ms ease' }}
        >
          Dissolve
        </button>
      </div>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: ROW_GAP }}>
          {rows.map((track, i) => <OrphanRow key={group.tracks[i]} track={track} onOpen={() => onOpen(group.tracks[i])} />)}
        </div>
      )}
    </div>
  )
}

// Panel search result row.
function ResultRow({ track, onSelect, isLast }) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onMouseDown={() => onSelect(track)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px',
        cursor: 'pointer', background: hovered ? 'rgba(255,255,255,0.05)' : 'transparent',
        borderBottom: isLast ? 'none' : `1px solid ${C.border}`, userSelect: 'none',
      }}
    >
      <SongThumb url={track.album_art_url} size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONT, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.name}</div>
        <div style={{ fontFamily: FONT, fontSize: 11, color: C.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.artist}</div>
      </div>
    </div>
  )
}

function CopyIcon({ color }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
      <rect x="9" y="9" width="11" height="11" rx="2" stroke={color} strokeWidth="1.7" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export default function SetBuilderPanel() {
  const {
    chain, orphanGroups, activeTracks, focusTrack, saveCurrentSet, savingSet,
    unlinkAfter, reorderChain, dissolveGroup, newSet, toggleSetBuilderMinimized,
  } = usePlaylistStore()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  // The Disconnected section is ALWAYS present but starts COLLAPSED (r4 #4) — it never auto-expands
  // to steal panel space; the user clicks its header to reveal the orphan groups.
  const [disconnectedOpen, setDisconnectedOpen] = useState(false)
  const searchRef = useRef(null)
  const scrollRef = useRef(null)

  const tracksById = useMemo(() => Object.fromEntries(activeTracks.map((t) => [t.id, t])), [activeTracks])
  const chainTracks = useMemo(() => chain.map((id) => tracksById[id]).filter(Boolean), [chain, tracksById])

  const results = useMemo(() => {
    if (query.length < 2) return []
    const q = query.toLowerCase()
    return activeTracks
      .filter((t) => t.name?.toLowerCase().includes(q) || t.artist?.toLowerCase().includes(q))
      .slice(0, 8)
  }, [query, activeTracks])

  useEffect(() => {
    const handler = (e) => { if (!searchRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleSelect = useCallback((track) => {
    setQuery('')
    setOpen(false)
    focusTrack(track.id) // pan + highlight on the map (Decision Log #56)
  }, [focusTrack])

  // —— Drag-to-reorder with native lift + gap animation (Slice 9 #6/#7) ————————————————
  // The dragged row lifts (scale + shadow) and follows the cursor; the others translate to open a
  // gap in real time. All geometry is in scroll-content space so it survives auto-scroll. `view`
  // holds the per-frame { translate, shifts } written by computeView; `meta` caches drag constants.
  const rowRefs = useRef([])
  const [dragIndex, setDragIndex] = useState(null)
  const [view, setView] = useState(null) // { translate, shifts: number[] } | null
  const meta = useRef({ index: null, centers: [], spacing: 0, to: null, moved: false })
  const lastClientY = useRef(0)
  const scrollRaf = useRef(0)
  const suppressClick = useRef(false)

  const computeView = useCallback((clientY) => {
    const c = scrollRef.current
    const m = meta.current
    if (!c || m.index == null) return
    const rect = c.getBoundingClientRect()
    const st = c.scrollTop
    const currentContentY = clientY - rect.top + st
    let insert = 0
    for (let i = 0; i < m.centers.length; i++) {
      if (i === m.index) continue
      if (m.centers[i] < currentContentY) insert++
    }
    m.to = insert
    const draggedOriginalClientCenter = m.centers[m.index] - st + rect.top
    const translate = clientY - draggedOriginalClientCenter
    if (Math.abs(translate) > 4) m.moved = true
    const shifts = m.centers.map((_, i) => {
      if (i === m.index) return 0
      const rank = i < m.index ? i : i - 1
      const newVisual = rank < insert ? rank : rank + 1
      return (newVisual - i) * m.spacing
    })
    setView({ translate, shifts })
  }, [])

  const AUTOSCROLL_EDGE = 46
  const AUTOSCROLL_SPEED = 11
  const scrollLoop = useCallback(() => {
    scrollRaf.current = requestAnimationFrame(scrollLoop)
    const c = scrollRef.current
    if (!c) return
    const rect = c.getBoundingClientRect()
    const y = lastClientY.current
    let dv = 0
    if (y < rect.top + AUTOSCROLL_EDGE) dv = -(AUTOSCROLL_EDGE - (y - rect.top)) / AUTOSCROLL_EDGE
    else if (y > rect.bottom - AUTOSCROLL_EDGE) dv = (AUTOSCROLL_EDGE - (rect.bottom - y)) / AUTOSCROLL_EDGE
    if (dv !== 0) {
      c.scrollTop += Math.max(-1, Math.min(1, dv)) * AUTOSCROLL_SPEED
      computeView(lastClientY.current) // scroll moved → re-derive translate/gap
    }
  }, [computeView])

  const onGripDown = useCallback((e, index) => {
    e.preventDefault()
    const c = scrollRef.current
    if (!c) return
    const cRect = c.getBoundingClientRect()
    const st = c.scrollTop
    const centers = rowRefs.current.slice(0, chainTracks.length).map((el) => {
      const r = el.getBoundingClientRect()
      return r.top - cRect.top + st + r.height / 2
    })
    const spacing = centers.length > 1 ? centers[1] - centers[0] : (rowRefs.current[0]?.getBoundingClientRect().height ?? 52) + ROW_GAP
    meta.current = { index, centers, spacing, to: index, moved: false }
    lastClientY.current = e.clientY
    setDragIndex(index)
    computeView(e.clientY)
    scrollRaf.current = requestAnimationFrame(scrollLoop)

    const onMove = (ev) => { lastClientY.current = ev.clientY; computeView(ev.clientY) }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      cancelAnimationFrame(scrollRaf.current)
      const m = meta.current
      if (m.index != null && m.to != null && m.to !== m.index) reorderChain(m.index, m.to)
      if (m.moved) { suppressClick.current = true; setTimeout(() => { suppressClick.current = false }, 0) }
      meta.current = { index: null, centers: [], spacing: 0, to: null, moved: false }
      setDragIndex(null)
      setView(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [chainTracks.length, computeView, scrollLoop, reorderChain])

  useEffect(() => () => cancelAnimationFrame(scrollRaf.current), [])

  // Clicking a row locates the song on the map (Slice 9 #4) — unless a drag just happened.
  const openOnMap = useCallback((trackId) => {
    if (suppressClick.current) return
    focusTrack(trackId)
  }, [focusTrack])

  // Bottom button is a small state machine (Slice 9 r2 #6 / r3 #3): build → saving → saved →
  // copyable. On a successful save the chain STAYS on screen (r3 #3); the button just becomes
  // "Copy Tracklist" (+ a New Set action). Editing the saved chain reverts to Save so it can be
  // re-saved; New Set / re-entering build mode clears everything.
  const [phase, setPhase] = useState('build') // 'build' | 'saving' | 'saved' | 'copyable'
  const savedChainIds = useRef(null)
  const canSave = chain.length >= 2 && !savingSet && phase === 'build'

  const copyTracklist = useCallback(() => {
    if (!chainTracks.length) return
    const text = chainTracks.map((t, i) => `${i + 1}. ${t.artist ?? 'Unknown'} – ${t.name ?? 'Unknown'}`).join('\n')
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1600) }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => {})
    else done()
  }, [chainTracks])

  const handleSave = useCallback(async () => {
    if (!canSave) return
    const head = tracksById[chain[0]]
    setPhase('saving')
    const ok = await saveCurrentSet(head?.name ? `${head.name} Set` : 'Untitled Set')
    if (ok) {
      savedChainIds.current = chain.join('|') // remember what was saved to detect later edits
      setPhase('saved')
      setTimeout(() => setPhase('copyable'), 1300)
    } else {
      setPhase('build')
    }
  }, [canSave, tracksById, chain, saveCurrentSet])

  const handleNewSet = useCallback(() => { savedChainIds.current = null; setPhase('build'); newSet() }, [newSet])

  // If the user edits the chain after saving, revert to the Save state so they can re-save.
  useEffect(() => {
    if ((phase === 'saved' || phase === 'copyable') && savedChainIds.current !== null && chain.join('|') !== savedChainIds.current) {
      setPhase('build')
    }
  }, [chain, phase])

  // Reset the Disconnected section to collapsed whenever it empties, so a later orphan never makes
  // it spring open on its own (r4 #4 — never auto-expand).
  useEffect(() => { if (orphanGroups.length === 0) setDisconnectedOpen(false) }, [orphanGroups.length])

  const showDropdown = open && query.length >= 2
  const empty = chain.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, fontFamily: FONT }}>
      {/* Title + minimize (Slice 9 final #5) — collapse the panel to a thin bottom tab for full map
          visibility while staying in build mode. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 40, fontWeight: 600, color: '#fff', lineHeight: 1.05 }}>Set Builder</h2>
        <button
          onClick={toggleSetBuilderMinimized}
          title="Minimize panel"
          style={{ marginTop: 6, width: 32, height: 32, flexShrink: 0, borderRadius: '50%', background: C.card, border: `1px solid ${C.border}`, boxShadow: INSET, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          {/* chevron down = minimize */}
          <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
            <path d="M1 1.5L6 6L11 1.5" stroke={C.textSecondary} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div style={{ marginTop: 16, marginBottom: 18, height: 1, background: 'rgba(255,255,255,0.08)' }} />

      {/* Library-scoped search */}
      <div ref={searchRef} style={{ position: 'relative', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 5px 5px 22px', background: C.card, borderRadius: 100, boxShadow: INSET }}>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => { if (query.length >= 2) setOpen(true) }}
            onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setQuery('') } }}
            placeholder="Find a Song on your Map"
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontFamily: FONT, fontSize: 14, fontWeight: 500, color: query ? '#fff' : C.textSecondary }}
          />
          <div style={{ width: 38, height: 38, borderRadius: '50%', border: `1.5px solid ${ACCENT}`, background: ACCENT1_FILL, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: `${ACTIVE_GLOW}, 4px 4px 5px 0px rgba(0,0,0,0.5)` }}>
            <MagnifierIcon color={ACCENT} />
          </div>
        </div>
        {showDropdown && (
          <div style={{ position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0, background: C.card, borderRadius: 14, border: `1px solid ${C.border}`, boxShadow: '0 8px 32px rgba(0,0,0,0.65)', overflow: 'hidden', zIndex: 10 }}>
            {results.length === 0 ? (
              <div style={{ padding: '12px 16px', fontSize: 13, color: C.textSecondary }}>No songs found</div>
            ) : (
              results.map((t, i) => <ResultRow key={t.id} track={t} onSelect={handleSelect} isLast={i === results.length - 1} />)
            )}
          </div>
        )}
      </div>

      {/* Count + duration (hidden in the empty state) */}
      {!empty && (
        <div style={{ marginTop: 16, fontSize: 14, fontWeight: 500, color: C.textSecondary, flexShrink: 0 }}>
          {formatSetMeta(chainTracks)}
        </div>
      )}

      {/* Connected chain — scrolls independently above the pinned Disconnected section (Slice 9
          r2 #5). Empty prompt shows only when there's nothing at all in the set. */}
      {empty ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 8, padding: '0 20px' }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: 'rgba(255,255,255,0.55)' }}>Click a song to start your set</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>Then drag a wire from its socket to chain the next track.</div>
        </div>
      ) : (
        <div ref={scrollRef} className="hide-scrollbar" style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: ROW_GAP, flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {chainTracks.map((track, i) => (
            <div key={chain[i]} ref={(el) => { rowRefs.current[i] = el }}>
              <ChainRow
                track={track}
                index={i}
                isHead={i === 0}
                isTail={i === chainTracks.length - 1}
                shift={dragIndex != null ? (view?.shifts?.[i] ?? 0) + (i === dragIndex ? (view?.translate ?? 0) : 0) : 0}
                lifted={i === dragIndex}
                onGripDown={onGripDown}
                onUnlink={unlinkAfter}
                onOpen={() => openOnMap(chain[i])}
              />
            </div>
          ))}
        </div>
      )}

      {/* Disconnected section — PINNED to the bottom (Slice 9 r2 #5) and ALWAYS present, giving the
          panel a consistent structure whether or not orphans exist (r4 #4). It starts collapsed:
          with orphans the header carries a "N Groups" count + an expand chevron the user clicks to
          reveal the groups (which then scroll internally); with none it's a static "0 Groups" label
          with no chevron. It never auto-expands. */}
      {(() => {
        const n = orphanGroups.length
        const expandable = n > 0
        const expanded = expandable && disconnectedOpen
        return (
          <div style={{ flexShrink: 0, marginTop: 14, paddingTop: 14, borderTop: `1px solid rgba(255,255,255,0.08)` }}>
            <button
              onClick={expandable ? () => setDisconnectedOpen((o) => !o) : undefined}
              disabled={!expandable}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'none', border: 'none', padding: 0, marginBottom: expanded ? 12 : 0,
                cursor: expandable ? 'pointer' : 'default',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {expandable && (
                  <svg width="9" height="6" viewBox="0 0 9 6" fill="none" style={{ transform: expanded ? 'none' : 'rotate(-90deg)', transition: 'transform 160ms ease' }}>
                    <path d="M1 1.5L4.5 4.5L8 1.5" stroke={C.textSecondary} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 500, color: C.textSecondary }}>Disconnected</span>
              </span>
              <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 500, color: C.textSecondary }}>
                {n} Group{n === 1 ? '' : 's'}
              </span>
            </button>
            {expanded && (
              <div className="hide-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 240, overflowY: 'auto' }}>
                {orphanGroups.map((group, gi) => (
                  <OrphanGroup
                    key={group.id}
                    group={group}
                    label={`${gi + 1} of ${n}`}
                    tracksById={tracksById}
                    onDissolve={dissolveGroup}
                    onOpen={openOnMap}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {/* Bottom action — Save & Complete, then transforms into Copy Tracklist post-save; the chain
          stays on screen and a "Start New Set" link clears it (Slice 9 r3 #3). */}
      {phase === 'copyable' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16, flexShrink: 0 }}>
          <button
            onClick={copyTracklist}
            style={{
              height: 56, borderRadius: 100,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              background: C.card, border: `1px solid ${copied ? ACCENT : C.border}`, boxShadow: INSET,
              color: copied ? ACCENT : '#fff', fontFamily: FONT, fontSize: 15, fontWeight: 500,
              cursor: 'pointer', transition: 'color 160ms ease, border-color 160ms ease',
            }}
          >
            <CopyIcon color={copied ? ACCENT : '#fff'} />
            {copied ? 'Copied!' : 'Copy Tracklist'}
          </button>
          <button
            onClick={handleNewSet}
            style={{ background: 'none', border: 'none', padding: '2px 0', cursor: 'pointer', fontFamily: FONT, fontSize: 13, fontWeight: 500, color: C.textSecondary }}
          >
            Start New Set
          </button>
        </div>
      ) : (
        // Two visual states (Slice 11 polish #5). DISABLED = the Figma gray treatment (frame 748:1774):
        // #141416 fill, extrusion (4/4/5 black drop + inset 1/1.5/3 #373737), #848484 text. ACTIVE (set
        // savable, or mid-save) = the app's orange primary-button treatment: accent border + tinted
        // fill + white text. A transparent border on the disabled state keeps the two the same size.
        (() => { const accented = canSave || phase === 'saving' || phase === 'saved'; return (
        <button
          onClick={handleSave}
          disabled={!canSave}
          style={{
            marginTop: 16, flexShrink: 0, borderRadius: 100, boxSizing: 'border-box',
            padding: '15px 15px 15px 30px',
            background: accented ? ACCENT1_FILL : C.card,
            border: `1.5px solid ${accented ? ACCENT : 'transparent'}`,
            boxShadow: accented ? `${ACTIVE_GLOW}, 4px 4px 5px 0px rgba(0,0,0,0.5)` : EXTRUSION,
            color: accented ? '#fff' : C.textSecondary,
            fontFamily: FONT, fontSize: 16, fontWeight: 500, textAlign: 'center',
            cursor: canSave ? 'pointer' : 'default',
            transition: 'color 160ms ease, background 160ms ease, border-color 160ms ease',
          }}
        >
          {phase === 'saving' ? 'Saving…' : phase === 'saved' ? 'Saved!' : 'Save and Complete'}
        </button>
        ) })()
      )}
    </div>
  )
}
