import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { usePlaylistStore } from '../store/usePlaylistStore'
import { C, FONT, INSET } from './import/tokens'
import { camelotColor } from '../lib/camelot'
import { formatSetMeta } from '../lib/setChain'

// The Set Builder panel (Figma node 658:407). Always open while building, not closeable
// (Decision Log #53). Slice 8 renders: title, library-scoped search (Decision Log #56), the
// connected chain list with the head accented, and a "Save & Complete" button gated at ≥2 songs
// (Decision Log #39, #57). The "Disconnected" / orphan section is Slice 9.

const ACCENT = C.accent1
const HEAD_BG = 'rgba(242,127,55,0.2)'

function MagnifierIcon({ color }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <circle cx="7.5" cy="7.5" r="5" stroke={color} strokeWidth="1.6" />
      <line x1="11.4" y1="11.4" x2="15.5" y2="15.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

// 6-dot drag grip (Figma) — reorder is Slice 9, so this is presentational for now.
function GripDots() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '3px 3px', gap: 3, flexShrink: 0 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <span key={i} style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(255,255,255,0.35)' }} />
      ))}
    </div>
  )
}

// Break-a-link glyph shown at the row's right edge (Figma). Unlink is Slice 9 — decorative here.
function UnlinkGlyph({ color }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, opacity: 0.8 }}>
      <path d="M9 15L15 9M10.5 5.5l1-1a4 4 0 0 1 5.6 5.6l-1 1M13.5 18.5l-1 1a4 4 0 0 1-5.6-5.6l1-1"
        stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SongThumb({ url }) {
  return (
    <div style={{ width: 42, height: 42, borderRadius: 5, overflow: 'hidden', flexShrink: 0 }}>
      {url ? (
        <img src={url} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: 'rgba(255,255,255,0.3)' }}>♪</div>
      )}
    </div>
  )
}

// A connected-song row. The head (position 1) gets the orange accent treatment (Decision Log #55).
function ChainRow({ track, isHead }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: 10, borderRadius: 10,
      background: isHead ? HEAD_BG : C.card,
      border: `1px solid ${isHead ? ACCENT : C.border}`,
    }}>
      <GripDots />
      <SongThumb url={track?.album_art_url} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {track?.name ?? 'Unknown'}
        </div>
        <div style={{ fontFamily: FONT, fontSize: 12, color: C.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {track?.artist ?? ''}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 500, color: '#fff', whiteSpace: 'nowrap' }}>
          {track?.bpm != null ? `${Math.round(track.bpm)} Bpm` : '—'}
        </span>
        <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 500, color: camelotColor(track?.camelot) }}>
          {track?.camelot ?? '—'}
        </span>
      </div>
      <UnlinkGlyph color={isHead ? ACCENT : C.textSecondary} />
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
      <SongThumb url={track.album_art_url} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONT, fontSize: 13, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.name}</div>
        <div style={{ fontFamily: FONT, fontSize: 11, color: C.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.artist}</div>
      </div>
    </div>
  )
}

export default function SetBuilderPanel() {
  const { chain, activeTracks, focusTrack, saveCurrentSet, savingSet } = usePlaylistStore()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const searchRef = useRef(null)

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

  const canSave = chain.length >= 2 && !savingSet
  const handleSave = useCallback(() => {
    if (!canSave) return
    const head = tracksById[chain[0]]
    saveCurrentSet(head?.name ? `${head.name} Set` : 'Untitled Set')
  }, [canSave, tracksById, chain, saveCurrentSet])

  const showDropdown = open && query.length >= 2
  const empty = chain.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, fontFamily: FONT }}>
      {/* Title */}
      <h2 style={{ margin: 0, fontSize: 40, fontWeight: 600, color: '#fff', lineHeight: 1.05 }}>Set Builder</h2>
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
          <div style={{ width: 38, height: 38, borderRadius: '50%', border: `1px solid ${ACCENT}`, background: 'rgba(20,20,22,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '4px 4px 5px 0px rgba(0,0,0,0.5)' }}>
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

      {/* Body: empty prompt, or the connected chain */}
      {empty ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 8, padding: '0 20px' }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: 'rgba(255,255,255,0.55)' }}>Click a song to start your set</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>Then drag a wire from its socket to chain the next track.</div>
        </div>
      ) : (
        <div className="hide-scrollbar" style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 5, flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {chainTracks.map((track, i) => (
            <ChainRow key={chain[i]} track={track} isHead={i === 0} />
          ))}
        </div>
      )}

      {/* Save & Complete — gated at ≥2 songs (Decision Log #39) */}
      <button
        onClick={handleSave}
        disabled={!canSave}
        style={{
          marginTop: 16, height: 56, flexShrink: 0,
          borderRadius: 100,
          background: canSave ? 'rgba(242,127,55,0.16)' : C.card,
          border: `1px solid ${canSave ? ACCENT : 'transparent'}`,
          boxShadow: canSave ? '4px 4px 5px 0px rgba(0,0,0,0.5)' : INSET,
          color: canSave ? ACCENT : C.textSecondary,
          fontFamily: FONT, fontSize: 16, fontWeight: 500,
          cursor: canSave ? 'pointer' : 'default',
          transition: 'color 160ms ease, border-color 160ms ease, background 160ms ease',
        }}
      >
        {savingSet ? 'Saving…' : 'Save and Complete'}
      </button>
    </div>
  )
}
