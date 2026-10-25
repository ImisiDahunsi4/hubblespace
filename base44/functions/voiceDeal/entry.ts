// voiceDeal — "say it → it builds", the room's half of the voice pipeline.
// Port of convex/voiceBuild.ts over Base44 entities + InvokeLLM.
//
//   op:deal       → the model call: prompt → answer text mirrored into the
//                   Deal row (the client's `live` query tails it by nonce)
//   op:decide     → the one-letter card pick fired while the asker talks
//   op:answer     → "what did we decide…" — snippets ranked in code, one
//                   guarded model call that may only cite them
//   op:commit     → the checked cards → widgets, each through the door
//   op:amend      → a late word rewrites the card just dealt, in place
//   op:noteLanded → the asker's stage timings back onto the Deal row
//
// Convex→Base44 deltas (honest): InvokeLLM isn't streamed, so `live` emits
// the whole answer at once; the spend gate (convex/guard.ts) isn't ported —
// a seat in the room is the gate; model timings degrade to one number.

import { createClientFromRequest } from "npm:@base44/sdk";
import { seatOf } from "./_shared/seat.ts";
import { streamChat, chooseLetter } from "./_shared/ai.ts";
import { rightOfWay } from "./_shared/door.ts";
import {
  deckPrompt, roomContext, dealTurn, parseDeal,
} from "./_shared/deck/prompt.ts";
import {
  deckPromptV2, dealTurnV2, cardLine, decideMessages,
  DECIDE_CHOICES, DECIDE_LETTERS, BOARD_LETTERS,
} from "./_shared/deck/promptV2.ts";
import { isFlow } from "./_shared/deck/recipes.ts";
import { applyCard } from "./_shared/deck/apply.ts";
import { VERB_CHOICES, VERB_LETTERS, VERB_Q } from "./_shared/deck/verbs.ts";

const json = (body: unknown, status = 200) => Response.json(body, { status });
const jparse = (s: unknown, fb: any) => { try { return s ? JSON.parse(String(s)) : fb; } catch { return fb; } };

const ASK_STOP = new Set("a an the of for to on in at is are was were be do does did who whos whose what whats when where which how our we us it this that and or with my me i you has have hasnt any anyone s".split(" "));
const DAY_SHORT: Record<string, string> = { monday: "mon", tuesday: "tue", wednesday: "wed", thursday: "thu", friday: "fri", saturday: "sat", sunday: "sun" };
const askWords = (x: string) =>
  new Set(x.toLowerCase().replace(/['’]s\b/g, "").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !ASK_STOP.has(w)).map((w) => DAY_SHORT[w] ?? w.replace(/(es|s)$/, "")));
const flatText = (data: unknown): string => {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (out.join(" ").length > 220) return;
    if (typeof x === "string" && x.length < 120 && !/^(https?:|\/|#)/.test(x)) out.push(x);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") Object.values(x).forEach(walk);
  };
  walk(data);
  return out.join(" · ").slice(0, 220);
};

/** One call's row, by the asker's nonce (among the room's newest). */
async function rowByNonce(E: any, spaceId: string, nonce: string) {
  const rows = await E.Deal.filter({ spaceId }, "-created_date", 40);
  for (const row of rows) {
    if (!String(row.run ?? "").includes(nonce)) continue;
    const run = jparse(row.run, {}) as { nonce?: string };
    if (run.nonce === nonce) return { row, run };
  }
  return null;
}

async function patchRun(E: any, dealId: string, fields: Record<string, unknown>) {
  const row = await E.Deal.get(dealId).catch(() => null);
  if (!row) return;
  await E.Deal.update(dealId, { run: JSON.stringify({ ...jparse(row.run, {}), ...fields }) }).catch(() => {});
}

/** Each person's colour by name, the seeded cast first (only when a check-in is written). */
async function colorsFor(E: any, spaceId: string, cards: { card: string }[]) {
  if (!cards.some((c) => /"checkin"/.test(c.card))) return undefined;
  const rows = await E.Member.filter({ spaceId }, undefined, 300);
  const out: Record<string, string> = {};
  for (const m of [...rows].sort((a: any, b: any) => Number(String(b.userId).startsWith("seed:")) - Number(String(a.userId).startsWith("seed:")))) out[m.name] ??= m.color;
  return out;
}

/** The check-in a standings card dealt on its own ranks: the newest on the board. */
async function checkInFor(E: any, spaceId: string): Promise<string | undefined> {
  const all = await E.Widget.filter({ spaceId }, "-created_date", 300);
  return all.find((w: any) => w.type === "checkIn")?.id;
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const E = (base44 as any).asServiceRole.entities;
  const a = await req.json().catch(() => ({}));
  const op = a.__op;

  /* ---------------- deal ---------------- */
  if (op === "deal") {
    const t0 = Date.now();
    const seat = await seatOf(base44, a.spaceId, a.userId);
    const said = String(a.said ?? "").trim().slice(0, 240);
    const brain = a.route === "brain" && !!a.menu;
    const M = brain ? { name: "Ultra", maxTokens: 300 } : { name: "Lightning", maxTokens: 220 };
    const card =
      a.card && (DECIDE_CHOICES.includes(a.card) || isFlow(a.card)) && a.card !== "none" && a.card !== "several"
        ? a.card
        : undefined;
    const context = brain
      ? String(a.menu).slice(0, 1600)
      : roomContext({ room: String(a.room ?? ""), today: String(a.today ?? ""), people: (a.people ?? []).slice(0, 12), selected: a.selected });
    const deck = a.deck?.length ? [...new Set([...a.deck.slice(0, 10), ...(card ? [card] : [])])] : undefined;
    const user = brain ? dealTurnV2({ menu: context, said, card }) : `${dealTurn({ context, said })}${card ? `\n${cardLine(card)}` : ""}`;

    // The gate: a seat in this room. (Convex also ran a spend ledger — the
    // guard isn't ported; seats are the door here.)
    if (!seat) {
      return json({
        dealId: null, model: M.name, route: brain ? "brain" : "fast", usage: null, context,
        answer: "", none: true, error: "limit: enter the space first",
        firstTokenMs: null, firstLineMs: null, totalMs: Date.now() - t0,
      });
    }
    const deal = await E.Deal.create({
      spaceId: a.spaceId,
      run: JSON.stringify({ at: t0, nonce: a.nonce, said, spec: a.spec, model: M.name, route: brain ? "brain" : "fast", card: card ?? null, deck: deck ?? null, context, answer: "", done: false }),
    });

    const result = await streamChat(base44, {
      model: brain ? "ultra" : "lightning",
      maxTokens: M.maxTokens,
      messages: [
        { role: "system", content: brain ? deckPromptV2({ cards: deck, ...(deck && a.focus ? { focus: [...a.focus, ...(card ? [card] : [])] } : {}) }) : deckPrompt({ cards: deck }) },
        { role: "user", content: user },
      ],
    });
    // The whole answer lands at once — InvokeLLM doesn't stream (live still
    // resolves it by nonce; the skeleton just fills at the end).
    await patchRun(E, deal.id, { answer: result.content.slice(0, 2000) });

    const parsed = parseDeal(result.content, true);
    const none = parsed.none && !parsed.items.some((i: any) => i.ok);
    const error = result.error ? `${result.status || "fetch"}: ${result.error.slice(0, 160)}` : null;
    const out = {
      model: M.name,
      route: brain ? "brain" : "fast",
      usage: null,
      context,
      answer: result.content.slice(0, 2000),
      none,
      error,
      firstTokenMs: result.firstTokenMs,
      firstLineMs: result.firstLineMs,
      totalMs: Date.now() - t0,
    };
    await patchRun(E, deal.id, {
      ...out, done: true, modelTotalMs: result.totalMs, finish: result.finish,
      invalid: parsed.items.flatMap((i: any) => (i.ok ? [] : [i.reason])),
    });
    return json({ ...out, dealId: deal.id });
  }

  /* ---------------- decide ---------------- */
  if (op === "decide") {
    const t0 = Date.now();
    const seat = await seatOf(base44, a.spaceId, a.userId);
    if (!seat) return json({ verb: null, onBoard: null, card: null, conf: null, top: [], ms: 0, usage: null, error: "limit: enter the space first" });
    const context = roomContext({ room: String(a.room ?? ""), today: String(a.today ?? ""), people: (a.people ?? []).slice(0, 12) });
    const prefix = { context, board: (a.board ?? []).slice(0, 24).map((t: string) => String(t).slice(0, 40)), said: String(a.said ?? "").trim().slice(0, 240) };
    const skipped = { status: 0, letter: null, conf: null, top: [], usage: null, ms: 0 };
    const verbQ = a.verb
      ? chooseLetter(base44, {
          model: "ultra",
          messages: [
            decideMessages(prefix)[0],
            { role: "user" as const, content: `${prefix.context}${prefix.board.length ? `\nOn the board: ${prefix.board.join(" · ")}` : ""}\nSaid: "${prefix.said}"\n\n${VERB_Q}` },
          ],
          letters: VERB_LETTERS,
        })
      : null;
    const [r, b, vq] = await Promise.all([
      a.card === false ? skipped : chooseLetter(base44, { model: "ultra", messages: decideMessages(prefix), letters: DECIDE_LETTERS }),
      a.onBoard && prefix.board.length
        ? chooseLetter(base44, {
            model: "ultra",
            messages: decideMessages({ ...prefix, ...(a.match ? { match: String(a.match).slice(0, 60) } : {}), q: "board" }),
            letters: BOARD_LETTERS,
          })
        : null,
      verbQ,
    ]);
    const cardOf = (l: string) => DECIDE_CHOICES[DECIDE_LETTERS.indexOf(l)] ?? l;
    return json({
      verb: vq && vq.letter ? { verb: VERB_CHOICES[VERB_LETTERS.indexOf(vq.letter)] ?? vq.letter, conf: vq.conf, ms: vq.ms, usage: null } : null,
      onBoard: b ? { yes: b.letter === "A", conf: b.conf, ms: b.ms, usage: null, error: b.error ? `${b.status || "fetch"}: ${b.error.slice(0, 160)}` : null } : null,
      card: r.letter ? cardOf(r.letter) : null,
      conf: r.conf,
      top: r.top.map((t) => ({ card: cardOf(t.card), p: t.p })),
      ms: Date.now() - t0,
      usage: null,
      error: r.error ? `${r.status || "fetch"}: ${r.error.slice(0, 160)}` : null,
    });
  }

  /* ---------------- answer ---------------- */
  if (op === "answer") {
    const t0 = Date.now();
    const seat = await seatOf(base44, a.spaceId, a.userId);
    if (!seat) return json({ answer: null, why: "limit: enter the space first", ms: Date.now() - t0, usage: null, snippets: [] });
    const q = String(a.question ?? "").trim().slice(0, 200);
    const widgets = await E.Widget.filter({ spaceId: a.spaceId });
    const chat = await E.Message.filter({ spaceId: a.spaceId, widgetId: "global" }, "-created_date", 40);
    const pool = [
      ...widgets
        .filter((w: any) => !["sticker", "media", "frame", "weather"].includes(w.type))
        .map((w: any) => ({ text: `${w.type}: ${flatText(w.data)}`, widgetId: w.id as string | undefined, source: `the ${w.type} card` })),
      ...chat.map((m: any) => ({ text: `${m.authorName}: ${m.text}`.slice(0, 220), widgetId: undefined, source: `${String(m.authorName).toLowerCase()} in the chat` })),
    ];
    const want = askWords(q);
    const ranked = pool
      .map((p) => ({ ...p, n: [...askWords(p.text)].filter((w) => want.has(w)).length }))
      .filter((p) => p.n > 0)
      .sort((x, y) => y.n - x.n)
      .slice(0, 6);
    const snippets = ranked.map((p, i) => `[${i + 1}] ${p.text}`);
    if (!ranked.length)
      return json({ answer: null, why: "nothing on the board or in the chat shares a word with the question", ms: Date.now() - t0, usage: null, snippets });
    const result = await streamChat(base44, {
      model: "ultra",
      maxTokens: 60,
      messages: [
        {
          role: "system",
          content:
            'You answer a question about a group of friends\' shared space using only the numbered snippets. Reply with one JSON line: {"answer":"<at most 14 words, lowercase, plain>","from":<snippet number>}. If the snippets don\'t say, reply {"answer":null}. Never guess a name, date, place or amount.',
        },
        { role: "user", content: `${snippets.join("\n")}\n\nQuestion: ${q}` },
      ],
    });
    let parsed: { answer?: unknown; from?: unknown } = {};
    try {
      parsed = JSON.parse(/\{[\s\S]*\}/.exec(result.content)?.[0] ?? "{}");
    } catch {
      return json({ answer: null, why: `unreadable: ${result.content.slice(0, 80)}`, ms: Date.now() - t0, usage: null, snippets });
    }
    const from = ranked[Number(parsed.from) - 1];
    if (typeof parsed.answer !== "string" || !parsed.answer.trim() || !from)
      return json({ answer: null, why: "the model says the snippets don't say", ms: Date.now() - t0, usage: null, snippets });
    const text = parsed.answer.trim().toLowerCase().slice(0, 120);
    const src = from.text.toLowerCase();
    const numbers = text.match(/\d+/g) ?? [];
    const people = [...new Set(chat.map((m: any) => String(m.authorName).toLowerCase()))];
    const named = people.filter((p) => new RegExp(`\\b${p}\\b`).test(text));
    const bad = [...numbers.filter((n) => !src.includes(n)), ...named.filter((p) => !src.includes(p))];
    if (bad.length) return json({ answer: null, why: `answer said ${bad.join(", ")}, not in snippet ${parsed.from}`, ms: Date.now() - t0, usage: null, snippets });
    return json({
      answer: { text, source: from.source, ...(from.widgetId ? { widgetId: from.widgetId } : {}), facts: [from.text] },
      why: `snippet ${parsed.from}`,
      ms: Date.now() - t0,
      usage: null,
      snippets,
    });
  }

  /* ---------------- commit ---------------- */
  if (op === "commit") {
    const me = await seatOf(base44, a.spaceId, a.createdBy);
    if (!me) return json([]);
    const by = me.name;
    const createdBy = me.userId;
    const people = (a.people ?? []).slice(0, 12);
    const cardCtx = { by, people: people.length ? people : [by], today: String(a.today ?? ""), colors: await colorsFor(E, a.spaceId, a.cards ?? []) };
    const ids: string[] = [];
    const now = Date.now();
    for (const c of (a.cards ?? []).slice(0, 8)) {
      let raw: unknown;
      try {
        raw = JSON.parse(c.card);
      } catch {
        continue;
      }
      const source = /"standings"/.test(c.card) && !c.link ? await checkInFor(E, a.spaceId) : undefined;
      const applied = applyCard(raw, { ...(c.people ? { ...cardCtx, people: c.people.slice(0, 12) } : cardCtx), ...(source ? { source } : {}) }, {
        z: c.z,
        assignees: c.assignees?.slice(0, 8),
        ...(c.blank ? { blank: c.blank } : {}),
        ...(c.blank && c.unfinished ? { unfinished: { by, byUserId: createdBy } } : {}),
      });
      if (!applied.ok) continue;
      const w = applied.widget;
      if (c.link?.value === "unclaimed") w.data = { ...w.data, dealTo: cardCtx.people };
      const size = { w: Math.round(Math.min(1600, Math.max(80, c.w ?? w.w))), h: Math.round(Math.min(1200, Math.max(60, c.h ?? w.h))) };
      let spot = { x: Math.round(c.x), y: Math.round(c.y) };
      const door = await rightOfWay(E, {
        kind: "build",
        spaceId: a.spaceId,
        by: { name: by, userId: createdBy },
        fields: [{ field: "card", old: null, new: { type: w.type, title: (w.data as any).title ?? (w.data as any).question ?? (w.data as any).event ?? null } }],
        rect: { ...spot, ...size },
      });
      if (door.verdict === "never" && door.onThing) {
        const held = await E.Widget.get(door.onThing).catch(() => null);
        if (held) spot = { x: spot.x, y: held.y + held.h + 64 };
      } else if (door.verdict !== "go") continue;
      const rotate = c.rotate ?? w.rotate;
      const row = await E.Widget.create({
        spaceId: a.spaceId,
        type: w.type,
        ...spot,
        ...size,
        z: w.z,
        ...(rotate !== undefined ? { rotate: Math.max(-6, Math.min(6, rotate)) } : {}),
        data: w.data,
        createdBy,
        createdAt: now,
      });
      ids.push(row.id);
      if (c.link) {
        const fromRow = await E.Widget.get(c.link.from).catch(() => null);
        if (fromRow && fromRow.spaceId === a.spaceId) {
          await E.Link.create({
            spaceId: a.spaceId,
            from: fromRow.id,
            to: row.id,
            when: c.link.when,
            fill: c.link.fill,
            value: c.link.value,
            ...(c.link.tag ? { tag: c.link.tag } : {}),
            ...(c.link.at ? { at: c.link.at } : {}),
          });
        }
      }
    }
    if (ids.length) {
      await E.Space.update(a.spaceId, { lastActivityAt: now }).catch(() => {});
      const found = a.dealId ? { row: { id: a.dealId } } : a.nonce ? await rowByNonce(E, a.spaceId, a.nonce) : null;
      if (found?.row?.id) {
        const row = await E.Deal.get(found.row.id).catch(() => null);
        if (row) {
          const run = jparse(row.run, {});
          const before = run.committed ?? [];
          await patchRun(E, row.id, { committed: [...before, ...ids], committedAt: now });
        }
      }
    }
    return json(ids);
  }

  /* ---------------- amend ---------------- */
  if (op === "amend") {
    const me = await seatOf(base44, a.spaceId, a.createdBy);
    if (!me) return json(false);
    const widget = await E.Widget.get(a.widgetId).catch(() => null);
    if (!widget || widget.spaceId !== a.spaceId || widget.createdBy !== me.userId) return json(false);
    if (Date.now() - (widget.createdAt ?? 0) > 60_000) return json(false);
    let raw: unknown;
    try {
      raw = JSON.parse(a.card);
    } catch {
      return json(false);
    }
    const people = (a.people ?? []).slice(0, 12);
    const room = a.cardPeople?.length ? a.cardPeople.slice(0, 12) : people.length ? people : [me.name];
    const applied = applyCard(raw, { by: me.name, people: room, today: String(a.today ?? "") }, { z: widget.z, assignees: a.assignees?.slice(0, 8) });
    if (!applied.ok) return json(false);
    const w = applied.widget;
    const door = await rightOfWay(E, {
      kind: "build",
      spaceId: a.spaceId,
      widgetId: a.widgetId,
      by: { name: me.name, userId: me.userId },
      fields: [{ field: "data", old: widget.data, new: w.data }],
    });
    if (door.verdict !== "go") return json(false);
    await E.Widget.update(a.widgetId, { type: w.type, w: w.w, h: w.h, data: w.data });
    return json(true);
  }

  /* ---------------- noteLanded ---------------- */
  if (op === "noteLanded") {
    const row = await E.Deal.get(a.dealId).catch(() => null);
    if (!row || !(a.landedMs > -60_000 && a.landedMs < 120_000)) return json(null);
    const seat = await seatOf(base44, row.spaceId, a.userId);
    if (!seat) return json(null);
    const run = jparse(row.run, {});
    if (run.landedMs !== undefined) return json(null);
    await E.Deal.update(row.id, {
      run: JSON.stringify({ ...run, landedMs: Math.round(a.landedMs), ...(a.trace ? { client: jparse(a.trace, {}) } : {}) }),
    });
    return json(null);
  }

  return json({ error: `unknown op: ${op}` }, { status: 400 });
});
