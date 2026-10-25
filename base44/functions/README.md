# Base44 backend functions — migration map

Every directory here is one Base44 backend function (`entry.ts` + optional
`function.jsonc` for automations). These are **skeletons**: each documents the
exact Convex source it replaces and the contract it must honor. They are not
yet functional — see `docs/migration/00-migration-status.md` for status.

Runtime: Deno. Per request, `createClientFromRequest(req)` gives a client
scoped to the caller; `base44.asServiceRole` bypasses entity RLS and MUST only
be used after the function has verified the caller itself (seat semantics:
port `convex/seat.ts` `seatOf`/`canRead`).

## Function inventory (Convex → Base44)

| Convex source | Base44 function | Priority |
|---|---|---|
| `convex/voiceBuild.ts` `deal`/`commit`/`amend`/`decide`/`answer` | `voiceDeal` | P0 |
| `convex/rightOfWay.ts` (the one door) | `rightOfWayDoor` (+ spaceRoom actor for serialization) | P0 |
| `convex/spaces.ts` createSpace/joinSpace/rename/delete/listMine/roomsOpen | `spaceOps` | P0 |
| `convex/messages.ts` `promoteMessage` (the money shot) | `promoteMessage` | P0 |
| `convex/seat.ts` + `convex/guard.ts` | shared `_shared/` helpers, imported by every function | P0 |
| `convex/inbox.ts` + `convex/inboxRouting.ts` (routeSmart) | `inboundRouter` | P1 |
| `convex/http.ts` `/api/agentmail/webhook` (svix HMAC) | `agentmailWebhook` | P1 |
| `convex/recap.ts` `generateAll` | `dailyRecap` (cron 15:00 UTC) | P1 |
| `convex/digest.ts` `weekly` | `weeklyDigest` (cron Fri 16:00 UTC) | P2 |
| `convex/admin.ts` `nightlyReset` | `nightlyReset` (cron 07:00 UTC) | P1 |
| `convex/roomBrief.ts` `refreshActive` | `roomBriefRefresh` (every 10 min) | P1 |
| `convex/batch.ts` `enqueueStaleLinkRefresh` + `processBatch` | `linkRefreshSweep` (cron Fri 17:00 UTC) | P2 |
| `convex/nebius.ts` + `convex/ai.ts` (completeJson/embeddings) | `_shared/ai.ts` — provider routing incl. Nebius Token Factory | P0 |
| `convex/firecrawl.ts` scrape/search/crawl | `linkEnrich` | P1 |
| `convex/tavily.ts` lookup/land | `placeLookup` | P1 |
| `convex/streaming.ts` `/api/ask-stream` | `askStream` (see note) | P2 |
| `convex/questions.ts`, `convex/similar.ts`, `convex/rag.ts` | `_shared/` + `linkEnrich` | P2 |
| `convex/widgets.ts`, `convex/votes.ts`, `convex/paint.ts`, `convex/messages.ts` send/list | entity CRUD + RLS; no functions needed except where validation/atomicity demands (votes one-per-user, potluck claim) | P0 |
| `convex/presence.ts`, `convex/roomPresence.ts`, `convex/leases.ts` | `actors/spaceRoom` | P0 |
| `convex/games.ts`, `convex/puzzles.ts`, `convex/links.ts`, `convex/checkIns.ts` | `gameOps` | P2 |
| `convex/photos.ts` generateUploadUrl/addPhoto | Base44 file storage (`base44.storage` / integrations.uploadFile) | P0 |
| `convex/otp.ts` (join-by-code email) | replaced by Base44 auth (email/social) — see docs/migration/04 | P0 |
| `convex/seed.ts`, `convex/admin.ts` baselines | `seedRooms` (one-shot, run via `base44 exec` or dashboard) | P1 |
| `convex/stats.ts` (sharded counters), `convex/migrations.ts` | derived counts / migration scripts — no runtime replacement | — |
| `convex/rateLimits.ts` | `_shared/rateLimit.ts` backed by an entity or actor storage | P1 |

## Shared code that must NOT be rewritten

`src/lib/rightOfWay.ts`, `src/lib/deck/*`, `src/lib/choiceVote.ts`,
`src/lib/pollRules.ts`, `src/lib/linkQuestions.ts`, `src/lib/linkRanking.ts`,
`src/lib/widgetDefaults.ts`, `src/lib/games/*`, `src/lib/jigsaw/*` are
platform-free TypeScript. Vendor them into `_shared/` (copy, don't re-author)
so functions and actors share one domain layer — that also fixes the mock/live
duplication called out in the audit.
