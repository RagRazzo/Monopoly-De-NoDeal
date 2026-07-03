import { ACTION_INFO, cardLabel } from '../../shared/src/cards.ts'
import type { ClientGame, ClientPending, Game } from '../../shared/src/types.ts'

function describePending(game: Game): ClientPending | null {
  const pending = game.pending
  if (!pending) return null
  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? '?'

  if (pending.kind === 'discard') {
    return {
      kind: 'discard',
      action: 'discard',
      awaitingId: pending.playerId,
      mustDiscard: pending.mustDiscard,
      description: `${name(pending.playerId)} must discard ${pending.mustDiscard} card(s)`,
    }
  }

  const d = pending.demand
  const t = d.targets[d.index]
  const actionLabel = d.action === 'rent' ? 'Rent' : ACTION_INFO[d.action].label
  let description: string
  if (t.stage === 'pay') {
    description = `${name(t.playerId)} must pay ${name(d.attackerId)} ${d.amount}M (${actionLabel})`
  } else if (t.awaiting === d.attackerId) {
    description = `${name(t.playerId)} said No! ${name(d.attackerId)} may counter with Just Say No`
  } else {
    description = `${actionLabel} targets ${name(t.playerId)} — they may pay/accept or Just Say No`
  }
  let detail = ''
  if (d.targetCardId) {
    const target = game.players.find((p) => p.id === t.playerId)
    const card = target?.piles.flatMap((p) => p.cards).find((c) => c.id === d.targetCardId)
    if (card) detail = ` (${cardLabel(card)})`
  }
  return {
    kind: 'demand',
    action: d.action,
    attackerId: d.attackerId,
    targetId: t.playerId,
    awaitingId: t.awaiting,
    stage: t.stage,
    jsnDepth: t.jsnDepth,
    amount: d.amount,
    description: description + detail,
  }
}

export function redactFor(game: Game, playerId: string): ClientGame {
  const you = game.players.find((p) => p.id === playerId)
  return {
    code: game.code,
    phase: game.phase,
    youId: playerId,
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      connected: p.connected,
      left: p.left,
      isHost: p.id === game.hostId,
      handCount: p.hand.length,
      bank: p.bank,
      piles: p.piles,
    })),
    yourHand: you?.hand ?? [],
    deckCount: game.deck.length,
    discardTop: game.discard[game.discard.length - 1] ?? null,
    discardCount: game.discard.length,
    turnPlayerId: game.phase === 'playing' ? game.players[game.turnIndex]?.id ?? null : null,
    playsLeft: game.playsLeft,
    pending: describePending(game),
    winnerId: game.winnerId,
    log: game.log.slice(-60),
  }
}
