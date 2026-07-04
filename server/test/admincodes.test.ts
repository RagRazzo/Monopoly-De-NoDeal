import test from 'node:test'
import assert from 'node:assert/strict'
import { isValidAdminCode, matchesAdminCode } from '../src/adminCodes.ts'

test('the four seeded codes are accepted (case/space-insensitive)', () => {
  for (const code of ['rougemont', 'netflix', 'apple', 'peach']) {
    assert.ok(isValidAdminCode(code), code)
    assert.ok(isValidAdminCode(` ${code.toUpperCase()} `), `${code} uppercase/padded`)
  }
})

test('wrong or empty codes are rejected', () => {
  assert.equal(isValidAdminCode('banana'), false)
  assert.equal(isValidAdminCode(''), false)
  assert.equal(isValidAdminCode('   '), false)
})

test('disabled codes are rejected', () => {
  const entries = [
    { code: 'alpha', enabled: true },
    { code: 'beta', enabled: false },
  ]
  assert.ok(matchesAdminCode(entries, 'alpha'))
  assert.equal(matchesAdminCode(entries, 'beta'), false)
})
