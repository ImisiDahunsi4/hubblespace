# 07 — Integrations & automation

## Services inventory → Base44 plan

| Service | Role today | Base44 plan | Secret(s) | Status |
|---|---|---|---|---|
| Nebius Token Factory | Nemotron models for voice deal/decide | direct HTTPS from `voiceDeal`/`_shared/ai.ts` | `NEBIUS_API_KEY` | scaffolded |
| Convex AI Gateway | gpt-4o-mini chat + embeddings | **replaced** — call OpenAI-compatible endpoint direct, or Base44 `integrations.Core.InvokeLLM` | `OPENAI_API_KEY` | open |
| Cloudflare ai-proxy | chat fallback (RoomDone shared worker) | keep as secondary fallback in `_shared/ai.ts` | `AI_PROXY_URL`/`AI_PROXY_TOKEN` | open |
| AgentMail | per-space real inboxes, inbound→canvas, OTP join sender, digest sender | `agentmailWebhook` function (svix verify → dedup → `inboundRouter`) + `agentmail` helpers in `_shared/` | `AGENTMAIL_API_KEY`, `AGENTMAIL_WEBHOOK_SECRET` | scaffolded |
| Firecrawl | scrape→linkCard, search→pile, crawl→CrawlStrip, attachment parsing | `linkEnrich` function + `Crawl`/`CrawlPage` entities + webhook fn for crawl completion | `FIRECRAWL_API_KEY`, `FIRECRAWL_WEBHOOK_SECRET` | open |
| Tavily | place lookup enriching poll options | `placeLookup` function | `TAVILY_API_KEY` | open |
| SomaFM | shared radio station | unchanged — Vite dev proxy `/soma-ice` strips Referer; needs same origin proxy on Base44 hosting (document) | none | open |
| Convex storage | photo/avatar uploads | Base44 file storage (`UploadFile`) → URL persisted in widget data | — | open |

**New inboxes required:** the 3 showcase inboxes (`ourspaces@`, `ustwo@`,
`buildroom@` on AgentMail) belong to the original org — HubbleSpace must
provision its own AgentMail inboxes (free-tier cap of 3 per org still applies)
and update `ensureShowcaseInboxes` mappings.

## Automation map (crons → function.jsonc automations)

| Convex cron | Base44 automation | File |
|---|---|---|
| presence sweep, 5 min | *not needed* — actor tick sweeps ephemeral state; entity-based sweep only if Presence fallback used | `actors/spaceRoom` |
| weekly digest, Fri 16:00 UTC | `weeklyDigest` scheduled cron `0 16 * * 5` | written |
| catch me up, 15:00 UTC | `dailyRecap` cron `0 15 * * *` | written |
| nightly reset, 07:00 UTC | `nightlyReset` cron `0 7 * * *` | written |
| room briefs, 10 min | `roomBriefRefresh` simple `minutes:10` | written |
| refresh stale links, Fri 17:00 UTC | `linkRefreshSweep` cron `0 17 * * 5` | written |

Candidate **entity automations** (evaluate, don't overuse — they don't fire on
bulk/updateMany writes): `Widget` create → `similar.ts` re-embed;
`InboundMessage` create → `inboundRouter` (alternative to webhook-chained call).

## Safety rules carried over

- **Idempotency:** webhook dedup via `WebhookEvent` (check-then-process);
  digest steps log completion rows so a re-run never double-sends.
- **Rate limits:** port buckets — sparkQuestions/recapAsk 5/min,
  recapGenerate 3/min, mailSend 10/h (AgentMail cap), paintStroke 60/min/user
  (fail-soft), keyed per space.
- **Retries + cache:** scrape cached 1h by URL; retried ×2 with backoff;
  questions cached by (title, description).
- **Webhook verification:** svix HMAC (`svixVerified` in convex/http.ts) ported
  verbatim; unsigned deliveries rejected when the secret is set.
- **Cost ceilings:** `guard.ts` spend caps + `noteSpend` ledger — port as
  `_shared/guard.ts`.
- **Never expose keys client-side.** All provider calls happen inside
  functions/actors.
