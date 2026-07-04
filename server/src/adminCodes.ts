// Room-creation gate. Codes live in admin-codes.json at the repo root so
// they can be edited without touching any code. Loaded once at startup.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

interface AdminCodeEntry {
  code: string
  enabled: boolean
}

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../admin-codes.json')

function loadCodes(): AdminCodeEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8')) as { codes?: AdminCodeEntry[] }
    if (!Array.isArray(raw.codes)) throw new Error('missing "codes" array')
    return raw.codes
  } catch (err) {
    // Fail closed: a broken/missing file means nobody can create rooms,
    // which is the safe direction for a gate.
    console.error(`Could not load admin codes from ${FILE}:`, err)
    return []
  }
}

const CODES = loadCodes()

export function matchesAdminCode(entries: AdminCodeEntry[], input: string): boolean {
  const needle = input.trim().toLowerCase()
  if (!needle) return false
  return entries.some((e) => e.enabled && e.code.trim().toLowerCase() === needle)
}

export function isValidAdminCode(input: string): boolean {
  return matchesAdminCode(CODES, input)
}
