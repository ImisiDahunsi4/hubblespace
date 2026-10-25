# 06 — AI & voice

## The feature (P0 for the competition)

"Say it → it builds": a natural-language ask becomes real, persisted,
interactive cards on every screen — e.g. *"Set up a poll for Friday dinner,
make a checklist of what everyone should bring, and add a countdown."*

## Model routing (port `convex/nebius.ts` + `convex/ai.ts`)

| Job | Model | Path |
|---|---|---|
| voice deal (plain asks, picks web places) | `nvidia/Nemotron-3_5-Lightning`, `chat_template_kwargs.enable_thinking=false` | Nebius Token Factory, `NEBIUS_API_KEY` secret |
| group-fact / multi-card asks / questions | `nvidia/Nemotron-3-Ultra-550b-a55b` | same endpoint — one constant swaps models |
| game setup, weekly digest prose | `nvidia/nemotron-3-super-120b-a12b`, thinking on | same |
| general structured decisions (router, recap) | `openai/gpt-4o-mini` (or Base44 `integrations.Core.InvokeLLM`) | was Convex AI Gateway |
| embeddings (rag/similar) | `text-embedding-3-small` 1536-dim | needs a replacement — see gaps |

Key implementation facts to preserve:
- `enable_thinking=false` is load-bearing — Lightning otherwise spends its
  token budget reasoning (measured: 0 valid answers in 6).
- Speculative early-fire: ~3 deal calls per ask, discarded if the user keeps
  talking. Cost per plain ask ~0.03¢.
- `completeJson({system, user, temperature}) -> JSON | null` with the
  brace-slicing salvage; **null → every caller degrades to canned output,
  never a fake success.**

## The pipeline (port `convex/voiceBuild.ts` + `src/lib/deck/*`)

```
speech (browser SpeechRecognition, src/lib/voice.ts)
  → deal(action): Nemotron → card specs → mirrored into a `deals` row,
    streamed to the asker who keeps/kills cards field by field
  → commit(mutation): kept cards re-checked through the Right of Way door,
    placed by placeCards/shortlist (code sees the board; the model never does),
    written once → every screen updates
  → amend: a late word ("…dinner") rewrites the same card, never a second
```

**The division of labor that must survive:**

- **Model proposes** — fills fields, picks cards for multi-card recipes
  (`src/lib/deck/recipes.ts` flows, `catalog.ts` widget names).
- **Code decides** — `applyCard` validates each spec against the widgetData
  union; `resolve.ts` turns "the people who are coming" into real member
  names; `placeCards`/`shortlist` pick non-overlapping geometry; the Right of
  Way door checks every write; `guard.ts` spend ceilings + `rateLimits` buckets
  (`voice`, `sparkQuestions`, `recapAsk`…).
- **Context:** the ask reads a stored `Brief` (roomBrief cron) + `roomContext`
  — never the whole board — plus room facts (`knows`/`correct`).

## Voice capture

`src/lib/voice.ts` + `VoiceOrb`/`VoiceStage`/`VoiceBuildLayer` — browser
SpeechRecognition when available; the orb's staged timings
(`voiceTimings.ts`, `voiceStage.ts`) are presentation and port unchanged.
No server-side audio exists today; keep it that way unless adding a
transcription integration (Base44 has a built-in transcribe).

## Adjacent AI surfaces (P1/P2)

- **Mail router** (`inbox.ts routeSmart`): model returns
  `{action: expense|itinerary|create|unfiled|discard, …, because}`; `unfiled`
  is the honest fallback — the router never guesses loudly. `because` voice
  spec + `cleanBecause` second-defense port verbatim.
- **Ask the space:** agent thread (`spaces.askThreadId`) → Base44 agent or a
  thread keyed on Message; `askStreams` + a streaming function for the SSE path.
- **Recap/digest:** snapshot() + model lines with real citations; canned
  fallbacks for every path.
- **Similarity dedup** (`similar.ts`): 1536-dim embeddings + cosine —
  needs a vector plan (gap: no Base44 vector index).
- **Tavily place lookup**: poll option enrichment (`web` field) — keep behind
  `placeLookup` function with `TAVILY_API_KEY` secret.

## Required secrets

`NEBIUS_API_KEY` (primary), `OPENAI_API_KEY` (fallback/embeddings),
`TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, `AGENTMAIL_API_KEY` — all via
`secrets.get()`, never in client bundles.
