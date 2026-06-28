import { usePlaylistStore } from '../../store/usePlaylistStore'
import WelcomeCard from './WelcomeCard'
import PasteStepsCard from './PasteStepsCard'
import ProgressCard from './ProgressCard'
import ReconciliationCard from './ReconciliationCard'

const CARDS = {
  welcome: WelcomeCard,
  steps: PasteStepsCard,
  progress: ProgressCard,
  reconcile: ReconciliationCard,
}

// Renders the active import card centered over the map. The map stays visible behind it
// (no empty-map state). A scrim dims the map but does not dismiss on click — import is modal.
export default function ImportFlow() {
  const { importState } = usePlaylistStore()
  const Card = importState ? CARDS[importState] : null
  if (!Card) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(8,8,8,0.55)',
        padding: 24,
      }}
    >
      <Card />
    </div>
  )
}
