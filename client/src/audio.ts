// All audio is synthesized with the Web Audio API — no audio files, so the
// app stays fully self-contained.
//
// - Music: a slow generative ambient loop (soft detuned pad chords through a
//   lowpass, with sparse pentatonic plucks), quiet by design.
// - SFX: short procedural sounds; every action card has its own voice.
//   Sounds are driven by the server's game log, so you hear opponents' and
//   the CPU's plays too.
//
// Browsers block audio until a user gesture: unlockAudio() runs on the first
// pointerdown (see main.tsx).
import type { ClientGame } from '@shared/types'

export type SoundMode = 'all' | 'sfx' | 'off'

let ctx: AudioContext | null = null
let sfxBus: GainNode | null = null
let musicBus: GainNode | null = null
let musicTimer: number | null = null
let inGame = false

const stored = localStorage.getItem('nodeal.sound')
let mode: SoundMode = stored === 'sfx' || stored === 'off' ? stored : 'all'

function ensure(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
    const master = ctx.createGain()
    master.gain.value = 0.9
    master.connect(ctx.destination)
    sfxBus = ctx.createGain()
    sfxBus.connect(master)
    musicBus = ctx.createGain()
    musicBus.connect(master)
    applyMode()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function applyMode() {
  if (!sfxBus || !musicBus) return
  sfxBus.gain.value = mode === 'off' ? 0 : 0.5
  musicBus.gain.value = mode === 'all' ? 0.32 : 0
}

export function getSoundMode(): SoundMode {
  return mode
}

export function cycleSoundMode(): SoundMode {
  mode = mode === 'all' ? 'sfx' : mode === 'sfx' ? 'off' : 'all'
  localStorage.setItem('nodeal.sound', mode)
  applyMode()
  if (mode === 'all' && inGame) startMusic()
  else if (mode !== 'all') stopMusic()
  return mode
}

export function unlockAudio() {
  ensure()
  if (mode === 'all' && inGame) startMusic()
}

export function setInGame(active: boolean) {
  inGame = active
  if (active && mode === 'all' && ctx) startMusic()
  if (!active) stopMusic()
}

// ---- Synth primitives ----

interface ToneOpts {
  f: number
  f1?: number // glide target
  type?: OscillatorType
  t?: number
  a?: number // attack
  d?: number // decay
  v?: number // peak volume
  bus?: GainNode
}

function tone(o: ToneOpts) {
  const c = ctx
  const bus = o.bus ?? sfxBus
  if (!c || !bus) return
  const t0 = o.t ?? c.currentTime
  const a = o.a ?? 0.008
  const d = o.d ?? 0.3
  const osc = c.createOscillator()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(Math.max(20, o.f), t0)
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + d)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(o.v ?? 0.2, t0 + a)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d)
  osc.connect(g)
  g.connect(bus)
  osc.start(t0)
  osc.stop(t0 + a + d + 0.05)
}

let noiseBuffer: AudioBuffer | null = null

function noise(o: { t?: number; dur?: number; f?: number; q?: number; v?: number }) {
  const c = ctx
  if (!c || !sfxBus) return
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  }
  const t0 = o.t ?? c.currentTime
  const dur = o.dur ?? 0.15
  const src = c.createBufferSource()
  src.buffer = noiseBuffer
  const filter = c.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = o.f ?? 1500
  filter.Q.value = o.q ?? 0.9
  const g = c.createGain()
  g.gain.setValueAtTime(o.v ?? 0.2, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(filter)
  filter.connect(g)
  g.connect(sfxBus)
  src.start(t0)
  src.stop(t0 + dur + 0.05)
}

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12)

// ---- SFX library ----

export type SfxName =
  | 'card' | 'draw' | 'coin' | 'property' | 'payment' | 'shuffle' | 'discard' | 'pop'
  | 'passgo' | 'rent' | 'dealbreaker' | 'justsayno' | 'slydeal' | 'forceddeal'
  | 'debtcollector' | 'birthday' | 'building' | 'yourturn' | 'timeout' | 'win' | 'lose'

const SFX: Record<SfxName, (t: number) => void> = {
  card: (t) => noise({ t, dur: 0.1, f: 2600, v: 0.14 }),
  draw: (t) => {
    noise({ t, dur: 0.05, f: 3000, v: 0.1 })
    noise({ t: t + 0.09, dur: 0.05, f: 3400, v: 0.1 })
  },
  coin: (t) => {
    tone({ f: 1568, t, type: 'triangle', d: 0.18, v: 0.14 })
    tone({ f: 2093, t: t + 0.07, type: 'triangle', d: 0.3, v: 0.12 })
  },
  property: (t) => {
    noise({ t, dur: 0.07, f: 420, q: 1.5, v: 0.25 })
    tone({ f: 262, t: t + 0.02, type: 'triangle', d: 0.22, v: 0.12 })
  },
  payment: (t) => {
    for (let i = 0; i < 3; i++) tone({ f: 1568 + i * 260, t: t + i * 0.07, type: 'triangle', d: 0.14, v: 0.1 })
  },
  shuffle: (t) => {
    for (let i = 0; i < 4; i++) noise({ t: t + i * 0.08, dur: 0.07, f: 1800 + i * 300, v: 0.09 })
  },
  discard: (t) => noise({ t, dur: 0.12, f: 900, v: 0.12 }),
  pop: (t) => tone({ f: 520, f1: 780, t, d: 0.12, v: 0.12 }),
  passgo: (t) => {
    ;[60, 64, 67].forEach((m, i) => tone({ f: hz(m + 12), t: t + i * 0.08, type: 'triangle', d: 0.16, v: 0.12 }))
  },
  rent: (t) => {
    tone({ f: 330, f1: 220, t, type: 'sawtooth', d: 0.25, v: 0.07 })
    tone({ f: 1568, t: t + 0.12, type: 'triangle', d: 0.25, v: 0.12 })
  },
  dealbreaker: (t) => {
    tone({ f: 130, f1: 45, t, d: 0.7, v: 0.4 })
    noise({ t, dur: 0.3, f: 220, q: 0.7, v: 0.28 })
    tone({ f: 392, f1: 196, t: t + 0.12, type: 'square', d: 0.4, v: 0.05 })
  },
  justsayno: (t) => {
    tone({ f: 330, t, type: 'square', d: 0.11, v: 0.07 })
    tone({ f: 262, t: t + 0.14, type: 'square', d: 0.22, v: 0.08 })
  },
  slydeal: (t) => {
    tone({ f: 500, f1: 950, t, d: 0.22, v: 0.07 })
    noise({ t: t + 0.05, dur: 0.16, f: 4200, v: 0.06 })
  },
  forceddeal: (t) => {
    tone({ f: 440, f1: 740, t, d: 0.18, v: 0.08 })
    tone({ f: 740, f1: 440, t: t + 0.2, d: 0.18, v: 0.08 })
  },
  debtcollector: (t) => {
    for (const dt of [0, 0.18]) {
      tone({ f: 95, t: t + dt, d: 0.16, v: 0.35 })
      noise({ t: t + dt, dur: 0.07, f: 160, q: 1.6, v: 0.2 })
    }
  },
  birthday: (t) => {
    ;[60, 64, 67, 72].forEach((m, i) => tone({ f: hz(m + 12), t: t + i * 0.07, type: 'triangle', d: 0.18, v: 0.11 }))
    noise({ t: t + 0.3, dur: 0.25, f: 5200, v: 0.05 })
  },
  building: (t) => {
    for (const dt of [0, 0.16]) {
      noise({ t: t + dt, dur: 0.06, f: 700, q: 2, v: 0.28 })
      tone({ f: 180, t: t + dt, d: 0.09, v: 0.16 })
    }
  },
  yourturn: (t) => {
    tone({ f: hz(79), t, type: 'triangle', d: 0.22, v: 0.13 })
    tone({ f: hz(84), t: t + 0.16, type: 'triangle', d: 0.4, v: 0.13 })
  },
  timeout: (t) => tone({ f: 220, f1: 165, t, type: 'square', d: 0.3, v: 0.07 }),
  win: (t) => {
    ;[60, 64, 67, 72, 76].forEach((m, i) => tone({ f: hz(m + 12), t: t + i * 0.12, type: 'triangle', d: 0.4, v: 0.14 }))
  },
  lose: (t) => {
    ;[64, 60, 55].forEach((m, i) => tone({ f: hz(m), t: t + i * 0.18, type: 'triangle', d: 0.35, v: 0.11 }))
  },
}

export function playSfx(name: SfxName, delay = 0) {
  if (mode === 'off') return
  const c = ensure()
  if (!c) return
  SFX[name](c.currentTime + 0.02 + delay)
}

// ---- Generative ambient music ----

// Cmaj7 -> Am9 -> Fmaj7 -> G6, low and slow.
const CHORDS = [
  [48, 55, 60, 64, 71],
  [45, 52, 57, 60, 67],
  [41, 48, 53, 57, 64],
  [43, 50, 55, 59, 64],
]
const PENTATONIC = [72, 74, 76, 79, 81, 84]
const BAR_SECONDS = 7.5

function pad(f: number, t: number, dur: number) {
  const c = ctx
  if (!c || !musicBus) return
  for (const detune of [-4, 4]) {
    const osc = c.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = f
    osc.detune.value = detune
    const filter = c.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 850
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.035, t + 2.6)
    g.gain.setValueAtTime(0.035, t + dur - 3)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    osc.connect(filter)
    filter.connect(g)
    g.connect(musicBus)
    osc.start(t)
    osc.stop(t + dur + 0.1)
  }
}

function pluck(f: number, t: number) {
  const c = ctx
  if (!c || !musicBus) return
  const osc = c.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = f
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.055, t + 0.02)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6)
  osc.connect(g)
  g.connect(musicBus)
  osc.start(t)
  osc.stop(t + 1.8)
}

function startMusic() {
  const c = ensure()
  if (!c || musicTimer !== null) return
  let bar = 0
  const scheduleBar = () => {
    if (!ctx) return
    const t = ctx.currentTime + 0.1
    for (const m of CHORDS[bar % CHORDS.length]) pad(hz(m), t, BAR_SECONDS + 3)
    const plucks = Math.random() < 0.7 ? 1 + Math.floor(Math.random() * 2) : 0
    for (let i = 0; i < plucks; i++) {
      pluck(hz(PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)]), t + 1 + Math.random() * (BAR_SECONDS - 2.5))
    }
    bar++
  }
  scheduleBar()
  musicTimer = window.setInterval(scheduleBar, BAR_SECONDS * 1000)
}

function stopMusic() {
  if (musicTimer !== null) {
    clearInterval(musicTimer)
    musicTimer = null
  }
}

// ---- Game-state driven triggers ----

function sfxForLine(line: string): SfxName | null {
  if (line.includes('🏆')) return null // handled via the phase change
  if (line.includes('Deal Breaker') || line.includes('deal-broke')) return 'dealbreaker'
  if (line.includes('Just Say No')) return 'justsayno'
  if (line.includes('Pass Go')) return 'passgo'
  if (line.includes('sly-dealt') || line.includes('Sly Deal')) return 'slydeal'
  if (line.includes('Forced Deal') || line.includes('forced a deal')) return 'forceddeal'
  if (line.includes('Debt Collector')) return 'debtcollector'
  if (line.includes('Birthday')) return 'birthday'
  if (line.includes('built a')) return 'building'
  if (line.includes('rent')) return 'rent'
  if (line.includes('banked')) return 'coin'
  if (line.includes('paid')) return 'payment'
  if (line.includes('reshuffled')) return 'shuffle'
  if (line.includes('discarded') || line.includes('must discard')) return 'discard'
  if (line.includes('timed out') || line.includes('took too long') || line.includes('ended automatically')) return 'timeout'
  if (line.includes('joined')) return 'pop'
  if (line.includes("'s turn (drew")) return 'draw'
  if (line.includes('played') || line.includes('added a') || line.includes('moved a')) return 'property'
  return null
}

// Called on every state update: diff the log and play matching sounds.
export function gameAudio(prev: ClientGame | null, next: ClientGame | null) {
  setInGame(!!next && next.phase !== 'lobby')
  if (!prev || !next || prev.code !== next.code) return // no replay on join/refresh

  const fresh = Math.min(Math.max(0, next.logSeq - prev.logSeq), 6, next.log.length)
  next.log.slice(next.log.length - fresh).forEach((line, i) => {
    const name = sfxForLine(line)
    if (name) playSfx(name, i * 0.14)
  })

  if (prev.turnPlayerId !== next.turnPlayerId && next.turnPlayerId === next.youId) playSfx('yourturn', 0.25)
  if (prev.phase === 'playing' && next.phase === 'finished') {
    playSfx(next.winnerId === next.youId ? 'win' : 'lose', 0.3)
  }
}
