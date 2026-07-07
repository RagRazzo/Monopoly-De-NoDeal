// Cards on the table are flat planes lying in the XZ plane. When two cards
// sit at the *same* height (Y) and their footprints overlap, the GPU can't
// decide which is in front and they flicker (z-fighting). This test builds a
// worst-case 6-player table — every seat holding several property sets plus a
// bank — and asserts that no two co-planar cards overlap.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { Card, Color } from '../../shared/src/cards.ts'
import type { ClientGame, ClientPlayer } from '../../shared/src/types.ts'
import { computePlacements, type Placement } from '../../client/src/game3d/layout.ts'

const CARD_W = 1
const CARD_H = 1.4
const COLORS: Color[] = ['brown', 'lightblue', 'pink', 'orange', 'red', 'yellow', 'green', 'darkblue']

function prop(id: string, color: Color): Card {
  return { id, kind: 'property', color, value: 2 }
}

// A player holding `pileCount` property sets plus a small bank. Sets alternate
// between single cards and 2-3 card stacks so the test also exercises the
// within-pile stacking, not just single-card columns.
function player(idx: number, pileCount: number): ClientPlayer {
  const piles = Array.from({ length: pileCount }, (_, pi) => {
    const color = COLORS[pi % COLORS.length]
    const depth = 1 + (pi % 3) // 1, 2 or 3 cards in the set
    return {
      id: `p${idx}-pile${pi}`,
      color,
      cards: Array.from({ length: depth }, (_, ci) => prop(`p${idx}-c${pi}-${ci}`, color)),
    }
  })
  const bank = Array.from({ length: 3 }, (_, bi) => ({
    id: `p${idx}-bank${bi}`,
    kind: 'money' as const,
    value: 2,
  }))
  return {
    id: `p${idx}`,
    name: `P${idx}`,
    seat: idx,
    connected: true,
    left: false,
    isHost: idx === 0,
    isBot: idx !== 0,
    handCount: 7,
    bank,
    piles,
  }
}

function sixPlayerGame(pilesEach: number): ClientGame {
  const players = Array.from({ length: 6 }, (_, i) => player(i, pilesEach))
  return {
    code: 'TEST',
    phase: 'playing',
    youId: 'p0',
    players,
    yourHand: Array.from({ length: 7 }, (_, i) => prop(`hand${i}`, COLORS[i % COLORS.length])),
    deckCount: 40,
    discardTop: prop('disc', 'red'),
    discardCount: 5,
    turnPlayerId: 'p0',
    playsLeft: 3,
    pending: null,
    winnerId: null,
    log: [],
    logSeq: 0,
    now: 0,
    turnDeadline: null,
    responseDeadline: null,
  }
}

// Three.js Euler order 'XYZ' -> rotation matrix (column-major axis images).
function rotate(px: number, py: number, pz: number, r: [number, number, number]) {
  const [x, y, z] = r
  const a = Math.cos(x), b = Math.sin(x)
  const c = Math.cos(y), d = Math.sin(y)
  const e = Math.cos(z), f = Math.sin(z)
  const ae = a * e, af = a * f, be = b * e, bf = b * f
  return {
    x: c * e * px + -c * f * py + d * pz,
    y: (af + be * d) * px + (ae - bf * d) * py + -b * c * pz,
    z: (bf - ae * d) * px + (be + af * d) * py + a * c * pz,
  }
}

// The four corners of a card, in the world XZ plane.
function footprint(p: Placement): { x: number; z: number }[] {
  const hw = (CARD_W / 2) * p.scale
  const hh = (CARD_H / 2) * p.scale
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([lx, ly]) => {
    const w = rotate(lx, ly, 0, p.rot)
    return { x: w.x + p.pos[0], z: w.z + p.pos[2] }
  })
}

// Separating Axis Theorem for two convex quads in the XZ plane, with a small
// tolerance so cards that merely touch edge-to-edge don't count as overlapping.
function overlapArea(a: { x: number; z: number }[], b: { x: number; z: number }[]): boolean {
  const TOL = 0.02
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i]
      const p2 = poly[(i + 1) % poly.length]
      const nx = -(p2.z - p1.z)
      const nz = p2.x - p1.x
      const len = Math.hypot(nx, nz) || 1
      const axx = nx / len
      const axz = nz / len
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity
      for (const p of a) {
        const proj = p.x * axx + p.z * axz
        aMin = Math.min(aMin, proj)
        aMax = Math.max(aMax, proj)
      }
      for (const p of b) {
        const proj = p.x * axx + p.z * axz
        bMin = Math.min(bMin, proj)
        bMax = Math.max(bMax, proj)
      }
      if (aMax - TOL <= bMin || bMax - TOL <= aMin) return false // separating axis found
    }
  }
  return true
}

// Two cards flicker when they share a height plane and overlap on the table.
const COPLANAR_EPS = 0.006 // < the 0.012 per-card lift inside a single stack

function coplanarOverlaps(placements: Placement[]): string[] {
  const clash: string[] = []
  const foot = placements.map(footprint)
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      if (Math.abs(placements[i].pos[1] - placements[j].pos[1]) >= COPLANAR_EPS) continue
      if (overlapArea(foot[i], foot[j])) clash.push(`${placements[i].key} ↔ ${placements[j].key}`)
    }
  }
  return clash
}

for (const aspect of [1.78, 1.35, 1.0, 0.56, 0.46]) {
  for (const pilesEach of [4, 5, 6]) {
    test(`6 players, ${pilesEach} sets each, aspect ${aspect}: no co-planar card overlap`, () => {
      const game = sixPlayerGame(pilesEach)
      const placements = computePlacements(game, aspect, aspect < 1 ? 1.4 : 1)
      const clashes = coplanarOverlaps(placements)
      assert.deepEqual(clashes, [], `flickering (overlapping co-planar) cards: ${clashes.join(', ')}`)
    })
  }
}
