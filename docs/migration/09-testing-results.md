# 09 — Testing results

Baseline rule (carried over from the original project): **no test suite exists
by the original author's explicit decision** (`docs/architecture.md` §18 —
"no tests, `npm run build` is the check"). Migration adds targeted tests only
for the most critical migrated behavior.

## Verified

| Check | Command | Result |
|---|---|---|
| Dependency install | `npm install` | clean (audit warnings only) |
| TypeScript + production build at import | `npm run build` | PASS — `tsc -b && vite build`, dist emitted |
| Build after rebrand + scaffold | `npm run build` | PASS — same command, green, chunk-size warning only |
| Entity schemas accepted | `cd base44 && base44 entities push -y` | PASS — 32/32 (31 created + `User` updated). First attempt REJECTED `x-convex-*` annotation keys; stripped, re-pushed clean |
| Backend functions deploy | `base44 functions deploy` | PASS — 10/10 deployed (stub bodies) |
| Actor deploy | `base44 actors deploy` | PASS — `spaceRoom` (stub handlers) |
| Legacy automations | `function.jsonc` `automations` blocks | FAIL by design — app uses Workflows (`workflows_enabled` 409); replaced |
| Scheduled workflows | `base44 api fetch POST /api/apps/{app_id}/workflows` | PASS — 5 created, `status:active`, crons match `convex/crons.ts` |
| Auth config + site deploy | `base44 deploy --no-build -y` | PASS — entities+functions+actor+auth+site; live at https://hubblespace-c2adbd10.base44.app |

## Pending (required before VERIFIED claims)

| Area | Test | Blocker |
|---|---|---|
| entities (data) | schema diff + CRUD round-trip per entity | schemas pushed; no runtime calls yet |
| auth | register/sign-in/sign-out/session-restore; guest canvas access | Base44 app needed |
| space lifecycle | create → invite → second user joins; owner-only rename/delete | functions unimplemented |
| widgets | create → refresh persists → second tab sees it (entity subscribe) | runtime wiring pending |
| votes | two-tab vote; one-vote-per-user claim | pending |
| ROW | the 8-scenario matrix in `05-realtime-and-right-of-way.md` | actor unimplemented |
| voice | real NL ask → deal → commit → interactive cards on 2 screens | `voiceDeal` unimplemented |
| mail | real inbound → svix verify → routed widget + in-thread reply | function + inbox provisioning |
| uploads | photo → storage URL → wall renders cross-window | pending |
| automations | each workflow fires once in run history (`base44 workflows runs`) | schedules live; function bodies still stubs |
| concurrency | `updateMany` claim on Vote upsert race | pending |
| mock mode | `?mock=1` still renders demo rooms without backend | should already work — confirm |
| mobile | responsive layout sanity pass | pending |
| deployed site | published URL serves the app; live path needs `VITE_BASE44_APP_ID` wiring | site published; frontend unported |

## Commands

```bash
npm run build            # tsc + vite — the standing check
cd base44 && base44 entities push   # schema deploy check
base44 deploy            # functions/actors/auth/site (workflows are API-managed)
base44 workflows runs    # scheduled-job run history
base44 logs              # function run logs
```
