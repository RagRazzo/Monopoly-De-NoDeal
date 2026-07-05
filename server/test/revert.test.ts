// "Back to Just Say No": a target who accepted (moved to the payment stage)
// can revert to the Just Say No decision while they still hold one.
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
  // Deterministic Debt Collector demand for 5M.
  const idx = game.deck.findIndex((c) => c.kind === 'action' && c.action === 'debtcollector')
  const debt = game.deck.splice(idx, 1)[0]
  attacker.hand.push(debt)
  target.bank.push({ id: 'tm', kind: 'money', value: 5 })
  assert.equal(engine.playAction(game, attacker.id, debt.id, { targetPlayerId: target.id }), null)
  return { game, attacker: attacker.id, target: target.id }
}

const jsn: Card = { id: 'jsn1', kind: 'action', action: 'justsayno', value: 4 }

test('accept then revert to Just Say No while holding one', () => {
  const { game, target } = setup()
  const t = game.players.find((p) => p.id === target)!
  t.hand.push({ ...jsn })
  // Accept -> payment stage.
  assert.equal(engine.respondJsn(game, target, false), null)
  assert.equal((game.pending as any).demand.targets[0].stage, 'pay')
  // Revert -> back to the Just Say No decision.
  assert.equal(engine.backToJsn(game, target), null)
  assert.equal((game.pending as any).demand.targets[0].stage, 'jsn')
  // Now actually play Just Say No.
  assert.equal(engine.respondJsn(game, target, true), null)
})

test('revert is rejected without a Just Say No card', () => {
  const { game, target } = setup()
  assert.equal(engine.respondJsn(game, target, false), null) // no JSN in hand -> pay stage
  assert.ok(engine.backToJsn(game, target), 'should error without a JSN card')
  assert.equal((game.pending as any).demand.targets[0].stage, 'pay', 'still owes payment')
})

test('revert is rejected before accepting (still at jsn stage) and from the wrong player', () => {
  const { game, target, attacker } = setup()
  const t = game.players.find((p) => p.id === target)!
  t.hand.push({ ...jsn })
  assert.ok(engine.backToJsn(game, target), 'nothing to revert while still at jsn stage')
  assert.equal(engine.respondJsn(game, target, false), null)
  assert.ok(engine.backToJsn(game, attacker), 'the attacker cannot revert the payment')
})
