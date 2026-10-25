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
| Build after rebrand + scaffold | `npm run build` | re-run after edits — see below |

## Pending (required before VERIFIED claims)

| Area | Test | Blocker |
|---|---|---|
| entities | `base44 entities push` then dashboard/schema diff of all 31 | `base44 login` needed |
| auth | register/sign-in/sign-out/session-restore; guest canvas access | Base44 app needed |
| space lifecycle | create → invite → second user joins; owner-only rename/delete | functions unimplemented |
| widgets | create → refresh persists → second tab sees it (entity subscribe) | runtime wiring pending |
| votes | two-tab vote; one-vote-per-user claim | pending |
| ROW | the 8-scenario matrix in `05-realtime-and-right-of-way.md` | actor unimplemented |
| voice | real NL ask → deal → commit → interactive cards on 2 screens | `voiceDeal` unimplemented |
| mail | real inbound → svix verify → routed widget + in-thread reply | function + inbox provisioning |
| uploads | photo → storage URL → wall renders cross-window | pending |
| automations | each cron fires once in run history | deploy needed |
| concurrency | `updateMany` claim on Vote upsert race | pending |
| mock mode | `?mock=1` still renders demo rooms without backend | should already work — confirm |
| mobile | responsive layout sanity pass | pending |

## Commands

```bash
npm run build          # tsc + vite — the standing check
base44 entities push   # schema deploy check
base44 deploy          # functions/actors/automations/site
base44 logs            # function run logs
```
