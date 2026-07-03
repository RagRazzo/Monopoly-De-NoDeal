import { useEffect, useState } from 'react'
import { COLOR_INFO, cardLabel, type Card } from '@shared/cards'
import type { ClientGame, ClientPlayer } from '@shared/types'
import { send } from '../net'
import { useStore } from '../store'

function me(game: ClientGame): ClientPlayer {
  return game.players.find((p) => p.id === game.youId)!
}

function chipColor(card: Card): string {
  if (card.kind === 'property') return COLOR_INFO[card.color].hex
  if (card.kind === 'money') return '#5a8a4a'
  if (card.kind === 'rent') return '#e74c3c'
  if (card.kind === 'wild') return card.colors === 'any' ? '#a855f7' : COLOR_INFO[card.colors[0]].hex
  return '#374151'
}

function CardChip({ card, selected, onClick }: { card: Card; selected?: boolean; onClick?: () => void }) {
  return (
    <button className={`card-chip ${selected ? 'selected' : ''}`} onClick={onClick}>
      <span className="chip-color" style={{ background: chipColor(card) }} />
      <span className="chip-label">{cardLabel(card)}</span>
      <span className="chip-value">{card.value}M</span>
    </button>
  )
}

export function PromptModal() {
  const prompt = useStore((s) => s.prompt)
  const setPrompt = useStore((s) => s.setPrompt)
  if (!prompt) return null
  return (
    <div className="modal-backdrop" onClick={() => setPrompt(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{prompt.title}</h3>
        <div className="option-list">
          {prompt.options.map((o, i) => (
            <button key={i} className="option-btn" onClick={o.onPick}>
              {o.colorHex && <span className="chip-color" style={{ background: o.colorHex }} />}
              <span>
                {o.label}
                {o.sub && <small className="option-sub">{o.sub}</small>}
              </span>
            </button>
          ))}
        </div>
        <button className="ghost-btn" onClick={() => setPrompt(null)}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export function PaymentModal({ game }: { game: ClientGame }) {
  const [picked, setPicked] = useState<string[]>([])
  const pending = game.pending
  useEffect(() => setPicked([]), [pending?.description])
  if (!pending || pending.kind !== 'demand' || pending.stage !== 'pay' || pending.awaitingId !== game.youId) return null

  const my = me(game)
  const pool: Card[] = [...my.bank, ...my.piles.flatMap((p) => p.cards)]
  const worth = pool.reduce((s, c) => s + c.value, 0)
  const due = Math.min(pending.amount ?? 0, worth)
  const total = pool.filter((c) => picked.includes(c.id)).reduce((s, c) => s + c.value, 0)
  const attacker = game.players.find((p) => p.id === pending.attackerId)

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  return (
    <div className="modal-backdrop">
      <div className="modal wide">
        <h3>
          Pay {attacker?.name} {pending.amount}M
        </h3>
        <p className="muted">
          Select cards worth at least {due}M — no change is given.
          {worth < (pending.amount ?? 0) && ' You cannot cover it fully, so you must hand over everything.'}
        </p>
        <div className="chip-grid">
          {pool.map((c) => (
            <CardChip key={c.id} card={c} selected={picked.includes(c.id)} onClick={() => toggle(c.id)} />
          ))}
        </div>
        <div className="modal-footer">
          <span className={total >= due ? 'ok' : 'bad'}>
            Selected {total}M / {due}M
          </span>
          <button className="primary-btn" disabled={total < due} onClick={() => send('submitPayment', { cardIds: picked })}>
            Pay
          </button>
        </div>
      </div>
    </div>
  )
}

export function JsnModal({ game }: { game: ClientGame }) {
  const pending = game.pending
  if (!pending || pending.kind !== 'demand' || pending.stage !== 'jsn' || pending.awaitingId !== game.youId) return null
  const hasJsn = game.yourHand.some((c) => c.kind === 'action' && c.action === 'justsayno')
  const iAmAttacker = pending.attackerId === game.youId
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>{iAmAttacker ? 'They said No!' : 'You are targeted!'}</h3>
        <p>{pending.description}</p>
        <div className="option-list">
          <button className="primary-btn" disabled={!hasJsn} onClick={() => send('respondJsn', { useJsn: true })}>
            {iAmAttacker ? 'Counter with Just Say No!' : 'Just Say No!'}
            {!hasJsn && ' (none in hand)'}
          </button>
          <button className="option-btn" onClick={() => send('respondJsn', { useJsn: false })}>
            {iAmAttacker ? 'Let it go' : 'Accept'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function DiscardModal({ game }: { game: ClientGame }) {
  const [picked, setPicked] = useState<string[]>([])
  const pending = game.pending
  useEffect(() => setPicked([]), [pending?.description])
  if (!pending || pending.kind !== 'discard' || pending.awaitingId !== game.youId) return null
  const need = pending.mustDiscard ?? 0
  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < need ? [...prev, id] : prev))
  return (
    <div className="modal-backdrop">
      <div className="modal wide">
        <h3>Hand limit is 7 — discard {need}</h3>
        <div className="chip-grid">
          {game.yourHand.map((c) => (
            <CardChip key={c.id} card={c} selected={picked.includes(c.id)} onClick={() => toggle(c.id)} />
          ))}
        </div>
        <div className="modal-footer">
          <span>
            {picked.length}/{need} selected
          </span>
          <button className="primary-btn" disabled={picked.length !== need} onClick={() => send('discardCards', { cardIds: picked })}>
            Discard
          </button>
        </div>
      </div>
    </div>
  )
}
