import { useState } from 'react'
import { MAX_PLAYERS, MIN_PLAYERS, type ClientGame } from '@shared/types'
import { leaveRoom, send } from '../net'
import { useStore } from '../store'

export function Lobby({ game }: { game: ClientGame }) {
  const error = useStore((s) => s.error)
  const [copied, setCopied] = useState(false)
  const isHost = game.players.find((p) => p.id === game.youId)?.isHost
  const canStart = game.players.length >= MIN_PLAYERS

  const inviteUrl = `${window.location.origin}/?join=${game.code}`
  const inviteText = `Join my NoDeal 3D game! Room code ${game.code}`

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl)
    } catch {
      // Older/locked-down browsers: fall back to a hidden textarea.
      const ta = document.createElement('textarea')
      ta.value = inviteUrl
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const canShare = typeof navigator.share === 'function'
  const shareInvite = () => {
    navigator.share({ title: 'NoDeal 3D', text: inviteText, url: inviteUrl }).catch(() => {})
  }

  return (
    <div className="landing">
      <div className="landing-card">
        <h2>Room code</h2>
        <div className="big-code">{game.code}</div>
        <p className="muted">Share this code — friends join at this address. {game.players.length}/{MAX_PLAYERS} players.</p>
        <div className="invite-row">
          <button className="option-btn invite-btn" onClick={copyInvite}>
            {copied ? '✓ Link copied!' : '📋 Copy invite link'}
          </button>
          {canShare && (
            <button className="option-btn invite-btn" onClick={shareInvite}>
              📤 Share…
            </button>
          )}
        </div>
        <ul className="player-list">
          {game.players.map((p) => (
            <li key={p.id}>
              <span className={`dot ${p.connected ? 'on' : 'off'}`} />
              {p.name}
              {p.isHost && ' ♛'}
              {p.id === game.youId && ' (you)'}
            </li>
          ))}
        </ul>
        {isHost ? (
          <>
            <button className="primary-btn big" disabled={!canStart} onClick={() => send('startGame')}>
              {canStart ? 'Start game' : `Waiting for players (min ${MIN_PLAYERS})`}
            </button>
            {game.players.length === 1 && (
              <button className="option-btn cpu-btn" onClick={() => send('startWithBot')}>
                🤖 Play solo vs CPU
              </button>
            )}
          </>
        ) : (
          <p className="muted">Waiting for the host to start…</p>
        )}
        <button className="ghost-btn" onClick={leaveRoom}>
          Leave room
        </button>
        {error && <div className="toast inline">{error}</div>}
      </div>
    </div>
  )
}
