// Payment demands drop the target straight onto the payment stage. They can
// still play Just Say No from there (directly, or via the "back to Just Say
// No" revert while they hold one).
import test from 'node:test'
import assert from 'node:assert/strict'
import * as engine from '../src/engine.ts'
import { createGame } from '../src/engine.ts'
import type { Card } from '../../shared/src/cards.ts'
import type { Game } from '../../shared/src/types.ts'

function setup(): { game: Game; attacker: string; target: string } {
  const game = createGame('REV1', 'A', 'id0', 't0')
  engine.addPlayer(game, 'B', 'id1', 't1')
  assert.equal(engine.startGame(game, 'id0'), null)
  const attacker = game.players[game.turnIndex]
  const target = game.players[(game.turnIndex + 1) % 2]
  // Deterministic Debt Collector demand for 5M. Clear the target's random
  // starting hand so Just Say No is only present when a test adds it.
  target.hand = []
  const idx = game.deck.findIndex((c) => c.kind === 'action' && c.action === 'debtcollector')
  const debt = game.deck.splice(idx, 1)[0]
  attacker.hand.push(debt)
  target.bank.push({ id: 'tm', kind: 'money', value: 5 })
  assert.equal(engine.playAction(game, attacker.id, debt.id, { targetPlayerId: target.id }), null)
  return { game, attacker: attacker.id, target: target.id }
}

const jsn: Card = { id: 'jsn1', kind: 'action', action: 'justsayno', value: 4 }

test('a payment demand starts the target on the pay stage', () => {
  const { game } = setup()
  assert.equal((game.pending as any).demand.targets[0].stage, 'pay')
})

test('play Just Say No directly from the payment stage', () => {
  const { game, target } = setup()
  const t = game.players.find((p) => p.id === target)!
  t.hand.push({ ...jsn })
  assert.equal(engine.respondJsn(game, target, true), null)
  // The block hands the counter decision to the attacker.
  assert.equal((game.pending as any).demand.targets[0].stage, 'jsn')
  assert.equal((game.pending as any).demand.targets[0].awaiting, (game.pending as any).demand.attackerId)
})

test('back to Just Say No from payment, then play it', () => {
  const { game, target } = setup()
  const t = game.players.find((p) => p.id === target)!
  t.hand.push({ ...jsn })
  assert.equal(engine.backToJsn(game, target), null)
  assert.equal((game.pending as any).demand.targets[0].stage, 'jsn')
  assert.equal(engine.respondJsn(game, target, true), null)
})

test('Just Say No from payment is rejected without a card', () => {
  const { game, target } = setup()
  assert.ok(engine.respondJsn(game, target, true), 'should error without a JSN card')
  assert.equal((game.pending as any).demand.targets[0].stage, 'pay', 'still owes payment')
})

test('revert is rejected without a Just Say No card', () => {
  const { game, target } = setup()
  assert.ok(engine.backToJsn(game, target), 'should error without a JSN card')
  assert.equal((game.pending as any).demand.targets[0].stage, 'pay', 'still owes payment')
})

test('the attacker cannot revert the payment', () => {
  const { game, attacker } = setup()
  assert.ok(engine.backToJsn(game, attacker), 'the attacker cannot revert the payment')
})
