import { ACTION_INFO, cardLabel } from '../../shared/src/cards.ts'
import {
  RESPONSE_SECONDS,
  TURN_SECONDS,
  type ClientGame,
  type ClientPending,
  type Game,
} from '../../shared/src/types.ts'

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
  const amount = t.amount ?? d.amount
  const actionLabel = d.action === 'rent' ? 'Rent' : ACTION_INFO[d.action].label
  let description: string
  if (d.action === 'gofundme') {
    description = `${name(t.playerId)} may gift ${name(d.attackerId)} bank cash (Go Fund Me)`
  } else if (t.stage === 'pay') {
    description = `${name(t.playerId)} must pay ${name(d.attackerId)} ${amount}M (${actionLabel})`
  } else if (t.awaiting === d.attackerId) {
    description = `${name(t.playerId)} said No! ${name(d.attackerId)} may counter with Just Say No`
  } else if (d.action === 'robbank') {
    description = `Rob A Bank hits ${name(t.playerId)} — hand over your bank or Just Say No`
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
    amount,
    description: description + detail,
  }
}

export function redactFor(game: Game, playerId: string): ClientGame {
  const you = game.players.find((p) => p.id === playerId)
  const current = game.phase === 'playing' ? game.players[game.turnIndex] : undefined

  let responseDeadline: number | null = null
  if (game.pending && game.pendingSince) {
    const awaitingId =
      game.pending.kind === 'discard'
        ? game.pending.playerId
        : game.pending.demand.targets[game.pending.demand.index]?.awaiting
    const awaiting = game.players.find((p) => p.id === awaitingId)
    if (awaiting && !awaiting.bot) responseDeadline = game.pendingSince + RESPONSE_SECONDS * 1000
  }

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
      isBot: p.bot,
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
    logSeq: game.logSeq,
    now: Date.now(),
    turnDeadline:
      current && !current.bot && game.turnStartedAt ? game.turnStartedAt + TURN_SECONDS * 1000 : null,
    responseDeadline,
  }
}
