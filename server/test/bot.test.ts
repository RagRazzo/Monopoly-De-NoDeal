// CPU strategy tests: bot-vs-bot games must run to completion through the
// public engine API without stalling, erroring, or losing cards.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as engine from '../src/engine.ts'
import { botAct, botToAct } from '../src/bot.ts'
import { createGame } from '../src/engine.ts'
import type { Game } from '../../shared/src/types.ts'

function totalCards(game: Game): number {
  let n = game.deck.length + game.discard.length
  for (const p of game.players) {
    n += p.hand.length + p.bank.length
    for (const pile of p.piles) n += pile.cards.length
  }
  return n
}

function runBotGame(): Game {
  const game = createGame('BOTS1', 'Host', 'id0', 't0')
  // Make every seat a bot so botAct drives the whole game.
  game.players[0].bot = true
  assert.equal(engine.addBot(game), null)
  assert.equal(engine.startGame(game, 'id0'), null)
  const expected = totalCards(game)

  let steps = 0
  while (game.phase === 'playing') {
    if (++steps > 5000) assert.fail('bot game did not finish in 5000 steps')
    const actor = botToAct(game)
    assert.ok(actor, `no bot to act but game still running (pending=${JSON.stringify(game.pending)})`)
    const before = { plays: game.playsLeft, turn: game.turnIndex, pending: JSON.stringify(game.pending) }
    botAct(game, actor)
    const progressed =
      game.phase !== 'playing' ||
      game.playsLeft !== before.plays ||
      game.turnIndex !== before.turn ||
      JSON.stringify(game.pending) !== before.pending
    assert.ok(progressed, 'bot action made no progress')
    assert.equal(totalCards(game), expected, 'cards were created or destroyed')
  }
  assert.equal(game.phase, 'finished')
  assert.ok(game.winnerId)
  return game
}

test('bot vs bot games finish cleanly', () => {
  for (let i = 0; i < 25; i++) runBotGame()
})

test('startWithBot is host-only and solo-only', () => {
  const game = createGame('BOTS2', 'Host', 'id0', 't0')
  engine.addPlayer(game, 'Friend', 'id1', 't1')
  // Not allowed once a real player has joined.
  assert.ok(engine.startWithBot(game, 'id0'))
  assert.equal(game.phase, 'lobby')

  const solo = createGame('BOTS3', 'Host', 'id0', 't0')
  // Only the host may trigger it.
  assert.ok(engine.startWithBot(solo, 'someone-else'))
  // Host alone: starts a 2-player game vs the CPU.
  assert.equal(engine.startWithBot(solo, 'id0'), null)
  assert.equal(solo.phase, 'playing')
  assert.equal(solo.players.length, 2)
  assert.ok(solo.players[1].bot)
  assert.equal(solo.players[1].name, 'CPU')
})

test('bot responds to a human demand without stalling', () => {
  // Force a deterministic scenario: human plays Birthday, CPU must pay.
  for (let attempt = 0; attempt < 50; attempt++) {
    const game = createGame('BOTS4', 'Host', 'id0', 't0')
    assert.equal(engine.startWithBot(game, 'id0'), null)
    const human = game.players[0]
    const bot = game.players[1]
    // Give the human a Birthday card and make it their turn.
    const idx = game.deck.findIndex((c) => c.kind === 'action' && c.action === 'birthday')
    if (idx === -1) continue
    const birthday = game.deck.splice(idx, 1)[0]
    human.hand.push(birthday)
    game.turnIndex = 0
    game.playsLeft = 3
    game.pending = null
    // Ensure the bot can pay something.
    bot.bank.push({ id: 'test-money', kind: 'money', value: 2 })
    assert.equal(engine.playAction(game, human.id, birthday.id, {}), null)
    // Resolve every bot response (JSN decision and/or payment).
    let guard = 0
    while (game.pending && botToAct(game)) {
      botAct(game, botToAct(game)!)
      assert.ok(++guard < 10, 'bot response loop stalled')
    }
    assert.equal(game.pending, null)
    return
  }
  assert.fail('no Birthday card found in 50 deck builds')
})
