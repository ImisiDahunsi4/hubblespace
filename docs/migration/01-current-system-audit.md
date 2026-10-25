# 01 — Current system audit (OurSpaces on Convex)

Baseline verified 2026-10-25: `npm install` clean, `npm run build`
(`tsc -b && vite build`) green. No test suite exists — by the original
author's explicit decision `npm run build` is the check
(`docs/architecture.md` §14, §18).

## 1. The 30-second model

A **space** is a group's shared room = an infinite canvas of **widgets**
(polls, countdowns, photo piles, letters, link cards — ~32 types). Widgets are
rows in one table; the canvas is a reactive query. Three inputs write to a
canvas: **people** (clicks, drags, chat), **email** (each space has a real
AgentMail inbox; a model routes mail into widgets), and **URLs** (Firecrawl
turns a link into a card). On top: **voice** — "say it and the cards land" —
and **Right of Way**, the conflict system that keeps AI writes from touching
what a person is holding or undoing what people chose.

## 2. Two runtimes: mock and live

Two complete canvas implementations, twins not layers
(`docs/architecture.md` §2):

| | Mock | Live |
|---|---|---|
| Entry | `src/App.tsx` (~2.5k lines, one `App()`) | `src/pages/LiveSpace.tsx` (~2.2k lines) |
| Data | in-memory fixtures `src/data/` | Convex reactive queries |
| Trigger | `?mock=1` or `VITE_DATA_MODE=mock` | default when `VITE_CONVEX_URL` set |
| Selector | `src/live/dataMode.ts` `getDataMode()` | same |

**Migration consequence:** the mock runtime is a fully client-side app that
shares components/widgets with live. The Base44 port should collapse this
duplication — one shared domain layer (`src/lib/*` is already platform-free)
feeding a single canvas, with mock reduced to a labeled demo mode seeded from
the same fixtures (`convex/seed.ts` already imports `src/data/` as the seed).

## 3. Convex inventory

### 3.1 Schema — `convex/schema.ts` + `convex/tables/*`

Auth (`authTables` from `@convex-dev/auth`) plus:

| Table | File | Purpose |
|---|---|---|
| `users` | rooms.ts | auth fields + `color`, `emoji`, `mergedInto` (guest→account fold) |
| `waitlist` | rooms.ts | landing-page emails |
| `spaces` | rooms.ts | room row: name/type/icon/color/slug/canvas/tagline, `inboxId`, `askThreadId`, `ragIndexedAt`, `ownerId` (optional — unset = locked showcase), `door` |
| `members` | rooms.ts | `spaceId`, `userId` (string: real id or `seed:*`), name/color/emoji/avatarUrl/lastSeen |
| `widgets` | rooms.ts | `spaceId`, open `type` string, x/y/w/h/z/rotate, `data` (35-arm union in `widgetData.ts`), `createdBy/createdAt`, optional `embedding`/`embeddedText` + vector index |
| `messages` | rooms.ts | chat: `widgetId` = `"global"` | widget id | `<id>::photo:<pid>` | `<id>::q:<n>` | `"recap"`; denormalized author fields; `promotable`/`promotedWidgetId`; FTS index on `text` |
| `votes` | rooms.ts | one row per (widget, user, option); one-vote-per-user via index+upsert |
| `paintMarks` | rooms.ts | coloring-room strokes/region fills |
| `presence` | rooms.ts | cursors + `gesture` object that doubles as the drag lock (TTL 30s / 1.5s) |
| `baselines` | rooms.ts | nightly-reset snapshots per slug |
| `emailEvents` | mail.ts | every mail in/out + `because` reason + AgentMail `messageId`/`threadId` + parsed `attachments` |
| `work` | mail.ts | "the room is thinking" ledger — rows only where work really happened |
| `recaps` | mail.ts | daily/ask briefings, `lines[]` cite widgetId/messageId |
| `askStreams` | mail.ts | streamId → question + recap messageId for `/api/ask-stream` |
| `linkRefreshQueue` | mail.ts | stale-linkCard refresh queue (commit-ts cursor) |
| `deals` | voice.ts | voice-ask receipts (JSON run blob) |
| `links` | voice.ts | card-feeds-card flows; `vote` links to a ChoiceVote |
| `briefs` | voice.ts | room brief a voice ask reads (cron-refreshed) |
| `aiWrites` | rightOfWay.ts | ledger of every AI write + verdict + undo op |
| `leases` | rightOfWay.ts | live holds: `thing` = widget id or `piece:<g>:<i>` |
| `pending` | rightOfWay.ts | "wait"-verdict writes (ghosts), replayed on release |
| `choiceVotes` | rightOfWay.ts | writes that would override people's choices, put to those people |
| `games`, `gamePlayers`, `gameRounds`, `gameAnswers`, `awards`, `puzzlePieces` | games.ts | game state machines + held-back answers + jigsaw |

Component-owned tables (also need mapping): agentMail component `events`
(webhook dedup), `inboundMessages`; firecrawl component `crawls`, `pages`.

### 3.2 Functions — ~250 exported, by area

- **Canvas CRUD:** `widgets.ts` (list/create/move/resize/delete/claimItem/
  spinWheel/tuneRadio/updateWidgetData/stamp/board), `spaces.ts`
  (listSpaces/getBySlug/getSpaceWithWidgets/createSpace/renameSpace/
  deleteSpace/listMine/roomsOpen/joinDemoSpace + admin helpers)
- **Chat:** `messages.ts` (list/paginated search FTS/send/**promoteMessage**)
- **Votes:** `votes.ts` (getResults via aggregate component, vote upsert, inSpace)
- **Presence:** `presence.ts` (heartbeat/claimGesture/updateGesture/
  finishGesture/cancelGesture/listHereNow/disconnect/cleanup — gesture = drag lock),
  `roomPresence.ts` (occupancy via @convex-dev/presence)
- **Right of Way:** `rightOfWay.ts` (the door + expire/cancel/room/heldBack/
  probe), `leases.ts` (hold/letGo/settle/forRoom), `choiceVotes.ts`
  (answer/withdraw/expire/room), `edits.ts` (apply/undo/recent)
- **Voice build:** `voiceBuild.ts` (deal/record/stream/finish/live/commit/
  amend/decide/answer/warm + noteLanded/recent), `roomBrief.ts` (brief
  refresh/get/knows/correct), `links.ts` (card-feeds-card flows)
- **Mail brain:** `agentmail.ts` (inbox mgmt/send/logEvent/onMessageReceived/
  parseAttachments), `inbox.ts` (processInbound → routeSmart → applyExpense/
  applyItinerary/addLetter/prependDroppedLinks), `inboxRouting.ts`,
  `mailArrival.ts`, `digest.ts` (weekly workflow)
- **AI layer:** `ai.ts` (completeJson + model routing), `nebius.ts`
  (Nemotron on Token Factory — the voice model), `rag.ts` (embeddings index),
  `similar.ts` (embedding dedup/echo), `agent.ts` (agent component thread),
  `questions.ts`, `recap.ts` (~530 lines: snapshot/generate/ask/save/reply),
  `streaming.ts` (ask-stream), `guard.ts` (spend ceilings)
- **External:** `firecrawl.ts` (scrapeLink/searchTopic/crawlSite/parseDocument),
  `tavily.ts` (place lookup/enrichment), `batch.ts` (link-refresh worker)
- **Infra:** `auth.ts` (convexAuth, OTP join, seat merge), `seat.ts`
  (seatOf/seatOrMaker/canRead), `rateLimits.ts`, `stats.ts` (sharded
  counters), `checkIns.ts`, `games.ts`, `puzzles.ts`, `photos.ts`
  (storage upload URLs), `admin.ts` (baselines/nightlyReset), `seed.ts`
  (all fixtures), `pilot.ts`, `playLab.ts`, `harness.ts`, `shootReset.ts`,
  `migrations.ts`, `activity.ts`, `staticHosting.ts`, `waitlist.ts`,
  `otp.ts`, `paint.ts`

### 3.3 HTTP endpoints — `convex/http.ts` (mounted under `/api`)

- `POST /api/ask-stream` — persistent-text-streaming SSE for "ask the space"
- `POST /api/agentmail/webhook` — svix HMAC-verified AgentMail inbound
- `/.well-known/*` — OIDC discovery via `authWellKnown` component (mounted at
  root because Convex fetches JWKS from `/`, not `/api` — documented trap)
- Firecrawl crawl webhooks via the firecrawl component

### 3.4 Crons — `convex/crons.ts`

| Job | Schedule | Target |
|---|---|---|
| clean stale presence | every 5 min | `presence.cleanup` |
| weekly digest | Fri 16:00 UTC | `digest.weekly` |
| catch me up | daily 15:00 UTC | `recap.generateAll` |
| nightly room reset | 07:00 UTC | `admin.nightlyReset` |
| room briefs | every 10 min | `roomBrief.refreshActive` |
| refresh stale links | Fri 17:00 UTC | `batch.enqueueStaleLinkRefresh` |

### 3.5 Convex components in use (16 real + 1 first-party)

migrations · aggregate ×2 (`pollTallies`, `memberCounts`) · sharded-counter
(live totals) · rate-limiter (per-space buckets: sparkQuestions/recapAsk
5/min, recapGenerate 3/min, mailSend 10/h, paintStroke 60/min) ·
action-retrier (Firecrawl, AgentMail sends) · action-cache (scrape 1h,
questions) · workpool (recap fan-out ≤3) · workflow (weekly digest) ·
batch-worker (link refresh) · agent (ask-the-space thread) · rag ·
persistent-text-streaming · presence · firecrawl · static-hosting ·
**agentMail** (first-party: `convex/components/agentMail/`).

## 4. Auth & authorization — as built

- `@convex-dev/auth` with **Anonymous** (silent guest sign-in) + **EmailOtp**
  (join by 6-digit code sent through AgentMail from `ourspaces@agentmail.to`)
  + Google provider wired. `callbacks.createOrUpdateUser` upgrades a guest to
  a joined account **without forking the userId** (`docs/data-model-plan.md` §1).
- `convex/seat.ts` `seatOf`/`canRead`/`seatOrMaker`: the caller's identity
  always resolves server-side via `getAuthUserId`; client-supplied names/ids
  are ignored. `requireUserId`/`requireRegisteredUserId`/`requireOwner` in
  `convex/auth.ts` guard `createSpace`/`renameSpace`/`deleteSpace`.
- Deliberate posture: showcase spaces are world-writable for guests; only the
  three owner ops enforce registered identity. **This is a design decision,
  not debt** — but Base44 row-level security gives a chance to tighten it
  (see `04-entity-permissions.md`).
- Known traps preserved in docs: JWKS must serve from site root (authWellKnown
  component); after join the page must reload for the new token (JoinForm.tsx).

## 5. External services & secrets

| Service | Role | Secret |
|---|---|---|
| Nebius Token Factory | Nemotron chat models for voice build (`streamChat`, `enable_thinking=false`) | `NEBIUS_API_KEY` (verify name in convex/nebius.ts) |
| Convex AI Gateway | default chat (`gpt-4o-mini`) + embeddings (`text-embedding-3-small`) | none — minted per-call |
| OpenAI | chat/embedding fallback | `OPENAI_API_KEY` |
| Cloudflare ai-proxy | chat fallback | `AI_PROXY_URL`, `AI_PROXY_TOKEN` |
| AgentMail | per-space real inboxes (3 max, free tier), OTP join sender, digest sender | `AGENTMAIL_API_KEY`, `AGENTMAIL_WEBHOOK_SECRET` |
| Firecrawl | scrape/search/crawl + attachment parsing | `FIRECRAWL_API_KEY`, `FIRECRAWL_WEBHOOK_SECRET` |
| Tavily | place lookup/enrichment for polls | `TAVILY_API_KEY` (verify in convex/tavily.ts) |
| SomaFM | shared radio streams | none (Referer-stripping proxy in vite.config.ts) |
| Convex storage | photo uploads | — |
| Netlify | current frontend host (`ourspaces-app`, ourspaces.io pending DNS) | site id `3b6e9f86-…` |

Kill-switch env: `AI_GATEWAY_DISABLED` reroutes all model calls.

## 6. What stays vs. what gets replaced

**Reuse unchanged (platform-free TS):** everything in `src/lib/` —
`rightOfWay.ts` (the verdict gate), `deck/*` (voice card DSL: prompt,
dealTurn, applyCard, placeCards, recipes, resolve, shortlist), `choiceVote.ts`,
`pollRules.ts`, `linkQuestions.ts`, `linkRanking.ts`, `widgetDefaults.ts`,
`frameMembership.ts`, `games/*`, `jigsaw/*`, `canvasPlacement.ts`, plus all of
`src/widgets/`, `src/components/`, `src/data/` fixtures, `src/index.css`
tokens.

**Adapt (thin ports):** `src/live/*` hooks (swap `useQuery`/`useMutation` for
SDK calls), `src/main.tsx` (provider swap), identity/claim flow.

**Replace:** all of `convex/` — tables → `base44/entities/`, functions →
`base44/functions/`, presence/gesture/lease hot paths → `base44/actors/spaceRoom`,
crons → function automations, storage → Base44 file storage, auth → Base44
auth, generated `_generated/` API → SDK + `base44 types generate`.

## 7. Technical debt & migration risks

1. **No transactions on Base44.** The Convex mutation's atomicity (gate-check +
   commit; multi-table sweeps; vote+ledger) has no direct equivalent. Mitigation:
   spaceRoom actor serializes lease/ROW decisions; `updateMany({id,cond})` claim
   pattern for single-record races; ledger-first writes for replayability.
2. **No vector index** — `widgets.by_embedding` + `similar.ts`/`rag.ts` need an
   alternative (external vector store or brute-force scan over `embedding[]`).
3. **No FTS index** — `messages.search_text`; Base44 `filter` substring matching
   is the documented fallback.
4. **`v.commitTs()` cursor** on linkRefreshQueue — use `queuedAt` ms / `created_date`.
5. **Mock/live twin implementations** — the port is the chance to unify (one
   canvas, fixtures as demo seed only).
6. **Occupancy vs coordinates** — two presence systems by design; the actor
   covers both (`occupancy` broadcast + cursor messages).
7. **Join-creates-new-token-needs-reload** (JoinForm) — Base44's client manages
   tokens itself; verify the post-login identity adoption flow without a reload.
8. **AgentMail 3-inbox cap** — showcase inbox allocation policy carries over;
   new HubbleSpace inboxes must be provisioned fresh (the old ones belong to
   the original deployment).
9. **`?mock=1` everywhere** — keep as demo mode but never let it mask a broken
   live path (mission rule 9).
10. **The `convex/` tree imports from `src/lib/` and `src/data/`** — do not
    move those files while convex/ remains; vendor copies into
    `base44/functions/_shared/` instead.
