// Rule-based CPU opponent. No randomness in decisions, no lookahead search —
// a fixed priority strategy that reacts to the public game state and to
// opponents' plays (Just Say No threat scoring, minimal-loss payments,
// set-completion-first building, target-the-richest attacks).
//
// The bot only reads its own hand plus public zones (banks, table piles,
// pile counts) — it never peeks at opponents' hands or the deck order.
import { COLOR_INFO, type Card, type Color } from '../../shared/src/cards.ts'
import {
  isPileComplete,
  isPropertyCard,
  payableCards,
  pileHas,
  pilePropertyCount,
  pileRent,
  playerWorth,
} from '../../shared/src/logic.ts'
import {
  PLAYS_PER_TURN,
  RESPONSE_SECONDS,
  TURN_SECONDS,
  type Game,
  type Pile,
  type Player,
} from '../../shared/src/types.ts'
import * as engine from './engine.ts'

const ok = (err: string | null) => err === null

// Which bot (if any) must act right now — the current player on a normal
// turn, or whoever a pending interaction is waiting on.
export function botToAct(game: Game): string | null {
  if (game.phase !== 'playing') return null
  if (game.pending) {
    const awaitingId =
      game.pending.kind === 'discard'
        ? game.pending.playerId
        : game.pending.demand.targets[game.pending.demand.index]?.awaiting
    const p = game.players.find((pl) => pl.id === awaitingId)
    return p?.bot && !p.left ? p.id : null
  }
  const cur = game.players[game.turnIndex]
  return cur?.bot && !cur.left ? cur.id : null
}

// Perform exactly ONE engine action (a play, a response, or ending the
// turn), so human players watch the bot act step by step.
export function botAct(game: Game, botId: string) {
  const bot = game.players.find((p) => p.id === botId)
  if (!bot) return
  if (game.pending) {
    respondPendingFor(game, bot)
    return
  }
  if (game.playsLeft > 0 && tryBestPlay(game, bot)) return
  engine.endTurn(game, botId)
}

// ---- Helpers ----

function opponents(game: Game, bot: Player): Player[] {
  return game.players.filter((p) => p.id !== bot.id && !p.left)
}

function richest(game: Game, bot: Player): Player | null {
  const opps = opponents(game, bot)
  if (opps.length === 0) return null
  return opps.reduce((a, b) => (playerWorth(b) > playerWorth(a) ? b : a))
}

function colorCount(player: Player, color: Color): number {
  return player.piles
    .filter((p) => p.color === color)
    .reduce((s, p) => s + pilePropertyCount(p), 0)
}

// A pile of this color that needs exactly one more property card.
function needsOneMore(player: Player, color: Color): Pile | null {
  return (
    player.piles.find(
      (p) => p.color === color && !isPileComplete(p) && pilePropertyCount(p) === COLOR_INFO[color].setSize - 1,
    ) ?? null
  )
}

function hasJsn(player: Player): boolean {
  return player.hand.some((c) => c.kind === 'action' && c.action === 'justsayno')
}

// ---- Pending responses ----

// Resolves the pending interaction on behalf of `bot` (also used as the CPU
// stand-in when a human times out or disconnects mid-prompt).
export function respondPendingFor(game: Game, bot: Player) {
  const pending = game.pending!

  if (pending.kind === 'discard') {
    const sorted = [...bot.hand].sort((a, b) => keepScore(a) - keepScore(b))
    const ids = sorted.slice(0, pending.mustDiscard).map((c) => c.id)
    if (!ok(engine.discardCards(game, bot.id, ids))) {
      engine.discardCards(game, bot.id, bot.hand.slice(0, pending.mustDiscard).map((c) => c.id))
    }
    return
  }

  const demand = pending.demand
  const target = demand.targets[demand.index]

  if (target.stage === 'jsn') {
    const iAmAttacker = bot.id === demand.attackerId
    const use = hasJsn(bot) && threatScore(game, bot, iAmAttacker) >= 5
    engine.respondJsn(game, bot.id, use)
    return
  }

  // Payment due from the bot.
  const ids = pickPayment(game, bot, demand.amount ?? 0)
  if (!ok(engine.submitPayment(game, bot.id, ids))) {
    // Safety net: hand over everything (always satisfies "all you have").
    engine.submitPayment(game, bot.id, payableCards(bot).map((c) => c.id))
  }
}

// How bad is the pending demand for the bot (as target), or how much is at
// stake for the bot's own attack (as attacker deciding to counter a No)?
function threatScore(game: Game, bot: Player, iAmAttacker: boolean): number {
  const demand = (game.pending as Extract<NonNullable<Game['pending']>, { kind: 'demand' }>).demand
  if (demand.action === 'dealbreaker') return 10
  if (demand.amount !== undefined) {
    const victim = iAmAttacker
      ? game.players.find((p) => p.id === demand.targets[demand.index].playerId)
      : bot
    return Math.min(demand.amount, victim ? playerWorth(victim) : demand.amount)
  }
  // Sly/forced deal: value of the contested card, boosted when it sits in a
  // pile that is one card away from completion.
  const victim = game.players.find((p) => p.id === demand.targets[demand.index].playerId)
  const pile = victim?.piles.find((p) => p.cards.some((c) => c.id === demand.targetCardId))
  const card = pile?.cards.find((c) => c.id === demand.targetCardId)
  if (!pile || !card) return 0
  const nearComplete = pilePropertyCount(pile) >= COLOR_INFO[pile.color].setSize - 1
  return card.value + (nearComplete ? 4 : 0)
}

// Lower = discarded first when over the hand limit.
function keepScore(card: Card): number {
  if (card.kind === 'property' || card.kind === 'wild') return 60 + card.value
  if (card.kind === 'money') return card.value * 3
  if (card.kind === 'rent') return 40 + card.value
  switch (card.action) {
    case 'justsayno':
      return 100
    case 'dealbreaker':
      return 55
    case 'passgo':
      return 38
    case 'slydeal':
    case 'forceddeal':
      return 35
    case 'debtcollector':
      return 30
    case 'birthday':
      return 28
    case 'house':
    case 'hotel':
      return 26
    case 'doublerent':
      return 24
  }
}

// Pick payment cards: bank money first with minimal overpay, then the least
// damaging table cards (never from complete sets unless nothing else left).
function pickPayment(game: Game, bot: Player, amount: number): string[] {
  const due = Math.min(amount, playerWorth(bot))
  const picked: string[] = []
  let remaining = due

  const bank = [...bot.bank].sort((a, b) => b.value - a.value)
  for (const c of bank) {
    if (remaining <= 0) break
    if (c.value <= remaining) {
      picked.push(c.id)
      remaining -= c.value
    }
  }
  if (remaining > 0) {
    // Top up with the smallest remaining bank card (small overpay beats
    // giving away a property).
    const topUp = bank.filter((c) => !picked.includes(c.id)).sort((a, b) => a.value - b.value)[0]
    if (topUp) {
      picked.push(topUp.id)
      remaining = 0
    }
  }
  if (remaining > 0) {
    const table: { card: Card; score: number }[] = []
    for (const pile of bot.piles) {
      for (const card of pile.cards) {
        let score = card.value
        if (isPileComplete(pile)) score += 100
        if (card.kind === 'action') score += 50 // buildings
        if (card.kind === 'wild') score += 5
        if (pilePropertyCount(pile) >= COLOR_INFO[pile.color].setSize - 1) score += 20
        table.push({ card, score })
      }
    }
    table.sort((a, b) => a.score - b.score)
    for (const { card } of table) {
      if (remaining <= 0) break
      picked.push(card.id)
      remaining -= card.value
    }
  }
  return picked
}

// ---- Turn strategy ----

function tryBestPlay(game: Game, bot: Player): boolean {
  return (
    tryPassGo(game, bot) ||
    tryBuilding(game, bot) ||
    tryProperty(game, bot) ||
    tryMoveWild(game, bot) ||
    tryDealBreaker(game, bot) ||
    trySteal(game, bot) ||
    tryRent(game, bot) ||
    tryDebtCollector(game, bot) ||
    tryBirthday(game, bot) ||
    tryBankMoney(game, bot) ||
    tryBankSurplus(game, bot)
  )
}

function tryPassGo(game: Game, bot: Player): boolean {
  const card = bot.hand.find((c) => c.kind === 'action' && c.action === 'passgo')
  return !!card && ok(engine.playAction(game, bot.id, card.id, {}))
}

function tryBuilding(game: Game, bot: Player): boolean {
  for (const action of ['house', 'hotel'] as const) {
    const card = bot.hand.find((c) => c.kind === 'action' && c.action === action)
    if (!card) continue
    const pile = bot.piles.find(
      (p) =>
        isPileComplete(p) &&
        COLOR_INFO[p.color].buildable &&
        (action === 'house' ? !pileHas(p, 'house') : pileHas(p, 'house') && !pileHas(p, 'hotel')),
    )
    if (pile && ok(engine.playAction(game, bot.id, card.id, { pileId: pile.id }))) return true
  }
  return false
}

function tryProperty(game: Game, bot: Player): boolean {
  // Plain properties first, ordered by how close they get a set to done.
  const props = bot.hand
    .filter((c): c is Card & { kind: 'property' } => c.kind === 'property')
    .sort((a, b) => colorCount(bot, b.color) * 10 + b.value - (colorCount(bot, a.color) * 10 + a.value))
  for (const card of props) {
    if (ok(engine.playProperty(game, bot.id, card.id))) return true
  }
  // Dual-color wilds: pick the side with the most progress.
  for (const card of bot.hand) {
    if (card.kind !== 'wild' || card.colors === 'any') continue
    const [a, b] = card.colors
    const score = (c: Color) => {
      const pile = bot.piles.find((p) => p.color === c && !isPileComplete(p))
      return pile ? 10 + pilePropertyCount(pile) / COLOR_INFO[c].setSize : 3 - COLOR_INFO[c].setSize / 10
    }
    const color = score(a) >= score(b) ? a : b
    if (ok(engine.playProperty(game, bot.id, card.id, color))) return true
  }
  // Rainbow wilds need an existing incomplete pile — join the closest one.
  for (const card of bot.hand) {
    if (card.kind !== 'wild' || card.colors !== 'any') continue
    const pile = [...bot.piles]
      .filter((p) => !isPileComplete(p))
      .sort((x, y) => pilePropertyCount(y) / COLOR_INFO[y.color].setSize - pilePropertyCount(x) / COLOR_INFO[x.color].setSize)[0]
    if (pile && ok(engine.playProperty(game, bot.id, card.id, undefined, pile.id))) return true
  }
  return false
}

// Move a table wildcard when doing so completes another set.
function tryMoveWild(game: Game, bot: Player): boolean {
  for (const from of bot.piles) {
    if (isPileComplete(from)) continue
    for (const wild of from.cards) {
      if (wild.kind !== 'wild') continue
      for (const to of bot.piles) {
        if (to.id === from.id || isPileComplete(to)) continue
        if (pilePropertyCount(to) !== COLOR_INFO[to.color].setSize - 1) continue
        const fits = wild.colors === 'any' || wild.colors.includes(to.color)
        if (fits && ok(engine.moveWild(game, bot.id, wild.id, to.color, to.id))) return true
      }
    }
  }
  return false
}

function tryDealBreaker(game: Game, bot: Player): boolean {
  const card = bot.hand.find((c) => c.kind === 'action' && c.action === 'dealbreaker')
  if (!card) return false
  let best: { playerId: string; pile: Pile; rent: number } | null = null
  for (const opp of opponents(game, bot)) {
    for (const pile of opp.piles) {
      if (!isPileComplete(pile)) continue
      const rent = pileRent(pile)
      if (!best || rent > best.rent) best = { playerId: opp.id, pile, rent }
    }
  }
  return !!best && ok(engine.playAction(game, bot.id, card.id, { targetPlayerId: best.playerId, targetPileId: best.pile.id }))
}

function trySteal(game: Game, bot: Player): boolean {
  const sly = bot.hand.find((c) => c.kind === 'action' && c.action === 'slydeal')
  const forced = bot.hand.find((c) => c.kind === 'action' && c.action === 'forceddeal')
  if (!sly && !forced) return false

  // Score every stealable opponent card; completing one of our sets wins.
  let best: { playerId: string; card: Card; score: number } | null = null
  for (const opp of opponents(game, bot)) {
    for (const pile of opp.piles) {
      if (isPileComplete(pile)) continue
      for (const card of pile.cards) {
        if (!isPropertyCard(card)) continue
        const completes = !!needsOneMore(bot, pile.color)
        const score = card.value + (completes ? 10 : 0)
        if (!best || score > best.score) best = { playerId: opp.id, card, score }
      }
    }
  }
  if (!best) return false

  if (sly && best.score >= 3) {
    if (ok(engine.playAction(game, bot.id, sly.id, { targetPlayerId: best.playerId, targetCardId: best.card.id })))
      return true
  }
  // Forced deal only when the take completes a set; give away the least
  // useful property (loneliest, cheapest, not from a near-complete pile).
  if (forced && best.score >= 10) {
    const give = bot.piles
      .filter((p) => !isPileComplete(p))
      .flatMap((p) => p.cards.filter(isPropertyCard).map((card) => ({ card, pile: p })))
      .sort(
        (a, b) =>
          pilePropertyCount(a.pile) * 10 + a.card.value - (pilePropertyCount(b.pile) * 10 + b.card.value),
      )[0]
    if (
      give &&
      ok(
        engine.playAction(game, bot.id, forced.id, {
          targetPlayerId: best.playerId,
          targetCardId: best.card.id,
          myCardId: give.card.id,
        }),
      )
    )
      return true
  }
  return false
}

function tryRent(game: Game, bot: Player): boolean {
  let best: { card: Card; color: Color; amount: number } | null = null
  for (const card of bot.hand) {
    if (card.kind !== 'rent') continue
    const colors = card.colors === 'any' ? bot.piles.map((p) => p.color) : card.colors
    for (const color of new Set(colors)) {
      const piles = bot.piles.filter((p) => p.color === color)
      if (piles.length === 0) continue
      const amount = Math.max(...piles.map(pileRent))
      if (amount > 0 && (!best || amount > best.amount)) best = { card, color, amount }
    }
  }
  if (!best || best.amount < 2) return false

  const doubler = bot.hand.find((c) => c.kind === 'action' && c.action === 'doublerent')
  const useDoubler = !!doubler && game.playsLeft >= 2 && best.amount >= 3
  const opts: Parameters<typeof engine.playAction>[3] = {
    color: best.color,
    ...(useDoubler ? { doubleRentCardIds: [doubler.id] } : {}),
  }
  if (best.card.kind === 'rent' && best.card.colors === 'any') {
    const target = richest(game, bot)
    if (!target || playerWorth(target) === 0) return false
    opts.targetPlayerId = target.id
  }
  return ok(engine.playAction(game, bot.id, best.card.id, opts))
}

function tryDebtCollector(game: Game, bot: Player): boolean {
  const card = bot.hand.find((c) => c.kind === 'action' && c.action === 'debtcollector')
  if (!card) return false
  const target = richest(game, bot)
  if (!target || playerWorth(target) < 3) return false
  return ok(engine.playAction(game, bot.id, card.id, { targetPlayerId: target.id }))
}

function tryBirthday(game: Game, bot: Player): boolean {
  const card = bot.hand.find((c) => c.kind === 'action' && c.action === 'birthday')
  if (!card) return false
  const take = opponents(game, bot).reduce((s, o) => s + Math.min(2, playerWorth(o)), 0)
  if (take < 2) return false
  return ok(engine.playAction(game, bot.id, card.id, {}))
}

// Constructive, non-interactive plays only (no rent/steals/demands) — used
// when the CPU stands in for a timed-out human, so nobody gets attacked
// "by" an absent player and no new prompts are created.
export function tryBestSafePlay(game: Game, player: Player): boolean {
  if (
    tryPassGo(game, player) ||
    tryBuilding(game, player) ||
    tryProperty(game, player) ||
    tryMoveWild(game, player) ||
    tryBankMoney(game, player)
  )
    return true
  // Last resort: bank the least useful non-defensive card.
  const spare = player.hand
    .filter((c) => c.kind === 'rent' || (c.kind === 'action' && c.action !== 'justsayno'))
    .sort((a, b) => keepScore(a) - keepScore(b))[0]
  return !!spare && ok(engine.playMoney(game, player.id, spare.id))
}

function tryBankMoney(game: Game, bot: Player): boolean {
  const money = bot.hand
    .filter((c) => c.kind === 'money')
    .sort((a, b) => b.value - a.value)[0]
  return !!money && ok(engine.playMoney(game, bot.id, money.id))
}

// When the hand is crowded, bank action cards we are clearly not using
// (never Just Say No — that stays for defense).
function tryBankSurplus(game: Game, bot: Player): boolean {
  if (bot.hand.length <= 6) return false
  const surplus = bot.hand
    .filter((c) => c.kind === 'rent' || (c.kind === 'action' && c.action !== 'justsayno'))
    .sort((a, b) => keepScore(a) - keepScore(b))[0]
  return !!surplus && ok(engine.playMoney(game, bot.id, surplus.id))
}

// ---- Turn / response timeouts ----
//
// Called every second per room. Returns true when it changed the game (the
// caller should re-broadcast).
//
// Rules:
// - A human turn lasts TURN_SECONDS. On expiry: if they made zero plays the
//   CPU makes one safe play for them, then the turn ends either way; any
//   over-limit hand is auto-discarded (least valuable first).
// - A pending prompt (payment / Just Say No / discard) aimed at a human is
//   answered by the CPU after RESPONSE_SECONDS, so a stalled response can
//   never freeze the table.
// - While a prompt is open, the turn clock is paused: the wait is credited
//   back to the current player when the prompt resolves.

function pendingKeyOf(game: Game): string {
  const p = game.pending!
  if (p.kind === 'discard') return `d:${p.playerId}:${p.mustDiscard}`
  const d = p.demand
  const t = d.targets[d.index]
  return `q:${d.action}:${d.index}:${t?.playerId}:${t?.stage}:${t?.awaiting}:${t?.jsnDepth}`
}

export function sweepTimeouts(game: Game, now = Date.now()): boolean {
  if (game.phase !== 'playing') return false
  // Nobody watching: leave the game frozen (same rule as the CPU scheduler).
  if (!game.players.some((p) => !p.bot && !p.left && p.connected)) return false

  if (game.pending) {
    const key = pendingKeyOf(game)
    if (game.pendingKey !== key) {
      // New prompt (or the awaited responder changed): start its clock and
      // broadcast so clients pick up the response deadline.
      game.pendingKey = key
      game.pendingSince = now
      return true
    }
    const awaitingId =
      game.pending.kind === 'discard'
        ? game.pending.playerId
        : game.pending.demand.targets[game.pending.demand.index]?.awaiting
    const awaiting = game.players.find((p) => p.id === awaitingId)
    if (!awaiting || awaiting.bot) return false
    if (now - (game.pendingSince ?? now) < RESPONSE_SECONDS * 1000) return false
    game.log.push(`⏱️ ${awaiting.name} took too long — CPU responded for them`)
    game.logSeq++
    respondPendingFor(game, awaiting)
    game.updatedAt = now
    return true
  }

  if (game.pendingKey) {
    // A prompt just resolved: credit the wait back to the turn clock.
    if (game.pendingSince) game.turnStartedAt += now - game.pendingSince
    game.pendingKey = undefined
    game.pendingSince = undefined
    return true
  }

  const cur = game.players[game.turnIndex]
  if (!cur || cur.bot || cur.left) return false
  if (now - game.turnStartedAt < TURN_SECONDS * 1000) return false

  const played = game.playsLeft < PLAYS_PER_TURN
  if (!played && tryBestSafePlay(game, cur)) {
    game.log.push(`⏱️ ${cur.name} timed out — CPU made a play for them`)
    game.logSeq++
  }
  if (game.phase === 'playing') {
    game.log.push(`⏱️ ${cur.name}'s turn ended automatically`)
    game.logSeq++
    engine.endTurn(game, cur.id)
    // endTurn may have created a discard prompt (TS can't see the mutation
    // through the call): the CPU discards their least valuable cards.
    const afterEnd = game.pending as Game['pending']
    if (afterEnd?.kind === 'discard' && afterEnd.playerId === cur.id) {
      respondPendingFor(game, cur)
    }
  }
  game.updatedAt = now
  return true
}
