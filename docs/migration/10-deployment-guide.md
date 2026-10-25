# 10 — Deployment guide

## Current deployment (verified)

- **App:** `hubblespace` — id `6ade2063a43a5acbc2adbd10`
- **URL:** https://hubblespace-c2adbd10.base44.app
- **Dashboard:** https://app.base44.com/apps/6ade2063a43a5acbc2adbd10/editor/workspace/overview
- **Deployed:** 32 entities, 10 functions, 1 actor (`spaceRoom`), auth
  config, site (current frontend build), public visibility.
- **Workflows (active):** `catch_me_up` (0 15 * * *), `nightly_room_reset`
  (0 7 * * *), `room_briefs` (*/10 * * * *), `refresh_stale_links`
  (0 17 * * 5), `weekly_digest` (0 16 * * 5) — all UTC, matching
  `convex/crons.ts`. Definitions: `base44/workflows/*.json`.

## Prerequisites

- Node ≥ 22 (vite 8) and npm.
- Base44 CLI ≥ 0.2.2 (`npm i -g base44`; verified on 0.2.2 — update available: 0.2.3).
- A Base44 account with permission to create/link an app.

## First-time setup (new checkout)

```bash
base44 login                          # device-code browser auth
cd <repo>/base44                      # the Base44 project root is base44/, not repo root
base44 link --app-id 6ade2063a43a5acbc2adbd10   # re-link this checkout to the app
base44 entities push                  # deploys entities/*.json (already live)
base44 deploy                         # functions + actors + auth + site
```

`base44 link`/`create` writes `base44/base44/.app.jsonc` — gitignored by
`base44/.gitignore`. Never commit it.

## Workflows (scheduled jobs) — API-managed, not CLI

This app has **Workflows enabled**: `automations` blocks in
`function.jsonc` are rejected at deploy (`reason: workflows_enabled`).
Schedules are therefore workflow objects over the app API; the local JSON
in `base44/workflows/` is the source of truth. To (re)create one:

```bash
base44 api fetch POST /api/apps/{app_id}/workflows/validate-definition \
  --body @workflows/nightly_room_reset.json        # validate definition first
base44 api fetch POST /api/apps/{app_id}/workflows \
  --body @workflows/nightly_room_reset.json        # create (activates immediately)
base44 workflows list                              # inspect
base44 workflows runs                              # run history
```

Definition shape (CNCF Serverless Workflow v1.0, `document.namespace` must
be `"base44"`; tasks support `call`/`switch`/`wait`; `call:
invoke_backend_function` with `with.function_name` invokes a deployed
function; every task needs `then`).

## Secrets (server-side, via `base44 secrets set`)

| Name | Needed for |
|---|---|
| `NEBIUS_API_KEY` | voice deal/decide (P0) |
| `OPENAI_API_KEY` | fallback chat + embeddings |
| `AGENTMAIL_API_KEY`, `AGENTMAIL_WEBHOOK_SECRET` | mail brain (P1) — provision NEW inboxes for HubbleSpace; do not reuse the original org's `ourspaces@`/`ustwo@`/`buildroom@` addresses |
| `FIRECRAWL_API_KEY`, `FIRECRAWL_WEBHOOK_SECRET` | link enrichment/crawl (P1) |
| `TAVILY_API_KEY` | place lookups (P2) |
| `AI_PROXY_URL`, `AI_PROXY_TOKEN` | optional secondary chat fallback |

Frontend env: `VITE_BASE44_APP_ID` — injected by `base44 build`; set it in
`.env.local` for `npm run dev` (see `.env.local.example`).

## Deploy

```bash
npm run build            # verify frontend compiles (repo root)
cd base44
base44 deploy --build    # entities + functions + actors + auth + site
                         # (site buildCommand = `cd .. && npm run build`,
                         #  outputDirectory = ../dist)
```

Verify: https://hubblespace-c2adbd10.base44.app → load it in two browsers
→ walk the P0 journey in `00-migration-status.md` (space → NL ask → real card
→ vote/edit → second-session sync → ROW hold protection). Note: until the
frontend is ported to the Base44 SDK, the published site shows the
missing-backend-config state in live mode and the demo in `?mock=1`.

## Webhook wiring (after first deploy)

- AgentMail → `POST <functions-base>/agentmailWebhook` with
  `AGENTMAIL_WEBHOOK_SECRET` configured on both sides.
- Firecrawl crawls → the crawl function's webhook route with a per-crawl
  token (carried in `Crawl.token`).

## Rollback

Convex code is untouched in `convex/`; the frontend adapter layer can be
pointed back at a Convex deployment by restoring `VITE_CONVEX_URL` and the
Convex provider until each replacement is verified. The `legacy:*` npm
scripts keep the old dev/deploy commands available during the transition.
