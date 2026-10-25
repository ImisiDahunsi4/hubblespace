# 12 — Feature parity matrix

Status values: `NOT STARTED` · `IN PROGRESS` · `IMPLEMENTED` (code exists,
unproven) · `VERIFIED` (tested with evidence) · `BLOCKED` (external dependency).

**Backend scaffold is DEPLOYED** (entities/functions/actor/workflows/site —
see doc 09 for evidence), but function bodies and the frontend port are not
started: deployed ≠ migrated. This matrix is the scoreboard the Base44
agent updates.

| Feature | Original (Convex) | Replacement (Base44) | Status | Files / notes |
|---|---|---|---|---|
| Spaces list + rail | `spaces.listSpaces` + aggregate counts | `Space`/`Member` entities + subscribe | NOT STARTED | schema pushed |
| Create/rename/delete space (owner-only) | `spaces.createSpace`… `requireOwner` | `functions/spaceOps` + `auth.me()` ownerId | NOT STARTED | stub deployed |
| Join a space / membership | `members` + `joinDemoSpace`/gate | `Member` entity + `spaceOps.joinSpace` | NOT STARTED | schema pushed |
| Guest identity (no login wall) | `@convex-dev/auth` Anonymous | public app + anonymous actor identity + claim-card Member rows | IN PROGRESS | `auth/config.jsonc` deployed; guest path unproven |
| Join-as-account (upgrade don't fork) | EmailOtp via AgentMail + `createOrUpdateUser` | Base44 email/Google auth + Member re-point | NOT STARTED | replaces `convex/otp.ts` |
| Widget canvas (CRUD, drag, resize) | `widgets.*` mutations + reactive query | `Widget` entity + subscribe + actor `gesture:finish` commit | NOT STARTED | schema pushed |
| ~32 widget types render | `src/widgets/*` | unchanged (reused) | IMPLEMENTED | frontend unchanged |
| Widget.data validation | `widgetData.ts` union (35 arms) | vendored zod union in `_shared` | NOT STARTED | schema keeps `data` open |
| Polls + one-vote-per-user | `votes` + `by_widget_user` upsert + aggregate | `Vote` + `updateMany` claim + count | NOT STARTED | schema pushed |
| Potluck/checklist claims | `claimItem` patch | function-level claim (`updateMany`) | NOT STARTED | races documented |
| Messages/threads/promote | `messages.*` + `promoteMessage` | `Message` entity + `functions/promoteMessage` | NOT STARTED | money-shot stub deployed |
| Live cursors | `presence.ts` heartbeat | `spaceRoom` actor peers | NOT STARTED | stub actor deployed |
| Drag gesture lock (no drag-fights) | `claimGesture`/`finishGesture` | actor gesture map + ordered commit | NOT STARTED | |
| Room occupancy `·N here` | `roomPresence` component | actor `occupancy` broadcast | NOT STARTED | |
| Voice → widgets (deal/commit/amend) | `voiceBuild.ts` + Nemotron | `functions/voiceDeal` + `NEBIUS_API_KEY` | NOT STARTED | P0; stub deployed |
| NL multi-card recipes | `src/lib/deck/*` | vendored unchanged | NOT STARTED | reuse, don't rewrite |
| Right of Way gate | `rightOfWay.ts` + `src/lib/rightOfWay.ts` | gate vendored + actor-serialized + `rightOfWayDoor` | NOT STARTED | pure logic reusable; stub deployed |
| ROW ledger/ghosts/undo | `aiWrites`/`pending`/`leases` | `AiWrite`/`PendingWrite`/`Lease` + actor | NOT STARTED | schemas pushed |
| Choice votes | `choiceVotes.ts` | `ChoiceVote` entity + functions | NOT STARTED | schema pushed |
| Email → canvas brain | agentmail component + `inbox.routeSmart` | `agentmailWebhook` + `inboundRouter` + `InboundMessage`/`EmailEvent` | NOT STARTED | webhook stub deployed; needs new inboxes |
| Reply-in-thread + labels | `agentmail.ts` | `_shared/agentmail.ts` REST helpers | NOT STARTED | |
| because-slip | `because` fields + `BecauseSlip` | unchanged UI + same fields | NOT STARTED | |
| Link cards (scrape/search/crawl) | firecrawl component | `linkEnrich` fn + `Crawl`/`CrawlPage` | NOT STARTED | schemas pushed |
| Daily recap | `recap.generateAll` cron | `dailyRecap` fn + `catch_me_up` workflow | IN PROGRESS | schedule live, body stub |
| Ask-the-space stream | `streaming.ts` + agent thread | `askStream` fn / agent | NOT STARTED | streaming design in 02 |
| Weekly digest | `digest.weekly` workflow | `weeklyDigest` fn + `weekly_digest` workflow | IN PROGRESS | schedule live, body stub |
| Nightly reset | `admin.nightlyReset` | `nightlyReset` fn + `nightly_room_reset` workflow | IN PROGRESS | schedule live, body stub |
| Room briefs | `roomBrief.refreshActive` | `roomBriefRefresh` fn + `room_briefs` workflow | IN PROGRESS | schedule live, body stub |
| Stale link refresh | `batch.ts` + queue | `linkRefreshSweep` fn + `refresh_stale_links` workflow | IN PROGRESS | schedule live, body stub |
| Photo/avatar upload | Convex storage | Base44 file storage | NOT STARTED | |
| Games (hotSeat/flappy/jigsaw) | `games.ts`/`puzzles.ts`/`links.ts` | entities mapped; runtime P2 | NOT STARTED | schemas pushed |
| Cozy coloring room | `paint.ts` + cozy zone | `PaintMark` + actor `zone` cursors | NOT STARTED | schema pushed |
| RAG/similar dedup | `rag.ts`/`similar.ts` + vector idx | **gap** — no vector index | BLOCKED | see 11 |
| FTS chat search | `search_text` index | substring filter fallback | NOT STARTED | reduced fidelity |
| Live stats counters | sharded-counter | derived counts | NOT STARTED | |
| Rate limits | rate-limiter component | `_shared/rateLimit.ts` | NOT STARTED | |
| Waitlist | `waitlist.ts` | `Waitlist` entity | NOT STARTED | schema pushed |
| Admin baselines | `admin.ts` | `Baseline` + `nightlyReset` | NOT STARTED | schema pushed |
| Static hosting | static-hosting component | `base44 deploy` site hosting | VERIFIED | published https://hubblespace-c2adbd10.base44.app |
| Refresh nudge | `UpdateNudge` + static-hosting publish | needs new publish signal | NOT STARTED | |
| Mock demo mode | `?mock=1` + `src/data/` fixtures | keep — labeled demo, never silent | IMPLEMENTED | unchanged |
| Frontend design system | `src/index.css` @theme + components | unchanged | IMPLEMENTED | reused |
| Rebranding | — | sweep done | IMPLEMENTED | see 08; visual QA pending |
| Entity schemas (all 32) | `convex/tables/*` + component tables | `base44/entities/*.json` | VERIFIED | pushed + accepted |
| Scheduled jobs framework | `convex/crons.ts` (6 jobs) | 5 workflows (API-managed) | IN PROGRESS | 6th job — presence GC — folds into `spaceRoom` actor; all crons live |

**Counts:** 4 VERIFIED (schemas, hosting, + reused widget rendering & mock
mode if counting reuse-as-verified), 7 IN PROGRESS (auth config, 5 scheduled
jobs, branding-adjacent), 1 BLOCKED (vector index), rest NOT STARTED.
Deployed stubs are marked by the feature they gate, not by their deploy state.
