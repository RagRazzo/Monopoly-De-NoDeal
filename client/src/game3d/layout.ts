import type { Card } from '@shared/cards'
import type { ClientGame, ClientPlayer } from '@shared/types'

export interface Placement {
  key: string
  card: Card | null // null = face-down (card back)
  pos: [number, number, number]
  rot: [number, number, number]
  scale: number
  handCard?: boolean // one of my hand cards (clickable)
  pileHint?: string // pile id, for highlighting
}

const SEAT_DIST = 4.4
const FLAT: [number, number, number] = [-Math.PI / 2, 0, 0]

interface Frame {
  angle: number
  cx: number
  cz: number
}

function seatFrame(rel: number, total: number): Frame {
  const angle = Math.PI / 2 + (rel * 2 * Math.PI) / total
  return { angle, cx: Math.cos(angle) * SEAT_DIST, cz: Math.sin(angle) * SEAT_DIST }
}

// Convert seat-local (lx = right, lz = toward player, ly = up) to world.
function local(f: Frame, lx: number, ly: number, lz: number): [number, number, number] {
  const rx = Math.sin(f.angle)
  const rz = -Math.cos(f.angle)
  const ox = Math.cos(f.angle)
  const oz = Math.sin(f.angle)
  return [f.cx + rx * lx + ox * lz, ly, f.cz + rz * lx + oz * lz]
}

function flatRot(f: Frame, spin = 0): [number, number, number] {
  return [-Math.PI / 2, 0, Math.PI / 2 - f.angle + spin]
}

export function seatPositions(game: ClientGame): Map<string, Frame> {
  const players = game.players
  const youIdx = Math.max(0, players.findIndex((p) => p.id === game.youId))
  const map = new Map<string, Frame>()
  players.forEach((p, i) => {
    const rel = (i - youIdx + players.length) % players.length
    map.set(p.id, seatFrame(rel, players.length))
  })
  return map
}

function playerCards(out: Placement[], p: ClientPlayer, f: Frame, mine: boolean) {
  const scale = mine ? 0.92 : 0.78
  // Bank: a tight stack on the player's right.
  p.bank.forEach((card, i) => {
    out.push({
      key: card.id,
      card,
      pos: local(f, 2.35, 0.02 + i * 0.012, 0.25),
      rot: flatRot(f, (i % 3 - 1) * 0.09),
      scale,
    })
  })
  // Property piles: a row, each pile fanned toward the table center.
  const pileCount = p.piles.length
  const startX = -((pileCount - 1) * 0.92) / 2 - 0.6
  p.piles.forEach((pile, pi) => {
    pile.cards.forEach((card, ci) => {
      out.push({
        key: card.id,
        card,
        pos: local(f, startX + pi * 0.92, 0.02 + ci * 0.012, -0.15 - ci * 0.38),
        rot: flatRot(f),
        scale,
        pileHint: pile.id,
      })
    })
  })
  // Opponents' hands: fanned card backs beyond their play area.
  if (!mine) {
    const n = Math.min(p.handCount, 8)
    for (let i = 0; i < n; i++) {
      out.push({
        key: `hand-${p.id}-${i}`,
        card: null,
        pos: local(f, (i - (n - 1) / 2) * 0.32, 0.6 + i * 0.005, 1.35),
        rot: [-0.9, 0, Math.PI / 2 - f.angle + (i - (n - 1) / 2) * 0.06],
        scale: 0.62,
      })
    }
  }
}

export function computePlacements(game: ClientGame, aspect = 1.78, fit = 1): Placement[] {
  const out: Placement[] = []
  const seats = seatPositions(game)

  // Draw deck (center-left) and discard (center-right).
  const deckShown = Math.min(game.deckCount, 12)
  for (let i = 0; i < deckShown; i++) {
    out.push({
      key: `deck-${i}`,
      card: null,
      pos: [-0.85, 0.02 + i * 0.015, 0],
      rot: FLAT,
      scale: 0.95,
    })
  }
  if (game.discardTop) {
    if (game.discardCount > 1) {
      out.push({ key: 'discard-under', card: null, pos: [0.85, 0.02, 0], rot: [-Math.PI / 2, 0, 0.05], scale: 0.95 })
    }
    out.push({
      key: game.discardTop.id,
      card: game.discardTop,
      pos: [0.85, 0.04, 0],
      rot: FLAT,
      scale: 0.95,
    })
  }

  for (const p of game.players) {
    if (p.left) continue
    playerCards(out, p, seats.get(p.id)!, p.id === game.youId)
  }

  // My hand: an arc floating in front of the camera's default view. The
  // whole arc tracks the camera fit factor (portrait screens push the
  // camera back) and compresses horizontally on narrow viewports.
  const hand = game.yourHand
  const n = hand.length
  const squeeze = Math.min(1, aspect / 1.6)
  hand.forEach((card, i) => {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5
    out.push({
      key: card.id,
      card,
      pos: [
        t * Math.min(6.4, n * 1.05) * squeeze * fit,
        (3.1 + Math.cos(t * 2.4) * 0.25) * fit,
        (6.9 + Math.abs(t) * 0.35) * fit,
      ],
      rot: [-0.42, 0, -t * 0.28],
      scale: 1.05 * fit,
      handCard: true,
    })
  })

  return out
}
