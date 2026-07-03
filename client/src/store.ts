import { create } from 'zustand'
import type { ClientGame } from '@shared/types'

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
  setGame: (g: ClientGame | null) => void
  setConnected: (c: boolean) => void
  setError: (e: string | null) => void
  select: (id: string | null) => void
  setPrompt: (p: Prompt | null) => void
}

export const useStore = create<Store>((set) => ({
  game: null,
  connected: false,
  error: null,
  selectedCardId: null,
  prompt: null,
  setGame: (game) =>
    set((s) => ({
      game,
      // Drop selection if the card left our hand.
      selectedCardId:
        game && s.selectedCardId && game.yourHand.some((c) => c.id === s.selectedCardId)
          ? s.selectedCardId
          : null,
    })),
  setConnected: (connected) => set({ connected }),
  setError: (error) => set({ error }),
  select: (selectedCardId) => set({ selectedCardId, prompt: null }),
  setPrompt: (prompt) => set({ prompt }),
}))

let errTimer: ReturnType<typeof setTimeout> | undefined
export function toast(message: string) {
  useStore.getState().setError(message)
  clearTimeout(errTimer)
  errTimer = setTimeout(() => useStore.getState().setError(null), 3500)
}
