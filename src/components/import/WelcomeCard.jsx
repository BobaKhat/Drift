import { useState } from 'react'
import { usePlaylistStore } from '../../store/usePlaylistStore'
import { C, FONT, MONO, RADIUS } from './tokens'
import { ModalCard, PrimaryButton } from './pieces'

// Ghost secondary CTA — quiet outline, no fill, a step smaller than the primary so it clearly reads
// as the alternate path. Border lightens a touch on hover for feedback.
function GhostCTA({ children, onClick, style }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{
        height: 52,
        borderRadius: RADIUS.pill,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT,
        fontSize: 14,
        fontWeight: 500,
        color: C.textSecondary,
        cursor: 'pointer',
        background: 'transparent',
        border: `1px solid ${hover ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.12)'}`,
        padding: '0 24px',
        whiteSpace: 'nowrap',
        transition: 'border-color 150ms ease',
        ...style,
      }}
    >
      {children}
    </button>
  )
}

// Welcome / empty-state card (Figma node 753:4403). Two paths: demo (hero) or paste. The container
// treatment is untouched; only the internal hierarchy, copy, and CTA weighting live here.
export default function WelcomeCard() {
  const { loadDemo, goImportStep } = usePlaylistStore()

  return (
    <ModalCard width={570} style={{ gap: 0, alignItems: 'center' }}>
      {/* Brand mark */}
      <div style={{ fontFamily: MONO, fontSize: 12, fontWeight: 500, letterSpacing: '3px', textTransform: 'uppercase', color: C.textSecondary, textAlign: 'center' }}>
        Orion
      </div>

      {/* Tagline — the big statement */}
      <h1 style={{ fontFamily: FONT, fontSize: 34, fontWeight: 700, color: C.textPrimary, lineHeight: 1.15, textAlign: 'center', margin: '8px 0 0' }}>
        Explore your music in space
      </h1>

      {/* Subtitle */}
      <p style={{ fontFamily: FONT, fontSize: 15, fontWeight: 400, color: C.textSecondary, textAlign: 'center', margin: '16px 0 0' }}>
        See your music the way it feels
      </p>

      {/* Primary CTA — the icon rail's active/"selected" treatment: sunk-in dark face, inset accent
          ring + press shadow, accent label. */}
      <PrimaryButton onClick={loadDemo} selected style={{ width: 330, marginTop: 28 }}>
        Explore the demo library
      </PrimaryButton>

      {/* Caption tucked under the primary CTA */}
      <p style={{ fontFamily: FONT, fontSize: 12, fontWeight: 400, color: C.textSecondary, textAlign: 'center', margin: '8px 0 0' }}>
        No account needed — see Orion in action instantly
      </p>

      {/* Divider — tight above (closes the primary section), open below (into the secondary) */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'center', justifyContent: 'center', width: '100%', marginTop: 28 }}>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
        <span style={{ fontFamily: FONT, fontSize: 13, color: C.textSecondary, whiteSpace: 'nowrap' }}>or bring your own</span>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
      </div>

      {/* Secondary CTA — ghost, lighter */}
      <GhostCTA onClick={() => goImportStep('steps')} style={{ width: 330, marginTop: 20 }}>
        Paste your tracklist
      </GhostCTA>
    </ModalCard>
  )
}
