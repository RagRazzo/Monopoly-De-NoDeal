// Builds the contextual action buttons and multi-step target prompts
// for the currently selected hand card.
import { ALL_COLORS, COLOR_INFO, cardLabel, type Card, type Color } from '@shared/cards'
import { isPileComplete, isPropertyCard, pileHas, pileRent } from '@shared/logic'
import type { ClientGame, ClientPlayer, PlayActionOpts } from '@shared/types'
import { send } from '../net'
import { toast, useStore, type Prompt, type PromptOption } from '../store'

const setPrompt = (p: Prompt | null) => useStore.getState().setPrompt(p)
const deselect = () => useStore.getState().select(null)

function me(game: ClientGame): ClientPlayer {
  return game.players.find((p) => p.id === game.youId)!
}

function others(game: ClientGame): ClientPlayer[] {
  return game.players.filter((p) => p.id !== game.youId && !p.left)
}

function playAction(cardId: string, opts: PlayActionOpts = {}) {
  send('playAction', { cardId, opts })
  setPrompt(null)
  deselect()
}

function bank(cardId: string) {
  send('playMoney', { cardId })
  deselect()
}

export interface CardAction {
  label: string
  primary?: boolean
  onClick: () => void
}

function pickPlayer(title: string, candidates: ClientPlayer[], then: (p: ClientPlayer) => void) {
  setPrompt({
    title,
    options: candidates.map((p) => ({ label: p.name, onPick: () => then(p) })),
  })
}

function doubleRentStep(game: ClientGame, card: Card, opts: PlayActionOpts) {
  const my = me(game)
  // Rent boosters: Quadruple Rent (x4) is stronger, so offer it first.
  const quads = game.yourHand.filter((c) => c.kind === 'action' && c.action === 'quadruplerent')
  const doublers = game.yourHand.filter((c) => c.kind === 'action' && c.action === 'doublerent')
  const boosters = [
    ...quads.map((c) => ({ id: c.id, factor: 4, kind: 'quad' as const })),
    ...doublers.map((c) => ({ id: c.id, factor: 2, kind: 'double' as const })),
  ]
  const maxBoost = Math.min(boosters.length, game.playsLeft - 1)
  if (maxBoost < 1) return playAction(card.id, opts)
  const baseRent = Math.max(
    ...my.piles.filter((p) => p.color === opts.color).map(pileRent),
  )
  const options: PromptOption[] = [
    { label: `No — charge ${baseRent}M`, onPick: () => playAction(card.id, opts) },
  ]
  let mult = 1
  for (let n = 1; n <= maxBoost; n++) {
    mult *= boosters[n - 1].factor
    const chosen = boosters.slice(0, n)
    const boostOpts: PlayActionOpts = {
      ...opts,
      doubleRentCardIds: chosen.filter((b) => b.kind === 'double').map((b) => b.id),
      quadRentCardIds: chosen.filter((b) => b.kind === 'quad').map((b) => b.id),
    }
    options.push({
      label: `Boost x${mult} — charge ${baseRent * mult}M (uses ${n + 1} plays)`,
      onPick: () => playAction(card.id, boostOpts),
    })
  }
  setPrompt({ title: 'Boost the rent?', options })
}

function rentFlow(game: ClientGame, card: Card & { kind: 'rent' }) {
  const my = me(game)
  const colors = card.colors === 'any' ? ALL_COLORS : card.colors
  const owned = colors.filter((c) => my.piles.some((p) => p.color === c && pileRent(p) > 0))
  if (owned.length === 0) return toast('You have no properties matching this rent card')

  const pickColor = (then: (c: Color) => void) =>
    setPrompt({
      title: 'Charge rent for which color?',
      options: owned.map((c) => ({
        label: `${COLOR_INFO[c].label} — ${Math.max(...my.piles.filter((p) => p.color === c).map(pileRent))}M`,
        colorHex: COLOR_INFO[c].hex,
        onPick: () => then(c),
      })),
    })

  if (card.colors === 'any') {
    pickColor((color) =>
      pickPlayer('Charge which player?', others(game), (p) =>
        doubleRentStep(game, card, { color, targetPlayerId: p.id }),
      ),
    )
  } else {
    pickColor((color) => doubleRentStep(game, card, { color }))
  }
}

function stealableCards(p: ClientPlayer): { card: Card; pileColor: Color }[] {
  const out: { card: Card; pileColor: Color }[] = []
  for (const pile of p.piles) {
    if (isPileComplete(pile)) continue
    for (const c of pile.cards) if (isPropertyCard(c)) out.push({ card: c, pileColor: pile.color })
  }
  return out
}

function pickTheirCard(title: string, p: ClientPlayer, then: (cardId: string) => void) {
  setPrompt({
    title,
    options: stealableCards(p).map(({ card, pileColor }) => ({
      label: cardLabel(card),
      sub: `${COLOR_INFO[pileColor].label} set · ${card.value}M`,
      colorHex: COLOR_INFO[pileColor].hex,
      onPick: () => then(card.id),
    })),
  })
}

export function actionsForCard(game: ClientGame, card: Card): CardAction[] {
  const my = me(game)
  const actions: CardAction[] = []
  const canBank = card.kind !== 'property' && card.kind !== 'wild'

  switch (card.kind) {
    case 'money':
      actions.push({ label: `Bank ${card.value}M`, primary: true, onClick: () => bank(card.id) })
      return actions

    case 'property':
      actions.push({
        label: `Play ${COLOR_INFO[card.color].label} property`,
        primary: true,
        onClick: () => {
          send('playProperty', { cardId: card.id })
          deselect()
        },
      })
      return actions

    case 'wild': {
      if (card.colors === 'any') {
        const piles = my.piles.filter((p) => !isPileComplete(p))
        actions.push({
          label: 'Add to a set…',
          primary: true,
          onClick: () => {
            if (piles.length === 0) return toast('A rainbow wildcard needs an existing incomplete set')
            setPrompt({
              title: 'Add the rainbow wildcard to…',
              options: piles.map((p) => ({
                label: `${COLOR_INFO[p.color].label} set (${p.cards.length} card${p.cards.length > 1 ? 's' : ''})`,
                colorHex: COLOR_INFO[p.color].hex,
                onPick: () => {
                  send('playProperty', { cardId: card.id, pileId: p.id })
                  setPrompt(null)
                  deselect()
                },
              })),
            })
          },
        })
      } else {
        for (const color of card.colors) {
          actions.push({
            label: `Play as ${COLOR_INFO[color].label}`,
            primary: true,
            onClick: () => {
              send('playProperty', { cardId: card.id, color })
              deselect()
            },
          })
        }
      }
      return actions
    }

    case 'rent':
      actions.push({ label: 'Charge rent…', primary: true, onClick: () => rentFlow(game, card) })
      break

    case 'action':
      switch (card.action) {
        case 'passgo':
          actions.push({ label: 'Play — draw 2', primary: true, onClick: () => playAction(card.id) })
          break
        case 'birthday':
          actions.push({ label: 'Play — everyone pays 2M', primary: true, onClick: () => playAction(card.id) })
          break
        case 'debtcollector':
          actions.push({
            label: 'Collect 5M from…',
            primary: true,
            onClick: () => pickPlayer('Who owes you 5M?', others(game), (p) => playAction(card.id, { targetPlayerId: p.id })),
          })
          break
        case 'robbank':
          actions.push({
            label: 'Rob a bank…',
            primary: true,
            onClick: () => {
              const candidates = others(game).filter((p) => p.bank.length > 0)
              if (candidates.length === 0) return toast('No one has a bank to rob')
              pickPlayer('Rob whose bank?', candidates, (p) => playAction(card.id, { targetPlayerId: p.id }))
            },
          })
          break
        case 'tax':
          actions.push({
            label: 'Play — tax complete sets',
            primary: true,
            onClick: () => {
              if (!others(game).some((p) => p.piles.some(isPileComplete)))
                return toast('No one has a complete set to tax')
              playAction(card.id)
            },
          })
          break
        case 'slydeal': {
          actions.push({
            label: 'Steal a property…',
            primary: true,
            onClick: () => {
              const candidates = others(game).filter((p) => stealableCards(p).length > 0)
              if (candidates.length === 0) return toast('No properties available to steal')
              pickPlayer('Steal from whom?', candidates, (p) =>
                pickTheirCard(`Take which of ${p.name}'s properties?`, p, (targetCardId) =>
                  playAction(card.id, { targetPlayerId: p.id, targetCardId }),
                ),
              )
            },
          })
          break
        }
        case 'forceddeal': {
          actions.push({
            label: 'Swap a property…',
            primary: true,
            onClick: () => {
              const mine = stealableCards(my)
              if (mine.length === 0) return toast('You need a property (outside a complete set) to trade away')
              const candidates = others(game).filter((p) => stealableCards(p).length > 0)
              if (candidates.length === 0) return toast('No properties available to swap for')
              pickPlayer('Swap with whom?', candidates, (p) =>
                pickTheirCard(`Take which of ${p.name}'s properties?`, p, (targetCardId) =>
                  setPrompt({
                    title: 'Give which of your properties?',
                    options: mine.map(({ card: mc, pileColor }) => ({
                      label: cardLabel(mc),
                      sub: `${COLOR_INFO[pileColor].label} set · ${mc.value}M`,
                      colorHex: COLOR_INFO[pileColor].hex,
                      onPick: () => playAction(card.id, { targetPlayerId: p.id, targetCardId, myCardId: mc.id }),
                    })),
                  }),
                ),
              )
            },
          })
          break
        }
        case 'dealbreaker': {
          actions.push({
            label: 'Steal a complete set…',
            primary: true,
            onClick: () => {
              const candidates = others(game).filter((p) => p.piles.some(isPileComplete))
              if (candidates.length === 0) return toast('No one has a complete set yet')
              pickPlayer('Break whose deal?', candidates, (p) =>
                setPrompt({
                  title: `Steal which of ${p.name}'s sets?`,
                  options: p.piles.filter(isPileComplete).map((pile) => ({
                    label: `${COLOR_INFO[pile.color].label} set`,
                    colorHex: COLOR_INFO[pile.color].hex,
                    onPick: () => playAction(card.id, { targetPlayerId: p.id, targetPileId: pile.id }),
                  })),
                }),
              )
            },
          })
          break
        }
        case 'house':
        case 'hotel': {
          const needsHouse = card.action === 'hotel'
          actions.push({
            label: `Build a ${card.action}…`,
            primary: true,
            onClick: () => {
              const piles = my.piles.filter(
                (p) =>
                  isPileComplete(p) &&
                  COLOR_INFO[p.color].buildable &&
                  (needsHouse ? pileHas(p, 'house') && !pileHas(p, 'hotel') : !pileHas(p, 'house')),
              )
              if (piles.length === 0)
                return toast(needsHouse ? 'You need a complete set with a house first' : 'You need a complete set first (not rail/utility)')
              setPrompt({
                title: `Build on which set?`,
                options: piles.map((p) => ({
                  label: `${COLOR_INFO[p.color].label} set`,
                  colorHex: COLOR_INFO[p.color].hex,
                  onPick: () => playAction(card.id, { pileId: p.id }),
                })),
              })
            },
          })
          break
        }
        case 'justsayno':
        case 'doublerent':
        case 'quadruplerent':
          // Only playable in response / alongside rent; can still be banked.
          break
      }
      break
  }

  if (canBank) actions.push({ label: `Bank as ${card.value}M`, onClick: () => bank(card.id) })
  return actions
}

// "Move a wildcard" flow for wilds already on the table.
export function moveWildFlow(game: ClientGame) {
  const my = me(game)
  const wilds: { card: Card; pileId: string; color: Color }[] = []
  for (const pile of my.piles)
    for (const c of pile.cards) if (c.kind === 'wild') wilds.push({ card: c, pileId: pile.id, color: pile.color })
  if (wilds.length === 0) return toast('You have no wildcards on the table')

  setPrompt({
    title: 'Move which wildcard?',
    options: wilds.map(({ card, color }) => ({
      label: cardLabel(card),
      sub: `currently ${COLOR_INFO[color].label}`,
      colorHex: COLOR_INFO[color].hex,
      onPick: () => {
        if (card.kind !== 'wild') return
        if (card.colors === 'any') {
          const piles = my.piles.filter((p) => !isPileComplete(p) && !p.cards.some((c) => c.id === card.id))
          if (piles.length === 0) return toast('No other incomplete set to move it to')
          setPrompt({
            title: 'Move it to…',
            options: piles.map((p) => ({
              label: `${COLOR_INFO[p.color].label} set`,
              colorHex: COLOR_INFO[p.color].hex,
              onPick: () => {
                send('moveWild', { cardId: card.id, toColor: p.color, toPileId: p.id })
                setPrompt(null)
              },
            })),
          })
        } else {
          setPrompt({
            title: 'Use it as…',
            options: card.colors.map((c) => ({
              label: COLOR_INFO[c].label,
              colorHex: COLOR_INFO[c].hex,
              onPick: () => {
                send('moveWild', { cardId: card.id, toColor: c })
                setPrompt(null)
              },
            })),
          })
        }
      },
    })),
  })
}
