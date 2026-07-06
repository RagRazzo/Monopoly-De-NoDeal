// Turn/response timeout sweeper: the CPU must step in for timed-out humans
// exactly per the rules — one safe play if they did nothing, auto end-turn,
// least-valuable auto-discard, and auto-response to stalled prompts.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as engine from '../src/engine.ts'
import { sweepTimeouts } from '../src/bot.ts'
import { createGame } from '../src/engine.ts'
import { HAND_LIMIT, PLAYS_PER_TURN, TURN_SECONDS, type Game } from '../../shared/src/types.ts'

const TURN_MS = TURN_SECONDS * 1000

function makeGame(): Game {
  const game = createGame('TIME1', 'A', 'id0', 't0')
  engine.addPlayer(game, 'B', 'id1', 't1')
  assert.equal(engine.startGame(game, 'id0'), null)
  return game
}

test('no timeout before the deadline', () => {
  const game = makeGame()
  assert.equal(sweepTimeouts(game, game.turnStartedAt + TURN_MS - 1000), false)
})

test('zero plays: CPU makes at most one play, then the turn ends', () => {
  const game = makeGame()
  const cur = game.players[game.turnIndex]
  const changed = sweepTimeouts(game, game.turnStartedAt + TURN_MS + 1000)
  assert.ok(changed)
  // Turn advanced to the other player (or a discard was auto-resolved too).
  assert.notEqual(game.players[game.turnIndex].id, cur.id)
  assert.equal(game.pending, null)
  assert.ok(game.log.some((l) => l.includes('ended automatically')))
})

test('at least one play made: turn just ends, CPU adds nothing', () => {
  const game = makeGame()
  const cur = game.players[game.turnIndex]
  game.playsLeft = PLAYS_PER_TURN - 1 // simulate one play already made
  const hand = cur.hand.length
  const bank = cur.bank.length
  const piles = cur.piles.length
  assert.ok(sweepTimeouts(game, game.turnStartedAt + TURN_MS + 1000))
  assert.notEqual(game.players[game.turnIndex].id, cur.id)
  assert.equal(cur.hand.length, hand, 'CPU should not have played a card')
  assert.equal(cur.bank.length, bank)
  assert.equal(cur.piles.length, piles)
})

test('over hand limit on auto-end: CPU discards down to the limit', () => {
  const game = makeGame()
  const cur = game.players[game.turnIndex]
  game.playsLeft = PLAYS_PER_TURN - 1 // at least one play, so no CPU stand-in play
  cur.hand.push(...game.deck.splice(0, 6)) // force an oversized hand
  assert.ok(cur.hand.length > HAND_LIMIT)
  assert.ok(sweepTimeouts(game, game.turnStartedAt + TURN_MS + 1000))
  assert.equal(cur.hand.length, HAND_LIMIT)
  assert.equal(game.pending, null)
  assert.notEqual(game.players[game.turnIndex].id, cur.id)
})

test('stalled prompt: CPU responds for the human after the response window', () => {
  const game = makeGame()
  const attacker = game.players[game.turnIndex]
  const target = game.players[(game.turnIndex + 1) % 2]
  // Force a Birthday demand aimed at the other human.
  const idx = game.deck.findIndex((c) => c.kind === 'action' && c.action === 'birthday')
  assert.notEqual(idx, -1)
  const birthday = game.deck.splice(idx, 1)[0]
  attacker.hand.push(birthday)
  target.bank.push({ id: 'tm', kind: 'money', value: 2 })
  assert.equal(engine.playAction(game, attacker.id, birthday.id, {}), null)
  assert.ok(game.pending)

  let now = Date.now()
  let guard = 0
  while (game.pending && guard++ < 10) {
    sweepTimeouts(game, now) // first call arms the prompt clock, later calls expire it
    now += 46_000
  }
  assert.equal(game.pending, null, 'prompt was not auto-resolved')
  assert.ok(game.log.some((l) => l.includes('took too long')))
})

test('turn clock is paused while a prompt is open', () => {
  const game = makeGame()
  const attacker = game.players[game.turnIndex]
  const target = game.players[(game.turnIndex + 1) % 2]
  const idx = game.deck.findIndex((c) => c.kind === 'action' && c.action === 'debtcollector')
  assert.notEqual(idx, -1)
  const debt = game.deck.splice(idx, 1)[0]
  attacker.hand.push(debt)
  target.bank.push({ id: 'tm2', kind: 'money', value: 5 })
  const startedAt = game.turnStartedAt
  assert.equal(engine.playAction(game, attacker.id, debt.id, { targetPlayerId: target.id }), null)

  let now = startedAt + 10_000
  sweepTimeouts(game, now) // arm the prompt clock
  now += 30_000 // 30s pass while the target thinks
  // Payment demands drop the target straight onto the pay stage.
  assert.equal((game.pending as any).demand.targets[0].stage, 'pay')
  assert.equal(engine.submitPayment(game, target.id, ['tm2']), null)
  assert.equal(game.pending, null)
  sweepTimeouts(game, now) // sweeper credits the wait back
  assert.ok(game.turnStartedAt >= startedAt + 30_000, 'prompt wait was not credited back to the turn clock')
})

test('sweeper leaves bot turns and finished games alone', () => {
  const game = makeGame()
  game.players[game.turnIndex].bot = true
  assert.equal(sweepTimeouts(game, game.turnStartedAt + TURN_MS + 1000), false)
  game.players[game.turnIndex].bot = false
  game.phase = 'finished'
  assert.equal(sweepTimeouts(game, game.turnStartedAt + TURN_MS + 1000), false)
})
