import { useState } from 'react'
import { createRoom, joinRoom } from '../net'
import { toast, useStore } from '../store'

export function Home() {
  const [name, setName] = useState(localStorage.getItem('nodeal.name') ?? '')
  const [code, setCode] = useState('')
  const [adminCode, setAdminCode] = useState(localStorage.getItem('nodeal.admincode') ?? '')
  const error = useStore((s) => s.error)

  const withName = (fn: (name: string) => void) => {
    const n = name.trim()
    if (!n) return toast('Pick a nickname first')
    localStorage.setItem('nodeal.name', n)
    fn(n)
  }

  const create = () =>
    withName((n) => {
      if (!adminCode.trim()) return toast('Hosting needs an admin code — ask the app owner')
      localStorage.setItem('nodeal.admincode', adminCode.trim())
      createRoom(n, adminCode)
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
          placeholder="Admin code (only needed to host)"
          value={adminCode}
          onChange={(e) => setAdminCode(e.target.value)}
        />
        <button className="primary-btn big" onClick={create}>
          Create a room
        </button>
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
