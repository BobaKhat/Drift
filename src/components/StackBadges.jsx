import { useState } from 'react'
import { C, NEO_BAR_BG, NEO_BAR_SHADOW, NEO_BAR_EDGE } from './import/tokens'
import { SongCardRow, ROW_GAP } from './SongListRow'

// —— Stack badge + proximity popover (Slice 14) ————————————————————————————————————————
// When songs overlap at pill tier and above, one representative renders in place and this badge
// floats above it showing how many songs share that spot. Clicking it opens the popover listing
// every song in the cluster. Both are pixel-built from Figma (badge 748:3517, popover 748:3483).

const FONT = "'DM Sans', system-ui, -apple-system, sans-serif"
const ACCENT1 = '#F27F37'

// Screen-px the badge floats ABOVE the representative node's centre. The badge lives in the pane's
// ViewportPortal counter-scaled to a constant screen size, so this offset is a constant screen
// distance too — it clears the node body at both pill and card tiers. Shared with the popover
// anchor math and the wire-drag hit test so all three agree on where the badge sits.
export const BADGE_FLOAT = 56

// Badge (Figma 748:3517): translucent glass fill, 1px accent ring, accent count, hard black drop. A
// fixed-diameter circle for single-digit counts — height == min-width with a full-round radius, so it's
// a true circle, not the oval that asymmetric padding produced; larger counts grow into a pill of the
// same height. Sized ~¾ of the original.
const BADGE_SIZE = 42
// On-screen badge radius (the badge is counter-scaled to a constant screen size), used by the wire-drag
// layer to stop a dragged wire at the badge's outer edge instead of its centre.
export const BADGE_RADIUS = BADGE_SIZE / 2
export function StackBadge({ count, onOpen }) {
  const [hover, setHover] = useState(false)
  return (
    <div
      data-stack-badge=""
      onPointerDown={(e) => { e.stopPropagation() }}
      onClick={(e) => { e.stopPropagation(); onOpen?.(e) }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        boxSizing: 'border-box',
        height: BADGE_SIZE, minWidth: BADGE_SIZE, padding: '0 8px',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: BADGE_SIZE / 2,
        background: 'rgba(20,20,22,0.2)',
        border: `1px solid ${ACCENT1}`,
        boxShadow: hover
          ? `4px 4px 5px 0px rgba(0,0,0,1), 0 0 12px 1px rgba(242,127,55,0.55)`
          : `4px 4px 5px 0px rgba(0,0,0,1)`,
        backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
        color: ACCENT1, fontFamily: FONT, fontWeight: 600, fontSize: 24, lineHeight: 1,
        whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none',
        transition: 'box-shadow 140ms ease',
      }}
    >
      {count}
    </div>
  )
}

// Close (X) glyph for the popover header — #808080 (Figma "Icons/Primary").
function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M1 1L11 11M11 1L1 11" stroke="#808080" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

// Neomorphic X close button (standalone raised button on the panel surface): outer glow + rim at rest,
// intensifies on hover, sinks to an inset well with an accent ring on press. No CSS border.
const XBTN_REST = 'inset 0 0 0 1px rgba(255,255,255,0.05), -3px -3px 6px rgba(255,255,255,0.06), 3px 3px 6px rgba(0,0,0,0.8)'
const XBTN_HOVER = 'inset 0 0 0 1px rgba(255,255,255,0.07), -3px -3px 8px rgba(255,255,255,0.09), 4px 4px 9px rgba(0,0,0,0.9)'
const XBTN_PRESS = 'inset 2px 2px 5px rgba(0,0,0,0.7), inset -1px -1px 2px rgba(255,255,255,0.04), inset 0 0 0 1px rgba(242,127,55,0.85)'

function CloseButton({ onClose }) {
  const [hover, setHover] = useState(false)
  const [press, setPress] = useState(false)
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClose?.() }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => { setHover(false); setPress(false) }}
      onPointerDown={() => setPress(true)}
      onPointerUp={() => setPress(false)}
      style={{
        width: 28, height: 28, borderRadius: 8, flexShrink: 0, padding: 0, border: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        background: press ? '#161618' : (hover ? '#222224' : '#1a1a1c'),
        boxShadow: press ? XBTN_PRESS : (hover ? XBTN_HOVER : XBTN_REST),
        transition: 'background 120ms ease, box-shadow 120ms ease',
      }}
    >
      <CloseIcon />
    </button>
  )
}

// Popover (Figma 748:3483, reworked Slice 14): a raised neomorphic panel — shadows define every edge,
// no CSS border. Fixed 320px wide; the HEADER stays pinned while the SONG LIST is the scroll region,
// capped so the whole panel never exceeds 380px (2–3 songs size it to content). Rows are the shared
// SongCardRow, identical to the Set Builder panel list. Positioned by the map (left/top set
// imperatively so it stays glued to the badge); the map owns dismissal + per-mode row behavior.
export const StackPopover = function StackPopover({ innerRef, songs, tiers, onSelect, onClose }) {
  return (
    <div
      ref={innerRef}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute', zIndex: 7,
        width: 320, maxHeight: 380, boxSizing: 'border-box', padding: 12,
        display: 'flex', flexDirection: 'column',
        // Same raised slab as the toolbar pill + search bar: NEO_BAR_BG surface, NEO_BAR_SHADOW
        // extrusion, NEO_BAR_EDGE inner rim — one material across all the map's floating chrome. No border.
        background: NEO_BAR_BG, borderRadius: 12,
        boxShadow: `${NEO_BAR_SHADOW}, ${NEO_BAR_EDGE}`,
      }}
    >
      {/* Pinned header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0 }}>
        <span style={{ fontFamily: FONT, fontWeight: 600, fontSize: 14, color: C.textSecondary }}>
          {songs.length} Songs In Proximity
        </span>
        <CloseButton onClose={onClose} />
      </div>
      {/* Subtle divider — a hairline, not a heavy border */}
      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', width: '100%', margin: '12px 0' }} />
      {/* Scrollable song list — the only scroll region, so the header stays put */}
      <div className="hide-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: ROW_GAP, flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {songs.map((song) => (
          <SongCardRow
            key={song.id}
            track={{ ...song, album_art_url: song.albumArtUrl }}
            highlight={tiers?.[song.id]}
            onClick={(e) => { e.stopPropagation(); onSelect?.(song) }}
          />
        ))}
      </div>
    </div>
  )
}
