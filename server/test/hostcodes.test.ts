import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addCode,
  deleteCode,
  isMasterCode,
  isValidHostCode,
  listCodeStats,
  recentRooms,
  recordRoomCreated,
  recordRoomEnded,
  recordRoomStarted,
  setCodeEnabled,
} from '../src/hostCodes.ts'

test('the seeded host codes are accepted (case/space-insensitive)', () => {
  for (const code of ['rougemont', 'netflix', 'apple', 'peach']) {
    assert.ok(isValidHostCode(code), code)
    assert.ok(isValidHostCode(` ${code.toUpperCase()} `), `${code} uppercase/padded`)
  }
})

test('master code unlocks admin and also works as a host code', () => {
  assert.ok(isMasterCode('rougemount9raju'))
  assert.ok(isMasterCode(' ROUGEMOUNT9RAJU '))
  assert.ok(isValidHostCode('rougemount9raju'))
  assert.equal(isMasterCode('rougemont'), false, 'plain host codes are not master')
})

test('wrong or empty codes are rejected', () => {
  assert.equal(isValidHostCode('banana'), false)
  assert.equal(isValidHostCode(''), false)
  assert.equal(isValidHostCode('   '), false)
})

test('add / disable / delete lifecycle', () => {
  const code = 'zzz-test-code'
  try {
    assert.equal(addCode(code), null)
    assert.ok(addCode(code), 'duplicate add must be rejected')
    assert.ok(isValidHostCode(code))
    assert.equal(setCodeEnabled(code, false), null)
    assert.equal(isValidHostCode(code), false, 'disabled code must be rejected')
    assert.equal(setCodeEnabled(code, true), null)
    assert.ok(isValidHostCode(code))
  } finally {
    assert.equal(deleteCode(code), null)
  }
  assert.equal(isValidHostCode(code), false)
  assert.ok(deleteCode(code), 'deleting a missing code must error')
  assert.ok(addCode('ab'), 'too-short codes are rejected')
})

test('usage is tracked per code', () => {
  // The usage log persists across runs (by design), so assert deltas.
  const code = 'zzz-usage-code'
  try {
    assert.equal(addCode(code), null)
    const before = listCodeStats().find((s) => s.code === code)?.uses ?? 0
    const at = Date.now()
    recordRoomCreated({ at, code, location: 'America/Toronto · en-US', ip: '1.2.3.4', room: 'ZZZU1' })
    recordRoomCreated({ at: at + 1000, code, location: 'America/Toronto · en-US', ip: '1.2.3.4', room: 'ZZZU2' })
    const stat = listCodeStats().find((s) => s.code === code)
    assert.ok(stat)
    assert.equal(stat.uses, before + 2)
    assert.equal(stat.lastUsedAt, at + 1000)
  } finally {
    recordRoomEnded('ZZZU1', { outcome: 'abandoned' })
    recordRoomEnded('ZZZU2', { outcome: 'abandoned' })
    deleteCode(code)
  }
})

test('room lifecycle: created -> started -> ended updates one record', () => {
  const code = 'zzz-lifecycle'
  try {
    assert.equal(addCode(code), null)
    recordRoomCreated({ at: Date.now(), code, location: 'tz', ip: '1.1.1.1', room: 'ZZZL1' })

    let rec = recentRooms(500).find((r) => r.room === 'ZZZL1' && r.code === code)
    assert.ok(rec)
    assert.equal(rec.startedAt, undefined)

    recordRoomStarted('ZZZL1', { humans: 3, bots: 1 })
    rec = recentRooms(500).find((r) => r.room === 'ZZZL1' && r.code === code)
    assert.ok(rec?.startedAt, 'start recorded')
    assert.equal(rec.humans, 3)
    assert.equal(rec.bots, 1)

    recordRoomEnded('ZZZL1', { outcome: 'finished', winner: 'Alice', turns: 24 })
    rec = recentRooms(500).find((r) => r.room === 'ZZZL1' && r.code === code)
    assert.ok(rec?.endedAt, 'end recorded')
    assert.equal(rec.outcome, 'finished')
    assert.equal(rec.winner, 'Alice')
    assert.equal(rec.turns, 24)

    // Ending again is a no-op (already closed).
    recordRoomEnded('ZZZL1', { outcome: 'abandoned' })
    rec = recentRooms(500).find((r) => r.room === 'ZZZL1' && r.code === code)
    assert.equal(rec?.outcome, 'finished')
  } finally {
    deleteCode(code)
  }
})
