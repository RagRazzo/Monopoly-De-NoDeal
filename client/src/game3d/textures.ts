import * as THREE from 'three'
import { ACTION_INFO, COLOR_INFO, type Card, type Color } from '@shared/cards'

const W = 512
const H = 716
const R = 42

const cache = new Map<string, THREE.CanvasTexture>()

function cardKey(card: Card): string {
  switch (card.kind) {
    case 'money':
      return `money-${card.value}`
    case 'property':
      return `prop-${card.color}`
    case 'wild':
      return `wild-${card.colors === 'any' ? 'any' : card.colors.join('-')}`
    case 'rent':
      return `rent-${card.colors === 'any' ? 'any' : card.colors.join('-')}`
    case 'action':
      return `action-${card.action}`
  }
}

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  return [canvas, ctx]
}

function roundedPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function cardBase(ctx: CanvasRenderingContext2D, fill = '#f8f5ec') {
  ctx.clearRect(0, 0, W, H)
  roundedPath(ctx, 0, 0, W, H, R)
  ctx.fillStyle = fill
  ctx.fill()
  ctx.save()
  roundedPath(ctx, 0, 0, W, H, R)
  ctx.clip()
}

function frame(ctx: CanvasRenderingContext2D, color = '#2b2b2b') {
  ctx.restore()
  roundedPath(ctx, 8, 8, W - 16, H - 16, R - 8)
  ctx.lineWidth = 8
  ctx.strokeStyle = color
  ctx.stroke()
}

function valueBadge(ctx: CanvasRenderingContext2D, value: number) {
  ctx.beginPath()
  ctx.arc(70, 70, 48, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'
  ctx.fill()
  ctx.lineWidth = 6
  ctx.strokeStyle = '#c9a227'
  ctx.stroke()
  ctx.fillStyle = '#1f2937'
  ctx.font = 'bold 44px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${value}M`, 70, 72)
}

function centered(ctx: CanvasRenderingContext2D, text: string, y: number, font: string, color = '#1f2937') {
  ctx.fillStyle = color
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, W / 2, y)
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(' ')
  let line = ''
  for (const word of words) {
    const probe = line ? `${line} ${word}` : word
    if (ctx.measureText(probe).width > maxWidth && line) {
      ctx.fillText(line, W / 2, y)
      line = word
      y += lineHeight
    } else {
      line = probe
    }
  }
  if (line) ctx.fillText(line, W / 2, y)
}

const RAINBOW: Color[] = ['red', 'orange', 'yellow', 'green', 'lightblue', 'darkblue', 'pink', 'brown', 'railroad', 'utility']

function drawMoney(ctx: CanvasRenderingContext2D, value: number) {
  cardBase(ctx, '#e8f3e4')
  const g = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, 420)
  g.addColorStop(0, '#dcefd4')
  g.addColorStop(1, '#b9dcae')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  ctx.beginPath()
  ctx.ellipse(W / 2, H / 2, 180, 130, 0, 0, Math.PI * 2)
  ctx.fillStyle = '#f6fbf2'
  ctx.fill()
  ctx.lineWidth = 8
  ctx.strokeStyle = '#5a8a4a'
  ctx.stroke()
  centered(ctx, `${value}M`, H / 2, 'bold 130px sans-serif', '#2f5e22')
  centered(ctx, 'BANK NOTE', H - 90, 'bold 40px sans-serif', '#41682f')
  centered(ctx, 'BANK NOTE', 90, 'bold 40px sans-serif', '#41682f')
  frame(ctx, '#5a8a4a')
}

function drawProperty(ctx: CanvasRenderingContext2D, color: Color) {
  const info = COLOR_INFO[color]
  cardBase(ctx)
  ctx.fillStyle = info.hex
  ctx.fillRect(0, 0, W, 190)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 52px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(info.label.toUpperCase(), W / 2, 120)
  centered(ctx, 'PROPERTY', 240, 'bold 34px sans-serif', '#6b7280')
  // Rent table
  ctx.font = '38px sans-serif'
  info.rent.forEach((r, i) => {
    const y = 330 + i * 70
    ctx.fillStyle = '#374151'
    ctx.textAlign = 'left'
    ctx.fillText(`${i + 1} card${i ? 's' : ''}`, 110, y)
    ctx.textAlign = 'right'
    ctx.fillText(`${r}M rent`, W - 110, y)
  })
  centered(ctx, `Full set: ${info.setSize}`, H - 80, 'bold 34px sans-serif', '#6b7280')
  frame(ctx, info.hex)
  valueBadge(ctx, COLOR_INFO[color] ? propValue(color) : 0)
}

function propValue(color: Color): number {
  const v: Record<Color, number> = {
    brown: 1, lightblue: 1, pink: 2, orange: 2, red: 3,
    yellow: 3, green: 4, darkblue: 4, railroad: 2, utility: 2,
  }
  return v[color]
}

function drawWild(ctx: CanvasRenderingContext2D, colors: Color[] | 'any', value: number) {
  cardBase(ctx)
  if (colors === 'any') {
    const bandH = H / RAINBOW.length
    RAINBOW.forEach((c, i) => {
      ctx.fillStyle = COLOR_INFO[c].hex
      ctx.fillRect(0, i * bandH, W, bandH + 1)
    })
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.fillRect(60, H / 2 - 110, W - 120, 220)
    centered(ctx, 'WILD', H / 2 - 35, 'bold 84px sans-serif')
    centered(ctx, 'any color', H / 2 + 55, '40px sans-serif', '#4b5563')
  } else {
    const [a, b] = colors
    ctx.fillStyle = COLOR_INFO[a].hex
    ctx.fillRect(0, 0, W, H / 2)
    ctx.fillStyle = COLOR_INFO[b].hex
    ctx.fillRect(0, H / 2, W, H / 2)
    centered(ctx, COLOR_INFO[a].label.toUpperCase(), H / 4, 'bold 54px sans-serif', '#ffffff')
    centered(ctx, COLOR_INFO[b].label.toUpperCase(), (3 * H) / 4, 'bold 54px sans-serif', '#ffffff')
    ctx.beginPath()
    ctx.arc(W / 2, H / 2, 120, 0, Math.PI * 2)
    ctx.fillStyle = '#fffdf5'
    ctx.fill()
    ctx.lineWidth = 8
    ctx.strokeStyle = '#1f2937'
    ctx.stroke()
    centered(ctx, 'WILD', H / 2, 'bold 56px sans-serif')
  }
  frame(ctx)
  valueBadge(ctx, value)
}

function drawRent(ctx: CanvasRenderingContext2D, colors: Color[] | 'any', value: number) {
  cardBase(ctx, '#fdf3e3')
  if (colors === 'any') {
    const bandW = W / RAINBOW.length
    RAINBOW.forEach((c, i) => {
      ctx.fillStyle = COLOR_INFO[c].hex
      ctx.fillRect(i * bandW, 0, bandW + 1, 170)
    })
  } else {
    ctx.fillStyle = COLOR_INFO[colors[0]].hex
    ctx.fillRect(0, 0, W / 2, 170)
    ctx.fillStyle = COLOR_INFO[colors[1]].hex
    ctx.fillRect(W / 2, 0, W / 2, 170)
  }
  ctx.beginPath()
  ctx.arc(W / 2, H / 2 - 30, 150, 0, Math.PI * 2)
  ctx.fillStyle = '#e74c3c'
  ctx.fill()
  centered(ctx, 'RENT', H / 2 - 30, 'bold 76px sans-serif', '#ffffff')
  const sub =
    colors === 'any'
      ? 'Charge ONE player rent for any of your sets'
      : 'ALL players pay rent for your set of these colors'
  ctx.fillStyle = '#4b5563'
  ctx.font = '34px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  wrapText(ctx, sub, H - 200, W - 140, 44)
  frame(ctx, '#e74c3c')
  valueBadge(ctx, value)
}

const ACTION_COLORS: Record<string, string> = {
  dealbreaker: '#7c3aed',
  justsayno: '#dc2626',
  passgo: '#0891b2',
  forceddeal: '#d97706',
  slydeal: '#db2777',
  debtcollector: '#374151',
  birthday: '#e11d48',
  doublerent: '#b45309',
  quadruplerent: '#9a3412',
  robbank: '#1f2937',
  tax: '#0f766e',
  house: '#16a34a',
  hotel: '#b91c1c',
}

function drawAction(ctx: CanvasRenderingContext2D, action: keyof typeof ACTION_INFO, value: number) {
  const info = ACTION_INFO[action]
  const hue = ACTION_COLORS[action] ?? '#374151'
  cardBase(ctx, '#fbf7ea')
  ctx.fillStyle = hue
  ctx.fillRect(0, 0, W, 150)
  centered(ctx, 'ACTION', 82, 'bold 44px sans-serif', '#ffffff')
  ctx.fillStyle = '#111827'
  ctx.font = 'bold 56px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  wrapText(ctx, info.label, 280, W - 100, 66)
  ctx.fillStyle = '#4b5563'
  ctx.font = '36px sans-serif'
  wrapText(ctx, info.text, 460, W - 120, 48)
  frame(ctx, hue)
  valueBadge(ctx, value)
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

// Full-resolution card image for the 2D inspect/zoom overlays.
const urlCache = new Map<string, string>()
export function getCardImageURL(card: Card): string {
  const key = cardKey(card)
  let url = urlCache.get(key)
  if (!url) {
    const tex = getCardTexture(card)
    url = (tex.image as HTMLCanvasElement).toDataURL('image/png')
    urlCache.set(key, url)
  }
  return url
}

export function getCardTexture(card: Card): THREE.CanvasTexture {
  const key = cardKey(card)
  const hit = cache.get(key)
  if (hit) return hit
  const [canvas, ctx] = makeCanvas()
  switch (card.kind) {
    case 'money':
      drawMoney(ctx, card.value)
      break
    case 'property':
      drawProperty(ctx, card.color)
      break
    case 'wild':
      drawWild(ctx, card.colors, card.value)
      break
    case 'rent':
      drawRent(ctx, card.colors, card.value)
      break
    case 'action':
      drawAction(ctx, card.action, card.value)
      break
  }
  const tex = toTexture(canvas)
  cache.set(key, tex)
  return tex
}

export function getBackTexture(): THREE.CanvasTexture {
  const hit = cache.get('back')
  if (hit) return hit
  const [canvas, ctx] = makeCanvas()
  cardBase(ctx, '#8c1d18')
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, '#9a221c')
  g.addColorStop(1, '#6e1512')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // Diamond lattice
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)'
  ctx.lineWidth = 3
  for (let i = -H; i < W + H; i += 46) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i + H, H)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(i + H, 0)
    ctx.lineTo(i, H)
    ctx.stroke()
  }
  roundedPath(ctx, 70, H / 2 - 100, W - 140, 200, 30)
  ctx.fillStyle = '#fdf3e3'
  ctx.fill()
  centered(ctx, 'NoDeal', H / 2 - 25, 'bold 88px sans-serif', '#8c1d18')
  centered(ctx, '3D', H / 2 + 55, 'bold 48px sans-serif', '#b8860b')
  frame(ctx, '#f3d9a4')
  const tex = toTexture(canvas)
  cache.set('back', tex)
  return tex
}
