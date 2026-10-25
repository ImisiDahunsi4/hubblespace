# 04 — Entity permissions (RLS plan)

Base44 entities support `rls` rules in the schema (`read/create/update/delete`,
matching `{{user.email}}`, `{{user.id}}`, `{{user.data.*}}`, `{{user.role}}`,
or `true`). Privileged work goes through functions with `asServiceRole`.

**Design constraint carried over:** "Guest is a complete product — the canvas
is never behind a sign-in screen." So reads on room content must not require a
login, while writes still attribute to a verified seat where it matters.
Anonymous connections exist on actors (`conn.identity.anonymousId`) but entity
RLS treats unauthenticated calls as public — which is exactly the intended
posture for showcase rooms.

## Recommended posture

| Entity | read | create | update | delete | Rationale |
|---|---|---|---|---|---|
| Space | `true` | functions only | functions only (owner) | functions only (owner) | ownerId from `auth.me()` never args; unset owner = locked showcase |
| Member | `true` | functions only | functions only | functions only | join/leave through `spaceOps`; seat is server-derived |
| Widget | `true` | member-checked create | functions/actor | functions/actor | direct create acceptable for MVP only if seat check stays client-side — prefer function |
| Message | `true` | member-checked | author/service | author/service | threads are room-public |
| Vote | `true` | member-checked | same user | same user | one-vote-per-user enforced in function (`updateMany` claim) |
| PaintMark | `true` | member-checked | — | service | append-only strokes; clear via function |
| Presence | `true` | `true` | `true` | `true` | ephemeral fallback only; hot path is the actor |
| EmailEvent / InboundMessage / WebhookEvent | service only | service only | service only | service only | private — mail content must never be client-readable |
| WorkLog / Recap / Brief / Deal / AiWrite / PendingWrite / ChoiceVote / Lease | `true` | service only | service only | service only | readable ledger feeds UI (ghosts, "what it held back", slips) but only functions write |
| Link / AskStream / LinkRefreshQueue | `true` | service only | service only | service only | |
| Game*/Award/PuzzlePiece | `true` | service only | service only | service only | answer-to-see: `GameRound.asks`/`GameAnswer.pick` must be **field-level protected** or withheld until reveal — see below |
| Baseline | service only | service only | service only | service only | admin-only |
| Waitlist | deny | `true` (public join) | service | service | nobody reads the list from the client |
| Crawl / CrawlPage | `true` | service only | service only | service only | |
| User | `true` (profile basics) | system | `{{user.id}}` own row via `updateMe` | system | color/emoji editable by owner only |

## Server-side rules that must hold regardless of RLS

1. **Identity from auth, never args.** Port `seatOf` — `by_user`/`userId`/
   `authorName` fields are derived inside functions from `auth.me()` + the
   caller's Member row. A `userId` in a request body is ignored.
2. **Owner ops** — `ownerId` written only at `createSpace` from the session;
   rename/delete verify `space.ownerId === user.id`; missing ownerId = refuse.
3. **Private spaces** (when supported): `Space` gets an `inviteCode`/`private`
   flag; reads gated by Member-row existence — enforce inside a `getSpace`
   function rather than RLS (RLS can't join tables).
4. **Answer-to-see:** `GameRound.asks` (holds right answers) and
   `GameAnswer.pick` (held back until reveal) — mark the field `"rls"` admin-read
   or strip it in the function that serves rounds; clients get it only after
   `revealedAt`.
5. **Mail/AI internals:** EmailEvent `body`, InboundMessage `text`, Brief
   `facts`, Deal `run` are service-read; UI surfaces `summary`/`because`-style
   derived fields only.
6. **Atomicity recipe:** one-person-one-X uses
   `updateMany({id: rec.id, <old condition>}, {$set: ...})` and checks
   `result.updated === 1` — the ONLY atomic conditional write Base44
   documents. Anything needing cross-record atomicity goes through the
   spaceRoom actor (single serialized writer) or a ledger-first replayable
   function.
7. **No service-role in frontend code.** `asServiceRole` appears only inside
   `functions/` and `actors/`.

## Test plan (must run before claiming VERIFIED)

- guest (anonymous) can read + join + interact on a public space
- guest cannot read EmailEvent/InboundMessage/Baseline/Waitlist rows
- user A cannot rename/delete user B's space; cannot write Member rows directly
- second user cannot open a `private` space without invite
- forged `userId` in a widget/message create is ignored (server attributes seat)
- unrevealed GameRound does not leak `asks`
