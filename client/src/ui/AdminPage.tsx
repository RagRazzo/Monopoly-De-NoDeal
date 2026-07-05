import { useCallback, useEffect, useState } from 'react'
import type { HostCodeStat, RoomUsage } from '@shared/types'
import { socket } from '../net'
import { toast, useStore } from '../store'

interface AdminData {
  codes: HostCodeStat[]
  rooms: RoomUsage[]
  durable: string // 'off' | 'ok' | 'unmounted' | 'failed: <errno>'
}

type AdminAck = ({ ok: true } & AdminData) | { ok: false; error: string }

const fmt = (t?: number | null) => (t ? new Date(t).toLocaleString() : '—')

function roomStatus(r: RoomUsage): { label: string; cls: string } {
  if (!r.endedAt) return { label: r.startedAt ? 'LIVE' : 'LOBBY', cls: 'on' }
  return r.outcome === 'finished' ? { label: 'DONE', cls: 'done' } : { label: 'GONE', cls: 'off' }
}

function RoomRow({
  r,
  onDelete,
}: {
  r: RoomUsage
  onDelete: (id: string) => void
}) {
  const status = roomStatus(r)
  const duration =
    r.startedAt && r.endedAt ? Math.max(1, Math.round((r.endedAt - r.startedAt) / 60000)) : null
  return (
    <details className="room-item">
      <summary>
        <span className={`pill ${status.cls}`}>{status.label}</span>
        <span className="room-code-label">{r.room}</span>
        <span className="muted room-summary-time">
          {fmt(r.at)}
          {r.humans !== undefined && ` · ${r.humans}👤${r.bots ? ` + ${r.bots}🤖` : ''}`}
        </span>
        <button
          className="option-btn small danger row-delete"
          title="Delete this log entry (permanent)"
          onClick={(e) => {
            e.preventDefault() // stop <details> from toggling
            e.stopPropagation()
            if (window.confirm(`Permanently delete the log for room ${r.room}?`)) onDelete(r.id)
          }}
        >
          ✕
        </button>
      </summary>
      <div className="room-detail">
        <div>Room created: {fmt(r.at)}</div>
        <div>
          Game started: {fmt(r.startedAt)}
          {r.humans !== undefined && ` — ${r.humans} player${r.humans === 1 ? '' : 's'}${r.bots ? ` + ${r.bots} CPU` : ''}`}
        </div>
        <div>
          Ended: {fmt(r.endedAt)}
          {r.outcome && ` (${r.outcome})`}
          {r.winner && ` · 🏆 ${r.winner}`}
          {r.turns ? ` · ${r.turns} turns` : ''}
          {duration && ` · ~${duration} min`}
        </div>
        <div>
          From: {r.location || 'unknown location'} · {r.ip}
        </div>
      </div>
    </details>
  )
}

function RoomsByCode({
  rooms,
  onDeleteRoom,
  onClearCode,
}: {
  rooms: RoomUsage[]
  onDeleteRoom: (id: string) => void
  onClearCode: (code: string) => void
}) {
  const groups = new Map<string, RoomUsage[]>()
  for (const r of rooms) {
    const list = groups.get(r.code) ?? []
    list.push(r)
    groups.set(r.code, list)
  }
  if (rooms.length === 0) return <p className="muted">No rooms created yet.</p>
  return (
    <>
      {[...groups.entries()].map(([code, list]) => (
        <details key={code} className="pile-group code-group">
          <summary>
            <span className="code-name">{code}</span>
            <span className="muted">
              {list.length} room{list.length === 1 ? '' : 's'} · last {fmt(list[0].at)}
            </span>
            <button
              className="option-btn small danger row-delete"
              title="Delete all log entries for this host code (permanent)"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                if (window.confirm(`Permanently delete ALL ${list.length} log entries for "${code}"?`))
                  onClearCode(code)
              }}
            >
              🗑 Clear all
            </button>
          </summary>
          {list.map((r) => (
            <RoomRow key={r.id} r={r} onDelete={onDeleteRoom} />
          ))}
        </details>
      ))}
    </>
  )
}

export function AdminPage({ master, onBack }: { master: string; onBack: () => void }) {
  const [data, setData] = useState<AdminData | null>(null)
  const [newCode, setNewCode] = useState('')
  const error = useStore((s) => s.error)

  const handle = useCallback((ack: AdminAck) => {
    if (!ack.ok) return toast(ack.error)
    setData({ codes: ack.codes, rooms: ack.rooms, durable: ack.durable })
  }, [])

  useEffect(() => {
    socket.emit('adminListCodes', { master }, handle)
  }, [master, handle])

  const fmt = (t: number | null) => (t ? new Date(t).toLocaleString() : 'never used')

  return (
    <div className="landing">
      <div className="landing-card admin-card">
        <h2>Host codes</h2>
        {data && data.durable === 'ok' && (
          <p className="muted">✅ Durable storage is on — changes here survive deploys and restarts.</p>
        )}
        {data && data.durable === 'off' && (
          <p className="muted">
            ⚠️ No durable storage: changes here reset to <code>host-codes.json</code> on the next
            deploy or restart. Mount a Cloud Storage volume and set <code>DATA_DIR</code> to keep
            them (see README).
          </p>
        )}
        {data && data.durable === 'unmounted' && (
          <p className="muted storage-broken">
            ❌ DATA_DIR is set but no volume is mounted there — writes are going to plain container
            disk and will NOT survive. In Cloud Run: Volumes tab → add the Cloud Storage bucket,
            then Container tab → Volume mounts → mount it at exactly the DATA_DIR path.
          </p>
        )}
        {data && data.durable.startsWith('failed') && (
          <p className="muted storage-broken">
            ❌ DATA_DIR is set but not writable ({data.durable}) — changes will NOT survive.
            EROFS: volume mounted read-only · EACCES: service account needs Storage Object Admin ·
            ENOENT: DATA_DIR doesn't match the mount path.
          </p>
        )}
        {!data ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <ul className="code-list">
              {data.codes.map((c) => (
                <li key={c.code} className="code-row">
                  <span className={`pill ${c.enabled ? 'on' : 'off'}`}>{c.enabled ? 'ON' : 'OFF'}</span>
                  <span className="code-name">
                    {c.code}
                    <small className="muted">
                      {c.uses} room{c.uses === 1 ? '' : 's'} · {fmt(c.lastUsedAt)}
                    </small>
                  </span>
                  <button
                    className="option-btn small"
                    onClick={() => socket.emit('adminSetCode', { master, code: c.code, enabled: !c.enabled }, handle)}
                  >
                    {c.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    className="option-btn small danger"
                    onClick={() => {
                      if (window.confirm(`Delete host code "${c.code}"?`))
                        socket.emit('adminDeleteCode', { master, code: c.code }, handle)
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <div className="join-row">
              <input
                placeholder="New host code"
                maxLength={40}
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
              />
              <button
                className="primary-btn"
                onClick={() => {
                  if (!newCode.trim()) return toast('Type the new code first')
                  socket.emit('adminAddCode', { master, code: newCode }, (a: AdminAck) => {
                    handle(a)
                    if (a.ok) setNewCode('')
                  })
                }}
              >
                Add
              </button>
            </div>
            <h3>Rooms by host code</h3>
            <RoomsByCode
              rooms={data.rooms}
              onDeleteRoom={(id) => socket.emit('adminDeleteRoomUsage', { master, id }, handle)}
              onClearCode={(code) => socket.emit('adminDeleteUsageForCode', { master, code }, handle)}
            />
          </>
        )}
        <button className="ghost-btn" onClick={onBack}>
          ← Back to home
        </button>
        {error && <div className="toast inline">{error}</div>}
      </div>
    </div>
  )
}
