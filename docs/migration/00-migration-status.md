# 00 — Migration status & handoff brief

**Product:** HubbleSpace — "Your shared space for turning ideas into action."
**Source:** OurSpaces (MIT, Thomas Nguyen / Holly Tran) — Convex backend.
**Target:** Base44 platform (entities + actors + backend functions + automations + hosting).
**This file is the entry point for whoever continues the migration** — including the Base44 AI agent.

## Ground truth

| Statement | Status | Evidence |
|---|---|---|
| Repo builds clean | VERIFIED | `npm run build` (tsc -b && vite build) green at import |
| Convex backend fully audited | VERIFIED | `01-current-system-audit.md` |
| Base44 entity schemas written | IMPLEMENTED | `base44/entities/` — 31 schemas, 1:1 with convex/tables/* + component tables |
| Base44 project scaffold written | IMPLEMENTED | `base44/config.jsonc`, `auth/config.jsonc`, `actors/spaceRoom`, `functions/*` (skeletons) |
| Base44 app linked / entities pushed | NOT STARTED | needs `base44 login` — credentials |
| Any runtime code migrated | NOT STARTED | frontend still uses Convex exclusively |
| Rebranding | IN PROGRESS | `08-rebranding-checklist.md` |
| Tests | n/a | none existed by original author's decision; `npm run build` is the check |
| Live-data export from Convex | NOT STARTED | needs authorized access to deployment `necessary-cobra-892` |

## Work orders, in priority order (P0 → P2)

### P0 — required for a functional HubbleSpace

1. `base44 login` + `base44 link` (or `base44 create hubblespace`) → writes `base44/.app.jsonc`.
2. `base44 entities push` → verify all 31 schemas in the dashboard.
3. Add `@base44/sdk` to package.json; create `src/api/base44Client.ts`
   (`createClient({ appId: import.meta.env.VITE_BASE44_APP_ID })`).
4. Vendor `_shared/` modules (list in `base44/functions/_shared/README.md`),
   starting with `src/lib/rightOfWay.ts` and `src/lib/deck/*` — copy, don't re-author.
5. Implement `spaceOps` (create/join/rename/delete), then rewire
   `src/live/useCreateSpace.ts`/`useJoin.ts`/`useSpaceData.ts` to it.
6. Port widget CRUD: `useQuery(api.widgets.*)` → `base44.entities.Widget.filter({spaceId})`
   + `Widget.subscribe(...)`; mutations → entity create/update/delete through
   functions where seat checks apply.
7. Wire `spaceRoom` actor: presence cursors + gesture drag-lock + occupancy.
   Replaces `usePresence.ts`/`convex/presence.ts`/`roomPresence.ts`.
8. Implement `voiceDeal` (deal → commit) end-to-end with Nebius via `secrets.get("NEBIUS_API_KEY")`
   — the one NL→widgets path that must work for the competition.
9. `rightOfWayDoor` + actor-serialized commits; verify the go/ask/wait/never
   table in `src/lib/rightOfWay.ts` holds with two browser sessions.
10. Rebrand sweep finishes (`08`), `npm run build`, `base44 deploy`.

### P1 — differentiation

11. `promoteMessage`, daily recap, room briefs, nightly reset.
12. `agentmailWebhook` + `inboundRouter` (routeSmart) for the email brain.
13. `linkEnrich` (Firecrawl scrape/search) for link cards.
14. Photo upload via Base44 file storage (`useAvatarUpload.ts`, photoWall).

### P2 — preserve as time permits

15. Games (`games.ts`/`puzzles.ts`/`links.ts` flows), weekly digest, link
    refresh sweep, ask-stream, Tavily place lookup, RAG re-embedding.

## Hard rules for whoever picks this up

- **Never trust a userId from the client.** Port `seatOf` (`convex/seat.ts`):
  identity comes from `base44.auth.me()`; a name/id in args is ignored.
- **The model never writes directly.** Deal proposes; code validates
  (`applyCard`) and the Right of Way door commits. That boundary is the product.
- **`completeJson` returning null means degrade**, not error — canned fallbacks
  are load-bearing for demos.
- **No multi-entity transactions on Base44.** Ordering comes from the
  `spaceRoom` actor (single lease writer) and the `updateMany({id, condition})`
  claim pattern documented in `04-entity-permissions.md`.
- **`?mock=1` stays** as an explicitly-labeled demo mode, but production data
  paths must never silently fall back to fixtures.
- Keep `convex/` until each replacement is verified. Deletion is the last step.
