import { usePlaylistStore } from '../../store/usePlaylistStore'
import { C, FONT } from './tokens'
import { ModalCard, PrimaryButton, SecondaryButton } from './pieces'

// Welcome / empty-state card (Figma node 753:4403). Two paths: demo (hero) or paste.
export default function WelcomeCard() {
  const { loadDemo, goImportStep } = usePlaylistStore()

  return (
    <ModalCard width={570} style={{ gap: 24, alignItems: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center', width: '100%' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', textAlign: 'center', width: '100%' }}>
            <h1 style={{ fontFamily: FONT, fontSize: 32, fontWeight: 600, color: C.textPrimary, lineHeight: 1.15, margin: 0 }}>
              Orion: Explore your music in space
            </h1>
            <p style={{ fontFamily: FONT, fontSize: 14, fontWeight: 400, color: C.textSecondary, width: 350, margin: 0 }}>
              Drop in a playlist and Orion maps it by preset feeling
            </p>
          </div>
          <PrimaryButton onClick={loadDemo} selected style={{ width: 330 }}>
            Explore the demo library
          </PrimaryButton>
        </div>
        <p style={{ fontFamily: FONT, fontSize: 12, fontWeight: 400, color: C.textSecondary, textAlign: 'center', margin: 0 }}>
          No account needed — see Orion in action instantly
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, alignItems: 'center', width: '100%' }}>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', justifyContent: 'center', width: '100%' }}>
          <div style={{ flex: '0 0 151px', height: 1, background: C.border }} />
          <span style={{ fontFamily: FONT, fontSize: 12, color: C.textSecondary, whiteSpace: 'nowrap' }}>or bring your own</span>
          <div style={{ flex: '0 0 151px', height: 1, background: C.border }} />
        </div>
        <SecondaryButton onClick={() => goImportStep('steps')} style={{ width: 330 }}>
          Paste your tracklist
        </SecondaryButton>
      </div>
    </ModalCard>
  )
}
