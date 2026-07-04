// Lobby resilience: a room must survive its host backgrounding the browser
// tab (disconnect) long enough to share the invite link, and only get
// cleaned up after the grace period.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRoom, getRoom, sweepRooms } from '../src/rooms.ts'

const MIN = 60 * 1000

test('lobby survives a host disconnect within the grace period', () => {
  const { game, playerId } = createRoom('Host')
  const host = game.players.find((p) => p.id === playerId)!
  host.connected = false
  host.disconnectedAt = Date.now()

  sweepRooms(Date.now() + 5 * MIN) // host away 5 minutes: still fine
  assert.equal(getRoom(game.code), game, 'room must survive a short disconnect')
  assert.equal(game.players.length, 1, 'host keeps their seat')
})

test('lobby ghosts are removed after the grace period, then the room', () => {
  const { game, playerId } = createRoom('Host')
  const host = game.players.find((p) => p.id === playerId)!
  const t0 = Date.now()
  host.connected = false
  host.disconnectedAt = t0

  sweepRooms(t0 + 11 * MIN) // past the 10-minute grace: ghost removed, room now empty
  assert.equal(getRoom(game.code), undefined, 'empty room is deleted')
})

test('reconnecting clears the ghost timer', () => {
  const { game, playerId } = createRoom('Host')
  const host = game.players.find((p) => p.id === playerId)!
  host.connected = false
  host.disconnectedAt = Date.now() - 9 * MIN
  // Simulate a rejoin just before the deadline.
  host.connected = true
  host.disconnectedAt = undefined

  sweepRooms(Date.now() + 60 * MIN)
  assert.equal(getRoom(game.code), game, 'connected players are never swept')
  getRoom(game.code) && sweepRooms(Date.now() + 3 * 60 * MIN) // stale cleanup still applies eventually
})
