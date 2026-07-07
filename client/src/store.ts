import { create } from 'zustand'
import type { Card } from '@shared/cards'
import type { ClientGame } from '@shared/types'
import { gameAudio } from './audio'

// Client-side hand ordering: cards keep the player's chosen order; cards not
// yet ordered (fresh draws) stay in their natural draw order at the end.
export function orderHand(hand: Card[], order: string[]): Card[] {
  const pos = new Map(order.map((id, i) => [id, i]))
  return [...hand].sort(
    (a, b) =>
      (pos.get(a.id) ?? order.length + hand.indexOf(a)) - (pos.get(b.id) ?? order.length + hand.indexOf(b)),
  )
}

export interface PromptOption {
  label: string
  sub?: string
  colorHex?: string
  onPick: () => void
}

export interface Prompt {
  title: string
  options: PromptOption[]
}

// Short, splashy overlay animations triggered by fresh log lines.
export type EffectKind =
  | 'dealbreaker'
  | 'slydeal'
  | 'forceddeal'
  | 'robbank'
  | 'robcaught'
  | 'marketcrash'
  | 'gofundme'
  | 'justsayno'
  | 'payment'

export interface TableEffect {
  id: number
  kind: EffectKind
}

function effectKindForLine(line: string): EffectKind | null {
  if (line.includes('🚨')) return 'robcaught'
  if (line.includes('📉') || line.includes('MARKET CRASH')) return 'marketcrash'
  if (line.includes('🙏') || line.includes('funded')) return 'gofundme'
  if (line.includes('deal-broke')) return 'dealbreaker'
  if (line.includes('sly-dealt')) return 'slydeal'
  if (line.includes('forced a deal')) return 'forceddeal'
  if (line.includes('robbed')) return 'robbank'
  if (line.includes('Just Say No')) return 'justsayno'
  if (line.includes('paid')) return 'payment'
  return null
}

const EFFECT_MS: Record<EffectKind, number> = {
  dealbreaker: 1500,
  slydeal: 1400,
  forceddeal: 1400,
  robbank: 1500,
  robcaught: 1900,
  marketcrash: 1900,
  gofundme: 1500,
  justsayno: 1300,
  payment: 1200,
}

interface Store {
  game: ClientGame | null
  connected: boolean
  error: string | null
  selectedCardId: string | null
  prompt: Prompt | null
  handOrder: string[]
  inspectCard: Card | null
  inspectPlayerId: string | null
  viewResetNonce: number
  effects: TableEffect[]
  setGame: (g: ClientGame | null) => void
  setConnected: (c: boolean) => void
  setError: (e: string | null) => void
  select: (id: string | null) => void
  setPrompt: (p: Prompt | null) => void
  moveCard: (id: string, dir: -1 | 1) => void
  setInspectCard: (c: Card | null) => void
  setInspectPlayer: (id: string | null) => void
  resetView: () => void
  pushEffect: (kind: EffectKind) => void
}

let effectSeq = 0

export const useStore = create<Store>((set, get) => ({
  game: null,
  connected: false,
  error: null,
  selectedCardId: null,
  prompt: null,
  handOrder: [],
  inspectCard: null,
  inspectPlayerId: null,
  viewResetNonce: 0,
  effects: [],
  setGame: (game) => {
    const prev = get().game
    set((s) => ({
      game,
      // Drop selection if the card left our hand.
      selectedCardId:
        game && s.selectedCardId && game.yourHand.some((c) => c.id === s.selectedCardId)
          ? s.selectedCardId
          : null,
    }))
    gameAudio(prev, game)
    // Splash effects from fresh log lines (skip on join/refresh to avoid replay).
    if (prev && game && prev.code === game.code) {
      const fresh = Math.min(Math.max(0, game.logSeq - prev.logSeq), 6, game.log.length)
      for (const line of game.log.slice(game.log.length - fresh)) {
        const kind = effectKindForLine(line)
        if (kind) get().pushEffect(kind)
      }
    }
  },
  setConnected: (connected) => set({ connected }),
  setError: (error) => set({ error }),
  select: (selectedCardId) => set({ selectedCardId, prompt: null }),
  setPrompt: (prompt) => set({ prompt }),
  moveCard: (id, dir) =>
    set((s) => {
      if (!s.game) return {}
      const ids = orderHand(s.game.yourHand, s.handOrder).map((c) => c.id)
      const i = ids.indexOf(id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= ids.length) return {}
      ;[ids[i], ids[j]] = [ids[j], ids[i]]
      return { handOrder: ids }
    }),
  setInspectCard: (inspectCard) => set({ inspectCard }),
  setInspectPlayer: (inspectPlayerId) => set({ inspectPlayerId }),
  resetView: () => set((s) => ({ viewResetNonce: s.viewResetNonce + 1 })),
  pushEffect: (kind) => {
    const id = ++effectSeq
    set((s) => ({ effects: [...s.effects, { id, kind }] }))
    setTimeout(() => set((s) => ({ effects: s.effects.filter((e) => e.id !== id) })), EFFECT_MS[kind])
  },
}))

let errTimer: ReturnType<typeof setTimeout> | undefined
export function toast(message: string) {
  useStore.getState().setError(message)
  clearTimeout(errTimer)
  errTimer = setTimeout(() => useStore.getState().setError(null), 3500)
}
