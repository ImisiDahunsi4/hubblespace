# _shared — vendored domain code for Base44 functions and actors

Backend functions and actors run in Deno and cannot import from `src/` or
`convex/`. Shared, platform-free logic must be **vendored** (copied) into this
directory so every backend surface uses ONE implementation — this also fixes
the mock/live duplication the audit flags (`docs/migration/01`).

Copy these unchanged wherever possible:

| Source (repo) | Vendored file | Used by |
|---|---|---|
| `src/lib/rightOfWay.ts` | `rightOfWay.ts` | rightOfWayDoor, spaceRoom actor — the verdict gate |
| `src/lib/deck/edits.ts` | `deckEdits.ts` | edits/undo, choice detection (`applyEdit`, `linkChoice`) |
| `src/lib/deck/{apply,catalog,existing,guess,needs,place,prompt,promptV2,recipes,resolve,schema,shortlist,suggest,verbs}.ts` | `deck/` | voiceDeal |
| `src/lib/choiceVote.ts` | `choiceVote.ts` | choice-vote resolution |
| `src/lib/pollRules.ts` | `pollRules.ts` | poll close/pass rules |
| `src/lib/widgetDefaults.ts` | `widgetDefaults.ts` | default sizes per type |
| `convex/widgetData.ts` union | `widgetData.ts` (re-express as zod — `zod` is already a dep) | validation of `Widget.data` on every write |
| `convex/seat.ts` `seatOf`/`canRead`/`seatOrMaker` | `seat.ts` (re-implemented over `base44.auth.me()` + Member entity) | every function |
| `convex/ai.ts` `completeJson` + `convex/nebius.ts` `streamChat`/`routes` | `ai.ts` | model routing: Nebius Token Factory primary, OpenAI-compatible fallback |
| `convex/rateLimits.ts` | `rateLimit.ts` (entity- or actor-storage backed buckets) | voice, mail-send, paint strokes |

Keep filenames stable so `entry.ts` diffs stay reviewable. When the upstream
file changes, re-vendor — do not fork the logic.
