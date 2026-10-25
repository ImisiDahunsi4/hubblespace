# 00 — Migration status & handoff brief

**Product:** HubbleSpace — "Your shared space for turning ideas into action."
**Source:** OurSpaces (MIT, Thomas Nguyen / Holly Tran) — Convex backend.
**Target:** Base44 platform (entities + actors + backend functions + workflows + hosting).
**This file is the entry point for whoever continues the migration** — including the Base44 AI agent.

## Ground truth

| Statement | Status | Evidence |
|---|---|---|
| Repo builds clean | VERIFIED | `npx tsc -b && npx vite build` green (2026-10-25) |
| Base44 entity schemas pushed | VERIFIED | `base44 entities push` — all 32 live |
| Backend functions deployed | VERIFIED (real bodies) | 11 functions; `spaceOps`, `promoteMessage`, `rightOfWayDoor`, `voiceDeal`, `askStream` contain real ported logic; the 5 workflow targets + `agentmailWebhook` are stubs |
| spaceRoom actor deployed | VERIFIED (real body) | presence, cursors, gesture locks, leases, TTL sweeps |
| Frontend ported to Base44 | VERIFIED (compiles + deploys) | `src/services/base44/*` — shim, query store, entity impls, actor channel, auth, uploads, streaming; zero runtime `convex/` imports remain in `src/` |
| Live site serves Base44 build | VERIFIED | `base44 build` injects `VITE_BASE44_APP_ID`; https://hubblespace-c2adbd10.base44.app returns the live-mode bundle |
| Anonymous guest read/write | VERIFIED | no-RLS entities are world-readable/writable — `spaceOps create` + `join` + direct entity writes verified via curl |
| End-to-end browser QA | NOT DONE | needs a real browser: join a room, move a card, send a message, voice-deal one card |
| Rebranding | IMPLEMENTED | build green; final visual QA pending |
| Live-data export from Convex | NOT STARTED | needs authorized access to deployment `necessary-cobra-892` |

**Published app:** https://hubblespace-c2adbd10.base44.app —
dashboard https://app.base44.com/apps/6ade2063a43a5acbc2adbd10/editor/workspace/overview.
`?mock=1` still renders the labeled demo.

## Architecture mapping (what lives where)

- **Queries** — `src/services/base44/impl/queries.ts` registers ~35 impls.
  Entity-backed queries re-run on `entities.*.subscribe` events; the actor-fed
  ones (`presence.listHereNow`) stream from `spaceRoom`. All names resolve
  through the Convex-compatible `api` proxy in `shim.ts`, so ~200 call sites
  in `src/live/` and `src/pages/` needed no rewrites.
- **Mutations/actions** — `impl/calls.ts`. Simple writes go straight to
  entities; auth-sensitive ops dispatch to functions with `__op` keys
  (`spaces.* → spaceOps`, `edits.*`/`choiceVotes.answer → rightOfWayDoor`,
  `voiceBuild.* → voiceDeal`, `streaming.createAskStream` stays client-side
  and `askStream` writes the body).
- **Realtime** — `base44/actors/spaceRoom/entry.ts` is the single lease writer
  (cursor TTL 30 s, gesture TTL 1.5 s, disconnect cleanup). Client transport:
  `src/services/base44/roomChannel.ts` (request/reply) + `roomPresence.ts`
  (occupancy rows).
- **Right of Way** — the pure gate is vendored at
  `base44/functions/_shared/lib/rightOfWay.ts`; the door engine is
  `_shared/door.ts` (go/ask/wait/never, AiWrite ledger, PendingWrite,
  choice-vote open/settle). Shared by `rightOfWayDoor` and `voiceDeal`.
- **AI** — `_shared/ai.ts` wraps `integrations.Core.InvokeLLM`. InvokeLLM
  does NOT stream: `voiceDeal` lands answers whole; `askStream` writes the
  body in slices to keep the typewriter feel.
- **Shared-code vendoring** — Base44 function bundles cannot import outside
  their own directory. `functions/_shared/` is the canonical source;
  `functions/sync-shared.sh` copies it into each function dir before deploy
  (`functions/*/_shared/` is gitignored). Run it after editing `_shared`.

## What still needs doing (priority order)

### P0 — before judging
1. **Browser QA of the live path** — join a room as a guest, move a card,
   send a message, watch a second tab. This is untested; the shim is verified
   at compile + deploy level only.
2. **Seed a demo room** — `spaceOps create` + `join` work (verified by curl),
   but there is no seeded showcase space yet. The Convex seed script
   (`convex/seed.ts`) was not ported — port it or hand-seed one room via the
   dashboard for the demo.
3. **`NEBIUS_API_KEY` → not needed** — `_shared/ai.ts` uses
   `base44.integrations.Core.InvokeLLM` (platform-provided). Model names are
   mapped: `lightning`/`ultra` → whatever InvokeLLM defaults to; check
   latency on the voice path.

### P1 — correctness gaps the port knowingly left
4. **No server-side checks on direct entity writes.** Guests can write any
   entity row directly (verified). Convex mutations enforced seat checks;
   the shim's direct writes don't. Options: move hot writes (messages,
   votes, widget updates) behind functions, or add RLS (limited — guests
   aren't authenticated, so RLS can't express "member of this space").
5. **Presence/gesture actor path unproven** — actor code is deployed but
   drag-lock serialization hasn't been verified with two sessions.
6. **Streaming is simulated** — `askStream` slices the finished body;
   InvokeLLM streaming doesn't exist. Typing effect preserved, real
   token streaming isn't.
7. **Choice-vote expiry sweeps** — `settle` runs on answer; the periodic
   expiry sweep from Convex isn't scheduled yet (add to `nightlyReset` or a
   workflow).
8. **`promoteMessage`, `spaces.createSpace` arg shapes** — verified to
   compile + basic invoke; not QA'd against the real UI flows.

### P2 — stubs that still return placeholders
9. Workflow targets `dailyRecap`, `nightlyReset`, `roomBriefRefresh`,
   `weeklyDigest`, `linkRefreshSweep` are stub bodies — recaps/digests
   produce nothing until ported (`convex/recap.ts`, `convex/digest.ts`).
10. `agentmailWebhook`, Firecrawl search/scrape impls (`searchTopic`,
    `crawlSite`, `scrapeLink` return `notPorted`), Tavily place lookup,
    games/jigsaw flows, RAG re-embedding.
11. `convex/` tree still present as recoverable reference — delete only
    after the live path is proven end-to-end.

## Hard rules for whoever picks this up

- **Never trust a userId from the client.** Server functions derive identity
  from `base44.auth.me()`; the Member-row seat check (`_shared/seat.ts`)
  is the only guest path. Direct entity writes are unverified — treat all
  entity data as untrusted.
- **The model never writes directly.** Deal proposes; code validates
  (`applyCard`) and the Right of Way door commits. That boundary is the product.
- **`completeJson` returning null means degrade**, not error — canned fallbacks
  are load-bearing for demos.
- **No multi-entity transactions on Base44.** Ordering comes from the
  `spaceRoom` actor (single lease writer) and door-side PendingWrite rows.
- **`?mock=1` stays** as an explicitly-labeled demo mode, but production data
  paths must never silently fall back to fixtures.
- Keep `convex/` until each replacement is verified in a real browser.
