# 03 — Data migration

## Status

**PENDING — no production data access.** The live Convex deployment
(`necessary-cobra-892`) belongs to the original project. This document defines
the procedure; the export requires authorized Convex access. If access is
granted, follow §3 exactly and verify with §5 before any cutover.

Meanwhile `base44/entities/` is ready to receive data and `convex/seed.ts` +
`src/data/` provide a complete fixture seed for development/demo rooms.

## 1. Entity map (Convex table → Base44 entity)

All schemas live in `base44/entities/`. Table → entity:

| Convex | Base44 | Notes |
|---|---|---|
| `users` (+authTables) | built-in `User` + `User.json` extension (`color`, `emoji`, `mergedInto`) | **Never migrate password hashes or session secrets.** Re-auth flow required — see §4 |
| `spaces` | `Space` | |
| `members` | `Member` | `userId` stays a string — remap seeded `seed:*` ids as-is, real ids via §4 |
| `widgets` | `Widget` | `data` validated by vendored `widgetData` zod union, not the entity schema |
| `messages` | `Message` | |
| `votes` | `Vote` | |
| `paintMarks` | `PaintMark` | |
| `presence` | `Presence` | ephemeral — **do not migrate** live rows; schema exists for fallback only |
| `baselines` | `Baseline` | |
| `waitlist` | `Waitlist` | |
| `emailEvents` | `EmailEvent` | |
| `work` | `WorkLog` | bounded — migrate recent N rows per space only |
| `recaps` | `Recap` | |
| `askStreams` | `AskStream` | ephemeral-ish; migrate only if streams are live |
| `linkRefreshQueue` | `LinkRefreshQueue` | `queuedAt` = commit-ts → replace with ms timestamp |
| `deals` | `Deal` | |
| `links` | `Link` | |
| `briefs` | `Brief` | regenerate instead of migrating is acceptable |
| `aiWrites` | `AiWrite` | audit ledger — migrate for undo history |
| `leases` | `Lease` | ephemeral — skip live rows |
| `pending` | `PendingWrite` | skip — ghosts older than 30s are dead anyway |
| `choiceVotes` | `ChoiceVote` | migrate only `state:"open"` rows + recent history |
| `games`…`puzzlePieces` | `Game`…`PuzzlePiece` | migrate only live/finished-recently games |
| agentMail `events` | `WebhookEvent` | skip (dedup only) |
| agentMail `inboundMessages` | `InboundMessage` | audit trail — migrate |
| firecrawl `crawls`/`pages` | `Crawl`/`CrawlPage` | optional — pages re-scrapable |
| Convex storage files | Base44 storage | re-upload blobs; rewrite `avatarUrl`/`src`/`thumbnailSrc` URLs |

## 2. ID mapping

Convex ids (`v.id`) become Base44 entity ids. Build a persistent
`id_map` table/file during import: `{ convexTable, convexId, base44Entity, base44Id }`.
Rewrite every reference field through it — `spaceId`, `widgetId`, `memberId`,
`promotedWidgetId`, `from`/`to` on Link, `writeId` on PendingWrite/AiWrite,
`messageId` on AskStream/EmailEvent, `vote` on Link, `gameId` on game tables.
`messages.widgetId` is a **string** that may be `"global"`, a widget id, or a
compound `"<id>::photo:<pid>"`/`"<id>::q:<n>"` — rewrite only the id segment.

## 3. Procedure (restartable, idempotent)

1. **Backup first.** `npx convex export` (or dashboard snapshot) of the source
   deployment into `migration-data/<date>/`. Do not delete originals.
2. **Inventory** — record per-table counts; capture storage file list.
3. **Dependency order:** User(no-op, see §4) → Space → Member → Widget →
   Message → Vote → PaintMark → EmailEvent/InboundMessage → Recap →
   Deal/Link/Brief → AiWrite → ChoiceVote → Game* → Baseline → Waitlist →
   WorkLog → Crawl*/CrawlPage → files.
4. Import via a script run under `base44 exec` (service-side script with
   pre-authed SDK) using `bulkCreate`, tracking `id_map`. Make every step
   resume-safe: skip records whose `convexId` already has a `base44Id`.
5. **Verify** per §5.

## 4. Users — re-auth, not data copy

Convex Auth ids are Convex-local. Options, in order of preference:

1. **Claim flow (recommended):** keep `seed:*` and legacy ids on Member rows;
   when a real Base44 user signs in, `spaceOps.joinSpace` re-points that
   room's Member rows at `user.id` — same "upgrade, don't fork" rule as
   `convex/auth.ts createOrUpdateUser`.
2. Per-user re-registration; admins can `updateMe` profile color/emoji.
3. If the deployment is demo-only (it is — showcase rooms + visitors),
   **reseed** via ported `seed.ts` and treat live rows as disposable.

## 5. Verification checklist

- [ ] record counts per table match (excluding intentionally-skipped ephemera)
- [ ] every rewritten reference resolves (no dangling `convexId` strings —
      grep imported rows for `/^[a-z0-9]{32}$/`-shaped old ids)
- [ ] `members.by_space_user` uniqueness preserved (check dup `(spaceId,userId)`)
- [ ] one `Vote` per `(widgetId,userId)`
- [ ] widget `data` validates against the vendored union for all 35 types
- [ ] timestamps preserved (createdAt etc. — Base44 `created_date` is
      server-set; keep the original in the explicit `createdAt` field)
- [ ] photo/avatar URLs re-hosted and reachable
- [ ] spot-check: same space renders identically in old and new frontends
