// Same-color properties must always live in a single set — never split into
// two piles when overflowing a complete set, or when a steal/deal-breaker
// hands over a color the recipient was already collecting.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as engine from '../src/engine.ts'
import { createGame } from '../src/engine.ts'
import type { Card, Color } from '../../shared/src/cards.ts'
import type { Game, Pile } from '../../shared/src/types.ts'

function twoPlayerGame(code: string): { game: Game; a: string; b: string } {
  const game = createGame(code, 'A', 'id0', 't0')
  engine.addPlayer(game, 'B', 'id1', 't1')
  assert.equal(engine.startGame(game, 'id0'), null)
  const a = game.players[game.turnIndex].id
  const b = game.players[(game.turnIndex + 1) % 2].id
  return { game, a, b }
}

function redPile(id: string, n: number): Pile {
  const cards: Card[] = []
  for (let i = 0; i < n; i++) cards.push({ id: `${id}-${i}`, kind: 'property', color: 'red', value: 3 })
  return { id, color: 'red' as Color, cards }
}

function redCount(pileList: Pile[]): { piles: number; cards: number } {
  const red = pileList.filter((p) => p.color === 'red')
  return { piles: red.length, cards: red.reduce((s, p) => s + p.cards.length, 0) }
}

test('overflowing a complete set keeps the color as one pile', () => {
  const { game, a } = twoPlayerGame('PIL1')
  const player = game.players.find((p) => p.id === a)!
  player.piles = [redPile('done', 3)] // already a complete red set
  const extra: Card = { id: 'r-extra', kind: 'property', color: 'red', value: 3 }
  player.hand.push(extra)
  assert.equal(engine.playProperty(game, a, 'r-extra'), null)
  assert.deepEqual(redCount(player.piles), { piles: 1, cards: 4 })
})

test('deal breaker merges the stolen set into the same color', () => {
  const { game, a, b } = twoPlayerGame('PIL2')
  const attacker = game.players.find((p) => p.id === a)!
  const target = game.players.find((p) => p.id === b)!
  attacker.piles = [redPile('mine', 1)] // already collecting red
  target.piles = [redPile('theirs', 3)] // a complete red set
  const db: Card = { id: 'db1', kind: 'action', action: 'dealbreaker', value: 5 }
  attacker.hand.push(db)
  assert.equal(engine.playAction(game, a, 'db1', { targetPlayerId: b, targetPileId: 'theirs' }), null)
  assert.equal(engine.respondJsn(game, b, false), null) // target accepts
  assert.deepEqual(redCount(attacker.piles), { piles: 1, cards: 4 })
})

test('a paid-out property joins the recipient\'s existing color', () => {
  const { game, a, b } = twoPlayerGame('PIL3')
  const attacker = game.players.find((p) => p.id === a)!
  const target = game.players.find((p) => p.id === b)!
  attacker.piles = [redPile('mine', 1)] // collecting red
  target.piles = [redPile('theirs', 2)] // an incomplete red set to pay from
  const debt: Card = { id: 'debt1', kind: 'action', action: 'debtcollector', value: 3 }
  attacker.hand.push(debt)
  assert.equal(engine.playAction(game, a, 'debt1', { targetPlayerId: b }), null)
  // Pay the 5M debt with two red properties from the table.
  assert.equal(engine.submitPayment(game, b, ['theirs-0', 'theirs-1']), null)
  assert.deepEqual(redCount(attacker.piles), { piles: 1, cards: 3 })
})
