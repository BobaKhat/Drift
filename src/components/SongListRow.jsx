import { C, FONT } from './import/tokens'
import { camelotColor } from '../lib/camelot'

// Shared song-row building blocks (Slice 9 #8, extracted Slice 14). One implementation of the album
// art thumb + name/artist column + BPM/Camelot column, used by BOTH the Set Builder panel rows and the
// stack popover so the two never drift into separate styles. Roomier metrics (Slice 14 polish): larger
// art + taller padding so the rows breathe instead of reading as a squeezed list.
export const ROW_ART = 40
export const ROW_PY = 10
export const ROW_GAP = 6

export function SongThumb({ url, size = ROW_ART }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 5, overflow: 'hidden', flexShrink: 0 }}>
      {url ? (
        <img src={url} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', background: 'rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: C.textSecondary }}>♪</div>
      )}
    </div>
  )
}

// Name (SemiBold white) + artist (Regular, Text/Secondary). Truncates on overflow.
export function RowText({ track }) {
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

// BPM (Medium white) + Camelot key (Medium, colored per key — the gray rule applies to map cards only).
export function TrackMeta({ track }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
      <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 500, color: '#fff', whiteSpace: 'nowrap' }}>
        {track?.bpm != null ? `${Math.round(track.bpm)} Bpm` : '—'}
      </span>
      <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 500, color: camelotColor(track?.camelot) }}>
        {track?.camelot ?? '—'}
      </span>
    </div>
  )
}

// Compatibility highlight (Slice 14): in the stack popover's wire-connect mode a row is tinted by how
// well it'd mix after the wire's source song — green (strong) / amber (yellow) matching the wire colors,
// each over a faint fill. Weak = no highlight (neutral, never red). `highlight` is 'strong'|'mild'|
// undefined; when set it REPLACES the row's normal fill + border. Unused elsewhere (set-builder rows
// pass nothing), so those stay neutral.
const HL_TIER = {
  strong: { border: '#1EFFB8', bg: 'rgba(30, 255, 184, 0.08)' },
  mild: { border: '#F7CB29', bg: 'rgba(247, 203, 41, 0.08)' },
}

// A plain clickable song card — the exact treatment of the Set Builder's orphan rows (658:547): solid
// #222224 border, #141416 fill, rounded 10. `track` is a raw track record (album_art_url/bpm/camelot).
export function SongCardRow({ track, onClick, highlight }) {
  const hl = highlight ? HL_TIER[highlight] : null
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: `${ROW_PY}px 10px`, borderRadius: 10,
        background: hl ? hl.bg : C.card,
        border: `1px solid ${hl ? hl.border : C.border}`,
        cursor: onClick ? 'pointer' : 'default', userSelect: 'none',
      }}
    >
      <SongThumb url={track?.album_art_url} />
      <RowText track={track} />
      <TrackMeta track={track} />
    </div>
  )
}
