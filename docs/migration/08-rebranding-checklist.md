# 08 — Rebranding checklist (OurSpaces → HubbleSpace)

Naming: product `HubbleSpace` · lowercase `hubblespace` · slug `hubble-space`
where a hyphenated form fits · package `hubblespace`.

Copy: primary description "Your shared space for turning ideas into action."
Tagline "Say it. Build it. Share it." Alt: "Where your people and plans come
together." **Do not** claim hubblespace.com or any domain — not owned.

## Done

| Surface | Change |
|---|---|
| `index.html` | title, description, og/twitter meta, apple title → HubbleSpace; `ourspaces.io` URLs removed (og:url dropped — set to the published Base44 URL at deploy) |
| `public/manifest.webmanifest` | name/short_name/description; start_url → `/?enter=1#/` |
| `package.json` | `name: hubblespace`; deploy scripts → `base44` (legacy Convex scripts kept as `legacy:*`) |
| `netlify.toml` | **deleted** — pointed at the original author's Netlify site + Convex deployment; Base44 hosts now |
| `.env.local.example` | `VITE_BASE44_APP_ID` added; Convex vars demoted to commented legacy |
| Wordmark | `ourspace-mark.png` (abstract space+cursor mark — brand-agnostic) → copied to `hubblespace-mark.png`, refs updated in `DemoBanner`, `Rail`, `About` (×2), `Outro`, `MailReel`; old file removed |
| `src/components/DemoBanner.tsx` | event name, brand, notice copy |
| `src/pages/Welcome.tsx` | wordmark text + aria-label |
| `src/pages/About.tsx` | brand spans, "across hubblespace", vendor labels, footer tagline + attribution ("adapted from OurSpaces — originally built for the Nebius × NVIDIA hackathon"), REPO_URL documented as upstream |
| `src/pages/Outro.tsx` | brand, url → `hubblespace`, "adapted from OurSpaces · Base44 Challenge entry" |
| `src/pages/MailReel.tsx`, `CodexReel.tsx`, `ColorLab.tsx`, `Admin.tsx` | brand/email/title strings |
| `src/data/spaces.ts` | showcase inbox → `hubblespace@agentmail.to` (provisioning placeholder — see 07) |
| localStorage/sessionStorage keys | `ourspaces:*` → `hubblespace:*` across `identity.ts`, `routes.ts`, `onboarding.ts`, `sounds.ts`, `standalone.ts`, `snapshot.ts`, `LiveSpace.tsx` (×3), `Admin.tsx`, `OrbHint`, `WelcomePill`, `challenge.tsx` — fresh namespace avoids colliding with the original app's keys |
| `public/storyboard.html` | title, eyebrow, url strings → hubblespace; hackathon line marked as original entry |
| `scripts/dev-lane.sh` | comment |
| `README.md` | rewritten: HubbleSpace intro, provenance + attribution, layout, quickstart |
| `src/cursors/README.md` | brand |

## Intentionally preserved (attribution / history — do NOT rebrand)

- `LICENSE` — MIT, copyright (c) 2026 Thomas Nguyen. Required.
- `hackathon.md`, `docs/*.md` (architecture, code-map, todos, …) — engineering
  history of OurSpaces; truthful as-written.
- `convex/` — the reference implementation. Its strings (`ourspaces@agentmail.to`,
  deployment ids, comments) describe the real original deployment; rebranding
  them would falsify the record. Removed wholesale at Phase 10 anyway.
- `About.tsx` `REPO_URL` → points to `github.com/thomasnguyen/ourspaces-app`
  because "follow it in the code" links reference the upstream files.
- `Outro.tsx`/storyboard attribution lines ("built by Thomas · designed by Holly").
- `.agents/skills/ourspaces-docs`, `.claude/skills/run-ourspaces` — dev tooling
  names; harmless, but candidates for a `hubblespace-*` rename pass later.
- `eval/` — original eval corpus.

## Remaining

- [ ] PWA icon set (`public/icons/*`, `favicon.png`, `apple-touch-icon.png`)
      still carries the original mark's lime palette — acceptable (mark is
      reused) but regenerate if a new logo is designed.
- [ ] `og:url`/`og:image` absolute URLs once the Base44 publish URL is known.
- [ ] Email template sender name/address — depends on provisioned inboxes (07).
- [ ] `.github/readme/*` images still show the original UI — refresh after cutover.
