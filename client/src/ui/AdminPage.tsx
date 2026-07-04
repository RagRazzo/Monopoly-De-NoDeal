import { useCallback, useEffect, useState } from 'react'
import type { HostCodeStat, HostCodeUsageEvent } from '@shared/types'
import { socket } from '../net'
import { toast, useStore } from '../store'

interface AdminData {
  codes: HostCodeStat[]
  recent: HostCodeUsageEvent[]
  durable: string // 'off' | 'ok' | 'failed: <errno>'
}

type AdminAck = ({ ok: true } & AdminData) | { ok: false; error: string }

export function AdminPage({ master, onBack }: { master: string; onBack: () => void }) {
  const [data, setData] = useState<AdminData | null>(null)
  const [newCode, setNewCode] = useState('')
  const error = useStore((s) => s.error)

  const handle = useCallback((ack: AdminAck) => {
    if (!ack.ok) return toast(ack.error)
    setData({ codes: ack.codes, recent: ack.recent, durable: ack.durable })
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
            <h3>Recent room creations</h3>
            {data.recent.length === 0 ? (
              <p className="muted">No rooms created yet (history resets on redeploy).</p>
            ) : (
              <ul className="usage-list">
                {data.recent.map((u, i) => (
                  <li key={i} className="usage-row">
                    <span className="code-name">{u.code}</span>
                    <span>{new Date(u.at).toLocaleString()}</span>
                    <span className="muted">
                      {u.location || 'unknown location'} · {u.ip} · room {u.room}
                    </span>
                  </li>
                ))}
              </ul>
            )}
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
