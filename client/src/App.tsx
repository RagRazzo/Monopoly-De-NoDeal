import { Canvas } from '@react-three/fiber'
import { useStore } from './store'
import { Home } from './ui/Home'
import { Lobby } from './ui/Lobby'
import { Hud } from './ui/Hud'
import { Scene } from './game3d/Scene'

export default function App() {
  const game = useStore((s) => s.game)

  if (!game) return <Home />
  if (game.phase === 'lobby') return <Lobby game={game} />

  return (
    <div className="game-root">
      <Canvas dpr={[1, 2]} camera={{ position: [0, 8.2, 11.2], fov: 46 }}>
        <color attach="background" args={['#101418']} />
        <fog attach="fog" args={['#101418', 22, 44]} />
        <Scene game={game} />
      </Canvas>
      <Hud game={game} />
    </div>
  )
}
