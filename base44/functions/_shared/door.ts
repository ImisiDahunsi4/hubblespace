// door.ts — the one door every AI write passes.
//
// Port of convex/rightOfWay.ts + the run() flow of convex/edits.ts +
// convex/choiceVotes.ts (openVote/settle/land) over Base44 entities. The
// verdict logic itself is the vendored pure function in lib/rightOfWay.ts —
// the case table there is the spec.
//
// Lost in the port, documented honestly:
//   - atomicity: Convex ran gate+commit in one mutation. Here the check and
//     the write are two entity calls — a lease could land between them. The
//     spaceRoom actor serializes drags; the residual race is the same size
//     as a lost lease heartbeat.
//   - personOf: guest seats folding into accounts needs User.mergedInto,
//     which the Base44 User entity doesn't model — ids pass through.
//   - wait expiry: Convex scheduled `expire` exactly at WAIT_MS. Pending
//     ghosts now expire on read (queries and the door both treat
//     at+WAIT_MS as the deadline) instead of a scheduled sweep.

import { rightOfWay as gate, type Choice, type Lease, type Verdict } from "./lib/rightOfWay.ts";
import { applyEdit, type EditOp, type EditCtx } from "./deck/edits.ts";
import { tally, voterKey, voterOf, since, KEEP, MAX_OPTIONS } from "./lib/choiceVote.ts";

type Entities = Record<string, any>;

export type Holder = { userId: string; name: string; color: string; kind: string };
export type Replay =
  | { kind: "edit"; op: EditOp; today: string; set?: Record<string, unknown>; consent?: true; vote?: string }
  | { kind: "link"; linkId: string; fill: string; value: unknown }
  | { kind: "puzzle"; gameId: string; i: number; x: number; y: number };

export type AiWrite = {
  kind: "edit" | "undo" | "link" | "build" | "game" | "puzzle";
  spaceId: string;
  widgetId?: string;
  thing?: string;
  by: { name: string; userId?: string };
  fields: { field: string; old: unknown; new: unknown }[];
  text?: string;
  undo?: unknown;
  rect?: { x: number; y: number; w: number; h: number };
  choice?: Choice;
  consented?: string;
  refused?: string;
  finishes?: boolean;
  replay?: Replay;
};

export type Door = {
  verdict: Verdict["kind"];
  reason: string;
  writeId: string;
  on?: Holder;
  onThing?: string;
  pendingId?: string;
  who?: Choice["people"];
  stake?: string;
};

export const WAIT_MS = 30_000;
const DOING: Record<string, string> = { drag: "moving", type: "typing in", vote: "choosing on", piece: "holding" };
const SETS = new Set(["rename", "setWhen", "setDate", "setDays", "setDay"]);

const cut = (x: unknown) => {
  const s = JSON.stringify(x ?? null);
  return s.length > 240 ? `${s.slice(0, 237)}…` : s;
};
const holderOf = (l: any): Holder => ({ userId: l.userId, name: l.name, color: l.color, kind: l.kind });
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Live leases on the space (the room's hands), optionally on one thing. */
async function leasesOn(E: Entities, spaceId: string, thing?: string): Promise<any[]> {
  const rows = await E.Lease.filter(thing ? { spaceId, thing } : { spaceId });
  const now = Date.now();
  return rows.filter((l: any) => (l.until ?? 0) > now);
}

/** Guest seats folded into accounts isn't modeled on Base44 — the id stands. */
const personOf = async (_E: Entities, userId: string) => userId;

const asLeases = (rows: any[]): Lease[] =>
  rows.map((l) => ({ thing: l.thing, by: { kind: "person" as const, id: l.userId, name: l.name }, kind: l.kind }));

/** One ledger row (AiWrite). */
export async function log(E: Entities, write: AiWrite, verdict: string, reason?: string, others?: string[]) {
  const row = await E.AiWrite.create({
    spaceId: write.spaceId,
    ...(write.widgetId ? { widgetId: write.widgetId } : {}),
    kind: write.kind,
    by: write.by.name,
    ...(write.by.userId ? { byUserId: write.by.userId } : {}),
    fields: JSON.stringify(write.fields.map((f) => ({ field: f.field, old: cut(f.old), new: cut(f.new) }))),
    verdict,
    ...(reason ? { reason } : {}),
    ...(write.text ? { text: write.text } : {}),
    ...(write.undo !== undefined ? { undo: JSON.stringify(write.undo) } : {}),
    ...(others?.length ? { others: JSON.stringify(others) } : {}),
    at: Date.now(),
  });
  return row.id as string;
}

/**
 * The door. Reads the room's leases, runs the pure gate, writes the ledger
 * row, opens a ghost (PendingWrite) on wait. What the caller does with the
 * verdict is its own — build places elsewhere, edit opens a vote.
 */
export async function rightOfWay(E: Entities, write: AiWrite): Promise<Door> {
  const thing = write.thing ?? write.widgetId;
  const rows = thing !== undefined ? await leasesOn(E, write.spaceId, thing) : write.rect ? await leasesOn(E, write.spaceId) : [];
  let spot: string[] | undefined;
  if (thing === undefined && write.rect) {
    spot = [];
    for (const l of rows) {
      const w = await E.Widget.get(l.thing).catch(() => null);
      if (w && overlaps(write.rect, w)) spot.push(l.thing);
    }
  }
  const asker = write.by.userId ? await personOf(E, write.by.userId) : undefined;
  const hands = asLeases(rows);
  const choice =
    write.choice &&
    ({
      ...write.choice,
      people: await Promise.all(
        write.choice.people.map(async (p: any) => (p.id ? { ...p, id: await personOf(E, p.id) } : p)),
      ),
    } as Choice);
  const v = gate(
    {
      thing,
      by: { kind: "space", ...(asker ? { asker } : {}), askerName: write.by.name },
      spot,
      choice,
      refused: write.refused,
      finishes: write.finishes,
    },
    hands,
  );
  const vOn = v.kind === "wait" || v.kind === "never" ? (v as any).on : undefined;
  const lease = vOn ? rows[hands.indexOf(vOn)] : v.kind === "go" && thing !== undefined ? rows.find((l) => l.thing === thing) : undefined;
  const on = lease ? holderOf(lease) : undefined;
  const own = write.choice ? `only ${write.by.name.toLowerCase()}'s own choice (${write.choice.stake}); ` : "";
  const reason =
    v.kind === "ask"
      ? `that's ${(v as any).who.length === 1 ? `${(v as any).who[0].name.toLowerCase()}'s` : `${(v as any).who.length} people's`} choice: ${write.choice!.stake}`
      : (write.consented ? `${write.consented}; ` : "") +
        (v.kind === "go"
          ? own + (lease ? `${lease.name} holds it: their own hand` : "nobody holds it")
          : v.kind === "wait"
            ? own + `${on!.name} is ${DOING[on!.kind] ?? "holding"} it`
            : on && thing === undefined
              ? `${(v as any).why}; placed it below`
              : (v as any).why);
  const others = [
    ...new Set(
      rows
        .filter((l, i) => hands[i].by.kind === "person" && (hands[i].by as any).id !== asker && (thing !== undefined || spot?.includes(l.thing)))
        .map((l) => l.name),
    ),
  ];
  const writeId = await log(E, write, v.kind, reason, others);
  let pendingId: string | undefined;
  if (v.kind === "wait" && write.replay && thing !== undefined) {
    for (const old of await E.PendingWrite.filter({ spaceId: write.spaceId, thing })) {
      const r = JSON.parse(old.write) as Replay;
      const row = await E.AiWrite.get(old.writeId).catch(() => null);
      if (row?.byUserId === write.by.userId && r.kind === "edit" && write.replay.kind === "edit" && (r as any).op.op === (write.replay as any).op.op)
        await closePending(E, old, "replaced");
    }
    const p = await E.PendingWrite.create({
      spaceId: write.spaceId,
      thing,
      writeId,
      write: JSON.stringify(write.replay),
      on: JSON.stringify(on ?? null),
      at: Date.now(),
    });
    pendingId = p.id;
  }
  console.log(`rightOfWay ${write.kind} ${thing ?? "new"} by ${write.by.name}: ${write.fields.map((f) => f.field).join(",")} → ${v.kind} (${reason})`);
  return {
    verdict: v.kind,
    reason,
    writeId,
    ...(on ? { on, onThing: lease!.thing } : {}),
    ...(pendingId ? { pendingId } : {}),
    ...(v.kind === "ask" ? { who: (v as any).who, stake: (v as any).stake } : {}),
  };
}

/** Close a ghost: landed, replaced, or expired — the outcome lands on the ledger row. */
export async function closePending(E: Entities, pending: any, state: string) {
  const now = Date.now();
  await E.PendingWrite.delete(pending.id).catch(() => {});
  const row = await E.AiWrite.get(pending.writeId).catch(() => null);
  if (row && !row.outcome) {
    await E.AiWrite.update(row.id, {
      outcome: JSON.stringify({ state, ms: now - row.at, on: pending.thing, at: now }),
    }).catch(() => {});
  }
}

/** What people did on a card that an edit must not undo (poll votes and who cast them). */
export async function cardCtx(E: Entities, widget: any, today: string, consent = false): Promise<EditCtx> {
  if (widget.type !== "poll") return { today, consent };
  const votes: Record<string, number> = {};
  const voters: Record<string, { id: string; name: string }[]> = {};
  const rows = await E.Vote.filter({ widgetId: widget.id });
  const members = await E.Member.filter({ spaceId: widget.spaceId });
  const nameOf = new Map(members.map((m: any) => [m.userId, m.name]));
  for (const x of rows) {
    votes[x.optionId] = (votes[x.optionId] ?? 0) + 1;
    (voters[x.optionId] ??= []).push({ id: x.userId, name: nameOf.get(x.userId) ?? "someone" });
  }
  return { today, votes, voters, consent };
}

/** Write an applied edit: the card's data, and the vote rows of an option a passed vote took off. */
export async function commitEdit(E: Entities, widget: any, r: Extract<ReturnType<typeof applyEdit>, { ok: true }>) {
  await E.Widget.update(widget.id, { data: r.data });
  if (!r.cleared?.votesFor) return;
  for (const x of await E.Vote.filter({ widgetId: widget.id })) {
    if (x.optionId !== r.cleared.votesFor) continue;
    await E.Vote.delete(x.id).catch(() => {});
  }
}

/* ---------------- choice votes ---------------- */

const LIFE_MS = 24 * 3600_000;
const MIN_LIFE_MS = 10_000;

/** The door said ask: open the vote on this choice, or join the open one as another option. */
export async function openVote(
  E: Entities,
  a: { widget: any; choice: any; op: EditOp; changed: string; today: string; by: { name: string; userId: string }; writeId: string; life?: number },
): Promise<{ state: "asked" | "joined" | "already" | "busy"; voteId: string; who: string[] }> {
  const op = JSON.stringify(a.op);
  const now = Date.now();
  const open = (await E.ChoiceVote.filter({ widgetId: a.widget.id, state: "open" })).find((x: any) => x.key === a.choice.key);
  const voters = a.choice.people.map((p: any) => ({ ...(p.id ? { id: p.id } : {}), name: p.name, why: p.why }));
  const option = { ask: a.choice.ask, changed: a.changed, op, by: a.by.name, byUserId: a.by.userId, writeId: a.writeId };
  if (open) {
    const names = open.voters.map((p: any) => p.name);
    if (open.options.some((o: any) => o.op === op)) return { state: "already", voteId: open.id, who: names };
    if (open.options.length >= MAX_OPTIONS) return { state: "busy", voteId: open.id, who: names };
    const id = `c${open.options.length}`;
    const all = [...open.voters, ...voters.filter((p: any) => !open.voters.some((o: any) => voterKey(o) === voterKey(p)))];
    const mine = voterOf(all, a.by.userId, a.by.name);
    const answers = mine ? [...open.answers.filter((x: any) => x.voter !== mine), { voter: mine, option: id, at: now }] : open.answers;
    await E.ChoiceVote.update(open.id, { voters: all, options: [...open.options, { id, ...option }], answers });
    await settle(E, open.id);
    return { state: "joined", voteId: open.id, who: all.map((p: any) => p.name) };
  }
  const mine = voterOf(voters, a.by.userId, a.by.name);
  const life = Math.min(LIFE_MS, Math.max(MIN_LIFE_MS, a.life ?? LIFE_MS));
  const row = await E.ChoiceVote.create({
    spaceId: a.widget.spaceId,
    widgetId: a.widget.id,
    key: a.choice.key,
    stake: a.choice.stake,
    voters,
    options: [{ id: KEEP, ask: "" }, { id: "c1", ...option }],
    answers: mine ? [{ voter: mine, option: "c1", at: now }] : [],
    state: "open",
    today: a.today,
    at: now,
    endsAt: now + life,
  });
  return { state: "asked", voteId: row.id, who: voters.map((p: any) => p.name) };
}

async function closeVote(E: Entities, vote: any, state: string, why: string, extra: Record<string, unknown> = {}) {
  const now = Date.now();
  await E.ChoiceVote.update(vote.id, { state, why, closedAt: now, ...extra });
  for (const o of vote.options)
    if (o.writeId)
      await E.AiWrite.update(o.writeId, {
        outcome: JSON.stringify({ state: state === "change" ? "changed" : state === "keep" ? "kept" : state, ms: now - vote.at, on: vote.stake, why, at: now }),
      }).catch(() => {});
}

/** Send a change the people agreed to through the door again. */
async function land(E: Entities, vote: any, o: any, consented: string, consent: boolean): Promise<Record<string, unknown>> {
  const widget = await E.Widget.get(vote.widgetId).catch(() => null);
  if (!widget || !o.op) return { landed: "the card is gone; nothing done" };
  const op = JSON.parse(o.op) as EditOp;
  const card = { type: widget.type, data: widget.data as Record<string, unknown> };
  const r = applyEdit(card, op, await cardCtx(E, widget, vote.today, consent));
  if (!r.ok) return { landed: `${(r as any).reason}; nothing done` };
  const by = { name: o.by ?? "someone", ...(o.byUserId ? { userId: o.byUserId } : {}) };
  const now = applyEdit(card, op, await cardCtx(E, widget, vote.today));
  const was = !(now as any).ok ? (now as any).choice : undefined;
  const newer = was ? since(vote.voters, was.people) : [];
  const choice = was && newer.length ? { ...was, stake: newer.length === 1 ? `${newer[0].name.toLowerCase()} ${newer[0].why}` : `${newer.length} people since`, people: newer } : undefined;
  const door = await rightOfWay(E, {
    kind: "edit",
    spaceId: widget.spaceId,
    widgetId: widget.id,
    by,
    fields: r.fields,
    text: r.text,
    undo: r.undo,
    consented,
    ...(choice ? { choice } : {}),
    replay: { kind: "edit", op, today: vote.today, vote: vote.id, ...(consent ? { consent: true as const } : {}) },
  });
  if (door.verdict === "ask" && choice) {
    const kept = `${newer.length} ${widget.type === "poll" ? "vote" : "choice"}${newer.length === 1 ? " since was" : "s since were"} kept`;
    const next = await openVote(E, { widget, choice, op, changed: o.changed ?? "", today: vote.today, by: { name: by.name, userId: o.byUserId ?? "" }, writeId: door.writeId });
    return { landed: `waiting on ${next.who.map((n) => n.toLowerCase()).join(", ")} · ${kept}` };
  }
  if (door.verdict === "go") {
    await commitEdit(E, widget, r);
    return { landed: "landed", ...(r.cleared ? { note: r.cleared.note } : {}) };
  }
  if (door.verdict === "wait") return { landed: `waiting on ${door.on?.name.toLowerCase() ?? "someone"}`, ...(r.cleared ? { note: r.cleared.note } : {}) };
  return { landed: `${door.reason}; nothing done` };
}

/** Count it and close it if it's decided. */
export async function settle(E: Entities, voteId: string, expired = false) {
  const vote = await E.ChoiceVote.get(voteId).catch(() => null);
  if (!vote || vote.state !== "open") return;
  const out = tally(vote.voters, vote.options, vote.answers, expired || (vote.endsAt ?? 0) < Date.now());
  if (out.state === "open") return;
  const one = vote.voters.length === 1;
  if (out.state === "change") {
    const o = vote.options.find((x: any) => x.id === out.option)!;
    const said = one ? `${vote.voters[0].name.toLowerCase()} said ok` : `${out.n} of ${out.of} said ${vote.options.length > 2 ? o.changed ?? "change it" : "change it"}`;
    await closeVote(E, vote, "change", said);
    const landed = await land(E, vote, o, `the vote passed: ${said}`, true);
    await E.ChoiceVote.update(vote.id, landed);
    return;
  }
  const why =
    out.why === "expired"
      ? "nobody decided in time · kept as it is"
      : out.why === "tie"
        ? `no majority · kept as it is`
        : one
          ? `${vote.voters[0].name.toLowerCase()} said no · kept as it is`
          : `${out.n} of ${out.of} said keep it · kept as it is`;
  await closeVote(E, vote, out.why === "expired" ? "expired" : "keep", why);
}
