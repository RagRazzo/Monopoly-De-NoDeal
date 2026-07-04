import crypto from 'node:crypto'
import type { Game } from '../../shared/src/types.ts'
import { createGame, removePlayer } from './engine.ts'

const ROOMS = new Map<string, Game>()
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L

function newCode(): string {
  for (;;) {
    let code = ''
    for (let i = 0; i < 5; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
    if (!ROOMS.has(code)) return code
  }
}

export function createRoom(hostName: string): { game: Game; playerId: string; token: string } {
  const playerId = crypto.randomUUID()
  const token = crypto.randomUUID()
  const game = createGame(newCode(), hostName, playerId, token)
  ROOMS.set(game.code, game)
  return { game, playerId, token }
}

export function getRoom(code: string): Game | undefined {
  return ROOMS.get(code.toUpperCase().trim())
}

export function deleteRoom(code: string) {
  ROOMS.delete(code)
}

export function allRooms(): Iterable<Game> {
  return ROOMS.values()
}

// Housekeeping: drop rooms with no activity for 2 hours or finished for
// 15 minutes, and remove lobby players only after a long disconnect grace
// period (phones background the tab while sharing the invite link — the
// room must survive that).
const STALE_MS = 2 * 60 * 60 * 1000
const FINISHED_MS = 15 * 60 * 1000
const LOBBY_GHOST_MS = 10 * 60 * 1000

export function sweepRooms(now = Date.now()) {
  for (const [code, game] of ROOMS) {
    if (game.phase === 'lobby') {
      for (const p of [...game.players]) {
        if (!p.connected && p.disconnectedAt && now - p.disconnectedAt > LOBBY_GHOST_MS) {
          removePlayer(game, p.id)
        }
      }
    }
    const age = now - game.updatedAt
    if (age > STALE_MS || (game.phase === 'finished' && age > FINISHED_MS) || game.players.length === 0) {
      ROOMS.delete(code)
    }
  }
}

setInterval(() => sweepRooms(), 60 * 1000).unref()
