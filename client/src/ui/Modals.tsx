import { useEffect, useState } from 'react'
import { ACTION_INFO, COLOR_INFO, cardLabel, type ActionName, type Card } from '@shared/cards'
import { isPileComplete, pilePropertyCount } from '@shared/logic'
import type { ClientGame, ClientPlayer } from '@shared/types'
import { getCardImageURL } from '../game3d/textures'
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
  const attacker = game.players.find((p) => p.id === pending.attackerId)
  const gift = pending.action === 'gofundme'
  // Go Fund Me gifts come from bank cash only; everything else can be paid
  // from the bank or from table cards.
  const pool: Card[] = gift ? [...my.bank] : [...my.bank, ...my.piles.flatMap((p) => p.cards)]
  const worth = pool.reduce((s, c) => s + c.value, 0)
  const due = gift ? 0 : Math.min(pending.amount ?? 0, worth)
  const total = pool.filter((c) => picked.includes(c.id)).reduce((s, c) => s + c.value, 0)
  // Human-readable reason for the payment, e.g. "Rent", "Debt Collector".
  const reason =
    pending.action === 'rent'
      ? 'Rent'
      : pending.action && pending.action !== 'discard'
        ? ACTION_INFO[pending.action as ActionName]?.label ?? 'Payment'
        : 'Payment'
  const hasJsn = game.yourHand.some((c) => c.kind === 'action' && c.action === 'justsayno')

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  if (gift) {
    return (
      <div className="modal-backdrop">
        <div className="modal wide">
          <h3>🙏 Go Fund {attacker?.name}</h3>
          <p className="muted">Gift any amount of your bank cash to {attacker?.name}, or decline.</p>
          <div className="chip-grid">
            {pool.map((c) => (
              <CardChip key={c.id} card={c} selected={picked.includes(c.id)} onClick={() => toggle(c.id)} />
            ))}
          </div>
          <div className="modal-footer">
            <button className="option-btn" onClick={() => send('submitPayment', { cardIds: [] })}>
              Decline
            </button>
            <span className="ok">Gift {total}M</span>
            <button className="primary-btn" disabled={total === 0} onClick={() => send('submitPayment', { cardIds: picked })}>
              Fund {attacker?.name}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop">
      <div className="modal wide">
        <h3>
          {reason} — pay {attacker?.name} {pending.amount}M
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
          <button
            className="option-btn"
            disabled={!hasJsn}
            onClick={() => send('respondJsn', { useJsn: true })}
          >
            🛑 Say No{!hasJsn && ' (none in hand)'}
          </button>
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
  const isRobBank = pending.action === 'robbank'
  const acceptLabel = iAmAttacker ? 'Let it go' : isRobBank ? '💸 Give up your bank' : 'Accept'
  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>{iAmAttacker ? 'They said No!' : isRobBank ? '🔫 Bank robbery!' : 'You are targeted!'}</h3>
        <p>{pending.description}</p>
        <div className="option-list">
          <button className="primary-btn" disabled={!hasJsn} onClick={() => send('respondJsn', { useJsn: true })}>
            {iAmAttacker ? 'Counter with Just Say No!' : 'Just Say No!'}
            {!hasJsn && ' (none in hand)'}
          </button>
          <button className="option-btn" onClick={() => send('respondJsn', { useJsn: false })}>
            {acceptLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// Full-size zoom of a single card. Tap anywhere to close.
export function InspectCardModal() {
  const card = useStore((s) => s.inspectCard)
  const close = () => useStore.getState().setInspectCard(null)
  if (!card) return null
  return (
    <div className="modal-backdrop inspect-backdrop" onClick={close}>
      <img className="inspect-card" src={getCardImageURL(card)} alt={cardLabel(card)} />
      <div className="inspect-hint">Tap anywhere to close</div>
    </div>
  )
}

// Zoomed view of a player's table: their property piles and bank, with
// tappable card thumbnails. Opened by tapping a nameplate.
export function InspectPlayerModal({ game }: { game: ClientGame }) {
  const playerId = useStore((s) => s.inspectPlayerId)
  const close = () => useStore.getState().setInspectPlayer(null)
  const player = game.players.find((p) => p.id === playerId)
  if (!player) return null
  const zoom = (c: Card) => useStore.getState().setInspectCard(c)
  const bankTotal = player.bank.reduce((s, c) => s + c.value, 0)
  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>
          {player.isBot ? '🤖 ' : ''}
          {player.name}
          {player.id === game.youId ? ' (you)' : ''}
        </h3>
        <p className="muted">
          {player.handCount} card{player.handCount === 1 ? '' : 's'} in hand · {bankTotal}M banked
        </p>
        {player.piles.length === 0 && <p className="muted">No properties on the table yet.</p>}
        {player.piles.map((pile) => (
          <div key={pile.id} className="pile-group">
            <div className="pile-head">
              <span className="chip-color" style={{ background: COLOR_INFO[pile.color].hex }} />
              {COLOR_INFO[pile.color].label} · {pilePropertyCount(pile)}/{COLOR_INFO[pile.color].setSize}
              {isPileComplete(pile) && ' ✓ complete'}
            </div>
            <div className="thumb-row">
              {pile.cards.map((c) => (
                <img key={c.id} src={getCardImageURL(c)} alt={cardLabel(c)} onClick={() => zoom(c)} />
              ))}
            </div>
          </div>
        ))}
        {player.bank.length > 0 && (
          <div className="pile-group">
            <div className="pile-head">🏦 Bank · {bankTotal}M</div>
            <div className="thumb-row">
              {player.bank.map((c) => (
                <img key={c.id} src={getCardImageURL(c)} alt={cardLabel(c)} onClick={() => zoom(c)} />
              ))}
            </div>
          </div>
        )}
        <button className="ghost-btn" onClick={close}>
          Close
        </button>
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
