# NoDeal 3D 🎲

A 3D online multiplayer property-trading card game (in the spirit of the classic
fast-dealing card game) for **2–6 players**, playable with friends via private
room codes. Built with React + Three.js on the front and an authoritative
Node.js/Socket.IO rules engine on the back — all server-validated, so no one
can cheat by editing the client.

## Features

- **Full rules engine**: bank money, lay property sets, rent (with Double The
  Rent stacking), Sly Deal, Forced Deal, Deal Breaker, Debt Collector,
  Birthday, Pass Go, houses/hotels, Just Say No counter-chains, hand limit,
  payment with no change given, win at 3 complete sets of different colors.
- **3D table**: cards are real 3D objects with canvas-painted faces, spring
  animations between zones, an orbitable camera, and per-player nameplates.
- **Desktop and mobile browsers**: touch-friendly controls (tap to select,
  one-finger orbit, pinch zoom), a responsive camera that refits the table on
  portrait screens, a compact HUD with an on-demand log panel, safe-area/notch
  insets, dynamic-viewport-height layout, and a capped pixel ratio for phone
  GPUs.
- **Up to 6 players** with a *proportionally scaled deck*: the base 106-card
  deck grows to 144 cards for 5 players and 170 for 6, keeping every card
  type's draw probability faithful to the base game while adding enough
  properties for big tables to complete sets.
- **Fair shuffling**: unbiased Fisher–Yates driven by Node's crypto RNG.
- **Private rooms**: 5-letter codes, nickname-only (no accounts), reconnect
  support (rejoin token in localStorage), host tools for stuck/disconnected
  players.
- **Solo mode vs CPU**: while the host is alone in the lobby they can start a
  game against a rule-based CPU opponent (the option disappears the moment a
  real player joins). The CPU uses a fixed heuristic strategy — no
  LLM/AI service — reacting to opponents' plays: threat-scored Just Say No
  usage, minimal-loss payments, set-completion-first building,
  steal/deal-breaker target selection, and richest-player rent targeting. It
  only reads public zones plus its own hand — it never peeks at your cards or
  the deck.
- **Server-authoritative**: every action is validated server-side; each player
  only ever receives their own hand (opponents' hands and the deck order are
  never sent over the wire).

## Project layout

```
shared/   Card definitions, deck scaling, rules helpers (used by both sides)
server/   Express + Socket.IO server, authoritative game engine, tests
client/   Vite + React + react-three-fiber 3D client
```

## Local development

```bash
npm install
npm run dev        # server on :8080, Vite client on :5173 (proxied websocket)
```

Open http://localhost:5173 in two browser windows to play against yourself.

```bash
npm test           # deck-composition tests + monte-carlo full-game simulations
npm run typecheck
```

## Deploying to Google Cloud Run

Game state is in-memory by design (simple + free), so run **exactly one
instance** with session affinity:

```bash
gcloud run deploy nodeal-3d \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --max-instances 1 \
  --min-instances 0 \
  --session-affinity \
  --timeout 3600 \
  --memory 512Mi
```

Notes:

- Cloud Run supports WebSockets natively; `--timeout 3600` keeps long game
  sockets alive (the client auto-reconnects and rejoins if one drops).
- `--max-instances 1` is required — rooms live in process memory.
- `--min-instances 0` keeps it free-tier friendly (first visitor after idle
  pays a ~2s cold start; in-progress games do not survive an instance
  restart or redeploy).
- The container listens on `$PORT` (Cloud Run sets it; defaults to 8080).

## Other easy/free deployment options

Any host that runs a Docker container (or Node app) with WebSocket support
works. Good candidates:

| Host | Free? | Notes |
| --- | --- | --- |
| **Render** (free web service) | Yes, genuinely free | Easiest: point it at the repo, it builds the Dockerfile. Spins down after 15 min idle (~1 min cold start), which matches the in-memory design. |
| **Koyeb** | Free tier (1 small service) | Docker deploys, websockets fine. |
| **Fly.io** | Trial credit, then pay-as-you-go (cheap) | Great websocket support, keeps a tiny VM warm. |
| **Railway** | Trial credit, then paid | Very slick DX. |
| **Oracle Cloud Always Free VM** | Yes | An always-on VM for `docker run`; most work to set up. |
| **Cloud Run** | Effectively free at friends-scale | 2M requests + generous CPU-seconds/month free tier. |

## Rules variant notes

- 5–6 player games use the scaled deck described above.
- The winner needs 3 complete sets of **different** colors.
- A player who leaves mid-game has their cards discarded and turns skipped;
  the host can resolve payments owed by disconnected players so the game
  never stalls.
