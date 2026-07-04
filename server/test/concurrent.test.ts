// Concurrency: many games progressing at the same time must stay fully
// isolated. We interleave 20 bot-driven games one action at a time (the
// worst case for cross-game state leaks) and verify each game keeps its
// own cards, finishes cleanly, and never touches another game's state.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as engine from '../src/engine.ts'
import { botAct, botToAct } from '../src/bot.ts'
import { createGame } from '../src/engine.ts'
import { createRoom, deleteRoom, getRoom } from '../src/rooms.ts'
import type { Game } from '../../shared/src/types.ts'

function totalCards(game: Game): number {
  let n = game.deck.length + game.discard.length
  for (const p of game.players) {
    n += p.hand.length + p.bank.length
    for (const pile of p.piles) n += pile.cards.length
  }
  return n
}

test('20 interleaved games stay isolated and all finish', () => {
  const games: Game[] = []
  for (let i = 0; i < 20; i++) {
    const game = createGame(`ROOM${i}`, 'A', `a${i}`, `ta${i}`)
    game.players[0].bot = true
    assert.equal(engine.addBot(game), null)
    assert.equal(engine.startGame(game, `a${i}`), null)
    games.push(game)
  }
  const expected = games.map(totalCards)

  // Round-robin: one action per game per pass, so games constantly
  // interleave on the same event loop like they do in production.
  let steps = 0
  while (games.some((g) => g.phase === 'playing')) {
    if (++steps > 2000) assert.fail('interleaved games did not finish')
    games.forEach((game, i) => {
      if (game.phase !== 'playing') return
      const actor = botToAct(game)
      assert.ok(actor, `game ${i} wedged`)
      botAct(game, actor)
      assert.equal(totalCards(game), expected[i], `game ${i} gained/lost cards mid-interleave`)
    })
  }

  games.forEach((game, i) => {
    assert.equal(game.phase, 'finished', `game ${i} did not finish`)
    assert.ok(game.winnerId, `game ${i} has no winner`)
    assert.equal(totalCards(game), expected[i], `game ${i} card total drifted`)
    // A game's cards must all be its own objects — never shared with a
    // neighbor (same ids exist across games, but never the same instances).
    const other = games[(i + 1) % games.length]
    const mine = new Set(game.deck.concat(game.discard))
    for (const c of other.deck) assert.ok(!mine.has(c), 'card object shared between games')
  })
})

test('room registry: unique codes, correct lookup, independent deletion', () => {
  const rooms = Array.from({ length: 50 }, () => createRoom('Host'))
  const codes = new Set(rooms.map((r) => r.game.code))
  assert.equal(codes.size, 50, 'room codes must be unique')
  for (const r of rooms) {
    assert.equal(getRoom(r.game.code), r.game, 'lookup must return the exact instance')
  }
  deleteRoom(rooms[0].game.code)
  assert.equal(getRoom(rooms[0].game.code), undefined)
  assert.equal(getRoom(rooms[1].game.code), rooms[1].game, 'deleting one room must not affect others')
  for (const r of rooms.slice(1)) deleteRoom(r.game.code)
})
