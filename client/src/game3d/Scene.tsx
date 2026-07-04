import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import type { PerspectiveCamera } from 'three'
import { COLOR_INFO } from '@shared/cards'
import { isPileComplete } from '@shared/logic'
import type { ClientGame } from '@shared/types'
import { Card3D } from './Card3D'
import { computePlacements, seatPositions } from './layout'

// Pulls the camera up/back and widens the FOV on narrow (portrait/mobile)
// viewports so the whole table stays in frame.
function useViewFit(): { fit: number; fov: number; aspect: number } {
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height))
  const fit = aspect >= 1.35 ? 1 : Math.min(1.55, Math.pow(1.35 / aspect, 0.5))
  const fov = aspect < 1 ? 60 : 46
  return { fit, fov, aspect }
}

function CameraRig({ fit, fov }: { fit: number; fov: number }) {
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    camera.position.set(0, 8.2 * fit, 11.2 * fit)
    const persp = camera as PerspectiveCamera
    if (persp.isPerspectiveCamera) {
      persp.fov = fov
      persp.updateProjectionMatrix()
    }
  }, [camera, fit, fov])
  return null
}

function Table() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <circleGeometry args={[7.6, 64]} />
        <meshStandardMaterial color="#1e6b46" roughness={0.95} />
      </mesh>
      <mesh position={[0, -0.35, 0]}>
        <cylinderGeometry args={[7.9, 8.15, 0.6, 64]} />
        <meshStandardMaterial color="#5a3a22" roughness={0.6} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.7, 0]}>
        <circleGeometry args={[30, 32]} />
        <meshStandardMaterial color="#12100e" roughness={1} />
      </mesh>
    </group>
  )
}

function Nameplates({ game }: { game: ClientGame }) {
  const seats = seatPositions(game)
  return (
    <>
      {game.players.map((p) => {
        const f = seats.get(p.id)!
        const x = Math.cos(f.angle) * 6.6
        const z = Math.sin(f.angle) * 6.6
        const isTurn = game.turnPlayerId === p.id
        const bankTotal = p.bank.reduce((s, c) => s + c.value, 0)
        const sets = new Set(p.piles.filter(isPileComplete).map((pl) => pl.color))
        return (
          <Html key={p.id} position={[x, 0.9, z]} center zIndexRange={[10, 0]}>
            <div className={`nameplate ${isTurn ? 'turn' : ''} ${p.left || !p.connected ? 'away' : ''}`}>
              <div className="np-name">
                <span className={`dot ${p.connected && !p.left ? 'on' : 'off'}`} />
                {p.isBot ? '🤖 ' : ''}
                {p.name}
                {p.isHost ? ' ♛' : ''}
              </div>
              <div className="np-stats">
                🂠 {p.handCount} · 🏦 {bankTotal}M · {sets.size}/3 sets
              </div>
              <div className="np-sets">
                {[...sets].map((c) => (
                  <span key={c} className="set-chip" style={{ background: COLOR_INFO[c].hex }} />
                ))}
              </div>
            </div>
          </Html>
        )
      })}
    </>
  )
}

export function Scene({ game }: { game: ClientGame }) {
  const { fit, fov, aspect } = useViewFit()
  const placements = useMemo(() => computePlacements(game, aspect, fit), [game, aspect, fit])
  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[6, 12, 6]} intensity={1.4} />
      <directionalLight position={[-6, 8, -4]} intensity={0.5} />
      <pointLight position={[0, 6, 0]} intensity={18} distance={16} color="#fff2d8" />
      <Table />
      <Nameplates game={game} />
      {placements.map((p) => (
        <Card3D key={p.key} p={p} />
      ))}
      <CameraRig fit={fit} fov={fov} />
      <OrbitControls
        target={[0, 0.4, 1.2]}
        enablePan={false}
        minDistance={7 * fit}
        maxDistance={15 * fit}
        minPolarAngle={0.35}
        maxPolarAngle={1.25}
        minAzimuthAngle={-0.8}
        maxAzimuthAngle={0.8}
      />
    </>
  )
}
