# 05 — Realtime collaboration & Right of Way

## The two realtime channels

| Channel | Carries | Replaces |
|---|---|---|
| **Entity subscriptions** (`entities.X.subscribe`) | canonical persisted state: widgets, messages, votes, members, game rows | Convex reactive queries — every `useQuery(api.*)` on the canvas |
| **`spaceRoom` actor** (one session per space) | ephemeral + serialized state: cursors, drag gestures, lease holds, occupancy; also the ordered writer for contested operations | `presence.ts`, `roomPresence.ts`, `leases.ts`, and the serialization half of `rightOfWay.ts` |

Rule of thumb: if two screens must see the same durable fact → entity. If it's
a heartbeat, a hold, or an operation that must not interleave → actor.

## Presence port (`convex/presence.ts` → actor)

The Convex version is hand-rolled on purpose and does two jobs:
1. ~90ms cursor writes (+ optional `zone` for the cozy coloring board).
2. The `gesture` object = the **widget drag lock**. `claimGesture` denies if a
   live gesture exists on the widget; `finishGesture` is the commit-on-release.

Actor mapping (`base44/actors/spaceRoom/entry.ts` skeleton):
- `peers` map keyed by `conn.id` — cursor broadcasts to other connections.
- `gesture:claim` checks for a conflicting live gesture/lease → deny or store+broadcast.
- `gesture:finish` writes the final rect to the **Widget entity** from inside
  the actor (`this.client.asServiceRole.entities.Widget.update`) so lock and
  commit stay ordered — never let the client commit a contested rect directly.
- `handleClose`/tick sweeps dead peers and expired gestures (TTLs: presence
  30s, gesture 1.5s — carried over).
- `occupancy` broadcast replaces `roomPresence` (`·N here` on the Rail).

Entity `Presence` exists only as a debugging/fallback record — it is **not**
the hot path.

## Right of Way port

**The pure gate is reused verbatim.** `src/lib/rightOfWay.ts` is
platform-free: `Write + Lease[] → go | ask | wait | never`, with the 10-row
case table in its comment as the spec (choice-override → ask; own hand → go;
another's hold → wait; refused/finishes/held-spot → never). `src/lib/deck/edits.ts`
`applyEdit`/`linkChoice` finds whose choices a write would override. Vendor
both into `base44/functions/_shared/`.

**Where Convex had atomicity, Base44 gets serialization:**
- Convex: gate read leases + committed in one mutation — provably no race.
- Base44: the actor is the single writer of lease state for a room. Every AI
  write is offered to the actor (or to `rightOfWayDoor`, which routes through
  the actor for rooms in session); the verdict and the commit are performed
  in one `handleMessage`, so a competing `lease:hold` cannot slip between
  check and commit. For rooms with no live session, leases live in
  `this.storage` (persisted across idle) + the `Lease` entity as the audit
  record.

**Verdicts → entities:**
- `wait` → `PendingWrite` row (the ghost, WAIT_MS = 30s); the actor schedules
  `handleWake("pending:<writeId>")` and replays via the write's `replay` blob —
  **re-checking it still makes sense first** (`landWaiting` semantics); a
  stale/rejected ghost is never applied after reconnect.
- `ask` → `ChoiceVote` row; answers come back through a function; a passed
  vote resends the write with `consented` set and it goes or waits.
- every call → `AiWrite` ledger row (`fields`, `verdict`, `reason`, `undo`,
  `others`) — the "what it held back" UI reads this.

**Undo:** `AiWrite.undo` carries the inverse op JSON (`edits.ts undo`); undo
is itself an AiWrite through the same door.

## Reconnection

On connect the actor sends `peers` (cursors+gestures); canonical board state
comes from entity queries + subscriptions, so a reload repaints exactly the
committed world. Dead gestures vanish via the sweep; a `PendingWrite` whose
holder let go lands on the next tick/wake; one that no longer makes sense is
dropped — matching `landWaiting`.

## Two-session test matrix (required for VERIFIED)

| # | Scenario | Expected |
|---|---|---|
| 1 | A creates widget | appears on B without refresh |
| 2 | A drags card; B tries to drag same card | B denied with `gesture:denied`; sees A's live drag |
| 3 | A votes on poll | B's tally updates; A's second vote moves, not doubles |
| 4 | A edits card while AI write targets it | verdict `wait` → ghost on both screens → lands after A releases |
| 5 | AI write would flip a choice B made | verdict `ask` → vote rides the card → passes/fails visibly |
| 6 | B drops mid-drag | cursor+gesture swept in ≤TTL; card stays put |
| 7 | reload mid-ghost | ghost visible, resolves per rules; never double-applies |
| 8 | AI write on empty card | `go` — commits immediately |
