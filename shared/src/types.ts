import type { ActionName, Card, Color } from './cards.ts'

export const MAX_PLAYERS = 6
export const MIN_PLAYERS = 2
export const HAND_LIMIT = 7
export const PLAYS_PER_TURN = 3
export const SETS_TO_WIN = 3
export const TURN_SECONDS = 90 // time to finish your turn before the CPU steps in
export const RESPONSE_SECONDS = 45 // time to answer a payment/JSN/discard prompt

export interface Pile {
  id: string
  color: Color
  cards: Card[] // property + wild cards (and house/hotel action cards)
}

export interface Player {
  id: string
  token: string
  name: string
  seat: number
  connected: boolean
  disconnectedAt?: number
  left: boolean
  bot: boolean
  hand: Card[]
  bank: Card[]
  piles: Pile[]
}

export type DemandAction =
  | 'rent'
  | 'birthday'
  | 'debtcollector'
  | 'slydeal'
  | 'forceddeal'
  | 'dealbreaker'
  | 'robbank'
  | 'tax'

export interface TargetState {
  playerId: string
  stage: 'jsn' | 'pay'
  awaiting: string // player whose response is required next
  jsnDepth: number
  amount?: number // per-target amount owed (e.g. Tax Day scales with sets)
}

export interface Demand {
  action: DemandAction
  attackerId: string
  targets: TargetState[]
  index: number
  amount?: number
  targetCardId?: string
  myCardId?: string
  targetPileId?: string
}

export type Pending =
  | { kind: 'demand'; demand: Demand }
  | { kind: 'discard'; playerId: string; mustDiscard: number }

export interface Game {
  code: string
  hostId: string
  phase: 'lobby' | 'playing' | 'finished'
  players: Player[]
  deck: Card[]
  discard: Card[]
  turnIndex: number
  playsLeft: number
  pending: Pending | null
  winnerId: string | null
  log: string[]
  logSeq: number // total lines ever logged (log itself is trimmed)
  pileSeq: number
  updatedAt: number
  turnStartedAt: number
  turnsPlayed: number
  // Timeout bookkeeping maintained by the server sweeper.
  pendingKey?: string
  pendingSince?: number
}

// ---- Client-facing (redacted) types ----

export interface ClientPlayer {
  id: string
  name: string
  seat: number
  connected: boolean
  left: boolean
  isHost: boolean
  isBot: boolean
  handCount: number
  bank: Card[]
  piles: Pile[]
}

export interface ClientPending {
  kind: 'demand' | 'discard'
  action?: DemandAction | 'discard'
  attackerId?: string
  targetId?: string
  awaitingId: string
  stage?: 'jsn' | 'pay'
  jsnDepth?: number
  amount?: number
  mustDiscard?: number
  description: string
}

export interface ClientGame {
  code: string
  phase: 'lobby' | 'playing' | 'finished'
  youId: string
  players: ClientPlayer[]
  yourHand: Card[]
  deckCount: number
  discardTop: Card | null
  discardCount: number
  turnPlayerId: string | null
  playsLeft: number
  pending: ClientPending | null
  winnerId: string | null
  log: string[]
  logSeq: number
  now: number // server clock at redaction time, for countdown skew correction
  turnDeadline: number | null
  responseDeadline: number | null
}

export interface HostCodeStat {
  code: string
  enabled: boolean
  uses: number
  lastUsedAt: number | null
}

// One record per room, updated through its lifecycle (created -> game
// started -> ended). Persisted as append-only JSONL snapshots, last wins.
export interface RoomUsage {
  id: string
  at: number // room created
  code: string // host code used
  location: string // browser-reported timezone + language
  ip: string
  room: string // room code
  humans?: number // players when the game started
  bots?: number
  startedAt?: number
  endedAt?: number
  outcome?: 'finished' | 'abandoned'
  winner?: string
  turns?: number
}

export interface PlayActionOpts {
  targetPlayerId?: string
  targetCardId?: string
  myCardId?: string
  targetPileId?: string
  pileId?: string // for house/hotel
  color?: Color // for rent
  doubleRentCardIds?: string[]
  quadRentCardIds?: string[] // Quadruple Rent boosters played with a rent card
}

export type Ack<T = {}> = { ok: true } & T | { ok: false; error: string }
