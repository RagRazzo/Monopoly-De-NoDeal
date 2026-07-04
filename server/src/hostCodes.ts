// Host-code gate + management + usage tracking.
//
// Two storage modes:
// - Default: host-codes.json at the repo root (baked into the image).
//   Admin-page edits write the container's copy, which is ephemeral.
// - Durable: set DATA_DIR (e.g. a Cloud Storage bucket mounted at /data on
//   Cloud Run). Codes + usage live there and survive deploys and restarts.
//   On boot the durable file is seeded from the repo file if absent; on
//   every boot the repo's masterCode wins and any NEW repo codes are merged
//   in, while admin-page deletions are kept as tombstones so a redeploy
//   cannot resurrect a deleted code.
//
// Usage events are kept in memory (capped), appended to a JSONL file, and
// echoed to stdout so Cloud Logging keeps a permanent trail either way.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { HostCodeStat, RoomUsage } from '../../shared/src/types.ts'

interface HostCodeEntry {
  code: string
  enabled: boolean
  deleted?: boolean
}

interface CodesFile {
  _readme?: string
  masterCode?: string
  codes: HostCodeEntry[]
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const REPO_CODES_FILE = path.join(ROOT, 'host-codes.json')
const DATA_DIR = process.env.DATA_DIR || null
export const durableStorage = !!DATA_DIR
const CODES_FILE = DATA_DIR ? path.join(DATA_DIR, 'host-codes.json') : REPO_CODES_FILE
const USAGE_FILE = path.join(DATA_DIR ?? ROOT, 'host-code-usage.jsonl')

// Self-test the data dir at boot so a broken mount is loudly visible on
// /healthz and the admin page instead of failing silently on every write.
// 'off' = no DATA_DIR; 'ok' = writable AND a real mounted volume;
// 'unmounted' = writable but plain container disk (no volume attached at
// that path — on Cloud Run this means data still vanishes on restart!);
// 'failed: <errno>' with EROFS = mount is read-only, EACCES = service
// account lacks Storage Object Admin, ENOENT = path mismatch.

// A directory that is not its own mount point is just container disk.
function isMountPoint(dir: string): boolean {
  try {
    if (!fs.existsSync('/proc/mounts')) return true // non-Linux dev box: can't tell, assume ok
    const target = path.resolve(dir)
    return fs
      .readFileSync('/proc/mounts', 'utf8')
      .split('\n')
      .some((line) => line.split(' ')[1] === target)
  } catch {
    return true
  }
}

export let durableStatus = 'off'
if (DATA_DIR) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    const probe = path.join(DATA_DIR, '.write-probe')
    fs.writeFileSync(probe, String(Date.now()))
    fs.readFileSync(probe, 'utf8')
    fs.unlinkSync(probe)
    if (isMountPoint(DATA_DIR)) {
      durableStatus = 'ok'
      console.log(`host-codes: DATA_DIR ${DATA_DIR} verified writable (mounted volume)`)
    } else {
      durableStatus = 'unmounted'
      console.error(
        `host-codes: DATA_DIR ${DATA_DIR} is writable but NOT a mounted volume — this is plain container disk and will be wiped on restart. Attach the Cloud Storage volume at exactly this path.`,
      )
    }
  } catch (err) {
    durableStatus = `failed: ${(err as NodeJS.ErrnoException).code ?? String(err)}`
    console.error(`host-codes: DATA_DIR ${DATA_DIR} is NOT writable — durable persistence broken:`, err)
  }
}

const norm = (s: string) => s.trim().toLowerCase()

function loadCodesFile(p: string): CodesFile | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as CodesFile
    if (!Array.isArray(parsed.codes)) throw new Error('missing "codes" array')
    return parsed
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`Could not load host codes from ${p}:`, err)
    }
    return null
  }
}

// Fail closed: with no readable file at all, nobody can create rooms.
let file: CodesFile = { codes: [] }
{
  const repo = loadCodesFile(REPO_CODES_FILE)
  if (!DATA_DIR) {
    file = repo ?? { codes: [] }
  } else {
    const durable = loadCodesFile(CODES_FILE)
    if (!durable) {
      file = repo ?? { codes: [] }
      save() // seed the durable copy from the repo file
      console.log(`host-codes: seeded durable store at ${CODES_FILE}`)
    } else {
      file = durable
      // The repo file stays authoritative for the master code, and new
      // codes added via the repo are merged in (tombstones block revival).
      if (repo?.masterCode) file.masterCode = repo.masterCode
      let merged = 0
      for (const e of repo?.codes ?? []) {
        if (!file.codes.some((x) => norm(x.code) === norm(e.code))) {
          file.codes.push({ code: e.code, enabled: e.enabled })
          merged++
        }
      }
      if (merged > 0) save()
      console.log(`host-codes: loaded durable store from ${CODES_FILE} (${merged} repo code(s) merged)`)
    }
  }
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
  return file.codes.some((e) => e.enabled && !e.deleted && norm(e.code) === needle)
}

export function addCode(code: string): string | null {
  const c = norm(code)
  if (c.length < 3) return 'Host codes need at least 3 characters'
  if (c.length > 40) return 'Host code too long (max 40)'
  if (isMasterCode(c)) return 'That code already exists'
  const existing = file.codes.find((e) => norm(e.code) === c)
  if (existing) {
    if (!existing.deleted) return 'That code already exists'
    existing.deleted = false // revive a previously deleted code
    existing.enabled = true
  } else {
    file.codes.push({ code: c, enabled: true })
  }
  save()
  return null
}

export function setCodeEnabled(code: string, enabled: boolean): string | null {
  const entry = file.codes.find((e) => norm(e.code) === norm(code) && !e.deleted)
  if (!entry) return 'Code not found'
  entry.enabled = enabled
  save()
  return null
}

export function deleteCode(code: string): string | null {
  const entry = file.codes.find((e) => norm(e.code) === norm(code) && !e.deleted)
  if (!entry) return 'Code not found'
  if (durableStorage) {
    // Tombstone so a redeploy's repo-merge cannot resurrect it.
    entry.deleted = true
    entry.enabled = false
  } else {
    file.codes = file.codes.filter((e) => e !== entry)
  }
  save()
  return null
}

// ---- Room usage tracking (lifecycle records) ----
//
// One record per room. Lifecycle updates (game started / ended) append a
// full snapshot line to the JSONL file; on load, snapshots merge by id with
// last-wins, so the log stays append-only while records stay updatable.

const records = new Map<string, RoomUsage>()
const activeByRoom = new Map<string, string>() // room code -> open record id

function persistUsage(rec: RoomUsage) {
  try {
    fs.appendFileSync(USAGE_FILE, JSON.stringify(rec) + '\n')
  } catch {
    // Local log is best-effort; stdout below is the durable trail.
  }
  console.log(`host-code-usage ${JSON.stringify(rec)}`)
}

function trimRecords() {
  const excess = records.size - 2000
  if (excess > 0) for (const id of [...records.keys()].slice(0, excess)) records.delete(id)
}

try {
  if (fs.existsSync(USAGE_FILE)) {
    for (const line of fs.readFileSync(USAGE_FILE, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const raw = JSON.parse(line) as Partial<RoomUsage> & { at: number; code: string; room: string }
        // Legacy creation-only events (pre-lifecycle) have no id.
        const id = raw.id ?? `${raw.room}-${raw.at}`
        records.set(id, { location: '', ip: '', ...records.get(id), ...raw, id })
      } catch {
        // skip corrupt lines
      }
    }
  }
} catch {
  // start empty
}
// Boot reconciliation: records still open belonged to a previous instance
// whose in-memory games are gone — close them as abandoned.
for (const rec of records.values()) {
  if (!rec.endedAt) {
    rec.endedAt = Date.now()
    rec.outcome = rec.outcome ?? 'abandoned'
    persistUsage(rec)
  }
}
trimRecords()

export function recordRoomCreated(input: Omit<RoomUsage, 'id'>) {
  // A rare room-code collision with a still-open record: close the old one.
  const prevId = activeByRoom.get(input.room)
  const prev = prevId ? records.get(prevId) : undefined
  if (prev && !prev.endedAt) {
    prev.endedAt = Date.now()
    prev.outcome = 'abandoned'
    persistUsage(prev)
  }
  const rec: RoomUsage = { ...input, id: crypto.randomUUID().slice(0, 10) }
  records.set(rec.id, rec)
  activeByRoom.set(rec.room, rec.id)
  trimRecords()
  persistUsage(rec)
}

function activeRecord(room: string): RoomUsage | undefined {
  const id = activeByRoom.get(room)
  return id ? records.get(id) : undefined
}

export function recordRoomStarted(room: string, info: { humans: number; bots: number }) {
  const rec = activeRecord(room)
  if (!rec || rec.startedAt) return
  rec.startedAt = Date.now()
  rec.humans = info.humans
  rec.bots = info.bots
  persistUsage(rec)
}

export function recordRoomEnded(
  room: string,
  info: { outcome: 'finished' | 'abandoned'; winner?: string; turns?: number },
) {
  const rec = activeRecord(room)
  activeByRoom.delete(room)
  if (!rec || rec.endedAt) return
  rec.endedAt = Date.now()
  rec.outcome = info.outcome
  if (info.winner) rec.winner = info.winner
  if (info.turns !== undefined) rec.turns = info.turns
  persistUsage(rec)
}

export function recentRooms(limit = 200): RoomUsage[] {
  return [...records.values()].slice(-limit).reverse()
}

export function listCodeStats(): HostCodeStat[] {
  const all = [...records.values()]
  return file.codes.filter((e) => !e.deleted).map((e) => {
    const mine = all.filter((r) => r.code === norm(e.code))
    return {
      code: e.code,
      enabled: e.enabled,
      uses: mine.length,
      lastUsedAt: mine.length ? Math.max(...mine.map((r) => r.at)) : null,
    }
  })
}
