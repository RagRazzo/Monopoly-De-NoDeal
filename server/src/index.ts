import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { createServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import type { Ack, Game, PlayActionOpts } from '../../shared/src/types.ts'
import type { Color } from '../../shared/src/cards.ts'
import * as engine from './engine.ts'
import {
  addCode,
  deleteCode,
  durableStorage,
  isMasterCode,
  isValidHostCode,
  listCodeStats,
  recentUsage,
  recordUsage,
  setCodeEnabled,
} from './hostCodes.ts'
import { botAct, botToAct, sweepTimeouts } from './bot.ts'
import { redactFor } from './redact.ts'
import { allRooms, createRoom, deleteRoom, getRoom } from './rooms.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: true } })

const clientDist = path.resolve(__dirname, '../../client/dist')
const bootedAt = Date.now()
app.get('/healthz', (_req, res) =>
  res.json({
    ok: true,
    revision: process.env.K_REVISION ?? 'dev', // Cloud Run sets this per deploy
    durableHostCodes: durableStorage,
    uptimeSeconds: Math.round((Date.now() - bootedAt) / 1000),
  }))
app.use(express.static(clientDist))
app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')))

interface SocketData {
  code?: string
  playerId?: string
}

// playerId -> socket id, so reconnects displace stale sockets
const socketsByPlayer = new Map<string, string>()

function broadcast(game: Game) {
  for (const p of game.players) {
    const sid = socketsByPlayer.get(p.id)
    if (sid) io.to(sid).emit('state', redactFor(game, p.id))
  }
  scheduleBot(game)
}

// The CPU acts one step at a time on a short delay so humans can follow the
// plays. Every broadcast re-checks whether a bot owes the game an action.
const botTimers = new Map<string, ReturnType<typeof setTimeout>>()

function scheduleBot(game: Game) {
  if (botTimers.has(game.code)) return
  // Pause the CPU while no human is connected (nobody is watching).
  if (!game.players.some((p) => !p.bot && !p.left && p.connected)) return
  if (!botToAct(game)) return
  const code = game.code
  botTimers.set(
    code,
    setTimeout(() => {
      botTimers.delete(code)
      const g = getRoom(code)
      if (!g) return
      const actor = botToAct(g)
      if (actor) {
        try {
          botAct(g, actor)
        } catch (err) {
          console.error(`bot error in room ${code}:`, err)
        }
      }
      broadcast(g)
    }, 800),
  )
}

function bind(socket: Socket, game: Game, playerId: string) {
  const data = socket.data as SocketData
  data.code = game.code
  data.playerId = playerId
  socketsByPlayer.set(playerId, socket.id)
  socket.join(game.code)
}

function withGame(
  socket: Socket,
  fn: (game: Game, playerId: string) => string | null,
): Ack {
  const data = socket.data as SocketData
  if (!data.code || !data.playerId) return { ok: false, error: 'Not in a room' }
  const game = getRoom(data.code)
  if (!game) return { ok: false, error: 'Room no longer exists' }
  const err = fn(game, data.playerId)
  if (err) return { ok: false, error: err }
  broadcast(game)
  return { ok: true }
}

io.on('connection', (socket) => {
  socket.on('createRoom', ({ name, hostCode, location }: { name: string; hostCode?: string; location?: string }, ack: (a: Ack<{ code: string; playerId: string; token: string }>) => void) => {
    const entered = String(hostCode ?? '')
    if (!isValidHostCode(entered)) {
      return ack({ ok: false, error: 'Invalid host code — ask the app owner for one to host games' })
    }
    const { game, playerId, token } = createRoom(String(name ?? ''))
    bind(socket, game, playerId)
    const fwd = socket.handshake.headers['x-forwarded-for']
    const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || socket.handshake.address
    recordUsage({
      at: Date.now(),
      code: entered.trim().toLowerCase(),
      location: String(location ?? '').slice(0, 120),
      ip,
      room: game.code,
    })
    ack({ ok: true, code: game.code, playerId, token })
    broadcast(game)
  })

  // ---- Host-code admin (every call re-checks the master code) ----
  type AdminAck = Ack<{ codes: ReturnType<typeof listCodeStats>; recent: ReturnType<typeof recentUsage>; durable: boolean }>
  const adminPayload = (): AdminAck => ({ ok: true, codes: listCodeStats(), recent: recentUsage(100), durable: durableStorage })

  socket.on('adminCheck', ({ code }: { code?: string }, ack: (a: { isMaster: boolean }) => void) =>
    ack({ isMaster: isMasterCode(String(code ?? '')) }))

  socket.on('adminListCodes', ({ master }: { master?: string }, ack: (a: AdminAck) => void) => {
    if (!isMasterCode(String(master ?? ''))) return ack({ ok: false, error: 'Not authorized' })
    ack(adminPayload())
  })

  socket.on('adminAddCode', ({ master, code }: { master?: string; code?: string }, ack: (a: AdminAck) => void) => {
    if (!isMasterCode(String(master ?? ''))) return ack({ ok: false, error: 'Not authorized' })
    const err = addCode(String(code ?? ''))
    ack(err ? { ok: false, error: err } : adminPayload())
  })

  socket.on('adminSetCode', ({ master, code, enabled }: { master?: string; code?: string; enabled?: boolean }, ack: (a: AdminAck) => void) => {
    if (!isMasterCode(String(master ?? ''))) return ack({ ok: false, error: 'Not authorized' })
    const err = setCodeEnabled(String(code ?? ''), !!enabled)
    ack(err ? { ok: false, error: err } : adminPayload())
  })

  socket.on('adminDeleteCode', ({ master, code }: { master?: string; code?: string }, ack: (a: AdminAck) => void) => {
    if (!isMasterCode(String(master ?? ''))) return ack({ ok: false, error: 'Not authorized' })
    const err = deleteCode(String(code ?? ''))
    ack(err ? { ok: false, error: err } : adminPayload())
  })

  socket.on('joinRoom', ({ code, name }: { code: string; name: string }, ack: (a: Ack<{ code: string; playerId: string; token: string }>) => void) => {
    const game = getRoom(String(code ?? ''))
    if (!game) return ack({ ok: false, error: 'Room not found' })
    const playerId = crypto.randomUUID()
    const token = crypto.randomUUID()
    const err = engine.addPlayer(game, String(name ?? ''), playerId, token)
    if (err) return ack({ ok: false, error: err })
    bind(socket, game, playerId)
    ack({ ok: true, code: game.code, playerId, token })
    broadcast(game)
  })

  socket.on('rejoin', ({ code, token }: { code: string; token: string }, ack: (a: Ack<{ code: string; playerId: string; token: string }>) => void) => {
    const game = getRoom(String(code ?? ''))
    const player = game?.players.find((p) => p.token === token && !p.left)
    if (!game || !player) return ack({ ok: false, error: 'Could not rejoin' })
    player.connected = true
    bind(socket, game, player.id)
    ack({ ok: true, code: game.code, playerId: player.id, token })
    broadcast(game)
  })

  socket.on('startGame', (_: unknown, ack: (a: Ack) => void) =>
    ack(withGame(socket, (g, pid) => engine.startGame(g, pid))))

  socket.on('startWithBot', (_: unknown, ack: (a: Ack) => void) =>
    ack(withGame(socket, (g, pid) => engine.startWithBot(g, pid))))

  socket.on('playMoney', ({ cardId }: { cardId: string }, ack: (a: Ack) => void) =>
    ack(withGame(socket, (g, pid) => engine.playMoney(g, pid, cardId))))

  socket.on('playProperty', ({ cardId, color, pileId }: { cardId: string; color?: Color; pileId?: string }, ack: (a: Ack) => void) =>
    ack(withGame(socket, (g, pid) => engine.playProperty(g, pid, cardId, color, pileId))))

  socket.on('playAction', ({ cardId, opts }: { cardId: string; opts: PlayActionOpts }, ack: (a: Ack) => void) =>
    ack(withGame(socket, (g, pid) => engine.playAction(g, pid, cardId, opts ?? {}))))

  socket.on('moveWild', ({ cardId, toColor, toPileId }: { cardId: string; toColor: Color; toPileId?: string }, ack: (a: Ack) => void) =>
    ack(withGame(socket, (g, pid) => engine.moveWild(g, pid, cardId, toColor, toPileId))))

  socket.on('endTurn', (_: unknown, ack: (a: Ack) => void) =>
    ack(withGame(socket, (g, pid) => engine.endTurn(g, pid))))

  socket.on('respondJsn', ({ useJsn }: { useJsn: boolean }, ack: (a: Ack) => void) =>
    ack(withGame(socket, (g, pid) => engine.respondJsn(g, pid, !!useJsn))))

  socket.on('submitPayment', ({ cardIds }: { cardIds: string[] }, ack: (a: Ack) => void) =>
    ack(withGame(socket, (g, pid) => engine.submitPayment(g, pid, cardIds ?? []))))

  socket.on('discardCards', ({ cardIds }: { cardIds: string[] }, ack: (a: Ack) => void) =>
    ack(withGame(socket, (g, pid) => engine.discardCards(g, pid, cardIds ?? []))))

  socket.on('forceResolve', (_: unknown, ack: (a: Ack) => void) =>
    ack(withGame(socket, (g, pid) => engine.forceResolve(g, pid))))

  socket.on('kickPlayer', ({ playerId }: { playerId: string }, ack: (a: Ack) => void) =>
    ack(withGame(socket, (g, pid) => engine.kickPlayer(g, pid, playerId))))

  socket.on('leaveRoom', (_: unknown, ack: (a: Ack) => void) => {
    const data = socket.data as SocketData
    const result = withGame(socket, (g, pid) => engine.removePlayer(g, pid))
    if (data.code) {
      const game = getRoom(data.code)
      if (game && game.players.filter((p) => !p.left).length === 0) deleteRoom(data.code)
      socket.leave(data.code)
    }
    if (data.playerId) socketsByPlayer.delete(data.playerId)
    data.code = undefined
    data.playerId = undefined
    ack(result)
  })

  socket.on('disconnect', () => {
    const data = socket.data as SocketData
    if (!data.code || !data.playerId) return
    if (socketsByPlayer.get(data.playerId) !== socket.id) return // superseded by a reconnect
    socketsByPlayer.delete(data.playerId)
    const game = getRoom(data.code)
    const player = game?.players.find((p) => p.id === data.playerId)
    if (!game || !player || player.left) return
    player.connected = false
    game.log.push(`${player.name} disconnected`)
    game.logSeq++
    if (game.phase === 'lobby') engine.removePlayer(game, player.id)
    broadcast(game)
  })
})

// Turn/response timeout sweeper: once a second, let the CPU step in for
// timed-out humans so one absent player can never freeze a table.
setInterval(() => {
  for (const game of allRooms()) {
    try {
      if (sweepTimeouts(game)) broadcast(game)
    } catch (err) {
      console.error(`timeout sweep error in room ${game.code}:`, err)
    }
  }
}, 1000).unref()

const port = Number(process.env.PORT) || 8080
httpServer.listen(port, () => {
  console.log(`Deal or No Deal 3D server listening on :${port}`)
})
