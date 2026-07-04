import { useEffect, useState } from 'react'
import { createRoom, joinRoom, socket } from '../net'
import { toast, useStore } from '../store'
import { AdminPage } from './AdminPage'

export function Home() {
  const [name, setName] = useState(localStorage.getItem('nodeal.name') ?? '')
  const [code, setCode] = useState('')
  const [hostCode, setHostCode] = useState(
    localStorage.getItem('nodeal.hostcode') ?? localStorage.getItem('nodeal.admincode') ?? '',
  )
  const [isMaster, setIsMaster] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const error = useStore((s) => s.error)

  // Reveal the admin button only when the entered host code is the master
  // code (checked server-side so the master code never ships in the bundle).
  useEffect(() => {
    const entered = hostCode.trim()
    if (entered.length < 6) {
      setIsMaster(false)
      return
    }
    const t = setTimeout(
      () => socket.emit('adminCheck', { code: entered }, (a: { isMaster?: boolean }) => setIsMaster(!!a?.isMaster)),
      300,
    )
    return () => clearTimeout(t)
  }, [hostCode])

  if (showAdmin) return <AdminPage master={hostCode.trim()} onBack={() => setShowAdmin(false)} />

  const withName = (fn: (name: string) => void) => {
    const n = name.trim()
    if (!n) return toast('Pick a nickname first')
    localStorage.setItem('nodeal.name', n)
    fn(n)
  }

  const create = () =>
    withName((n) => {
      if (!hostCode.trim()) return toast('Hosting needs a host code — ask the app owner')
      localStorage.setItem('nodeal.hostcode', hostCode.trim())
      createRoom(n, hostCode)
    })

  return (
    <div className="landing">
      <div className="landing-card">
        <h1>
          NoDeal <span className="accent">3D</span>
        </h1>
        <p className="muted">The fast-dealing property card game — 2 to 6 players, online with friends.</p>
        <input
          placeholder="Your nickname"
          maxLength={16}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          placeholder="Host code (only needed to host)"
          value={hostCode}
          onChange={(e) => setHostCode(e.target.value)}
        />
        <button className="primary-btn big" onClick={create}>
          Create a room
        </button>
        {isMaster && (
          <button className="option-btn cpu-btn" onClick={() => setShowAdmin(true)}>
            🛠 Manage host codes
          </button>
        )}
        <div className="join-row">
          <input
            placeholder="Room code"
            maxLength={5}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button
            className="option-btn"
            onClick={() => withName((n) => (code.trim() ? joinRoom(code, n) : toast('Enter a room code')))}
          >
            Join
          </button>
        </div>
        {error && <div className="toast inline">{error}</div>}
        <details className="rules">
          <summary>How to play</summary>
          <ul>
            <li>On your turn draw 2 cards and play up to 3.</li>
            <li>Bank money, lay properties, or hit opponents with action cards.</li>
            <li>Charge rent, steal properties, and block attacks with Just Say No.</li>
            <li>First to 3 complete property sets of different colors wins.</li>
          </ul>
        </details>
      </div>
    </div>
  )
}
