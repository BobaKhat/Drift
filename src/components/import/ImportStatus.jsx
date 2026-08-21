import { usePlaylistStore } from '../../store/usePlaylistStore'
import { C, FONT, NEO_BAR_BG, NEO_BAR_SHADOW, NEO_BAR_EDGE } from './tokens'

// Non-blocking import status chip. It floats over the bottom of the map and never intercepts pointer
// events — the map stays fully interactive. The two-pass structure is deliberately INVISIBLE here:
// everything reads off one monotonic counter (importMapped = songs actually on the map, out of
// importTotal = songs pasted), so the number never resets or jumps backward as the passes hand off.
//   pass 1 — "Mapping your music · N of TOTAL"        (N = songs plotted so far)
//   pass 2 — "Still searching · (TOTAL − N) left"     (songs not yet on the map)
//   done   — "N of TOTAL mapped"                      (held briefly, then the chip dismisses)
// Renders nothing when no import is in flight (importPhase === null).
export default function ImportStatus() {
  const { importPhase, importTotal, importMapped } = usePlaylistStore()
  if (!importPhase || importTotal <= 0) return null

  const isPass2 = importPhase === 'pass2'
  const isDone = importPhase === 'done'
  // "left" can never read negative even if mapped momentarily leads total (duplicate-line edge cases).
  const left = Math.max(0, importTotal - importMapped)

  // label = the primary phrase; detail = the count, kept in the secondary tone during the passes.
  // On completion the whole message IS the count, so it takes the primary tone and drops the label.
  const label = isDone ? null : (isPass2 ? 'Still searching' : 'Mapping your music')
  const detail = isDone
    ? `${importMapped} of ${importTotal} mapped`
    : isPass2
      ? `${left} left`
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
            // Pass 2 runs quietly in the background, so its dot pulses ("still working"); pass 1 and the
            // completion read keep a steady lit dot.
            animation: isPass2 ? 'driftStatusPulse 1.4s ease-in-out infinite' : undefined,
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
