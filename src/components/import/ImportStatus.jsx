import { usePlaylistStore } from '../../store/usePlaylistStore'
import { C, FONT, NEO_BAR_BG, NEO_BAR_SHADOW, NEO_BAR_EDGE } from './tokens'

// Non-blocking import status chip. It floats over the bottom of the map and never intercepts pointer
// events — the map stays fully interactive. Everything reads off one monotonic counter (importMapped
// = songs actually on the map, out of importTotal = songs pasted), so the number never resets.
//   mapping — "Mapping your music · N of TOTAL"        (N = songs plotted so far)
//   done    — "N of TOTAL mapped"                      (held briefly, then the chip dismisses)
// Renders nothing when no import is in flight (importPhase === null).
export default function ImportStatus() {
  const { importPhase, importTotal, importMapped } = usePlaylistStore()
  if (!importPhase || importTotal <= 0) return null

  const isDone = importPhase === 'done'

  // label = the primary phrase; detail = the count, kept in the secondary tone while mapping.
  // On completion the whole message IS the count, so it takes the primary tone and drops the label.
  const label = isDone ? null : 'Mapping your music'
  const detail = isDone
    ? `${importMapped} of ${importTotal} mapped`
    : `${importMapped} of ${importTotal}`

  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 28,
        transform: 'translateX(-50%)',
        // Above the reconciliation scrim (z 50) so the completion read stays visible even when a
        // leftover-misses panel opens at the same moment; still pointer-transparent.
        zIndex: 60,
        pointerEvents: 'none',
      }}
    >
      <div
        className="drift-status-chip"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          height: 40,
          padding: '0 18px',
          borderRadius: 100,
          background: NEO_BAR_BG,
          boxShadow: `${NEO_BAR_SHADOW}, ${NEO_BAR_EDGE}`,
          fontFamily: FONT,
          whiteSpace: 'nowrap',
        }}
      >
        <span
          className="drift-status-dot"
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            // Green on completion; accent orange while working.
            background: isDone ? C.green : C.accent1,
            boxShadow: `0 0 8px ${isDone ? C.green : C.accent1}`,
            flexShrink: 0,
          }}
        />
        {label && <span style={{ fontSize: 13, fontWeight: 500, color: C.textPrimary }}>{label}</span>}
        <span
          style={{
            fontSize: 13,
            fontWeight: isDone ? 500 : 400,
            color: isDone ? C.textPrimary : C.textSecondary,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {label ? `· ${detail}` : detail}
        </span>
      </div>
    </div>
  )
}
