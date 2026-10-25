# 11 — Known limitations & open risks

Honest list — updated as migration proceeds.

## Hard platform gaps (Base44 ↔ Convex)

1. **No multi-entity transactions.** Convex mutations were atomic; Base44
   writes are per-record (documented). Mitigation designed but unproven:
   `spaceRoom` actor as the single serialized writer for leases/ROW; the
   `updateMany({id, condition})` claim pattern for single-record races;
   ledger-first idempotent writes elsewhere. Risk: subtle races on
   potluck-claim-style multi-field updates until exercised under load.
2. **No vector index.** `widgets.by_embedding`, `similar.ts`, `rag.ts` need an
   alternative (brute-force cosine is fine at demo scale; a vector service
   otherwise).
3. **No full-text search index** on entities — `messages.search` falls back to
   substring filter or an external search integration.
4. **Entity subscriptions are change notifications, not reactive queries.**
   Filtered views need refetch-on-event or client-side merge; the original
   "the query is the state" ergonomics must be rebuilt in `src/services/`.
5. **No unique constraints.** `slug`, `(spaceId,userId)` membership,
   `(widgetId,userId)` votes are convention + function-enforced only.
6. **Actor identity for anonymous guests** is an `anonymousId`, not a user —
   seat attribution for guests still flows through the Member row + claim
   card, as designed, but needs care in `spaceOps`.
7. **Streaming ask (`/api/ask-stream`)** — needs a Deno streaming function or
   actor broadcast; persistent-resume semantics (a reload sees the same
   answer) must be re-derived from `AskStream` + Message rows.

## Functional items explicitly deferred (P2)

- Games suite (`hotSeat`, `flappy`, jigsaw, `links` flows) — entities mapped,
  runtime not ported.
- Weekly digest, link refresh sweep, Tavily enrichment, RAG, ask-stream.
- Vision-on-photos and emailed-attachment routing (unbuilt upstream too).

## Carried-over quirks

- Mock/live twin canvas (`?mock=1`) — keep as labeled demo mode; the Base44
  port should converge on one canvas fed by `_shared` domain logic.
- Seeded people are `seed:*` strings — never authenticate; keep them out of
  counts/presence attribution where it matters.
- AgentMail free tier: 3 inboxes/org — the original org's inbox names must
  not be reused; provision HubbleSpace's own and update `ensureShowcaseInboxes`.
- Join flow: Convex required a page reload after token upgrade; verify
  whether Base44 needs the same (likely not — token handling differs).

## Platform facts learned by doing (not in docs)

- **Workflows, not automations.** New apps have Workflows enabled;
  `automations` blocks in `function.jsonc` fail deploy with a 409.
  Workflow definitions are created via the beta
  `POST /api/apps/{app_id}/workflows` API (CNCF Serverless Workflow v1.0;
  `document.namespace` must be `"base44"`; tasks `call`/`switch`/`wait`,
  `call: invoke_backend_function`). The CLI can only *inspect* workflows
  (`base44 workflows list/runs`) — `base44/workflows/*.json` in this repo
  is the source of truth and must be re-applied via `base44 api fetch` on a
  fresh app.
- **Entity schemas reject non-JSON-Schema keys.** `x-*` provenance
  annotations are refused; keep provenance in `description` fields and
  doc 03 only.
- **Published site is the pre-port frontend.** Until the SDK rewire lands,
  live mode on the published URL reports missing backend config; `?mock=1`
  works as the demo path.

## Blockers needing human action

| Blocker | Needs |
|---|---|
| Production data export | authorized access to Convex deployment `necessary-cobra-892` |
| AgentMail inboxes | provision under the new org (3 max) |
| Custom domain (optional) | DNS access for the chosen domain — not assumed |
