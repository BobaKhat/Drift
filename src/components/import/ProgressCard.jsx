import { usePlaylistStore } from '../../store/usePlaylistStore'
import { C, FONT, INSET, RADIUS } from './tokens'
import { ModalCard } from './pieces'

// Progress card (composed — no Figma design). Matches the card shell; accent1 progress bar.
export default function ProgressCard() {
  const { progress } = usePlaylistStore()
  const { current, total, name } = progress
  const pct = total > 0 ? Math.round((current / total) * 100) : 0

  return (
    <ModalCard width={510} style={{ gap: 24, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
        <h1 style={{ fontFamily: FONT, fontSize: 28, fontWeight: 600, color: C.textPrimary, letterSpacing: '-1px', margin: 0 }}>
          Mapping your music
        </h1>
        <p style={{ fontFamily: FONT, fontSize: 14, color: C.textSecondary, margin: 0 }}>
          {total > 0 ? `Analyzing ${current} of ${total}…` : 'Preparing…'}
          {name ? <span style={{ color: C.iconPrimary }}>{`  ${name}`}</span> : null}
        </p>
      </div>

      <div
        style={{
          width: '100%',
          height: 10,
          background: C.card,
          borderRadius: RADIUS.pill,
          boxShadow: INSET,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: C.accent1,
            borderRadius: RADIUS.pill,
            transition: 'width 250ms ease',
          }}
        />
      </div>
    </ModalCard>
  )
}
