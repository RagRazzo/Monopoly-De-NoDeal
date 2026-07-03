// Card definitions and deck construction.
//
// The base deck (2-4 players) mirrors the classic 106-card property-trading
// deck. For 5 players every count is scaled by 4/3 (~140 cards) and for
// 6 players by 3/2 (~160 cards), so draw probabilities for every card type
// stay faithful to the base game while giving larger tables enough
// properties to complete sets.

export type Color =
  | 'brown'
  | 'lightblue'
  | 'pink'
  | 'orange'
  | 'red'
  | 'yellow'
  | 'green'
  | 'darkblue'
  | 'railroad'
  | 'utility'

export interface ColorInfo {
  label: string
  hex: string
  setSize: number
  rent: number[] // rent by number of properties owned (1..setSize)
  buildable: boolean // whether house/hotel may be added
}

export const COLOR_INFO: Record<Color, ColorInfo> = {
  brown: { label: 'Brown', hex: '#8b5a2b', setSize: 2, rent: [1, 2], buildable: true },
  lightblue: { label: 'Sky', hex: '#7ec8e3', setSize: 3, rent: [1, 2, 3], buildable: true },
  pink: { label: 'Pink', hex: '#e75fa5', setSize: 3, rent: [1, 2, 4], buildable: true },
  orange: { label: 'Orange', hex: '#f28c28', setSize: 3, rent: [1, 3, 5], buildable: true },
  red: { label: 'Red', hex: '#d63031', setSize: 3, rent: [2, 3, 6], buildable: true },
  yellow: { label: 'Yellow', hex: '#f4c430', setSize: 3, rent: [2, 4, 6], buildable: true },
  green: { label: 'Green', hex: '#2e8b57', setSize: 3, rent: [2, 4, 7], buildable: true },
  darkblue: { label: 'Navy', hex: '#1e3a8a', setSize: 2, rent: [3, 8], buildable: true },
  railroad: { label: 'Rail', hex: '#404040', setSize: 4, rent: [1, 2, 3, 4], buildable: false },
  utility: { label: 'Utility', hex: '#9acd32', setSize: 2, rent: [1, 2], buildable: false },
}

export const ALL_COLORS = Object.keys(COLOR_INFO) as Color[]

export type ActionName =
  | 'dealbreaker'
  | 'justsayno'
  | 'passgo'
  | 'forceddeal'
  | 'slydeal'
  | 'debtcollector'
  | 'birthday'
  | 'doublerent'
  | 'house'
  | 'hotel'

export const ACTION_INFO: Record<ActionName, { label: string; text: string }> = {
  dealbreaker: { label: 'Deal Breaker', text: 'Steal a complete property set from any player.' },
  justsayno: { label: 'Just Say No!', text: 'Cancel an action played against you.' },
  passgo: { label: 'Pass Go', text: 'Draw 2 extra cards.' },
  forceddeal: { label: 'Forced Deal', text: 'Swap one of your properties with any player (not from a complete set).' },
  slydeal: { label: 'Sly Deal', text: 'Steal a property from any player (not from a complete set).' },
  debtcollector: { label: 'Debt Collector', text: 'Force one player to pay you 5M.' },
  birthday: { label: "It's My Birthday!", text: 'All players give you 2M as a gift.' },
  doublerent: { label: 'Double The Rent', text: 'Play with a rent card to double the amount charged.' },
  house: { label: 'House', text: 'Add 3M to the rent of a complete set (not rail/utility).' },
  hotel: { label: 'Hotel', text: 'Add 4M to the rent of a complete set that has a house.' },
}

export type Card =
  | { id: string; kind: 'money'; value: number }
  | { id: string; kind: 'property'; color: Color; value: number }
  | { id: string; kind: 'wild'; colors: Color[] | 'any'; value: number }
  | { id: string; kind: 'rent'; colors: Color[] | 'any'; value: number }
  | { id: string; kind: 'action'; action: ActionName; value: number }

interface Spec {
  baseCount: number
  make: () => Omit<Card, 'id'>
}

const SPECS: Spec[] = []
const money = (value: number, baseCount: number) =>
  SPECS.push({ baseCount, make: () => ({ kind: 'money', value }) })
const prop = (color: Color, value: number, baseCount: number) =>
  SPECS.push({ baseCount, make: () => ({ kind: 'property', color, value }) })
const wild = (colors: Color[] | 'any', value: number, baseCount: number) =>
  SPECS.push({ baseCount, make: () => ({ kind: 'wild', colors, value }) })
const rent = (colors: Color[] | 'any', value: number, baseCount: number) =>
  SPECS.push({ baseCount, make: () => ({ kind: 'rent', colors, value }) })
const action = (name: ActionName, value: number, baseCount: number) =>
  SPECS.push({ baseCount, make: () => ({ kind: 'action', action: name, value }) })

// Money (20)
money(1, 6)
money(2, 5)
money(3, 3)
money(4, 3)
money(5, 2)
money(10, 1)

// Properties (28)
prop('brown', 1, 2)
prop('lightblue', 1, 3)
prop('pink', 2, 3)
prop('orange', 2, 3)
prop('red', 3, 3)
prop('yellow', 3, 3)
prop('green', 4, 3)
prop('darkblue', 4, 2)
prop('railroad', 2, 4)
prop('utility', 2, 2)

// Property wildcards (11)
wild(['darkblue', 'green'], 4, 1)
wild(['green', 'railroad'], 4, 1)
wild(['utility', 'railroad'], 2, 1)
wild(['lightblue', 'brown'], 1, 1)
wild(['lightblue', 'railroad'], 4, 1)
wild(['pink', 'orange'], 2, 2)
wild(['red', 'yellow'], 3, 2)
wild('any', 0, 2)

// Rent cards (13)
rent(['darkblue', 'green'], 1, 2)
rent(['red', 'yellow'], 1, 2)
rent(['pink', 'orange'], 1, 2)
rent(['lightblue', 'brown'], 1, 2)
rent(['railroad', 'utility'], 1, 2)
rent('any', 3, 3)

// Actions (34)
action('dealbreaker', 5, 2)
action('justsayno', 4, 3)
action('passgo', 1, 10)
action('forceddeal', 3, 3)
action('slydeal', 3, 3)
action('debtcollector', 3, 3)
action('birthday', 2, 3)
action('doublerent', 1, 2)
action('house', 3, 3)
action('hotel', 4, 2)

export function deckScale(playerCount: number): number {
  if (playerCount <= 4) return 1
  if (playerCount === 5) return 4 / 3
  return 3 / 2
}

export type Rng = () => number // uniform [0, 1)

export function buildDeck(playerCount: number, rng: Rng): Card[] {
  const scale = deckScale(playerCount)
  const deck: Card[] = []
  let n = 0
  for (const spec of SPECS) {
    const count = Math.max(1, Math.round(spec.baseCount * scale))
    for (let i = 0; i < count; i++) {
      deck.push({ ...spec.make(), id: `c${n++}` } as Card)
    }
  }
  shuffle(deck, rng)
  return deck
}

// Unbiased Fisher-Yates shuffle.
export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function cardLabel(card: Card): string {
  switch (card.kind) {
    case 'money':
      return `${card.value}M`
    case 'property':
      return `${COLOR_INFO[card.color].label} Property`
    case 'wild':
      return card.colors === 'any'
        ? 'Rainbow Wildcard'
        : `${COLOR_INFO[card.colors[0]].label}/${COLOR_INFO[card.colors[1]].label} Wildcard`
    case 'rent':
      return card.colors === 'any'
        ? 'Wild Rent'
        : `${COLOR_INFO[card.colors[0]].label}/${COLOR_INFO[card.colors[1]].label} Rent`
    case 'action':
      return ACTION_INFO[card.action].label
  }
}
