// Full-screen splash animations layered over the 3D table. Each effect is a
// short, self-contained CSS animation triggered by a fresh game-log line
// (see store.ts `pushEffect`). Purely decorative — pointer-events are off.
import { useStore, type EffectKind } from '../store'

interface Spec {
  className: string
  emoji: string
  text: string
}

const SPECS: Record<EffectKind, Spec> = {
  dealbreaker: { className: 'fx-dealbreaker', emoji: '💥', text: 'DEAL BREAKER' },
  slydeal: { className: 'fx-slydeal', emoji: '🫳', text: 'SLY DEAL' },
  forceddeal: { className: 'fx-forceddeal', emoji: '🔄', text: 'FORCED DEAL' },
  robbank: { className: 'fx-robbank', emoji: '🔫', text: 'ROBBED!' },
  robcaught: { className: 'fx-robcaught', emoji: '🚨', text: 'BUSTED!' },
  justsayno: { className: 'fx-justsayno', emoji: '🚫', text: 'NO!' },
  payment: { className: 'fx-payment', emoji: '🪙', text: '' },
}

function EffectView({ kind }: { kind: EffectKind }) {
  const spec = SPECS[kind]
  if (kind === 'payment') {
    return (
      <div className={`fx ${spec.className}`}>
        <span className="fx-coin">🪙</span>
        <span className="fx-coin">💰</span>
        <span className="fx-coin">🪙</span>
      </div>
    )
  }
  return (
    <div className={`fx ${spec.className}`}>
      <span className="fx-emoji">{spec.emoji}</span>
      {spec.text && <span className="fx-text">{spec.text}</span>}
    </div>
  )
}

export function TableEffects() {
  const effects = useStore((s) => s.effects)
  if (effects.length === 0) return null
  return (
    <div className="fx-layer">
      {effects.map((e) => (
        <EffectView key={e.id} kind={e.kind} />
      ))}
    </div>
  )
}
