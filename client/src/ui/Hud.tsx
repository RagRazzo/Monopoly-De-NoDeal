import { useEffect, useRef, useState } from 'react'
import type { ClientGame } from '@shared/types'
import { leaveRoom, send } from '../net'
import { useStore } from '../store'
import { actionsForCard, moveWildFlow } from './actions'
import {
  DiscardModal,
  InspectCardModal,
  InspectPlayerModal,
  JsnModal,
  PaymentModal,
  PromptModal,
} from './Modals'

// Live countdown against a server-side deadline, corrected for the skew
// between the server clock and this device's clock.
function useCountdown(deadline: number | null, serverNow: number): number | null {
  const [remaining, setRemaining] = useState<number | null>(null)
  useEffect(() => {
    if (!deadline) {
      setRemaining(null)
      return
    }
    const skew = serverNow - Date.now()
    const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - (Date.now() + skew)) / 1000)))
    tick()
    const id = setInterval(tick, 500)
    return () => clearInterval(id)
  }, [deadline, serverNow])
  return remaining
}

function TimerPill({ deadline, serverNow }: { deadline: number | null; serverNow: number }) {
  const seconds = useCountdown(deadline, serverNow)
  if (seconds === null) return null
  return <span className={`timer-pill ${seconds <= 15 ? 'low' : ''}`}>⏱ {seconds}s</span>
}

// Reorder / zoom controls for the selected hand card — available on anyone's
// turn, since arranging and reading your hand is always allowed.
function CardTools({ game }: { game: ClientGame }) {
  const selectedCardId = useStore((s) => s.selectedCardId)
  const card = game.yourHand.find((c) => c.id === selectedCardId)
  if (!card) return null
  const { moveCard, setInspectCard } = useStore.getState()
  return (
    <div className="card-tools">
      <button className="option-btn small" onClick={() => moveCard(card.id, -1)} title="Move left in hand">
        ◀
      </button>
      <button className="option-btn small" onClick={() => setInspectCard(card)}>
        🔍 View card
      </button>
      <button className="option-btn small" onClick={() => moveCard(card.id, 1)} title="Move right in hand">
        ▶
      </button>
    </div>
  )
}

function LogPanel({ game, open }: { game: ClientGame; open: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight })
  }, [game.log.length])
  return (
    <div className={`log-panel ${open ? 'open' : ''}`} ref={ref}>
      {game.log.map((line, i) => (
        <div key={i} className="log-line">
          {line}
        </div>
      ))}
    </div>
  )
}

function ActionBar({ game }: { game: ClientGame }) {
  const selectedCardId = useStore((s) => s.selectedCardId)
  const myTurn = game.turnPlayerId === game.youId && !game.pending
  const card = game.yourHand.find((c) => c.id === selectedCardId)

  if (!myTurn) return null
  const me = game.players.find((p) => p.id === game.youId)!
  const hasTableWilds = me.piles.some((p) => p.cards.some((c) => c.kind === 'wild'))

  return (
    <div className="action-bar">
      {card && game.playsLeft > 0 ? (
        <>
          {actionsForCard(game, card).map((a, i) => (
            <button key={i} className={a.primary ? 'primary-btn' : 'option-btn'} onClick={a.onClick}>
              {a.label}
            </button>
          ))}
          {(card.kind === 'property' || card.kind === 'wild') && (
            <span className="muted bank-hint">
              Properties can't be banked — their value counts when you pay opponents
            </span>
          )}
        </>
      ) : (
        <span className="muted">
          {game.playsLeft > 0 ? 'Pick a card from your hand, or end your turn' : 'No plays left — end your turn'}
        </span>
      )}
      {hasTableWilds && game.playsLeft > 0 && (
        <button className="option-btn" onClick={() => moveWildFlow(game)}>
          Move a wildcard
        </button>
      )}
      <button className="end-turn-btn" onClick={() => send('endTurn')}>
        End turn
      </button>
    </div>
  )
}

function PendingBanner({ game }: { game: ClientGame }) {
  const pending = game.pending
  if (!pending) return null
  const awaiting = game.players.find((p) => p.id === pending.awaitingId)
  const isHost = game.players.find((p) => p.id === game.youId)?.isHost
  const awaitingOffline = awaiting && !awaiting.connected
  return (
    <div className="pending-banner">
      ⏳ {pending.description}
      <TimerPill deadline={game.responseDeadline} serverNow={game.now} />
      {awaitingOffline && isHost && (
        <button className="option-btn small" onClick={() => send('forceResolve')}>
          Resolve for {awaiting.name} (offline)
        </button>
      )}
    </div>
  )
}

function WinnerOverlay({ game }: { game: ClientGame }) {
  if (game.phase !== 'finished') return null
  const winner = game.players.find((p) => p.id === game.winnerId)
  return (
    <div className="modal-backdrop">
      <div className="modal winner">
        <h2>🏆 {winner?.name ?? 'Someone'} wins!</h2>
        <p className="muted">Three complete sets — game over.</p>
        <button className="primary-btn" onClick={leaveRoom}>
          Back to home
        </button>
      </div>
    </div>
  )
}

export function Hud({ game }: { game: ClientGame }) {
  const error = useStore((s) => s.error)
  const connected = useStore((s) => s.connected)
  const [logOpen, setLogOpen] = useState(false)
  const turnPlayer = game.players.find((p) => p.id === game.turnPlayerId)
  const myTurn = game.turnPlayerId === game.youId

  return (
    <div className="hud">
      <div className="top-bar">
        <span className="room-code">Room {game.code}</span>
        <span className={`turn-label ${myTurn ? 'my-turn' : ''}`}>
          {myTurn ? `Your turn — ${game.playsLeft} play${game.playsLeft === 1 ? '' : 's'} left` : `${turnPlayer?.name ?? '…'}'s turn`}
        </span>
        {!game.pending && <TimerPill deadline={game.turnDeadline} serverNow={game.now} />}
        <span className="counts">
          Deck {game.deckCount} · Discard {game.discardCount}
        </span>
        <button className="ghost-btn small log-toggle" onClick={() => setLogOpen((v) => !v)}>
          {logOpen ? 'Hide log' : 'Log'}
        </button>
        <button className="ghost-btn small" onClick={leaveRoom}>
          Leave
        </button>
      </div>
      {!connected && <div className="pending-banner offline">Reconnecting…</div>}
      <PendingBanner game={game} />
      <LogPanel game={game} open={logOpen} />
      <div className="bottom-stack">
        <CardTools game={game} />
        <ActionBar game={game} />
      </div>
      {error && <div className="toast">{error}</div>}
      <PromptModal />
      <PaymentModal game={game} />
      <JsnModal game={game} />
      <DiscardModal game={game} />
      <InspectPlayerModal game={game} />
      <InspectCardModal />
      <WinnerOverlay game={game} />
    </div>
  )
}
