# 10 — Deployment guide

## Prerequisites

- Node ≥ 22 (vite 8) and npm.
- Base44 CLI ≥ 0.2.2 (`npm i -g base44` — already installed locally, v0.2.2).
- A Base44 account with permission to create/link an app.

## First-time setup

```bash
base44 login                          # device-code browser auth
cd <repo>
base44 link --app-id <app-id>         # links an existing app…
# …or create the app from this repo's scaffold:
#   base44 create hubblespace --path .   (only if starting fresh)
base44 entities push                  # deploys base44/entities/*.json
base44 auth push                      # base44/auth/config.jsonc
```

`base44 link`/`create` writes `base44/.app.jsonc` — gitignored by
`base44/.gitignore`. Never commit it.

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
npm run build            # verify frontend compiles
base44 deploy --build    # entities + functions + actors + automations + site
```

Verify: published URL in the CLI output / dashboard → load it in two browsers
→ walk the P0 journey in `00-migration-status.md` (space → NL ask → real card
→ vote/edit → second-session sync → ROW hold protection).

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
