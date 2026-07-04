import { io } from 'socket.io-client'
import type { Ack, ClientGame } from '@shared/types'
import { toast, useStore } from './store'

export const socket = io()

interface Session {
  code: string
  token: string
}

function saveSession(s: Session | null) {
  if (s) localStorage.setItem('nodeal.session', JSON.stringify(s))
  else localStorage.removeItem('nodeal.session')
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem('nodeal.session')
    return raw ? (JSON.parse(raw) as Session) : null
  } catch {
    return null
  }
}

socket.on('connect', () => {
  useStore.getState().setConnected(true)
  const session = loadSession()
  const inGame = !!useStore.getState().game
  if (session && !inGame) {
    socket.emit('rejoin', session, (ack: Ack) => {
      if (!ack.ok) saveSession(null)
    })
  } else if (session && inGame) {
    // Reconnect after a drop mid-game.
    socket.emit('rejoin', session, () => {})
  }
})

socket.on('disconnect', () => useStore.getState().setConnected(false))
socket.on('state', (g: ClientGame) => useStore.getState().setGame(g))

type JoinAck = Ack<{ code: string; playerId: string; token: string }>

function enter(event: 'createRoom' | 'joinRoom', payload: object) {
  socket.emit(event, payload, (ack: JoinAck) => {
    if (!ack.ok) return toast(ack.error)
    saveSession({ code: ack.code, token: ack.token })
  })
}

export const createRoom = (name: string, adminCode: string) => enter('createRoom', { name, adminCode })
export const joinRoom = (code: string, name: string) => enter('joinRoom', { code, name })

export function send(event: string, payload: object = {}) {
  socket.emit(event, payload, (ack: Ack) => {
    if (!ack.ok) toast(ack.error)
  })
}

export function leaveRoom() {
  send('leaveRoom')
  saveSession(null)
  useStore.getState().setGame(null)
}
