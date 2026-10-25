# 02 — Base44 target architecture

Facts verified against docs.base44.com (CLI v0.2.2 installed locally).
Proposed mapping — each row's "verify" column says how to prove equivalence.

## 1. Stack

- **Frontend stays:** React 19 + TypeScript + Vite + Tailwind 4. `base44 build`
  injects `VITE_BASE44_APP_ID`; `site.outputDirectory: ./dist`
  (`base44/config.jsonc`).
- **Client:** `@base44/sdk` — `createClient({ appId })` in
  `src/api/base44Client.ts`; inside functions, `createClientFromRequest(req)`.
- **Backend:** `base44/` project — entities (JSON schemas), functions
  (Deno.serve), actors (`base44:runtime/actors`), automations (function.jsonc),
  auth (auth/config.jsonc), secrets (`base44 secrets set`).

## 2. Responsibility mapping

| Convex responsibility | Base44 replacement | Verify |
|---|---|---|
| Tables (31 incl. component tables) | `base44/entities/*.json` — JSON Schema, `base44 entities push` | dashboard Data view; count parity after import |
| Reactive queries (`useQuery`) | `base44.entities.X.filter()/list()` + `X.subscribe(cb)` — entity change subscriptions | edit in window A appears in window B without refresh |
| Mutations | `entities.X.create/update/delete`; `updateMany({id, cond}, {$set})` for atomic claims (only atomic when the query names a single `id`) | two-tab vote/claim race: exactly one winner |
| Actions (multi-step, external calls) | `functions/*/entry.ts` Deno.serve | function invokes, logs show run |
| Internal functions/scheduling | `functions.invoke()` between functions + automations | automation run history |
| Convex Auth (anonymous+OTP+Google) | `base44/auth` — public app + email/password + Google (auth/config.jsonc). Guest = anonymous session; join = real account, then re-point Member rows | sign in/out/restore session; guest → join keeps votes/membership |
| `seatOf` server identity | `base44.auth.me()` inside functions + `_shared/seat.ts` (port) | forged-userId write rejected |
| `presence` table + gesture locks | `actors/spaceRoom` — in-memory peers + gesture map; `conn.send`/`broadcast` | cursor + live drag visible cross-window; two users can't hold one card |
| `roomPresence` occupancy | same actor — `occupancy` broadcast on connect/close | `·N here` correct across windows |
| `leases`/`pending`/`aiWrites`/`choiceVotes` | actor owns hot lease state (persisted to `this.storage`); entities keep the ledger (AiWrite, PendingWrite, ChoiceVote, Lease) | ROW case table holds; ghost lands after release; stale ghost never applies |
| Convex storage (photos) | Base44 file storage / `integrations.Core.UploadFile` | upload → URL → renders on wall in both windows |
| Crons | `function.jsonc` automations (cron/simple) — files already written per function | run history fires on schedule |
| HTTP endpoints | functions are HTTP-addressable; `agentmailWebhook` re-implements svix HMAC verify | forged webhook rejected; real delivery ingested once (WebhookEvent dedup) |
| `@convex-dev/agent` thread | `spaces.askThreadId` → Base44 agent (`base44/agents/`) or a plain thread keyed on Message entity | follow-up questions keep memory |
| `rag` + vector index | **gap** — see §4 | — |
| `aggregate`/`sharded-counter` | count via `entities.list` (small rooms) or maintained counter fields updated by functions | member/vote counts correct |
| `rate-limiter` | `_shared/rateLimit.ts` — entity- or actor-storage token buckets | 6th sparkQuestions/min refused |
| `action-retrier`/`action-cache` | `_shared/` retry+cache helpers (entity-backed cache keyed by URL) | repeated scrape hits cache |
| `workpool`/`workflow`/`batch-worker` | function-level batching + automations; idempotent steps for digest | partial failure resumes without dupes |
| `persistent-text-streaming` | function streaming response (Deno `Response` with ReadableStream) or actor broadcast; askStreams entity keeps the resume row | second window sees the same answer |
| static-hosting | `base44 deploy` site hosting | published URL serves the app |
| `authWellKnown` component | n/a — Base44 auth owns discovery | — |

## 3. Layering (enforced)

```
src/components, src/widgets, src/pages     (unchanged UI)
src/live/*  →  src/services/*              (one adapter layer: auth, spaces,
                                            widgets, realtime, integrations)
src/lib/*            = platform-free domain logic (reused, also vendored to
base44/functions/_shared/                    functions/actors)
base44/entities|functions|actors|auth      (the backend)
```

Rules: UI never calls `base44.entities` directly for writes that need seat
checks or ROW — those go through functions/actor. Reads may go direct where
RLS allows. All externally supplied data validated (zod — already a dep).

## 4. Known gaps needing a designed answer

1. **Transactions:** none. Atomicity strategy = actor serialization (ROW,
   leases, gestures) + `updateMany` single-id claims (votes, potluck claim) +
   ledger-first + idempotent replays.
2. **Vector search:** `by_embedding` has no equivalent. Options: brute-force
   cosine over `Widget.embedding` for small rooms (fine at demo scale),
   or an external vector store behind a function. `similar.ts` thresholds
   documented in architecture.md §9.
3. **FTS:** `messages.search` → `filter` substring or an external search
   integration; flag in parity matrix.
4. **Entity subscriptions ≠ query reactivity:** `subscribe` notifies on entity
   changes; a "list widgets for space" view still needs a filter call +
   resubscribe. Verify granularity (create/update/delete events carry the row).
5. **Uniqueness:** no unique constraints — `slug`, `by_widget_user`,
   `by_space_user` enforced in functions via check-then-claim.
6. **`conn.identity` on actor:** anonymous connections get `anonymousId` —
   guests keep working, but Member attribution needs the seat claim step.

## 5. Deployment

`base44 deploy` pushes entities, functions, actors, automations and the built
site. `base44 dev` runs the local backend + `site.serveCommand`. Full steps in
`10-deployment-guide.md`.
