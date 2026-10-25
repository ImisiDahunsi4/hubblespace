# base44/ — HubbleSpace backend project

This directory is the Base44 half of the repo (see
`docs/migration/02-base44-target-architecture.md` for the full mapping and
`docs/migration/00-migration-status.md` for what is real vs. scaffolded).

```
base44/
├── config.jsonc          # project config (name, dirs, site build)
├── base44/.app.jsonc     # app link — created by `base44 link`, gitignored
├── entities/             # 32 JSON schemas mapped from convex/tables/* — PUSHED
├── workflows/            # scheduled-job definitions (API-managed — see below)
├── functions/            # backend functions (SKELETONS — see functions/README.md)
│   ├── _shared/          # vendored domain code (rightOfWay gate, deck, seat…)
│   ├── rightOfWayDoor/   # the one door every AI write passes
│   ├── voiceDeal/        # say it → it builds (deal/commit/amend)
│   ├── spaceOps/         # createSpace/joinSpace/owner ops
│   ├── promoteMessage/   # chat line → real card
│   ├── agentmailWebhook/ # inbound mail (svix-verified)
│   ├── dailyRecap/       # cron 0 15 * * *
│   ├── weeklyDigest/     # cron 0 16 * * 5
│   ├── nightlyReset/     # cron 0 7 * * *
│   ├── linkRefreshSweep/ # cron 0 17 * * 5
│   └── roomBriefRefresh/ # every 10 min
├── actors/
│   └── spaceRoom/        # presence cursors, drag-lock gestures, ROW leases
└── auth/
    └── config.jsonc      # email/password + Google login
```

## Deployed state

Linked app: `6ade2063a43a5acbc2adbd10` → https://hubblespace-c2adbd10.base44.app
Already pushed: 32 entities, 10 functions, `spaceRoom` actor, auth config,
site. Scheduled jobs are **workflows** (this app has Workflows enabled —
`automations` blocks in `function.jsonc` are rejected); definitions live in
`workflows/*.json`, applied via
`base44 api fetch POST /api/apps/{app_id}/workflows --body @workflows/<name>.json`.
Five are active, matching `convex/crons.ts` — see doc 10.

## Setup (fresh checkout)

```bash
base44 login
cd base44 && base44 link --app-id 6ade2063a43a5acbc2adbd10
base44 entities push        # deploy the schemas in entities/
base44 secrets set NEBIUS_API_KEY=...   # etc — see docs/migration/07
base44 deploy               # functions + actors + auth + site
```

## What is intentionally NOT here

- **Presence hot path** is the `spaceRoom` actor, not entities — the
  `Presence`/`Lease` entities exist only as persisted records/fallbacks.
- **Auth tables** — Base44's built-in User + session handling replaces
  `authTables`; `entities/User.json` only carries the extra profile fields.
- **The Convex `convex/` tree stays** in this repo as the reference
  implementation until each replacement is verified (migration rule: never
  delete before its replacement is tested).
