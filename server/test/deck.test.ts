import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDeck, deckScale } from '../../shared/src/cards.ts'

const rng = () => Math.random()

test('base deck for 2-4 players is 106 base cards + Tax/Quad + one Rob Bank per player', () => {
  // 106 classic cards + Quadruple Rent (1) + Tax Day (2) + one Rob Bank each.
  for (const n of [2, 3, 4]) {
    assert.equal(buildDeck(n, rng).length, 109 + n)
  }
})

test('deck scales up for 5 and 6 players with one Rob Bank per player', () => {
  const five = buildDeck(5, rng)
  const six = buildDeck(6, rng)
  assert.ok(five.length > 113, `5p deck ${five.length}`)
  assert.ok(six.length > five.length, `6p deck ${six.length}`)
  const robbanks = (d: typeof five) => d.filter((c) => c.kind === 'action' && c.action === 'robbank').length
  assert.equal(robbanks(five), 5)
  assert.equal(robbanks(six), 6)
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
