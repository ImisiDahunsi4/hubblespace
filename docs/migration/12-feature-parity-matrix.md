# 12 — Feature parity matrix

Status values: `NOT STARTED` · `IN PROGRESS` · `IMPLEMENTED` (code exists,
unproven) · `VERIFIED` (tested with evidence) · `BLOCKED` (external dependency).

Nothing is VERIFIED yet — the backend port has not started. This matrix is
the scoreboard the Base44 agent updates.

| Feature | Original (Convex) | Replacement (Base44) | Status | Files / notes |
|---|---|---|---|---|
| Spaces list + rail | `spaces.listSpaces` + aggregate counts | `Space`/`Member` entities + subscribe | NOT STARTED | `base44/entities/Space.json` |
| Create/rename/delete space (owner-only) | `spaces.createSpace`… `requireOwner` | `functions/spaceOps` + `auth.me()` ownerId | NOT STARTED | skeleton written |
| Join a space / membership | `members` + `joinDemoSpace`/gate | `Member` entity + `spaceOps.joinSpace` | NOT STARTED | |
| Guest identity (no login wall) | `@convex-dev/auth` Anonymous | public app + anonymous actor identity + claim-card Member rows | NOT STARTED | `auth/config.jsonc` |
| Join-as-account (upgrade don't fork) | EmailOtp via AgentMail + `createOrUpdateUser` | Base44 email/Google auth + Member re-point | NOT STARTED | replaces `convex/otp.ts` |
| Widget canvas (CRUD, drag, resize) | `widgets.*` mutations + reactive query | `Widget` entity + subscribe + actor `gesture:finish` commit | NOT STARTED | |
| ~32 widget types render | `src/widgets/*` | unchanged (reused) | IMPLEMENTED | frontend unchanged |
| Widget.data validation | `widgetData.ts` union (35 arms) | vendored zod union in `_shared` | NOT STARTED | schema keeps `data` open |
| Polls + one-vote-per-user | `votes` + `by_widget_user` upsert + aggregate | `Vote` + `updateMany` claim + count | NOT STARTED | |
| Potluck/checklist claims | `claimItem` patch | function-level claim (`updateMany`) | NOT STARTED | races documented |
| Messages/threads/promote | `messages.*` + `promoteMessage` | `Message` entity + `functions/promoteMessage` | NOT STARTED | money-shot function stubbed |
| Live cursors | `presence.ts` heartbeat | `spaceRoom` actor peers | NOT STARTED | skeleton written |
| Drag gesture lock (no drag-fights) | `claimGesture`/`finishGesture` | actor gesture map + ordered commit | NOT STARTED | |
| Room occupancy `·N here` | `roomPresence` component | actor `occupancy` broadcast | NOT STARTED | |
| Voice → widgets (deal/commit/amend) | `voiceBuild.ts` + Nemotron | `functions/voiceDeal` + `NEBIUS_API_KEY` | NOT STARTED | P0; skeleton written |
| NL multi-card recipes | `src/lib/deck/*` | vendored unchanged | NOT STARTED | reuse, don't rewrite |
| Right of Way gate | `rightOfWay.ts` + `src/lib/rightOfWay.ts` | gate vendored + actor-serialized + `rightOfWayDoor` | NOT STARTED | pure logic reusable |
| ROW ledger/ghosts/undo | `aiWrites`/`pending`/`leases` | `AiWrite`/`PendingWrite`/`Lease` + actor | NOT STARTED | |
| Choice votes | `choiceVotes.ts` | `ChoiceVote` entity + functions | NOT STARTED | |
| Email → canvas brain | agentmail component + `inbox.routeSmart` | `agentmailWebhook` + `inboundRouter` + `InboundMessage`/`EmailEvent` | NOT STARTED | needs new inboxes |
| Reply-in-thread + labels | `agentmail.ts` | `_shared/agentmail.ts` REST helpers | NOT STARTED | |
| because-slip | `because` fields + `BecauseSlip` | unchanged UI + same fields | NOT STARTED | |
| Link cards (scrape/search/crawl) | firecrawl component | `linkEnrich` fn + `Crawl`/`CrawlPage` | NOT STARTED | |
| Daily recap | `recap.generateAll` cron | `dailyRecap` automation | NOT STARTED | function+jsonc written |
| Ask-the-space stream | `streaming.ts` + agent thread | `askStream` fn / agent | NOT STARTED | streaming design in 02 |
| Weekly digest | `digest.weekly` workflow | `weeklyDigest` automation | NOT STARTED | idempotency rules in 07 |
| Nightly reset | `admin.nightlyReset` | `nightlyReset` automation | NOT STARTED | function+jsonc written |
| Room briefs | `roomBrief.refreshActive` | `roomBriefRefresh` automation | NOT STARTED | written |
| Stale link refresh | `batch.ts` + queue | `linkRefreshSweep` automation | NOT STARTED | written |
| Photo/avatar upload | Convex storage | Base44 file storage | NOT STARTED | |
| Games (hotSeat/flappy/jigsaw) | `games.ts`/`puzzles.ts`/`links.ts` | entities mapped; runtime P2 | NOT STARTED | |
| Cozy coloring room | `paint.ts` + cozy zone | `PaintMark` + actor `zone` cursors | NOT STARTED | |
| RAG/similar dedup | `rag.ts`/`similar.ts` + vector idx | **gap** — no vector index | BLOCKED | see 11 |
| FTS chat search | `search_text` index | substring filter fallback | NOT STARTED | reduced fidelity |
| Live stats counters | sharded-counter | derived counts | NOT STARTED | |
| Rate limits | rate-limiter component | `_shared/rateLimit.ts` | NOT STARTED | |
| Waitlist | `waitlist.ts` | `Waitlist` entity | NOT STARTED | |
| Admin baselines | `admin.ts` | `Baseline` + `nightlyReset` | NOT STARTED | |
| Static hosting + refresh nudge | static-hosting component + `UpdateNudge` | `base44 deploy` site hosting; nudge needs new publish signal | NOT STARTED | |
| Mock demo mode | `?mock=1` + `src/data/` fixtures | keep — labeled demo, never silent | IMPLEMENTED | unchanged |
| Frontend design system | `src/index.css` @theme + components | unchanged | IMPLEMENTED | reused |
| Rebranding | — | sweep done | IN PROGRESS | see 08 |

**Counts:** 2 IMPLEMENTED (widget rendering, mock mode — reused code), 1
IN PROGRESS (branding), 1 BLOCKED (vector), the rest NOT STARTED.
