// rightOfWayDoor — every AI write passes here.
//
// Port of convex/edits.ts (apply/undo/run) + convex/choiceVotes.ts (answer)
// over the shared door engine (_shared/door.ts → vendored
// lib/rightOfWay.ts + deck/edits.ts + lib/choiceVote.ts).
//
//   op:apply   → voice edits: {spaceId, widgetId, op, byUserId, today, life?}
//   op:undo    → the slip's undo, the asker only, within half a minute
//   op:answer  → a voter answers an open choice vote; settle() runs the
//                tally and lands a passed change through the same door
//
// Tavily's lookupForEdit is not ported (P2) — edits that would have waited
// on a web lookup go straight to the door instead.

import { createClientFromRequest } from "npm:@base44/sdk";
import { seatOf } from "./_shared/seat.ts";
import { applyEdit, type EditOp } from "./_shared/deck/edits.ts";
import { cardCtx, commitEdit, openVote, rightOfWay, settle } from "./_shared/door.ts";
import { voterOf } from "./_shared/lib/choiceVote.ts";

const json = (body: unknown, status = 200) => Response.json(body, { status });

type Ctx = { E: Record<string, any>; seat: { userId: string; name: string; color: string } };

const SETS = new Set(["rename", "setWhen", "setDate", "setDays", "setDay", "setNeeds", "setCloses"]);
const CLEARED = new Set(["responses", "logs", "dateBy"]);

async function run(
  { E, seat }: Ctx,
  a: { spaceId: string; widgetId: string; op: EditOp; today: string; kind: "edit" | "undo"; life?: number },
) {
  const widget = await E.Widget.get(a.widgetId).catch(() => null);
  if (!widget || widget.spaceId !== a.spaceId) return { status: "failed", text: "that card isn't in this room", fields: [] };
  const card = { type: widget.type, data: widget.data as Record<string, unknown> };
  const base = await cardCtx(E, widget, a.today);
  const r = applyEdit(card, a.op, base);
  const who = { name: seat.name, userId: seat.userId };
  if (!r.ok && !(r as any).choice) return { status: (r as any).refused ? "refused" : "failed", text: (r as any).reason, fields: [] };
  const choice = r.ok ? undefined : (r as any).choice;
  const c = r.ok ? r : applyEdit(card, a.op, { ...base, consent: true });
  if (!c.ok) return { status: "failed", text: (c as any).reason, fields: [] };

  const door = await rightOfWay(E, {
    kind: a.kind,
    spaceId: a.spaceId,
    widgetId: widget.id,
    by: who,
    fields: c.fields,
    text: choice ? choice.ask : c.text,
    undo: c.undo,
    ...(choice ? { choice } : {}),
    replay: {
      kind: "edit",
      op: a.op,
      today: a.today,
      ...(choice ? { consent: true as const } : {}),
      ...(SETS.has(a.op.op)
        ? { set: Object.fromEntries(c.fields.filter((f) => !CLEARED.has(f.field)).map((f) => [f.field, f.old ?? null])) }
        : {}),
    },
  });
  if (door.verdict === "ask" && choice) {
    const vote = await openVote(E, {
      widget,
      choice,
      op: a.op,
      changed: (c as any).changed,
      today: a.today,
      by: who,
      writeId: door.writeId,
      life: a.life,
    });
    return {
      status: "ask",
      text: door.reason,
      writeId: door.writeId,
      fields: [],
      verdict: "ask",
      vote: {
        id: vote.voteId,
        state: vote.state,
        who: vote.who,
        why: choice.people.map((p: any) => `${p.name} ${p.why}`),
        stake: choice.stake,
        ask: choice.ask,
      },
    };
  }
  if (door.verdict === "wait")
    return {
      status: "wait",
      text: door.reason,
      writeId: door.writeId,
      fields: c.fields.map((f: any) => f.field),
      verdict: "wait",
      ...(door.on ? { on: door.on } : {}),
      ...(door.pendingId ? { pendingId: door.pendingId } : {}),
    };
  if (door.verdict !== "go")
    return { status: "refused", text: door.reason, writeId: door.writeId, fields: [], verdict: door.verdict };
  await commitEdit(E, widget, c);
  return {
    status: "applied",
    text: c.text,
    writeId: door.writeId,
    fields: c.fields.map((f: any) => f.field),
    verdict: door.verdict,
    ...(door.on ? { on: door.on } : {}),
    ...(c.cleared ? { cleared: c.cleared.note } : {}),
  };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const E = (base44 as any).asServiceRole.entities;
  const a = await req.json().catch(() => ({}));

  const __op = a.__op ?? a.dispatch;
  if (__op === "apply" || __op === "undo") {
    const seat = await seatOf(base44, a.spaceId, a.byUserId);
    if (!seat) return json({ status: "refused", text: "enter the space first", fields: [] });

    if (__op === "apply") {
      return json(await run({ E, seat }, { spaceId: a.spaceId, widgetId: a.widgetId, op: a.op as EditOp, today: a.today, kind: "edit", life: a.life }));
    }

    // undo: the asker only, within half a minute, the inverse op through the same door
    const row = await E.AiWrite.get(a.writeId).catch(() => null);
    if (!row || row.spaceId !== a.spaceId || row.kind !== "edit" || row.verdict !== "go" || !row.widgetId || !row.undo)
      return json({ status: "failed", text: "nothing to undo", fields: [] });
    if (row.byUserId !== seat.userId) return json({ status: "refused", text: "only the person who asked can undo it", fields: [] });
    if (row.undone) return json({ status: "failed", text: "already undone", fields: [] });
    if (Date.now() - row.at > 30_000) return json({ status: "failed", text: "too late to undo", fields: [] });
    const out = await run({ E, seat }, {
      spaceId: a.spaceId,
      widgetId: row.widgetId,
      op: JSON.parse(row.undo) as EditOp,
      today: a.today,
      kind: "undo",
    });
    if (out.status === "applied") await E.AiWrite.update(row.id, { undone: true });
    return json(out);
  }

  if (__op === "answer") {
    const vote = await E.ChoiceVote.get(a.voteId).catch(() => null);
    if (!vote) return json("gone");
    if (vote.state !== "open") return json(vote.state);
    const seat = await seatOf(base44, vote.spaceId, a.userId);
    const me = seat && voterOf(vote.voters, seat.userId, seat.name);
    if (!me) return json("not yours to answer");
    if (!vote.options.some((o: any) => o.id === a.option)) return json("no such option");
    await E.ChoiceVote.update(vote.id, {
      answers: [...vote.answers.filter((x: any) => x.voter !== me), { voter: me, option: a.option, at: Date.now() }],
    });
    await settle(E, vote.id);
    const now = await E.ChoiceVote.get(vote.id).catch(() => null);
    return json(now?.state ?? "gone");
  }

  return json({ error: `unknown op: ${__op}` }, { status: 400 });
});
