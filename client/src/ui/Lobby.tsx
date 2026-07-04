import { MAX_PLAYERS, MIN_PLAYERS, type ClientGame } from '@shared/types'
import { leaveRoom, send } from '../net'
import { useStore } from '../store'

export function Lobby({ game }: { game: ClientGame }) {
  const error = useStore((s) => s.error)
  const isHost = game.players.find((p) => p.id === game.youId)?.isHost
  const canStart = game.players.length >= MIN_PLAYERS

  return (
    <div className="landing">
      <div className="landing-card">
        <h2>Room code</h2>
        <div className="big-code">{game.code}</div>
        <p className="muted">Share this code — friends join at this address. {game.players.length}/{MAX_PLAYERS} players.</p>
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
