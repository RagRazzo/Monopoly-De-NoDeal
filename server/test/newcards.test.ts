// Rob Bank, Tax Day, and Quadruple Rent.
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
  game.players.forEach((p) => (p.hand = [])) // deterministic hands
  return { game, a, b }
}

function completeSet(id: string, color: Color, n: number): Pile {
  const cards: Card[] = []
  for (let i = 0; i < n; i++) cards.push({ id: `${id}-${i}`, kind: 'property', color, value: 3 })
  return { id, color, cards }
}

const money = (id: string, value: number): Card => ({ id, kind: 'money', value })

test('Rob Bank takes the target entire bank when they accept', () => {
  const { game, a, b } = twoPlayerGame('RB1')
  const attacker = game.players.find((p) => p.id === a)!
  const target = game.players.find((p) => p.id === b)!
  target.bank = [money('m1', 5), money('m2', 2)]
  const rob: Card = { id: 'rob1', kind: 'action', action: 'robbank', value: 3 }
  attacker.hand.push(rob)
  assert.equal(engine.playAction(game, a, 'rob1', { targetPlayerId: b }), null)
  // Rob Bank is a steal-style demand: target decides at the JSN stage.
  assert.equal((game.pending as any).demand.targets[0].stage, 'jsn')
  assert.equal(engine.respondJsn(game, b, false), null) // give up
  assert.equal(target.bank.length, 0)
  assert.equal(attacker.bank.reduce((s, c) => s + c.value, 0), 7)
  assert.equal(game.pending, null)
})

test('Rob Bank can be blocked with Just Say No', () => {
  const { game, a, b } = twoPlayerGame('RB2')
  const attacker = game.players.find((p) => p.id === a)!
  const target = game.players.find((p) => p.id === b)!
  target.bank = [money('m1', 5)]
  target.hand.push({ id: 'jsn1', kind: 'action', action: 'justsayno', value: 4 })
  attacker.hand.push({ id: 'rob1', kind: 'action', action: 'robbank', value: 3 })
  assert.equal(engine.playAction(game, a, 'rob1', { targetPlayerId: b }), null)
  assert.equal(engine.respondJsn(game, b, true), null) // Just Say No
  assert.equal(engine.respondJsn(game, a, false), null) // attacker lets it go
  assert.equal(target.bank.length, 1, 'bank kept')
  assert.equal(game.pending, null)
})

test('Rob Bank needs a non-empty bank', () => {
  const { game, a, b } = twoPlayerGame('RB3')
  const attacker = game.players.find((p) => p.id === a)!
  const target = game.players.find((p) => p.id === b)!
  target.bank = []
  attacker.hand.push({ id: 'rob1', kind: 'action', action: 'robbank', value: 3 })
  assert.ok(engine.playAction(game, a, 'rob1', { targetPlayerId: b }), 'no bank to rob')
})

test('Tax Day charges 1M per complete set the target owns', () => {
  const { game, a, b } = twoPlayerGame('TX1')
  const attacker = game.players.find((p) => p.id === a)!
  const target = game.players.find((p) => p.id === b)!
  target.piles = [completeSet('red', 'red', 3), completeSet('navy', 'darkblue', 2)]
  target.bank = [money('m1', 5)]
  attacker.hand.push({ id: 'tax1', kind: 'action', action: 'tax', value: 2 })
  assert.equal(engine.playAction(game, a, 'tax1', {}), null)
  // Two complete sets -> owes 2M, straight to the pay stage.
  const t = (game.pending as any).demand.targets[0]
  assert.equal(t.stage, 'pay')
  assert.equal(t.amount, 2)
  assert.equal(engine.submitPayment(game, b, ['m1']), null)
  assert.equal(attacker.bank.reduce((s, c) => s + c.value, 0), 5)
})

test('Tax Day skips players with no complete sets', () => {
  const { game, a, b } = twoPlayerGame('TX2')
  const attacker = game.players.find((p) => p.id === a)!
  const target = game.players.find((p) => p.id === b)!
  target.piles = [completeSet('red', 'red', 1)] // incomplete
  target.bank = [money('m1', 5)]
  attacker.hand.push({ id: 'tax1', kind: 'action', action: 'tax', value: 2 })
  assert.ok(engine.playAction(game, a, 'tax1', {}), 'nobody has a complete set to tax')
})

test('Market Crash wipes every table into the discard pile', () => {
  const { game, a, b } = twoPlayerGame('MC1')
  const attacker = game.players.find((p) => p.id === a)!
  const target = game.players.find((p) => p.id === b)!
  attacker.piles = [completeSet('red', 'red', 3)]
  target.piles = [completeSet('navy', 'darkblue', 2), completeSet('green', 'green', 1)]
  const discardBefore = game.discard.length
  attacker.hand.push({ id: 'mc1', kind: 'action', action: 'marketcrash', value: 0 })
  assert.equal(engine.playAction(game, a, 'mc1', {}), null)
  assert.equal(attacker.piles.length, 0, 'own board wiped too')
  assert.equal(target.piles.length, 0)
  // 3 + 2 + 1 property cards + the played card all reach the discard pile.
  assert.equal(game.discard.length, discardBefore + 6 + 1)
  assert.equal(game.pending, null)
})

test('Go Fund Me lets a player gift bank cash, or decline', () => {
  const { game, a, b } = twoPlayerGame('GF1')
  const caster = game.players.find((p) => p.id === a)!
  const donor = game.players.find((p) => p.id === b)!
  donor.bank = [money('m1', 3), money('m2', 2)]
  caster.hand.push({ id: 'gf1', kind: 'action', action: 'gofundme', value: 0 })
  assert.equal(engine.playAction(game, a, 'gf1', {}), null)
  // Voluntary: due is 0, so any (or no) selection is valid.
  const t = (game.pending as any).demand.targets[0]
  assert.equal(t.stage, 'pay')
  assert.equal(t.amount, 0)
  assert.equal(engine.submitPayment(game, b, ['m1']), null) // gift 3M
  assert.equal(caster.bank.reduce((s, c) => s + c.value, 0), 3)
  assert.equal(donor.bank.reduce((s, c) => s + c.value, 0), 2)
})

test('Go Fund Me gifts are limited to bank cash', () => {
  const { game, a, b } = twoPlayerGame('GF2')
  const donor = game.players.find((p) => p.id === b)!
  donor.bank = [money('m1', 3)]
  donor.piles = [completeSet('red', 'red', 1)] // a table property, not giftable
  game.players.find((p) => p.id === a)!.hand.push({ id: 'gf1', kind: 'action', action: 'gofundme', value: 0 })
  assert.equal(engine.playAction(game, a, 'gf1', {}), null)
  assert.ok(engine.submitPayment(game, b, ['red-0']), 'cannot gift a table property')
})

test('Quadruple Rent multiplies rent by four and costs two plays', () => {
  const { game, a, b } = twoPlayerGame('QR1')
  const attacker = game.players.find((p) => p.id === a)!
  const target = game.players.find((p) => p.id === b)!
  attacker.piles = [completeSet('red', 'red', 3)] // red rent for 3 = 6M
  target.bank = [money('m1', 5), money('m2', 5), money('m3', 5), money('m4', 5), money('m5', 5)]
  const rent: Card = { id: 'rent1', kind: 'rent', colors: ['red', 'yellow'], value: 1 }
  const quad: Card = { id: 'quad1', kind: 'action', action: 'quadruplerent', value: 1 }
  attacker.hand.push(rent, quad)
  const playsBefore = game.playsLeft
  assert.equal(engine.playAction(game, a, 'rent1', { color: 'red', quadRentCardIds: ['quad1'] }), null)
  assert.equal(game.playsLeft, playsBefore - 2, 'rent + quad = two plays')
  assert.equal((game.pending as any).demand.targets[0].amount, 24) // 6M x4
})
