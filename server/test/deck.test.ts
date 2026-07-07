import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDeck, deckScale } from '../../shared/src/cards.ts'

const rng = () => Math.random()

test('base deck has 106 cards for 2-4 players (fun cards off by default)', () => {
  for (const n of [2, 3, 4]) {
    assert.equal(buildDeck(n, rng).length, 106)
  }
})

test('deck scales proportionally for 5 and 6 players', () => {
  const five = buildDeck(5, rng).length
  const six = buildDeck(6, rng).length
  assert.ok(five > 106 && five < 106 * 1.45, `5p deck ${five}`)
  assert.ok(six > five && six <= Math.ceil(106 * 1.6), `6p deck ${six}`)
})

test('no fun cards appear unless enabled', () => {
  const isFun = (a: string) => ['quadruplerent', 'robbank', 'tax', 'marketcrash', 'gofundme'].includes(a)
  for (const n of [2, 4, 6]) {
    const deck = buildDeck(n, rng)
    assert.equal(deck.filter((c) => c.kind === 'action' && isFun(c.action)).length, 0)
  }
})

test('fun cards use fixed per-game counts when enabled', () => {
  const count = (deck: ReturnType<typeof buildDeck>, action: string) =>
    deck.filter((c) => c.kind === 'action' && c.action === action).length
  for (const n of [2, 3, 4, 5, 6]) {
    const deck = buildDeck(n, rng, { fun: true })
    assert.equal(count(deck, 'tax'), 1, `tax @${n}`)
    assert.equal(count(deck, 'quadruplerent'), 2, `quad @${n}`)
    assert.equal(count(deck, 'gofundme'), 2, `gofundme @${n}`)
    assert.equal(count(deck, 'robbank'), n <= 4 ? 1 : 2, `robbank @${n}`)
    assert.equal(count(deck, 'marketcrash'), n >= 3 ? 1 : 0, `crash @${n}`)
  }
})

test('card type ratios stay faithful under scaling', () => {
  const base = buildDeck(4, rng)
  const big = buildDeck(6, rng)
  const share = (deck: ReturnType<typeof buildDeck>, kind: string) =>
    deck.filter((c) => c.kind === kind).length / deck.length
  for (const kind of ['money', 'property', 'wild', 'rent', 'action']) {
    const drift = Math.abs(share(base, kind) - share(big, kind))
    assert.ok(drift < 0.03, `${kind} share drifted ${drift.toFixed(3)}`)
  }
})

test('deck scale factors', () => {
  assert.equal(deckScale(2), 1)
  assert.equal(deckScale(4), 1)
  assert.equal(deckScale(5), 4 / 3)
  assert.equal(deckScale(6), 3 / 2)
})

test('all card ids are unique', () => {
  const deck = buildDeck(6, rng)
  assert.equal(new Set(deck.map((c) => c.id)).size, deck.length)
})

test('shuffle produces different orders', () => {
  const a = buildDeck(4, rng).map((c) => c.id).join(',')
  const b = buildDeck(4, rng).map((c) => c.id).join(',')
  assert.notEqual(a, b)
})
