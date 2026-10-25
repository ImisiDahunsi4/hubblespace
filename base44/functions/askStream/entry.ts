// askStream — the driven half of ask-the-space streaming.
//
// Convex used @convex-dev/persistent-text-streaming: the driving tab fetched
// an HTTP stream, the component persisted the body, every other tab tailed
// the row. On Base44 the driving tab invokes this function once per
// streamId; it runs the same snippet-ranked, citation-checked answer as
// voiceDeal op:answer, writes the body into the AskStream row in slices
// (InvokeLLM doesn't stream — the slices keep the room's typewriter feel),
// marks it done, and lands the answer on the linked message row.

import { createClientFromRequest } from "npm:@base44/sdk";
import { streamChat } from "./_shared/ai.ts";

const json = (body: unknown, status = 200) => Response.json(body, { status });

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const E = (base44 as any).asServiceRole.entities;
  const { streamId } = await req.json().catch(() => ({}));
  if (!streamId) return json({ error: "streamId required" }, { status: 400 });

  const [row] = await E.AskStream.filter({ streamId }, undefined, 1);
  if (!row) return json({ error: "no such stream" }, { status: 404 });
  if (row.done) return json({ ok: true, already: true });

  const fail = async (error: string) => {
    await E.AskStream.update(row.id, { error, done: true }).catch(() => {});
    return json({ ok: false, error });
  };

  const q = String(row.question ?? "").trim();
  const widgets = await E.Widget.filter({ spaceId: row.spaceId });
  const chat = await E.Message.filter({ spaceId: row.spaceId, widgetId: "global" }, "-created_date", 40);
  const pool = [
    ...widgets
      .filter((w: any) => !["sticker", "media", "frame", "weather"].includes(w.type))
      .map((w: any) => ({ text: `${w.type}: ${flatText(w.data)}` })),
    ...chat.map((m: any) => ({ text: `${m.authorName}: ${m.text}`.slice(0, 220) })),
  ];
  const want = askWords(q);
  const ranked = pool
    .map((p) => ({ ...p, n: [...askWords(p.text)].filter((w) => want.has(w)).length }))
    .filter((p) => p.n > 0)
    .sort((x, y) => y.n - x.n)
    .slice(0, 6);
  const snippets = ranked.map((p, i) => `[${i + 1}] ${p.text}`);

  let answer = "the room doesn't know yet — nothing on the board or in the chat says.";
  if (ranked.length) {
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
    if (result.error) return fail(`${result.status || "fetch"}: ${result.error.slice(0, 160)}`);
    let parsed: { answer?: unknown; from?: unknown } = {};
    try {
      parsed = JSON.parse(/\{[\s\S]*\}/.exec(result.content)?.[0] ?? "{}");
    } catch { /* fall through to the don't-know answer */ }
    const from = ranked[Number(parsed.from) - 1];
    if (typeof parsed.answer === "string" && parsed.answer.trim() && from) {
      const text = parsed.answer.trim().toLowerCase().slice(0, 120);
      const src = from.text.toLowerCase();
      const numbers = text.match(/\d+/g) ?? [];
      const people = [...new Set(chat.map((m: any) => String(m.authorName).toLowerCase()))];
      const named = people.filter((p) => new RegExp(`\\b${p}\\b`).test(text));
      const bad = [...numbers.filter((n) => !src.includes(n)), ...named.filter((p) => !src.includes(p))];
      if (!bad.length) answer = text;
    }
  }

  // InvokeLLM returns the whole answer at once: write it in slices so the
  // room still watches it land rather than a row appearing fully formed.
  const full = `**${q}**\n\n${answer}`;
  const steps = 4;
  for (let i = 1; i <= steps; i++) {
    await E.AskStream.update(row.id, { body: full.slice(0, Math.ceil((full.length * i) / steps)) }).catch(() => {});
    if (i < steps) await sleep(220);
  }
  await E.AskStream.update(row.id, { body: full, done: true }).catch(() => {});
  if (row.messageId) await E.Message.update(row.messageId, { text: full }).catch(() => {});
  return json({ ok: true });
});
