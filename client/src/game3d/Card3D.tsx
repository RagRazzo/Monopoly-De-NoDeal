import { useState } from 'react'
import { animated, useSpring } from '@react-spring/three'
import { useStore } from '../store'
import { getBackTexture, getCardTexture } from './textures'
import type { Placement } from './layout'

const CARD_W = 1
const CARD_H = 1.4

export function Card3D({ p }: { p: Placement }) {
  const [hovered, setHovered] = useState(false)
  const selectedCardId = useStore((s) => s.selectedCardId)
  const select = useStore((s) => s.select)
  const selected = p.handCard && selectedCardId === p.card?.id

  const lift = p.handCard && (hovered || selected) ? (selected ? 0.55 : 0.3) : 0
  const spring = useSpring({
    position: [p.pos[0], p.pos[1] + lift, p.pos[2] - (p.handCard ? lift * 0.4 : 0)] as [number, number, number],
    rotation: p.rot,
    scale: p.scale * (selected ? 1.12 : 1),
    config: { tension: 220, friction: 24 },
  })

  const frontTex = p.card ? getCardTexture(p.card) : getBackTexture()
  const backTex = getBackTexture()

  return (
    <animated.group
      position={spring.position as unknown as [number, number, number]}
      rotation={spring.rotation as unknown as [number, number, number]}
      scale={spring.scale}
      onClick={
        p.handCard
          ? (e) => {
              e.stopPropagation()
              select(selected ? null : p.card!.id)
            }
          : undefined
      }
      onPointerOver={
        p.handCard
          ? (e) => {
              e.stopPropagation()
              setHovered(true)
              document.body.style.cursor = 'pointer'
            }
          : undefined
      }
      onPointerOut={
        p.handCard
          ? () => {
              setHovered(false)
              document.body.style.cursor = 'auto'
            }
          : undefined
      }
    >
      {selected && (
        <mesh position={[0, 0, -0.005]}>
          <planeGeometry args={[CARD_W * 1.12, CARD_H * 1.09]} />
          <meshBasicMaterial color="#ffd54a" transparent opacity={0.9} />
        </mesh>
      )}
      <mesh>
        <planeGeometry args={[CARD_W, CARD_H]} />
        <meshStandardMaterial map={frontTex} transparent alphaTest={0.5} roughness={0.7} />
      </mesh>
      <mesh rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[CARD_W, CARD_H]} />
        <meshStandardMaterial map={backTex} transparent alphaTest={0.5} roughness={0.7} />
      </mesh>
    </animated.group>
  )
}
