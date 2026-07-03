import { COLOR_INFO, type Card, type Color } from './cards.ts'
import { SETS_TO_WIN, type Pile, type Player } from './types.ts'

export function isPropertyCard(card: Card): boolean {
  return card.kind === 'property' || card.kind === 'wild'
}

export function isBuilding(card: Card): boolean {
  return card.kind === 'action' && (card.action === 'house' || card.action === 'hotel')
}

export function pilePropertyCount(pile: Pile): number {
  return pile.cards.filter(isPropertyCard).length
}

export function isPileComplete(pile: Pile): boolean {
  return pilePropertyCount(pile) >= COLOR_INFO[pile.color].setSize
}

export function pileHas(pile: Pile, action: 'house' | 'hotel'): boolean {
  return pile.cards.some((c) => c.kind === 'action' && c.action === action)
}

export function pileRent(pile: Pile): number {
  const info = COLOR_INFO[pile.color]
  const n = Math.min(pilePropertyCount(pile), info.setSize)
  if (n === 0) return 0
  let rent = info.rent[n - 1]
  if (pileHas(pile, 'house')) rent += 3
  if (pileHas(pile, 'hotel')) rent += 4
  return rent
}

export function playerWorth(player: Player): number {
  let total = player.bank.reduce((s, c) => s + c.value, 0)
  for (const pile of player.piles) for (const c of pile.cards) total += c.value
  return total
}

export function completeSetColors(player: Player): Color[] {
  const colors = new Set<Color>()
  for (const pile of player.piles) if (isPileComplete(pile)) colors.add(pile.color)
  return [...colors]
}

export function hasWon(player: Player): boolean {
  return completeSetColors(player).length >= SETS_TO_WIN
}

// Payable cards: everything in bank, plus property/wild/building cards on the table.
export function payableCards(player: Player): Card[] {
  const cards = [...player.bank]
  for (const pile of player.piles) cards.push(...pile.cards)
  return cards
}
