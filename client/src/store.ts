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
  setGame: (g: ClientGame | null) => void
  setConnected: (c: boolean) => void
  setError: (e: string | null) => void
  select: (id: string | null) => void
  setPrompt: (p: Prompt | null) => void
  moveCard: (id: string, dir: -1 | 1) => void
  setInspectCard: (c: Card | null) => void
  setInspectPlayer: (id: string | null) => void
  resetView: () => void
}

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
}))

let errTimer: ReturnType<typeof setTimeout> | undefined
export function toast(message: string) {
  useStore.getState().setError(message)
  clearTimeout(errTimer)
  errTimer = setTimeout(() => useStore.getState().setError(null), 3500)
}
