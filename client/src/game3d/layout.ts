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
export const NAMEPLATE_RADIUS = 6.6
const FLAT: [number, number, number] = [-Math.PI / 2, 0, 0]

// Camera fitting shared with the Scene: portrait screens push the camera
// back (fit > 1) and widen the field of view so the whole table fits.
export function viewFit(aspect: number): { fit: number; fov: number } {
  const fit = aspect >= 1.35 ? 1 : Math.min(1.6, Math.pow(1.35 / aspect, 0.5))
  const fov = aspect >= 1.35 ? 46 : aspect >= 1 ? 54 : 66
  return { fit, fov }
}

// Portrait viewports are horizontally narrow, so the round seating layout's
// left/right players (and their nameplates) fall outside the frame. Pull the
// whole ring inward on narrow screens so every seat stays visible.
export function ringScale(aspect: number): number {
  if (aspect >= 1.35) return 1
  return Math.max(0.62, 0.5 + aspect * 0.34)
}

interface Frame {
  angle: number
  cx: number
  cz: number
}

function seatFrame(rel: number, total: number, ring = 1): Frame {
  const angle = Math.PI / 2 + (rel * 2 * Math.PI) / total
  return { angle, cx: Math.cos(angle) * SEAT_DIST * ring, cz: Math.sin(angle) * SEAT_DIST * ring }
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

export function seatPositions(game: ClientGame, aspect = 1.78): Map<string, Frame> {
  const players = game.players
  const youIdx = Math.max(0, players.findIndex((p) => p.id === game.youId))
  const ring = ringScale(aspect)
  const map = new Map<string, Frame>()
  players.forEach((p, i) => {
    const rel = (i - youIdx + players.length) % players.length
    map.set(p.id, seatFrame(rel, players.length, ring))
  })
  return map
}

// Each seat gets a compact play area centred in front of it. The whole
// footprint is kept narrow (tight pile spacing, the bank tucked close to the
// piles rather than off to the side) so neighbouring seats never overlap,
// even with 6 players around the ring. Tap a nameplate to inspect a table
// in full detail.
function playerCards(out: Placement[], p: ClientPlayer, f: Frame, mine: boolean) {
  const scale = mine ? 0.82 : 0.6
  const step = mine ? 0.74 : 0.56 // horizontal spacing between piles
  // Property piles: a centred row, each card fanned slightly toward center.
  const pileCount = p.piles.length
  const spanX = (pileCount - 1) * step
  const startX = -spanX / 2 - step * 0.45
  p.piles.forEach((pile, pi) => {
    pile.cards.forEach((card, ci) => {
      out.push({
        key: card.id,
        card,
        pos: local(f, startX + pi * step, 0.02 + ci * 0.012, -0.1 - ci * 0.3),
        rot: flatRot(f),
        scale,
        pileHint: pile.id,
      })
    })
  })
  // Bank: a tight stack tucked just to the right of the property row.
  const bankX = spanX / 2 + step * 0.9
  p.bank.forEach((card, i) => {
    out.push({
      key: card.id,
      card,
      pos: local(f, bankX, 0.02 + i * 0.012, 0.3),
      rot: flatRot(f, (i % 3 - 1) * 0.08),
      scale,
    })
  })
  // Opponents' hands: fanned card backs behind their play area.
  if (!mine) {
    const n = Math.min(p.handCount, 8)
    for (let i = 0; i < n; i++) {
      out.push({
        key: `hand-${p.id}-${i}`,
        card: null,
        pos: local(f, (i - (n - 1) / 2) * 0.24, 0.6 + i * 0.02, 1.25 + i * 0.015),
        rot: [-0.9, 0, Math.PI / 2 - f.angle + (i - (n - 1) / 2) * 0.06],
        scale: 0.5,
      })
    }
  }
}

export function computePlacements(
  game: ClientGame,
  aspect = 1.78,
  fit = 1,
  orderedHand?: Card[],
): Placement[] {
  const out: Placement[] = []
  const seats = seatPositions(game, aspect)

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

  // My hand: a fan floating in front of the camera's default view.
  // - Card size adapts to the screen (smaller base scale on portrait).
  // - The fan width is capped by what the camera can actually see at the
  //   hand's depth, so cards never spill off-screen.
  // - Each card sits at a strictly increasing depth (left under right,
  //   like a real hand) so overlapping cards never z-fight/flicker.
  const hand = orderedHand ?? game.yourHand
  const n = hand.length
  const { fov } = viewFit(aspect)
  const handScale = (aspect < 1 ? 0.8 : 1.05) * fit
  const dist = 6.7 * fit // approx camera-to-hand distance
  const halfVisible = Math.tan((fov * Math.PI) / 360) * dist * aspect
  const spread = Math.max(0, Math.min(2 * halfVisible - handScale - 0.3, (n - 1) * handScale * 0.72))
  hand.forEach((card, i) => {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5
    out.push({
      key: card.id,
      card,
      pos: [
        t * spread,
        (3.05 + Math.cos(t * 2.2) * 0.22) * fit,
        (6.75 + i * 0.045) * fit,
      ],
      rot: [-0.42, 0, -t * (aspect < 1 ? 0.38 : 0.28)],
      scale: handScale,
      handCard: true,
    })
  })

  return out
}
