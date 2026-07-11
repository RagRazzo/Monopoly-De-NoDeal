# Multiplayer Card/Board Game Platform — Design Document

This document distills everything reusable from **NoDeal 3D** (this repo) into a
blueprint for building *other* online tabletop games — auction games (For Sale),
trick-takers, drafting games, tile-layers — on the same architecture. It
separates the **platform** (rooms, networking, timers, bots, persistence, 3D
table, audio, deployment) from the **game** (cards, rules, actions), and ends
with a porting checklist plus a worked For Sale example.

Where this doc says "see `X`", it refers to a file in this repo that is the
reference implementation of the pattern.

---

## 1. Product pillars

These are the non-negotiable qualities every game built on this stack should keep:

1. **Zero-friction play with friends**: no accounts, no downloads. A 5-letter
   room code and a nickname is the entire onboarding. Runs in any desktop or
   mobile browser.
2. **Server-authoritative, cheat-proof**: the server owns all game state and
   validates every action. A client only ever receives what its player is
   allowed to see (own hand, public zones, counts of hidden zones). Editing the
   client cannot reveal secrets or perform illegal moves.
3. **The game never stalls**: turn/response timers with a CPU stand-in,
   reconnect support, host tools for stuck players, and room sweepers mean one
   absent human can never freeze a table.
4. **Free-tier friendly**: single Node process, all game state in memory, one
   Docker image serving both the API and the static client. Deployable to Cloud
   Run / Render / Fly at ~zero cost for friends-scale traffic.
5. **Fully self-contained client**: card faces are canvas-painted (no image
   assets), all audio is synthesized with the Web Audio API (no audio files).
   The whole game ships as one small bundle.

---

## 2. Repository layout & tech stack

```
shared/   Game definitions + pure rules helpers (imported by BOTH client and server)
server/   Express + Socket.IO, authoritative engine, bot, timers, admin, tests
client/   Vite + React + react-three-fiber 3D client, zustand store
```

npm **workspaces** monorepo. Key stack choices and why:

| Layer | Choice | Why it transfers |
| --- | --- | --- |
| Language | TypeScript everywhere, `.ts` sources run directly via `node --experimental-strip-types` (no server build step) | One type system across the wire; `shared/` types define the protocol |
| Transport | Socket.IO (websocket + fallbacks) | Rooms, acks, auto-reconnect out of the box |
| Server | Express serving `client/dist` statically + one Socket.IO server | One process, one port, one container |
| Client state | zustand (single small store) | The server snapshot *is* the state; almost no client-side game logic |
| 3D | three.js via @react-three/fiber + @react-spring/three | Declarative scene; springs give free animation between zones |
| Audio | Web Audio API, fully procedural | No assets; sounds derived from the game log |
| Tests | `node:test` + `assert/strict` | No test framework dependency |
| RNG | `node:crypto` (`crypto.randomInt`) + Fisher–Yates | Unbiased, not seedable by clients |

**The `shared/` package is the heart of the design.** It contains:

- `types.ts` — the full server-side `Game` state shape, the redacted
  `ClientGame` shape, tunable constants (`MIN/MAX_PLAYERS`, `HAND_LIMIT`,
  `TURN_SECONDS`, `RESPONSE_SECONDS`, win condition constants), and the
  `Ack<T>` protocol type.
- `cards.ts` — data-driven card/component definitions and deck construction.
- `logic.ts` — small **pure** rule helpers (`isPileComplete`, `pileRent`,
  `playerWorth`, `hasWon`…) used by the engine, the bot, *and* the client UI
  (e.g. to grey out illegal buttons before the server would reject them).

Client and server compute the same derived facts from the same code — the
client predicts legality for UX, the server enforces it for truth.

---

## 3. Game-content layer (swap per game)

### 3.1 Data-driven component definitions

All cards are defined as a **discriminated union** plus a declarative spec list
(see `shared/src/cards.ts`):

```ts
type Card =
  | { id: string; kind: 'money'; value: number }
  | { id: string; kind: 'property'; color: Color; value: number }
  | { id: string; kind: 'action'; action: ActionName; value: number }
  | ...
```

- Every card instance has a unique stable `id` (`c0`, `c1`, …) assigned at deck
  build time. **Card ids are the universal handle**: the protocol, the engine,
  the payment picker, and the 3D animation keys all address cards by id.
- Counts live in a spec table (`money(1, 6)` = six 1M bills), so the whole deck
  is auditable in ~50 lines and testable (`deck.test.ts` asserts composition).
- Static metadata lives in lookup records (`COLOR_INFO`, `ACTION_INFO`) holding
  label, color hex, set sizes, rent tables, and rule flags (`buildable`). UI
  text and rule parameters come from the same tables — one source of truth.

### 3.2 Player-count deck scaling

For games whose base deck supports fewer players than you want:
`deckScale(playerCount)` multiplies every spec count by a factor (4/3 for 5
players, 3/2 for 6) and rounds, keeping **draw probabilities faithful to the
base game** while providing enough components for big tables. Tested by
`deck.test.ts`.

### 3.3 Zones

The generic zone model that covers most tabletop games:

- Per-game: `deck` (face down, ordered), `discard` (face up, top visible).
- Per-player: `hand` (private), plus any number of public zones — here `bank`
  (money pile) and `piles` (property sets, each `{ id, color, cards[] }` with a
  server-assigned `pileSeq` id).

When the deck runs out, the discard is reshuffled in (Fisher–Yates) — a
generic mechanism worth keeping in any deck game.

---

## 4. The authoritative engine (`server/src/engine.ts`)

### 4.1 Shape of the engine

The engine is a module of plain functions that **mutate the `Game` object and
return `string | null`** — `null` for success, a human-readable error for
rejection. No exceptions for rule violations, no async, no I/O:

```ts
export function playMoney(game: Game, pid: string, cardId: string): string | null
```

This convention is load-bearing:

- The socket layer turns the return value directly into an `Ack` for the client
  (the error string is shown as a toast verbatim — write errors for players,
  not developers: *"Payment must be at least 5M (no change is given)"*).
- The bot and the test harness call the exact same public API as the network
  layer — there is no privileged path.
- Every mutating entry point starts with **guards** (`turnGuard`: phase is
  `playing`, nothing pending, it's your turn) and validates *everything* it was
  passed (card is actually in your hand, target pile exists, target isn't a
  complete set…). Validate first, mutate only after all checks pass — a
  helper like `moveWild` shows the put-back pattern when a check fails after a
  removal.

### 4.2 Game lifecycle

`phase: 'lobby' | 'playing' | 'finished'`.

- **Lobby**: players join/leave freely; seats are compacted; the host (first
  player, reassigned on host leave) starts the game.
- **Start**: build + shuffle deck, deal opening hands, pick a random first
  player, `beginTurn`.
- **Turn loop**: `beginTurn` skips players who left/disconnected, resets
  `playsLeft` (N actions per turn), stamps `turnStartedAt`, draws (2 normally,
  5 on an empty hand). `endTurn` enforces the hand limit by creating a discard
  prompt before advancing.
- **Win check**: `checkWin(game)` is called after every state change that could
  end the game; it flips phase to `finished` and sets `winnerId`. Also: last
  player standing wins if everyone else leaves.

### 4.3 The pending-interaction state machine (the key reusable pattern)

Anything that interrupts the normal turn flow — someone must pay, respond,
choose, or discard — is modeled as a single nullable `game.pending`:

```ts
type Pending =
  | { kind: 'demand'; demand: Demand }          // attack needing responses
  | { kind: 'discard'; playerId; mustDiscard }  // forced discard
```

A `Demand` carries the attacker, an **ordered list of targets** (multi-target
actions like "everyone pays me 2M" resolve one target at a time), a cursor
`index`, and per-target state:

```ts
interface TargetState {
  playerId: string
  stage: 'jsn' | 'pay'   // response phase, then settlement phase
  awaiting: string       // exactly WHO must act next
  jsnDepth: number       // counter-chain depth (No! → counter-No! → …)
}
```

Properties that make this pattern generalize to almost any game:

- **Exactly one player is `awaiting` at any moment.** The UI, the response
  timer, and the bot all key off this single field. Counter-chains (Just Say
  No wars) just flip `awaiting` between target and attacker and bump `jsnDepth`.
- **Targets that can't respond auto-resolve** (nothing to pay → skipped, player
  left → skipped) inside `advanceDemand`, so the machine can never wait on a
  dead seat.
- While `pending` is non-null, `turnGuard` blocks all normal plays — the
  interrupt fully owns the game until resolved.
- The whole demand is **plain serializable data**, so it survives redaction,
  reconnects, and timer sweeps with no special handling.

For a new game, this is the piece you re-model: auctions, simultaneous picks,
trick responses are all "a pending structure + who is awaiting + how it
advances" (see §12 for the For Sale mapping, including the simultaneous-choice
extension).

### 4.4 Payments with no change given

A reusable economic rule + mechanism: the payer chooses *which* cards to hand
over from all payable zones; the server validates the chosen total covers
`min(amount, playerWorth(payer))` (you can't owe what you don't have) and
allows overpaying (no change). `transferPayment` re-homes each card by zone
type. A greedy `autoPickPayment` (smallest cards first) settles for
disconnected/timed-out players.

### 4.5 Leaving, kicking, unblocking

`removePlayer` mid-game discards the leaver's cards, marks them `left`
(seats/turn order keep their shape — never re-index mid-game), reassigns host
if needed, awards the win to a sole survivor, and — critically — **unblocks
any pending interaction involving them** (their prompt is cancelled or
advanced, their turn is skipped). The host may kick only *disconnected*
players. Every one of these paths must leave the state machine runnable; the
monte-carlo test (§9) is what proves it.

### 4.6 Game log

`game.log` is an append-only array of human-readable lines (capped at 200)
plus `logSeq`, a monotonically increasing total count. The log is triple-duty:

- the in-game event feed shown to players,
- the **trigger for client sound effects** (new lines since last snapshot are
  pattern-matched to sounds — see §8.5),
- a debugging trail.

`logSeq` lets clients detect how many new lines arrived even though the array
itself is trimmed and only the last 60 lines are sent.

---

## 5. Rooms, sessions, reconnect (`server/src/rooms.ts`, `index.ts`)

### 5.1 Rooms

- In-memory `Map<code, Game>`. Room codes: 5 chars from an alphabet with
  ambiguous glyphs removed (`no 0/O/1/I/L`), generated with crypto randomness,
  collision-checked.
- **Sweeper** (every 60s): delete rooms idle > 2h, finished > 15min, or empty;
  in lobbies, remove players disconnected > 10min (a long grace period —
  phones background the tab while sharing the invite link, and the room must
  survive that).

### 5.2 Identity & reconnect (no accounts)

- On create/join, the server mints a `playerId` + random `token` (both UUIDs)
  and returns them in the ack. The client stores `{ code, token }` in
  `localStorage`.
- On any (re)connect, the client silently emits `rejoin { code, token }`; the
  server matches the token, marks the player connected, and rebinds the socket.
  A stale session (room gone) clears itself on the failed ack.
- `socketsByPlayer: Map<playerId, socketId>` ensures a reconnect displaces the
  old socket; a `disconnect` event from a superseded socket is ignored.
- Disconnects **never remove a player** — they mark `connected = false`,
  stamp `disconnectedAt`, and log it. Turn skipping, timers, sweepers, and
  host tools handle the rest.

### 5.3 Socket protocol

One pattern for every message, defined by `Ack<T>` in shared types:

```
client --emit('event', payload, ackCallback)--> server
server validates -> mutates via engine -> ack({ok:true|false,error}) -> broadcast
```

- The generic `withGame(socket, fn)` wrapper resolves the socket's bound
  room/player, runs the engine call, converts the error convention to an ack,
  and broadcasts on success. Adding a new game action to the network layer is
  **one line**.
- **Full-snapshot broadcasting**: after any mutation, every player in the room
  receives a complete redacted state (`redactFor(game, playerId)` — see §6).
  No deltas, no client-side reconciliation, no desync class of bugs. At
  tabletop scale (≤ 6 players, small state) this is the right trade; the
  client's animation layer turns snapshot diffs into motion for free (§8.2).

---

## 6. Redaction — per-player views (`server/src/redact.ts`)

`redactFor(game, playerId) -> ClientGame` is the **only** thing ever sent to a
client. Rules:

- Your own hand: full cards. Opponents: `handCount` only. Deck: `deckCount`
  only. Discard: top card + count. Public zones (banks, table piles): full.
- The pending machine is flattened into a display-ready `ClientPending`:
  who's awaiting, stage, amount, and a **pre-composed human description**
  ("Alice must pay Bob 8M (Rent)") so clients don't re-derive narrative text.
- **Clock skew correction**: the snapshot carries `now` (server time at
  redaction) plus absolute `turnDeadline` / `responseDeadline` timestamps.
  Clients render countdowns as `deadline - (Date.now() - (clientNowAtReceipt -
  serverNow))` — no NTP assumptions. Deadlines are `null` when the awaited
  player is a bot (no countdown UI).

**Design rule: hidden information must never leave the process, even
"unused".** Don't send the deck order, don't send opponents' hands and hide
them in the UI.

---

## 7. Liveness: timers, bots, host tools

Three cooperating mechanisms guarantee pillar #3 (the game never stalls).

### 7.1 Turn & response timers (`bot.ts: sweepTimeouts`, driven by `index.ts`)

A 1-second `setInterval` sweeps all rooms:

- **Turn timer** (90s): on expiry, if the player made zero plays the CPU makes
  one *safe* play for them (bank the least useful card), then ends their turn
  either way, auto-discarding over-limit cards (least valuable first).
- **Response timer** (45s): a pending prompt aimed at a human is answered by
  the CPU on expiry (decline the counter / auto-pay / auto-discard).
- **Prompt time is credited back**: while a prompt is open the turn clock is
  paused — `pendingKey` (a string fingerprint of the current prompt+awaiting)
  detects prompt transitions, `pendingSince` measures the wait, and on
  resolution `turnStartedAt += waited`. Without this, an opponent's slow
  response eats your turn.
- **Nobody watching → freeze**: if no connected human remains, both the
  sweeper and the bot scheduler pause the room (don't burn CPU playing a game
  nobody sees; the state waits for a rejoin).

### 7.2 The rule-based CPU (`server/src/bot.ts`)

- **Pure heuristics, no lookahead, no LLM, deterministic.** ~500 lines of
  priority rules: complete-a-set first, threat-scored counter-card usage,
  minimal-loss payment picking, target-the-richest attacks, keep-score-based
  discards.
- **Fair by construction**: reads only its own hand + public zones. Never
  peeks at opponents' hands or the deck. This is a trust feature — document it.
- **One action per tick**: `botToAct(game)` returns which bot (if any) owes an
  action right now — the current player on a normal turn, or whoever a pending
  prompt awaits. `botAct` performs exactly one engine call. The server
  schedules ticks on an ~800ms delay after every broadcast, so humans watch
  the CPU act step by step instead of an instant blur.
- **Dual use**: the same decision functions serve as the *stand-in* for
  timed-out or disconnected humans (§7.1) — one strategy implementation covers
  both solo mode and liveness.
- Every bot engine call is checked (`ok(...)`) with a safe fallback (e.g. "pay
  with everything", "discard first N"), so a bot bug degrades gracefully
  instead of wedging a room. Bot errors are caught and logged per room.
- **Solo mode**: while the host is *alone* in the lobby they can start against
  a CPU (`startWithBot`); the option is host-only and disappears when a human
  joins. Bots get `id: bot-N` and are excluded from human-count checks.

### 7.3 Host tools

- `forceResolve`: the host can settle a prompt owed by a **disconnected**
  player (auto-decline / auto-pay / auto-discard) — refused while they're
  still connected.
- `kickPlayer`: host-only, disconnected players only.

---

## 8. Client design

### 8.1 State model (`client/src/store.ts`, `net.ts`)

One zustand store holding: the latest `ClientGame` snapshot, connection flag,
transient UI state (selected card, active prompt, inspector targets, local
hand order), and a toast helper. Socket wiring is ~70 lines: `state` events
replace the snapshot wholesale; failed acks become toasts. **There is no
client-side game state to keep consistent** — the snapshot is the state.

Client-only conveniences layered on top without touching the server:

- **Local hand ordering**: the player's chosen order is a list of card ids;
  `orderHand` sorts the incoming hand by it, with fresh draws appended in
  natural order. Reordering is a pure client concern.
- Selection is auto-dropped when the selected card leaves your hand in a new
  snapshot.

### 8.2 The 3D table (`game3d/`)

The rendering architecture is the most transferable client idea:

1. **Layout is a pure function**: `computePlacements(game, aspect, fit,
   orderedHand) -> Placement[]` maps the snapshot to a flat list of
   `{ key, card|null, pos, rot, scale }`. Seats are computed by walking the
   player list from *your* index around a circle (`seatFrame`), with a
   seat-local coordinate helper (`local(f, lx, ly, lz)`) so per-player zones
   (bank right of the player, piles fanned toward center, opponents' hand fans
   as card backs) are written once in local space.
2. **Keys are card ids** (`key: card.id`). Face-down placeholders get
   synthetic keys (`deck-3`, `hand-<pid>-2`).
3. **Animation falls out of react-spring**: each `Card3D` renders at a
   spring-animated pos/rot/scale. When a new snapshot moves a card from hand
   to table (or steals it across the table!), the same keyed component gets
   new targets and *glides there*. **No animation system, no tweens — the
   snapshot diff is the animation.**
4. **Cards are canvas-painted** (`textures.ts`): 512×716 rounded-rect canvases
   drawn from `COLOR_INFO`/`ACTION_INFO` metadata, cached per card *type* (not
   instance) as `CanvasTexture`s. New game = new painting functions, zero image
   assets.
5. **Responsive camera**: `viewFit(aspect)` pushes the camera back and widens
   FOV on portrait screens so the table refits; `OrbitControls` are constrained
   (no pan, clamped polar/azimuth/distance) so players can peek but never get
   lost.
6. **Hand fan math**: card scale adapts to aspect; the fan's spread is capped
   by the camera frustum width at the hand's depth (cards never spill
   off-screen); each card sits at strictly increasing depth so overlaps never
   z-fight/flicker (this fixed a real mobile bug).
7. **HTML-in-3D for text**: nameplates are drei `<Html>` overlays anchored to
   seat positions showing live stats (hand count, bank total, progress toward
   the win condition) and doubling as tap targets for the player inspector.

### 8.3 Interaction model (`ui/actions.ts`, `Modals.tsx`, `Hud.tsx`)

- **Select a hand card → contextual action buttons** (`actionsFor(game, card)`
  returns `{label, onClick}[]`), computed with the same shared `logic.ts`
  helpers the server uses, so illegal options simply don't appear.
- **Multi-step choices are chained prompts**: a generic
  `Prompt { title, options[] }` modal; flows like *rent → pick color → pick
  doubling level → (wild) pick target* are plain functions that chain
  `setPrompt` callbacks and end in one `send('playAction', {cardId, opts})`.
  There is exactly one prompt at a time, stored in the store.
- **Server-driven prompts** (payment picker, Just Say No decision, discard
  picker) render from `game.pending` — whenever `pending.awaitingId === youId`,
  a blocking modal opens. Timers show on both sides (the awaited player sees a
  countdown; others see who's holding things up).
- Mobile & UX details worth carrying: tap-to-select, one-finger orbit, pinch
  zoom, dynamic-viewport-height layout, safe-area insets, capped
  `devicePixelRatio` for phone GPUs, a 🔍 full-size card zoom, a collapsible
  log panel, and copy/share invite links (Web Share API on mobile, clipboard
  on desktop).

### 8.4 Post-launch 3D/UX fixes — bake these in from day one

The first build "worked" but real play (especially on phones) surfaced a set
of problems that took follow-up fixes. Any new game on this stack should adopt
the solutions from the start:

1. **Coplanar cards flicker (z-fighting).** The original hand fan placed cards
   at symmetric depths (`6.9 + |t| * 0.35`), so the two center cards — and
   every mirrored pair — sat at *identical* depth and shimmered as the camera
   moved. The fix is a hard rule: **no two overlapping cards may ever share a
   plane.** Give every card in a group a strictly increasing offset on the
   axis facing the camera: hand cards `z = 6.75 + i * 0.045` (left tucks under
   right, like a real hand), opponents' hand backs `y = 0.6 + i * 0.02,
   z = 1.35 + i * 0.015`, table piles/banks lifted `y = 0.02 + i * 0.012` per
   card. These offsets are invisible but kill the entire flicker class.
2. **Cards piling into an unreadable heap on the table.** Stacked table cards
   need *deliberate* spreading, not just lift: piles fan each card toward the
   table center (`z = -0.15 - i * 0.38` in seat-local space) so every card's
   header stays visible; bank stacks get a small alternating spin
   (`(i % 3 - 1) * 0.09`) so a pile of money reads as a pile, not one card.
   Cap what you render for unbounded stacks (deck shows ≤ 12 backs, opponent
   hands ≤ 8 backs) — counts carry the truth, geometry only needs to suggest it.
3. **Hand cards jamming/spilling on narrow screens.** A fixed fan width either
   overflows a portrait screen or squeezes cards into a jam. Fix: compute the
   fan spread from the **camera frustum itself** — visible width at the hand's
   depth is `2 · tan(fov/2) · dist · aspect`; clamp the spread to that minus
   one card width, and shrink the base card scale on portrait (`0.8` vs
   `1.05`). The hand then adapts to any device with no breakpoints.
4. **A fixed camera can't serve both landscape and portrait.** The fix that
   unlocked mobile: a single `viewFit(aspect)` function (in `layout.ts`, used
   by *both* the camera rig and the layout math so they can never disagree)
   returns a fit factor that pulls the camera up/back (up to 1.55×) and widens
   the FOV (46° → 60°) as the viewport narrows. Everything camera-relative —
   hand position, hand scale, orbit distance limits — multiplies by `fit`.
5. **Camera flexibility with guardrails.** Players want to zoom in on cards
   and peek around the table, so don't lock the camera — constrain it:
   `OrbitControls` with pan disabled, zoom range `7·fit … 15·fit`, polar angle
   clamped to `0.35 … 1.25` rad and azimuth to `±0.8` rad. One-finger orbit and
   pinch-zoom on touch. The clamps matter as much as the freedom: players can
   never end up under the table, behind an opponent, or lost in space.
6. **3D zoom is not enough to read a card.** Even with orbit zoom, card text
   on a phone is too small. Two 2D escape hatches fixed it: a 🔍 **full-size
   card zoom** overlay for the selected hand card (renders the same canvas
   texture at screen size), and a **player inspector** — tap any nameplate to
   see that player's piles and bank as flat, tappable-to-zoom thumbnails.
   Inspecting public zones must never require camera gymnastics.
7. **Mobile browser plumbing** (fixed in one pass, keep as a checklist):
   `100dvh` layout (not `100vh`), safe-area insets for notches, canvas
   `touch-action: none` with `manipulation` on controls (no double-tap zoom),
   16px+ inputs (no iOS focus auto-zoom), no long-press callout,
   `devicePixelRatio` capped at 2 for phone GPUs, compact HUD under 760px with
   the log as a toggleable overlay.
8. **Whose-turn visibility.** Playtesters missed their own turn: fix was a
   highly visible turn timer/banner state, your-turn chime (§8.5), and turn
   highlighting on nameplates. Assume players are distracted between turns.

### 8.5 Procedural audio (`client/src/audio.ts`)

- Everything synthesized in the Web Audio API: a generative ambient loop
  (detuned pad chords + sparse pentatonic plucks through a lowpass) and short
  per-action SFX voices, routed through separate music/SFX gain buses.
- **Sounds are driven by the game-log diff**: on each snapshot, new log lines
  (detected via `logSeq`) are pattern-matched to sounds — so you hear
  opponents' and the CPU's plays with zero extra protocol. Plus your-turn and
  win/lose chimes from state transitions.
- Browser autoplay policy: audio unlocks on first `pointerdown`. A speaker
  button cycles music+SFX → SFX → mute, persisted in `localStorage`.

---

## 9. Testing strategy (`server/test/`)

All tests exercise the **public engine API** — the same functions the network
layer calls. In order of value:

1. **Monte-carlo full-game simulation** (`simulate.test.ts`): random-legal-move
   bots play complete games at every player count, asserting after *every*
   step:
   - **card conservation** — the total card count across deck + discard +
     all hands/banks/piles never changes (catches duplication/vanishing bugs,
     the worst class in card games),
   - the game never wedges (a step budget fails the test),
   - games actually finish with a winner.
   This single test is the safety net that makes refactoring the engine safe.
   **Port it first to any new game.**
2. **Invalid-move fuzzing**: wrong-turn plays, nonexistent cards, etc. are
   rejected *and* leave state untouched.
3. **Deck composition** (`deck.test.ts`): exact counts at each player scale.
4. **Timer tests** (`timer.test.ts`): inject `now` into `sweepTimeouts` to
   prove turn expiry, response expiry, and clock-credit behavior without real
   waiting. (Design rule: every time-dependent function takes `now = Date.now()`
   as a parameter.)
5. **Bot tests** (`bot.test.ts`): the CPU finishes games, makes legal moves.
6. **Concurrency tests** (`concurrent.test.ts`): interleaved actions across
   multiple rooms stay isolated (no cross-room state bleed).
7. **Lobby tests**: join/leave/host-reassign/sweeper edge cases.

Plus `npm run typecheck` across both workspaces (the shared types make many
protocol mistakes compile errors).

---

## 10. Access control, admin & analytics (fully game-agnostic)

### 10.1 Host-code gate (`server/src/hostCodes.ts`)

Problem: a public URL shouldn't let strangers run games on your free tier.
Solution: **creating** a room requires a host code; **joining** never does.

- Codes live in `host-codes.json` at the repo root (baked into the image), with
  a `masterCode` that both hosts games and unlocks the in-app **admin page**
  (add/enable/disable/delete codes, see usage). Codes are normalized
  (trim+lowercase); validation **fails closed** (no readable file → nobody can
  host).
- Every admin socket call re-checks the master code — no session state to
  hijack.

### 10.2 Durable state on ephemeral hosts

The generic pattern for "one JSON file of app state" on containers:

- `DATA_DIR` env var points at a mounted volume (e.g. a Cloud Storage bucket on
  Cloud Run). On boot: seed the durable file from the repo copy if absent;
  repo `masterCode` always wins; **new** repo codes merge in; admin deletions
  are kept as **tombstones** so a redeploy can't resurrect them.
- **Boot-time self-diagnosis**: write-probe the dir *and* check `/proc/mounts`
  to distinguish `ok` (writable, real mount) from `unmounted` (writable but
  plain container disk — data will silently vanish!) from `failed: EROFS/
  EACCES/ENOENT` (each errno mapped to a human explanation). Status is exposed
  on `/healthz` and the admin page. This caught real misconfigurations; keep it.

### 10.3 Usage tracking

- One `RoomUsage` record per room, updated through its lifecycle
  (created → started → finished/abandoned), keyed by host code, with player
  counts, winner, turn count, coarse client info (browser timezone/locale, IP
  from `x-forwarded-for`).
- Storage: in-memory map (capped) + **append-only JSONL snapshots, last-wins
  merge by id on load** — updatable records on top of an append-only file, no
  database. Every record is also echoed to stdout (`host-code-usage {...}`)
  so platform logging (Cloud Logging) keeps a permanent trail even without the
  volume.
- Boot reconciliation: records still "open" from a previous instance are
  closed as `abandoned`.
- Lifecycle hooks are driven by **phase-transition tracking in the broadcast
  path** (`trackPhase` in `index.ts`) — lobby→playing records the start,
  →finished records the outcome, and the room sweeper records abandonment.

### 10.4 `/healthz`

Returns: `revision` (deploy identifier), `instanceId` (random per process — if
it changes between refreshes, **more than one instance is running**, which
violates the in-memory design), durable-storage status, uptime, active room
count. Cheap and invaluable for a memory-stateful service.

---

## 11. Build & deployment

### 11.1 Docker (see `Dockerfile`)

Two-stage: build the Vite client, then a slim runtime with production-only
server deps, the `shared/` + `server/` TS sources (run directly with
`node --experimental-strip-types`), and the built `client/dist`. One image,
one port (`$PORT`, default 8080), serving both websocket API and static SPA
(catch-all route → `index.html`).

### 11.2 The in-memory single-instance contract

Game state lives in process memory **by design** (simple + free). This dictates
deployment:

- **Exactly one instance** (`--max-instances 1`) + `--session-affinity`.
- Long request timeout (`--timeout 3600`) to keep game websockets alive.
- `--min-instances 0` for free tier: cold starts are acceptable; in-progress
  games do not survive restarts/redeploys (the client auto-reconnects and
  rejoins what still exists).
- Anything that must survive restarts goes through the `DATA_DIR` pattern
  (§10.2) or stdout logging.

Scaling beyond one instance would mean externalizing rooms (Redis or sticky
shard-by-room-code) — deliberately out of scope at friends-scale.

Works on any Docker/Node host with websockets: Cloud Run, Render free tier,
Koyeb, Fly.io, Railway, a bare VM (see README's comparison table).

---

## 12. Porting checklist: building a new game on this platform

### 12.1 What you keep unchanged (the platform, ~70% of the code)

- Rooms, codes, join/rejoin tokens, socket plumbing, `withGame`, `Ack`,
  full-snapshot broadcast, sweepers, disconnect handling.
- Host-code gate, admin page, usage tracking, `DATA_DIR` persistence,
  `/healthz`, Dockerfile, deployment recipe.
- The redaction *pattern*, timer sweeper *pattern*, bot scheduling (one action
  per tick with delay, pause when unwatched), stand-in-for-humans mechanism.
- Client shell: store, net, toasts, prompt system, session storage, sound
  architecture, mobile handling, 3D table scaffolding (seat math, spring cards,
  canvas textures, camera fit).
- The monte-carlo test harness structure and its invariants.

### 12.2 What you replace (the game, in dependency order)

1. `shared/cards.ts` → your components: card union, spec/count tables, metadata
   records, `buildDeck`. Keep unique ids and the scale mechanism if player
   counts vary.
2. `shared/types.ts` → your `Game`/`Player` zones, your `Pending` shapes, your
   constants (turn seconds, win thresholds), and the matching `ClientGame`.
3. `shared/logic.ts` → your pure scoring/legality helpers (used by engine, bot,
   and UI alike).
4. `server/src/engine.ts` → your actions and turn structure, keeping the
   conventions: `(game, pid, args) -> string | null`, guards first, `log()`
   every event, `checkWin()` after every mutation, pending machine for
   interrupts, unblock-on-leave.
5. `server/src/redact.ts` → what each player may see, plus `describePending`.
6. `server/src/index.ts` → one socket handler line per new engine action.
7. `server/src/bot.ts` → new heuristics behind the same three entry points:
   `botToAct`, `botAct` (one action), `respondPendingFor` (also the human
   stand-in), plus `sweepTimeouts` policies.
8. Client: `ui/actions.ts` (contextual buttons + prompt chains),
   `game3d/layout.ts` (zone placement), `game3d/textures.ts` (card faces),
   `Modals.tsx` (pending-driven prompts), sound mappings in `audio.ts`.
9. Tests: rewrite the random-legal-move player in `simulate.test.ts`; keep the
   conservation/termination/isolation assertions.

### 12.3 Worked example: **For Sale**

Mapping the auction game For Sale onto this platform:

- **Components** (`cards.ts`): 30 `{kind:'house', rank:1..30}` cards,
  30 `{kind:'check', value:0|2..15}` cards, per-player starting coins (15/18
  depending on player count — a constant table keyed by player count, like
  `deckScale`). Card faces: two painting functions (house art by rank tier,
  check with a big value) — simpler than this repo's ten.
- **Zones**: `deck`, a public `market` (the N face-up cards this round),
  per-player `coins` (public count), `houses` (private or public per your
  variant — decide in `redactFor`), `checks` (hidden until game end), current
  `bids` (public).
- **Turn structure**: For Sale is **phase-based, not plays-per-turn**:
  `phase: 'lobby' | 'buying' | 'selling' | 'finished'`. The buying phase is a
  rotating auction — which is exactly a `Pending`-style structure promoted to
  the main loop: `{ market: Card[], bids: Map<pid, number>, passed: pid[],
  awaiting: pid }`. `bid(game, pid, amount)` and `pass(game, pid)` replace
  `playMoney`/`playProperty`; the guards convention, error strings, log lines,
  and broadcast flow are identical.
- **Simultaneous choice** (selling phase — everyone secretly picks a house,
  then all reveal): this is the one *extension* to the pending pattern. Instead
  of a single `awaiting`, use
  `{ kind:'simultaneous'; choices: Map<pid, cardId>; deadline }`: accept each
  player's choice silently (redact others' `chosen` to a boolean "ready"
  flag), resolve when all active players have chosen **or** the response timer
  expires (CPU stand-in picks for the missing — reuse `respondPendingFor`).
  The reveal is one broadcast; the spring-animated cards make the simultaneous
  flip look great for free.
- **Win condition**: `hasWon` becomes end-of-deck scoring (`checks + leftover
  coins`, tiebreak per rules) in `checkWin` when the selling deck empties.
- **Bot**: simpler than NoDeal's — bid heuristics (value of remaining market
  vs. coins), sell heuristics (rank-proportional check expectations). Same
  `botToAct`/one-action-per-tick shell; same timeout stand-in.
- **Layout**: market cards fan in the table center; player houses in the pile
  row slot; coins as a bank-like stack; the seat/camera/hand code is untouched.
- **Monte-carlo invariant**: conservation becomes "houses + checks + coins are
  conserved"; termination is "deck empties and scoring fires".

Everything else — rooms, reconnect, host codes, admin, timers, audio, mobile,
deploy — carries over without modification.

---

## 13. Design rules of thumb (hard-won, keep them)

1. **The server is the only truth; the ack error string is the only "no".**
   Write every rejection message for the player who will read it in a toast.
2. **Never ship hidden info to the client**, even unused — redact at the
   source.
3. **Snapshots over deltas** at tabletop scale; let keyed spring animation
   turn diffs into motion.
4. **Model every interruption as `pending` with an explicit `awaiting`** —
   the UI, timers, and bots all hang off that one field.
5. **Every path must leave the state machine runnable**: leaves, kicks,
   timeouts, and bot errors all need an unblock story. Prove it with
   monte-carlo simulation + a card-conservation invariant.
6. **Time-dependent logic takes `now` as a parameter** so tests inject time.
7. **One heuristic implementation serves both solo bots and absent humans.**
8. **Shared pure helpers** keep client affordances and server enforcement
   from drifting.
9. **Fail closed on access control; self-diagnose persistence at boot; expose
   both on `/healthz`.**
10. **Log lines are a product surface**: they feed the event feed, the sound
    engine, and debugging — write them well.
11. **No two overlapping cards ever share a plane, and one function owns the
    camera/layout math.** Tiny per-card depth offsets kill z-fighting; a
    shared `viewFit(aspect)` keeps the camera rig and layout from drifting;
    fan widths derive from the frustum, not from breakpoints (§8.4).
