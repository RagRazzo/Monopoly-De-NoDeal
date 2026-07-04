import crypto from 'node:crypto'
import {
  ACTION_INFO,
  COLOR_INFO,
  buildDeck,
  cardLabel,
  type ActionName,
  type Card,
  type Color,
} from '../../shared/src/cards.ts'
import {
  hasWon,
  isBuilding,
  isPileComplete,
  isPropertyCard,
  payableCards,
  pileHas,
  pileRent,
  playerWorth,
} from '../../shared/src/logic.ts'
import {
  HAND_LIMIT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYS_PER_TURN,
  type Demand,
  type Game,
  type Pile,
  type PlayActionOpts,
  type Player,
  type TargetState,
} from '../../shared/src/types.ts'

const rng = () => crypto.randomInt(2 ** 47) / 2 ** 47

function log(game: Game, msg: string) {
  game.log.push(msg)
  game.logSeq++
  if (game.log.length > 200) game.log.splice(0, game.log.length - 200)
  game.updatedAt = Date.now()
}

function findPlayer(game: Game, id: string): Player | undefined {
  return game.players.find((p) => p.id === id)
}

function activePlayers(game: Game): Player[] {
  return game.players.filter((p) => !p.left)
}

function currentPlayer(game: Game): Player {
  return game.players[game.turnIndex]
}

// ---- Lifecycle ----

export function createGame(code: string, hostName: string, hostId: string, token: string): Game {
  const game: Game = {
    code,
    hostId,
    phase: 'lobby',
    players: [],
    deck: [],
    discard: [],
    turnIndex: 0,
    playsLeft: 0,
    pending: null,
    winnerId: null,
    log: [],
    logSeq: 0,
    pileSeq: 0,
    updatedAt: Date.now(),
    turnStartedAt: 0,
    turnsPlayed: 0,
  }
  addPlayer(game, hostName, hostId, token)
  return game
}

export function addPlayer(game: Game, name: string, id: string, token: string): string | null {
  if (game.phase !== 'lobby') return 'Game already started'
  if (game.players.length >= MAX_PLAYERS) return `Room is full (max ${MAX_PLAYERS} players)`
  const clean = name.trim().slice(0, 16) || 'Player'
  game.players.push({
    id,
    token,
    name: clean,
    seat: game.players.length,
    connected: true,
    left: false,
    bot: false,
    hand: [],
    bank: [],
    piles: [],
  })
  log(game, `${clean} joined the room`)
  return null
}

export function addBot(game: Game): string | null {
  if (game.phase !== 'lobby') return 'Game already started'
  if (game.players.length >= MAX_PLAYERS) return `Room is full (max ${MAX_PLAYERS} players)`
  game.players.push({
    id: `bot-${game.players.length}`,
    token: crypto.randomUUID(),
    name: 'CPU',
    seat: game.players.length,
    connected: true,
    left: false,
    bot: true,
    hand: [],
    bank: [],
    piles: [],
  })
  log(game, '🤖 CPU joined the game')
  return null
}

// Host-only solo mode: adds a CPU opponent and starts immediately.
// Only allowed while the host is alone in the room.
export function startWithBot(game: Game, byId: string): string | null {
  if (game.phase !== 'lobby') return 'Game already started'
  if (byId !== game.hostId) return 'Only the host can start a CPU game'
  if (game.players.length !== 1) return 'CPU mode is only available while you are alone in the room'
  const err = addBot(game)
  if (err) return err
  return startGame(game, byId)
}

export function startGame(game: Game, byId: string): string | null {
  if (game.phase !== 'lobby') return 'Game already started'
  if (byId !== game.hostId) return 'Only the host can start the game'
  const n = game.players.length
  if (n < MIN_PLAYERS) return `Need at least ${MIN_PLAYERS} players`
  game.deck = buildDeck(n, rng)
  game.phase = 'playing'
  for (const p of game.players) p.hand = game.deck.splice(0, 5)
  game.turnIndex = crypto.randomInt(n)
  log(game, `Game started with ${n} players and a ${game.deck.length + 5 * n} card deck`)
  beginTurn(game)
  return null
}

function drawCards(game: Game, player: Player, count: number) {
  for (let i = 0; i < count; i++) {
    if (game.deck.length === 0) {
      if (game.discard.length === 0) break
      game.deck = game.discard.splice(0)
      // Fisher-Yates reshuffle of the spent discard pile
      for (let k = game.deck.length - 1; k > 0; k--) {
        const j = Math.floor(rng() * (k + 1))
        ;[game.deck[k], game.deck[j]] = [game.deck[j], game.deck[k]]
      }
      log(game, 'Discard pile reshuffled into the deck')
    }
    const card = game.deck.pop()
    if (card) player.hand.push(card)
  }
}

function beginTurn(game: Game) {
  // Skip players who left or are disconnected (up to a full loop).
  const n = game.players.length
  for (let i = 0; i < n; i++) {
    const p = game.players[game.turnIndex]
    if (!p.left && p.connected) break
    if (!p.left) log(game, `${p.name} is disconnected — turn skipped`)
    game.turnIndex = (game.turnIndex + 1) % n
  }
  const player = currentPlayer(game)
  game.playsLeft = PLAYS_PER_TURN
  game.turnStartedAt = Date.now()
  game.turnsPlayed++
  const count = player.hand.length === 0 ? 5 : 2
  drawCards(game, player, count)
  log(game, `${player.name}'s turn (drew ${count})`)
}

function nextTurn(game: Game) {
  game.turnIndex = (game.turnIndex + 1) % game.players.length
  beginTurn(game)
}

function checkWin(game: Game) {
  for (const p of activePlayers(game)) {
    if (hasWon(p)) {
      game.phase = 'finished'
      game.winnerId = p.id
      game.pending = null
      log(game, `🏆 ${p.name} wins with 3 complete sets!`)
      return
    }
  }
}

// ---- Guards ----

function turnGuard(game: Game, pid: string): string | null {
  if (game.phase !== 'playing') return 'Game is not in progress'
  if (game.pending) return 'Waiting for a pending action to resolve'
  if (currentPlayer(game).id !== pid) return 'Not your turn'
  return null
}

function takeFromHand(player: Player, cardId: string): Card | null {
  const i = player.hand.findIndex((c) => c.id === cardId)
  if (i === -1) return null
  return player.hand.splice(i, 1)[0]
}

// ---- Pile helpers ----

function newPile(game: Game, player: Player, color: Color): Pile {
  const pile: Pile = { id: `p${game.pileSeq++}`, color, cards: [] }
  player.piles.push(pile)
  return pile
}

function removeFromPiles(player: Player, cardId: string): { card: Card; pile: Pile } | null {
  for (const pile of player.piles) {
    const i = pile.cards.findIndex((c) => c.id === cardId)
    if (i !== -1) {
      const card = pile.cards.splice(i, 1)[0]
      if (pile.cards.length === 0) player.piles = player.piles.filter((p) => p !== pile)
      return { card, pile }
    }
  }
  return null
}

// Place a property/wild card into a player's pile of the given color,
// reusing an incomplete pile when possible.
function placeProperty(game: Game, player: Player, card: Card, color: Color) {
  let pile = player.piles.find((p) => p.color === color && !isPileComplete(p))
  if (!pile) pile = newPile(game, player, color)
  pile.cards.push(card)
}

// ---- Basic plays ----

export function playMoney(game: Game, pid: string, cardId: string): string | null {
  const err = turnGuard(game, pid)
  if (err) return err
  if (game.playsLeft < 1) return 'No plays left this turn'
  const player = currentPlayer(game)
  const card = player.hand.find((c) => c.id === cardId)
  if (!card) return 'Card not in your hand'
  if (card.kind === 'property' || card.kind === 'wild') return 'Properties cannot be banked'
  takeFromHand(player, cardId)
  player.bank.push(card)
  game.playsLeft--
  log(game, `${player.name} banked ${cardLabel(card)} (${card.value}M)`)
  return null
}

export function playProperty(
  game: Game,
  pid: string,
  cardId: string,
  color?: Color,
  pileId?: string,
): string | null {
  const err = turnGuard(game, pid)
  if (err) return err
  if (game.playsLeft < 1) return 'No plays left this turn'
  const player = currentPlayer(game)
  const card = player.hand.find((c) => c.id === cardId)
  if (!card) return 'Card not in your hand'
  if (!isPropertyCard(card)) return 'Not a property card'

  let target: Color
  if (card.kind === 'property') {
    target = card.color
  } else if (card.kind === 'wild' && card.colors !== 'any') {
    if (!color || !card.colors.includes(color)) return 'Pick one of the wildcard colors'
    target = color
  } else {
    // Rainbow wild: must join an existing pile that has a real property.
    const pile = player.piles.find((p) => p.id === pileId)
    if (!pile) return 'A rainbow wildcard must be added to an existing set'
    if (isPileComplete(pile)) return 'That set is already complete'
    takeFromHand(player, cardId)
    pile.cards.push(card)
    game.playsLeft--
    log(game, `${player.name} added a Rainbow Wildcard to their ${COLOR_INFO[pile.color].label} set`)
    checkWin(game)
    return null
  }

  takeFromHand(player, cardId)
  if (pileId) {
    const pile = player.piles.find((p) => p.id === pileId)
    if (pile && pile.color === target && !isPileComplete(pile)) pile.cards.push(card)
    else placeProperty(game, player, card, target)
  } else {
    placeProperty(game, player, card, target)
  }
  game.playsLeft--
  log(game, `${player.name} played ${cardLabel(card)} as ${COLOR_INFO[target].label}`)
  checkWin(game)
  return null
}

export function moveWild(
  game: Game,
  pid: string,
  cardId: string,
  toColor: Color,
  toPileId?: string,
): string | null {
  const err = turnGuard(game, pid)
  if (err) return err
  if (game.playsLeft < 1) return 'No plays left this turn'
  const player = currentPlayer(game)
  const found = removeFromPiles(player, cardId)
  if (!found) return 'Card is not on your table'
  const card = found.card
  const putBack = () => {
    let pile = player.piles.find((p) => p.id === found.pile.id)
    if (!pile) {
      pile = found.pile
      player.piles.push(pile)
    }
    pile.cards.push(card)
  }
  if (card.kind !== 'wild') {
    putBack()
    return 'Only wildcards can be moved'
  }
  if (card.colors !== 'any' && !card.colors.includes(toColor)) {
    putBack()
    return 'Wildcard cannot be that color'
  }
  if (card.colors === 'any') {
    const pile = player.piles.find((p) => p.id === toPileId)
    if (!pile || isPileComplete(pile)) {
      putBack()
      return 'A rainbow wildcard must join an existing incomplete set'
    }
    pile.cards.push(card)
  } else if (toPileId) {
    const pile = player.piles.find((p) => p.id === toPileId)
    if (!pile || pile.color !== toColor || isPileComplete(pile)) {
      putBack()
      return 'Invalid destination pile'
    }
    pile.cards.push(card)
  } else {
    placeProperty(game, player, card, toColor)
  }
  game.playsLeft--
  log(game, `${player.name} moved a wildcard to ${COLOR_INFO[toColor].label}`)
  checkWin(game)
  return null
}

// ---- Demands (rent / birthday / debt / steals) ----

function startDemand(game: Game, demand: Demand) {
  demand.index = -1
  game.pending = { kind: 'demand', demand }
  advanceDemand(game)
}

function initTarget(game: Game, demand: Demand): boolean {
  // Returns false if the target auto-resolves (nothing to take).
  const t = demand.targets[demand.index]
  const target = findPlayer(game, t.playerId)!
  if (target.left) return false
  if (demand.amount !== undefined && playerWorth(target) === 0) {
    log(game, `${target.name} has nothing to pay`)
    return false
  }
  t.stage = 'jsn'
  t.awaiting = t.playerId
  t.jsnDepth = 0
  return true
}

function advanceDemand(game: Game) {
  const pending = game.pending
  if (!pending || pending.kind !== 'demand') return
  const demand = pending.demand
  while (true) {
    demand.index++
    if (demand.index >= demand.targets.length) {
      game.pending = null
      checkWin(game)
      return
    }
    if (initTarget(game, demand)) return
  }
}

function currentTarget(demand: Demand): TargetState {
  return demand.targets[demand.index]
}

function makeTargets(playerIds: string[]): TargetState[] {
  return playerIds.map((playerId) => ({ playerId, stage: 'jsn' as const, awaiting: playerId, jsnDepth: 0 }))
}

function executeSteal(game: Game, demand: Demand) {
  const attacker = findPlayer(game, demand.attackerId)!
  const target = findPlayer(game, currentTarget(demand).playerId)!
  if (demand.action === 'dealbreaker') {
    const i = target.piles.findIndex((p) => p.id === demand.targetPileId)
    if (i === -1) return
    const pile = target.piles.splice(i, 1)[0]
    attacker.piles.push(pile)
    log(game, `${attacker.name} deal-broke ${target.name}'s ${COLOR_INFO[pile.color].label} set!`)
  } else if (demand.action === 'slydeal') {
    const found = removeFromPiles(target, demand.targetCardId!)
    if (!found) return
    placeProperty(game, attacker, found.card, found.pile.color)
    log(game, `${attacker.name} sly-dealt ${cardLabel(found.card)} from ${target.name}`)
  } else if (demand.action === 'forceddeal') {
    const theirs = removeFromPiles(target, demand.targetCardId!)
    const mine = removeFromPiles(attacker, demand.myCardId!)
    if (theirs) placeProperty(game, attacker, theirs.card, theirs.pile.color)
    if (mine) placeProperty(game, target, mine.card, mine.pile.color)
    log(game, `${attacker.name} forced a deal with ${target.name}`)
  }
}

export function respondJsn(game: Game, pid: string, useJsn: boolean): string | null {
  const pending = game.pending
  if (!pending || pending.kind !== 'demand') return 'Nothing to respond to'
  const demand = pending.demand
  const t = currentTarget(demand)
  if (t.stage !== 'jsn') return 'Not awaiting a Just Say No decision'
  if (t.awaiting !== pid) return 'Not your decision'
  const responder = findPlayer(game, pid)!

  if (useJsn) {
    const jsn = responder.hand.find((c) => c.kind === 'action' && c.action === 'justsayno')
    if (!jsn) return "You don't have a Just Say No card"
    takeFromHand(responder, jsn.id)
    game.discard.push(jsn)
    t.jsnDepth++
    t.awaiting = t.awaiting === t.playerId ? demand.attackerId : t.playerId
    log(game, `${responder.name} played Just Say No!`)
    return null
  }

  if (pid === demand.attackerId) {
    // Attacker declines to counter: this target is off the hook.
    log(game, `${findPlayer(game, t.playerId)!.name} blocked the ${ACTION_INFO[demand.action as ActionName]?.label ?? 'rent'}`)
    advanceDemand(game)
    return null
  }

  // Target accepts the action.
  if (demand.amount !== undefined) {
    t.stage = 'pay'
    t.awaiting = t.playerId
    return null
  }
  executeSteal(game, demand)
  advanceDemand(game)
  return null
}

export function submitPayment(game: Game, pid: string, cardIds: string[]): string | null {
  const pending = game.pending
  if (!pending || pending.kind !== 'demand') return 'No payment due'
  const demand = pending.demand
  const t = currentTarget(demand)
  if (t.stage !== 'pay' || t.playerId !== pid) return 'No payment due from you'
  const payer = findPlayer(game, pid)!
  const attacker = findPlayer(game, demand.attackerId)!
  const amount = demand.amount!

  const pool = payableCards(payer)
  const chosen: Card[] = []
  for (const id of new Set(cardIds)) {
    const card = pool.find((c) => c.id === id)
    if (!card) return 'Invalid payment card'
    chosen.push(card)
  }
  const total = chosen.reduce((s, c) => s + c.value, 0)
  const due = Math.min(amount, playerWorth(payer))
  if (total < due) return `Payment must be at least ${due}M (no change is given)`

  transferPayment(game, payer, attacker, chosen)
  log(game, `${payer.name} paid ${attacker.name} ${total}M`)
  advanceDemand(game)
  return null
}

function transferPayment(game: Game, from: Player, to: Player, cards: Card[]) {
  for (const card of cards) {
    const bi = from.bank.findIndex((c) => c.id === card.id)
    if (bi !== -1) {
      from.bank.splice(bi, 1)
      to.bank.push(card)
      continue
    }
    const found = removeFromPiles(from, card.id)
    if (!found) continue
    if (isPropertyCard(card)) placeProperty(game, to, card, found.pile.color)
    else to.bank.push(card) // houses/hotels paid out become money
  }
}

// Greedy auto-payment for disconnected players: bank first (smallest up), then table cards.
function autoPickPayment(payer: Player, amount: number): string[] {
  const due = Math.min(amount, playerWorth(payer))
  const bank = [...payer.bank].sort((a, b) => a.value - b.value)
  const table: Card[] = []
  for (const pile of payer.piles) table.push(...pile.cards)
  table.sort((a, b) => a.value - b.value)
  const picked: string[] = []
  let total = 0
  for (const c of [...bank, ...table]) {
    if (total >= due) break
    picked.push(c.id)
    total += c.value
  }
  return picked
}

// Host can resolve a pending response owed by a disconnected player.
export function forceResolve(game: Game, byId: string): string | null {
  if (byId !== game.hostId) return 'Only the host can do that'
  const pending = game.pending
  if (!pending) return 'Nothing pending'
  if (pending.kind === 'discard') {
    const p = findPlayer(game, pending.playerId)!
    if (p.connected) return `${p.name} is still connected`
    const ids = p.hand.slice(0, pending.mustDiscard).map((c) => c.id)
    return discardCards(game, p.id, ids)
  }
  const demand = pending.demand
  const t = currentTarget(demand)
  const awaiting = findPlayer(game, t.awaiting)!
  if (awaiting.connected) return `${awaiting.name} is still connected`
  if (t.stage === 'jsn') return respondJsn(game, awaiting.id, false)
  return submitPayment(game, awaiting.id, autoPickPayment(awaiting, demand.amount!))
}

// ---- Action cards ----

export function playAction(game: Game, pid: string, cardId: string, opts: PlayActionOpts): string | null {
  const err = turnGuard(game, pid)
  if (err) return err
  if (game.playsLeft < 1) return 'No plays left this turn'
  const player = currentPlayer(game)
  const card = player.hand.find((c) => c.id === cardId)
  if (!card) return 'Card not in your hand'

  if (card.kind === 'rent') return playRent(game, player, card, opts)
  if (card.kind !== 'action') return 'Not an action card'

  switch (card.action) {
    case 'passgo': {
      takeFromHand(player, cardId)
      game.discard.push(card)
      game.playsLeft--
      drawCards(game, player, 2)
      log(game, `${player.name} played Pass Go and drew 2`)
      return null
    }
    case 'house':
    case 'hotel': {
      const pile = player.piles.find((p) => p.id === opts.pileId)
      if (!pile) return 'Pick one of your sets'
      if (!COLOR_INFO[pile.color].buildable) return 'Cannot build on rail or utility sets'
      if (!isPileComplete(pile)) return 'The set must be complete first'
      if (card.action === 'house' && pileHas(pile, 'house')) return 'That set already has a house'
      if (card.action === 'hotel' && !pileHas(pile, 'house')) return 'Build a house there first'
      if (card.action === 'hotel' && pileHas(pile, 'hotel')) return 'That set already has a hotel'
      takeFromHand(player, cardId)
      pile.cards.push(card)
      game.playsLeft--
      log(game, `${player.name} built a ${card.action} on ${COLOR_INFO[pile.color].label}`)
      return null
    }
    case 'birthday': {
      const targets = activePlayers(game).filter((p) => p.id !== pid).map((p) => p.id)
      if (targets.length === 0) return 'No one to charge'
      takeFromHand(player, cardId)
      game.discard.push(card)
      game.playsLeft--
      log(game, `${player.name} played It's My Birthday — everyone owes 2M`)
      startDemand(game, { action: 'birthday', attackerId: pid, targets: makeTargets(targets), index: 0, amount: 2 })
      return null
    }
    case 'debtcollector': {
      const target = findPlayer(game, opts.targetPlayerId ?? '')
      if (!target || target.id === pid || target.left) return 'Pick a player to charge'
      takeFromHand(player, cardId)
      game.discard.push(card)
      game.playsLeft--
      log(game, `${player.name} played Debt Collector on ${target.name} (5M)`)
      startDemand(game, { action: 'debtcollector', attackerId: pid, targets: makeTargets([target.id]), index: 0, amount: 5 })
      return null
    }
    case 'slydeal':
    case 'forceddeal': {
      const target = findPlayer(game, opts.targetPlayerId ?? '')
      if (!target || target.id === pid || target.left) return 'Pick a player'
      const theirPile = target.piles.find((p) => p.cards.some((c) => c.id === opts.targetCardId))
      const theirCard = theirPile?.cards.find((c) => c.id === opts.targetCardId)
      if (!theirPile || !theirCard) return 'Pick a property to take'
      if (isPileComplete(theirPile)) return 'Cannot take from a complete set'
      if (!isPropertyCard(theirCard)) return 'Only property cards can be taken'
      let myCardId: string | undefined
      if (card.action === 'forceddeal') {
        const myPile = player.piles.find((p) => p.cards.some((c) => c.id === opts.myCardId))
        const myCard = myPile?.cards.find((c) => c.id === opts.myCardId)
        if (!myPile || !myCard || !isPropertyCard(myCard)) return 'Pick one of your properties to give'
        if (isPileComplete(myPile)) return 'Cannot trade from a complete set'
        myCardId = myCard.id
      }
      takeFromHand(player, cardId)
      game.discard.push(card)
      game.playsLeft--
      log(game, `${player.name} played ${ACTION_INFO[card.action].label} on ${target.name}`)
      startDemand(game, {
        action: card.action,
        attackerId: pid,
        targets: makeTargets([target.id]),
        index: 0,
        targetCardId: theirCard.id,
        myCardId,
      })
      return null
    }
    case 'dealbreaker': {
      const target = findPlayer(game, opts.targetPlayerId ?? '')
      if (!target || target.id === pid || target.left) return 'Pick a player'
      const pile = target.piles.find((p) => p.id === opts.targetPileId)
      if (!pile || !isPileComplete(pile)) return 'Pick a complete set to steal'
      takeFromHand(player, cardId)
      game.discard.push(card)
      game.playsLeft--
      log(game, `${player.name} played Deal Breaker on ${target.name}'s ${COLOR_INFO[pile.color].label} set`)
      startDemand(game, {
        action: 'dealbreaker',
        attackerId: pid,
        targets: makeTargets([target.id]),
        index: 0,
        targetPileId: pile.id,
      })
      return null
    }
    case 'justsayno':
      return 'Just Say No is played in response to an action'
    case 'doublerent':
      return 'Double The Rent is played together with a rent card'
  }
}

function playRent(game: Game, player: Player, card: Card & { kind: 'rent' }, opts: PlayActionOpts): string | null {
  const color = opts.color
  if (!color) return 'Pick a color to charge rent for'
  if (card.colors !== 'any' && !card.colors.includes(color)) return 'That rent card cannot charge that color'
  const piles = player.piles.filter((p) => p.color === color)
  if (piles.length === 0) return `You have no ${COLOR_INFO[color].label} properties`
  let amount = Math.max(...piles.map(pileRent))
  if (amount <= 0) return 'That set charges no rent'

  // Double The Rent: each copy doubles the amount and costs an extra play.
  const doublers: Card[] = []
  for (const id of new Set(opts.doubleRentCardIds ?? [])) {
    const d = player.hand.find((c) => c.id === id)
    if (!d || d.kind !== 'action' || d.action !== 'doublerent') return 'Invalid Double The Rent card'
    doublers.push(d)
  }
  const playsNeeded = 1 + doublers.length
  if (game.playsLeft < playsNeeded) return `Not enough plays left (needs ${playsNeeded})`

  let targetIds: string[]
  if (card.colors === 'any') {
    const target = findPlayer(game, opts.targetPlayerId ?? '')
    if (!target || target.id === player.id || target.left) return 'Wild rent charges one player — pick one'
    targetIds = [target.id]
  } else {
    targetIds = activePlayers(game).filter((p) => p.id !== player.id).map((p) => p.id)
    if (targetIds.length === 0) return 'No one to charge'
  }

  takeFromHand(player, card.id)
  game.discard.push(card)
  for (const d of doublers) {
    takeFromHand(player, d.id)
    game.discard.push(d)
    amount *= 2
  }
  game.playsLeft -= playsNeeded
  log(
    game,
    `${player.name} charges ${amount}M rent on ${COLOR_INFO[color].label}${doublers.length ? ` (doubled x${doublers.length})` : ''}`,
  )
  startDemand(game, { action: 'rent', attackerId: player.id, targets: makeTargets(targetIds), index: 0, amount })
  return null
}

// ---- Turn end / discard ----

export function endTurn(game: Game, pid: string): string | null {
  const err = turnGuard(game, pid)
  if (err) return err
  const player = currentPlayer(game)
  if (player.hand.length > HAND_LIMIT) {
    game.pending = { kind: 'discard', playerId: pid, mustDiscard: player.hand.length - HAND_LIMIT }
    log(game, `${player.name} must discard ${player.hand.length - HAND_LIMIT}`)
    return null
  }
  nextTurn(game)
  return null
}

export function discardCards(game: Game, pid: string, cardIds: string[]): string | null {
  const pending = game.pending
  if (!pending || pending.kind !== 'discard' || pending.playerId !== pid) return 'No discard required'
  const player = findPlayer(game, pid)!
  const unique = [...new Set(cardIds)]
  if (unique.length !== pending.mustDiscard) return `Discard exactly ${pending.mustDiscard} card(s)`
  const cards: Card[] = []
  for (const id of unique) {
    const card = player.hand.find((c) => c.id === id)
    if (!card) return 'Card not in your hand'
    cards.push(card)
  }
  for (const card of cards) {
    takeFromHand(player, card.id)
    game.discard.push(card)
  }
  log(game, `${player.name} discarded ${cards.length}`)
  game.pending = null
  nextTurn(game)
  return null
}

// ---- Leaving / kicking ----

export function removePlayer(game: Game, pid: string): string | null {
  const player = findPlayer(game, pid)
  if (!player || player.left) return 'Player not found'

  if (game.phase === 'lobby') {
    game.players = game.players.filter((p) => p.id !== pid)
    game.players.forEach((p, i) => (p.seat = i))
    if (game.hostId === pid && game.players.length > 0) game.hostId = game.players[0].id
    log(game, `${player.name} left the room`)
    return null
  }

  // Mid-game: cards go to the discard pile, player is skipped from now on.
  player.left = true
  player.connected = false
  game.discard.push(...player.hand.splice(0), ...player.bank.splice(0))
  for (const pile of player.piles.splice(0)) game.discard.push(...pile.cards)
  log(game, `${player.name} left the game — their cards were discarded`)

  if (game.hostId === pid) {
    const next = activePlayers(game)[0]
    if (next) game.hostId = next.id
  }

  const remaining = activePlayers(game)
  if (remaining.length === 1 && game.phase === 'playing') {
    game.phase = 'finished'
    game.winnerId = remaining[0].id
    game.pending = null
    log(game, `🏆 ${remaining[0].name} wins — everyone else left!`)
    return null
  }

  // Unblock any pending interaction involving them.
  const pending = game.pending
  if (pending) {
    if (pending.kind === 'discard' && pending.playerId === pid) {
      game.pending = null
      nextTurn(game)
      return null
    }
    if (pending.kind === 'demand') {
      const demand = pending.demand
      if (demand.attackerId === pid) {
        game.pending = null
      } else if (currentTarget(demand).playerId === pid) {
        advanceDemand(game)
      }
    }
  }
  if (game.phase === 'playing' && currentPlayer(game).id === pid) nextTurn(game)
  return null
}

export function kickPlayer(game: Game, byId: string, targetId: string): string | null {
  if (byId !== game.hostId) return 'Only the host can kick players'
  const target = findPlayer(game, targetId)
  if (!target) return 'Player not found'
  if (target.connected) return 'You can only kick disconnected players'
  return removePlayer(game, targetId)
}
