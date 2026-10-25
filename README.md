# HubbleSpace

> Your shared space for turning ideas into action. Say it. Build it. Share it.

HubbleSpace is a shared canvas for a group: polls, checklists, countdowns,
RSVPs, photo piles and more that everyone watches update live. Talk to it —
"set up a poll for Friday dinner, a checklist of what to bring, and a
countdown" — and real interactive cards land on every screen. A conflict
system called **Right of Way** keeps AI changes from touching a card a person
is holding or undoing a choice people made.

**Status:** mid-migration to the [Base44](https://base44.com) platform. This
repository contains the full reference implementation (React + Vite frontend
plus the original Convex backend in `convex/`) alongside the Base44 scaffold
(`base44/`). See [`docs/migration/00-migration-status.md`](docs/migration/00-migration-status.md)
for what works today and the ordered work orders.

## Provenance

HubbleSpace is an independent adaptation of **[OurSpaces](https://github.com/thomasnguyen/ourspaces-app)**,
built by Thomas Nguyen and designed by Holly Tran, released under the MIT
license (see `LICENSE`). The original was built for the Convex All Gas and
Nebius × NVIDIA hackathons — those results belong to the original project,
not to HubbleSpace. `hackathon.md` and the `docs/` archive are kept for
attribution and engineering history.

## Repository layout

```
src/                  React 19 + TypeScript + Vite frontend (reused as-is)
  components/         canvas, widgets' shells, voice orb, cursors
  widgets/            ~30 card types (poll, note, rsvp, letter, linkCard…)
  lib/                platform-free domain logic — including:
    rightOfWay.ts       the go|ask|wait|never verdict gate (pure)
    deck/               the voice→cards DSL: prompts, recipes, placement
  live/               hooks that bind the UI to the backend (being rewired)
  data/               fixture rooms — also the seed for live rooms
convex/               ORIGINAL backend, kept as reference until each Base44
                      replacement is verified. Do not extend it.
base44/               NEW backend project — entities/, functions/, actors/,
                      auth/, config.jsonc (see base44/README.md)
docs/migration/       audit, architecture, parity matrix, handoff docs
```

## Quick start

```bash
npm install
npm run dev            # frontend on :5173; add ?mock=1 for the no-backend demo
```

Against a real backend (requires a linked Base44 app):

```bash
base44 login
base44 link            # writes base44/.app.jsonc
base44 entities push
npm run dev            # with VITE_BASE44_APP_ID set (see .env.local.example)
```

The legacy Convex path still runs if you have the original env vars
(`legacy:dev:backend`); it is frozen and slated for removal.

## What makes it unusual

- **Voice → real cards.** A single ask can deal several linked widgets.
  The model proposes; code validates, places, and commits.
- **Right of Way.** Leases mark what people are holding; the gate decides
  `go | ask | wait | never` for every AI write, and the ledger is visible.
- **A real inbox per room.** Email the space and a router files the contents
  on the canvas — a receipt becomes an expense row, a booking an itinerary day.
- **Two-window liveness everywhere** — cursors, votes, drags, chat, games.

## License

MIT — same license as the original project; original copyright attribution
retained in `LICENSE`.
