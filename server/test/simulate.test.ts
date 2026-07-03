// Monte-carlo smoke test: random bots play full games through the public
// engine API. Verifies the rules engine never wedges, never loses cards,
// and that games actually finish with a winner.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as engine from '../src/engine.ts'
import { createGame } from '../src/engine.ts'
import { ALL_COLORS, type Card, type Color } from '../../shared/src/cards.ts'
import { isPileComplete, isPropertyCard, payableCards, playerWorth } from '../../shared/src/logic.ts'
import type { Game, Player } from '../../shared/src/types.ts'

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function totalCards(game: Game): number {
  let n = game.deck.length + game.discard.length
  for (const p of game.players) {
    n += p.hand.length + p.bank.length
    for (const pile of p.piles) n += pile.cards.length
  }
  return n
}

function makeGame(players: number): Game {
  const game = createGame('TEST1', 'P0', 'id0', 't0')
  for (let i = 1; i < players; i++) engine.addPlayer(game, `P${i}`, `id${i}`, `t${i}`)
  assert.equal(engine.startGame(game, 'id0'), null)
  return game
}

function respondToPending(game: Game) {
  const pending = game.pending!
  if (pending.kind === 'discard') {
    const p = game.players.find((pl) => pl.id === pending.playerId)!
    const ids = p.hand.slice(0, pending.mustDiscard).map((c) => c.id)
    assert.equal(engine.discardCards(game, pending.playerId, ids), null)
    return
  }
  const d = pending.demand
  const t = d.targets[d.index]
  if (t.stage === 'jsn') {
    const responder = game.players.find((p) => p.id === t.awaiting)!
    const hasJsn = responder.hand.some((c) => c.kind === 'action' && c.action === 'justsayno')
    const use = hasJsn && Math.random() < 0.5
    assert.equal(engine.respondJsn(game, t.awaiting, use), null)
    return
  }
  // Payment: pick cards greedily until covered.
  const payer = game.players.find((p) => p.id === t.playerId)!
  const due = Math.min(d.amount!, playerWorth(payer))
  const pool = payableCards(payer).sort((a, b) => a.value - b.value)
  const ids: string[] = []
  let total = 0
  for (const c of pool) {
    if (total >= due) break
    ids.push(c.id)
    total += c.value
  }
  assert.equal(engine.submitPayment(game, t.playerId, ids), null)
}

// Try one random play for the current player; returns true if a play happened.
function tryRandomPlay(game: Game): boolean {
  const player = game.players[game.turnIndex]
  if (game.playsLeft < 1 || player.hand.length === 0) return false
  const card = pick(player.hand)
  const others = game.players.filter((p) => p.id !== player.id && !p.left)

  const attempt = (): string | null => {
    switch (card.kind) {
      case 'money':
        return engine.playMoney(game, player.id, card.id)
      case 'property': {
        return engine.playProperty(game, player.id, card.id)
      }
      case 'wild': {
        if (card.colors === 'any') {
          const pile = player.piles.find((p) => !isPileComplete(p))
          if (!pile) return 'no pile'
          return engine.playProperty(game, player.id, card.id, undefined, pile.id)
        }
        return engine.playProperty(game, player.id, card.id, pick(card.colors as Color[]))
      }
      case 'rent': {
        const colors = card.colors === 'any' ? ALL_COLORS : (card.colors as Color[])
        const owned = colors.filter((c) => player.piles.some((p) => p.color === c))
        if (owned.length === 0) return engine.playMoney(game, player.id, card.id)
        const opts = card.colors === 'any' ? { color: pick(owned), targetPlayerId: pick(others).id } : { color: pick(owned) }
        return engine.playAction(game, player.id, card.id, opts)
      }
      case 'action': {
        switch (card.action) {
          case 'passgo':
            return engine.playAction(game, player.id, card.id, {})
          case 'birthday':
            return engine.playAction(game, player.id, card.id, {})
          case 'debtcollector':
            return engine.playAction(game, player.id, card.id, { targetPlayerId: pick(others).id })
          case 'slydeal': {
            for (const o of others) {
              for (const pile of o.piles) {
                if (isPileComplete(pile)) continue
                const c = pile.cards.find(isPropertyCard)
                if (c) return engine.playAction(game, player.id, card.id, { targetPlayerId: o.id, targetCardId: c.id })
              }
            }
            return engine.playMoney(game, player.id, card.id)
          }
          case 'forceddeal': {
            const minePile = player.piles.find((p) => !isPileComplete(p) && p.cards.some(isPropertyCard))
            const mine = minePile?.cards.find(isPropertyCard)
            if (mine) {
              for (const o of others) {
                for (const pile of o.piles) {
                  if (isPileComplete(pile)) continue
                  const c = pile.cards.find(isPropertyCard)
                  if (c)
                    return engine.playAction(game, player.id, card.id, {
                      targetPlayerId: o.id,
                      targetCardId: c.id,
                      myCardId: mine.id,
                    })
                }
              }
            }
            return engine.playMoney(game, player.id, card.id)
          }
          case 'dealbreaker': {
            for (const o of others) {
              const pile = o.piles.find(isPileComplete)
              if (pile) return engine.playAction(game, player.id, card.id, { targetPlayerId: o.id, targetPileId: pile.id })
            }
            return engine.playMoney(game, player.id, card.id)
          }
          case 'house':
          case 'hotel': {
            const err = engine.playAction(game, player.id, card.id, {
              pileId: player.piles.find(isPileComplete)?.id,
            })
            if (err) return engine.playMoney(game, player.id, card.id)
            return null
          }
          default:
            // justsayno / doublerent: bank them
            return engine.playMoney(game, player.id, card.id)
        }
      }
    }
  }
  return attempt() === null
}

function runGame(players: number): Game {
  const game = makeGame(players)
  const expectedCards = totalCards(game)
  let steps = 0
  while (game.phase === 'playing') {
    if (++steps > 20000) assert.fail('game did not finish in 20k steps')
    if (game.pending) {
      respondToPending(game)
      continue
    }
    if (!tryRandomPlay(game)) {
      assert.equal(engine.endTurn(game, game.players[game.turnIndex].id), null)
    }
    assert.equal(totalCards(game), expectedCards, 'cards were created or destroyed')
  }
  assert.equal(game.phase, 'finished')
  assert.ok(game.winnerId, 'game has a winner')
  return game
}

test('random games finish cleanly at every player count', () => {
  for (const players of [2, 3, 4, 5, 6]) {
    for (let i = 0; i < 4; i++) runGame(players)
  }
})

test('invalid moves are rejected without corrupting state', () => {
  const game = makeGame(3)
  const before = totalCards(game)
  const notMyTurn = game.players[(game.turnIndex + 1) % 3]
  assert.ok(engine.playMoney(game, notMyTurn.id, notMyTurn.hand[0]?.id ?? 'x'))
  assert.ok(engine.endTurn(game, notMyTurn.id))
  assert.ok(engine.playMoney(game, game.players[game.turnIndex].id, 'nonexistent'))
  assert.equal(totalCards(game), before)
})
