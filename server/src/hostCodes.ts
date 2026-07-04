// Host-code gate + management + usage tracking.
//
// Codes live in host-codes.json at the repo root (durable source of truth,
// loaded at startup). The in-app admin page mutates the in-memory list and
// writes the file back, so changes apply immediately — but the container
// filesystem is ephemeral, so they reset to the repo file on redeploy.
//
// Usage events are kept in memory (capped), appended to a local JSONL file,
// and echoed to stdout so Cloud Logging keeps a permanent trail.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HostCodeStat, HostCodeUsageEvent } from '../../shared/src/types.ts'

interface HostCodeEntry {
  code: string
  enabled: boolean
}

interface CodesFile {
  _readme?: string
  masterCode?: string
  codes: HostCodeEntry[]
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CODES_FILE = path.join(ROOT, 'host-codes.json')
const USAGE_FILE = path.join(ROOT, 'host-code-usage.jsonl')

const norm = (s: string) => s.trim().toLowerCase()

let file: CodesFile = { codes: [] }
try {
  file = JSON.parse(fs.readFileSync(CODES_FILE, 'utf8')) as CodesFile
  if (!Array.isArray(file.codes)) throw new Error('missing "codes" array')
} catch (err) {
  // Fail closed: a broken/missing file means nobody can create rooms.
  console.error(`Could not load host codes from ${CODES_FILE}:`, err)
  file = { codes: [] }
}

function save() {
  try {
    fs.writeFileSync(CODES_FILE, JSON.stringify(file, null, 2) + '\n')
  } catch (err) {
    console.error('Could not persist host codes:', err)
  }
}

export function isMasterCode(input: string): boolean {
  return !!file.masterCode && norm(input) === norm(file.masterCode)
}

export function isValidHostCode(input: string): boolean {
  const needle = norm(input)
  if (!needle) return false
  if (isMasterCode(needle)) return true
  return file.codes.some((e) => e.enabled && norm(e.code) === needle)
}

export function addCode(code: string): string | null {
  const c = norm(code)
  if (c.length < 3) return 'Host codes need at least 3 characters'
  if (c.length > 40) return 'Host code too long (max 40)'
  if (isMasterCode(c) || file.codes.some((e) => norm(e.code) === c)) return 'That code already exists'
  file.codes.push({ code: c, enabled: true })
  save()
  return null
}

export function setCodeEnabled(code: string, enabled: boolean): string | null {
  const entry = file.codes.find((e) => norm(e.code) === norm(code))
  if (!entry) return 'Code not found'
  entry.enabled = enabled
  save()
  return null
}

export function deleteCode(code: string): string | null {
  const before = file.codes.length
  file.codes = file.codes.filter((e) => norm(e.code) !== norm(code))
  if (file.codes.length === before) return 'Code not found'
  save()
  return null
}

// ---- Usage tracking ----

let usage: HostCodeUsageEvent[] = []
try {
  if (fs.existsSync(USAGE_FILE)) {
    usage = fs
      .readFileSync(USAGE_FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as HostCodeUsageEvent]
        } catch {
          return []
        }
      })
  }
} catch {
  usage = []
}

export function recordUsage(event: HostCodeUsageEvent) {
  usage.push(event)
  if (usage.length > 2000) usage.splice(0, usage.length - 2000)
  try {
    fs.appendFileSync(USAGE_FILE, JSON.stringify(event) + '\n')
  } catch {
    // Local log is best-effort; stdout below is the durable trail.
  }
  console.log(`host-code-usage ${JSON.stringify(event)}`)
}

export function listCodeStats(): HostCodeStat[] {
  return file.codes.map((e) => {
    const events = usage.filter((u) => u.code === norm(e.code))
    return {
      code: e.code,
      enabled: e.enabled,
      uses: events.length,
      lastUsedAt: events.length ? events[events.length - 1].at : null,
    }
  })
}

export function recentUsage(limit = 100): HostCodeUsageEvent[] {
  return usage.slice(-limit).reverse()
}
