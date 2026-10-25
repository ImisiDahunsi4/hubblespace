/**
 * Query impls — every `api.X.y` the frontend reads, backed by Base44 entities.
 * Each registers a producer that fetches and re-emits on entity change events.
 * Shapes mirror the Convex query results the call sites were written for.
 */
import { ent, entityQuery, withId, withIds, isoMs } from "./entities";
import { registerQueryImpl } from "../store";
import { getIdentity } from "../../../live/identity";
import { base44 } from "../client";
import { peersRows, onPeers } from "../roomChannel";

function jparse<T>(s: unknown, fallback: T): T {
  try {
    return s ? (JSON.parse(String(s)) as T) : fallback;
  } catch {
    return fallback;
  }
}

const byNewest = "-created_date";
const dedupe = <T extends { id: string }>(rows: T[]) => {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
};

/* ---------------- spaces ---------------- */

registerQueryImpl(
  "spaces.getSpaceWithWidgets",
  entityQuery(["Space", "Widget"], async ({ slug }) => {
    const [space] = await ent("Space").filter({ slug }, undefined, 1);
    if (!space) return { space: null, widgets: [] };
    const widgets = await ent("Widget").filter({ spaceId: space.id });
    return { space: withId(space), widgets: withIds(widgets) };
  }),
);

registerQueryImpl(
  "spaces.getBySlug",
  entityQuery(["Space"], async ({ slug }) => {
    const [space] = await ent("Space").filter({ slug }, undefined, 1);
    return space ? withId(space) : null;
  }),
);

registerQueryImpl(
  "spaces.listMine",
  entityQuery(["Space", "Member"], async () => {
    const uid = getIdentity().userId;
    const [owned, memberships] = await Promise.all([
      ent("Space").filter({ ownerId: uid }),
      ent("Member").filter({ userId: uid }),
    ]);
    const memberSpaces = (
      await Promise.all(
        memberships.map((m: any) => ent("Space").get(m.spaceId).catch(() => null)),
      )
    ).filter(Boolean) as any[];
    return withIds(dedupe([...owned, ...memberSpaces])).sort(
      (a: any, b: any) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0),
    );
  }),
);

/** "can visitors make their own space" — HubbleSpace is open. */
registerQueryImpl("spaces.roomsOpen", entityQuery([], async () => true));

/* ---------------- messages ---------------- */

registerQueryImpl(
  "messages.listBySpace",
  entityQuery(["Message"], async ({ spaceId, paginationOpts }) => {
    const limit = paginationOpts?.numItems ?? 200;
    const rows = await ent("Message").filter({ spaceId }, "-created_date", limit);
    return withIds(rows).reverse();
  }),
);

/* ---------------- votes ---------------- */

async function spaceVotes(spaceId: string) {
  const widgets = await ent("Widget").filter({ spaceId });
  const ids = widgets.map((w: any) => w.id);
  if (!ids.length) return [];
  const [votes, members] = await Promise.all([
    ent("Vote").filter({ widgetId: { $in: ids } }),
    ent("Member").filter({ spaceId }),
  ]);
  const nameOf = new Map(members.map((m: any) => [m.userId, m.name]));
  return votes.map((v: any) =>
    withId({ ...v, voterName: nameOf.get(v.userId) ?? "someone" }),
  );
}

registerQueryImpl("votes.inSpace", entityQuery(["Vote", "Member", "Widget"], ({ spaceId }) => spaceVotes(spaceId)));
registerQueryImpl(
  "votes.getResults",
  entityQuery(["Vote", "Member"], async ({ widgetId }) => {
    const [votes, space] = await Promise.all([ent("Vote").filter({ widgetId }), Promise.resolve(null)]);
    void space;
    return votes.map((v: any) => withId({ ...v, voterName: v.voterName ?? "someone" }));
  }),
);

/* ---------------- presence occupancy (RoomPresenceHeartbeat parity) ----------------
 * The hot cursor path is the spaceRoom actor; the rail/header occupancy
 * number rides a Presence entity row per tab (the documented fallback). */
registerQueryImpl(
  "roomPresence.onlineForSpace",
  entityQuery(["Presence"], async ({ spaceId, userId }) => {
    const cutoff = Date.now() - 30_000;
    const rows = await ent("Presence").filter({
      spaceId,
      updatedAt: { $gt: cutoff },
    });
    const others = rows.filter((r: any) => r.userId !== userId).length;
    return { total: rows.length, others };
  }),
);

/* ---------------- presence peers (actor-fed — see roomChannel.ts) ---------------- */

registerQueryImpl("presence.listHereNow", (args, emit) => {
  const emitRows = () =>
    emit(peersRows(args.spaceId).map((r) => ({ ...r, _id: r.userId })));
  emitRows();
  return onPeers(args.spaceId, emitRows);
});

/* ---------------- paint ---------------- */

registerQueryImpl("paint.listBySpace", entityQuery(["PaintMark"], async ({ spaceId }) => withIds(await ent("PaintMark").filter({ spaceId }))));

/* ---------------- choice votes (Right of Way 'ask') ---------------- */

registerQueryImpl("choiceVotes.room", entityQuery(["ChoiceVote"], async ({ spaceId }) => withIds(await ent("ChoiceVote").filter({ spaceId }, "-at", 30))));

/* ---------------- Right of Way: leases, ghosts, settled ---------------- */

registerQueryImpl("leases.forRoom", entityQuery(["Lease"], async ({ spaceId }) => withIds(await ent("Lease").filter({ spaceId }))));

registerQueryImpl(
  "rightOfWay.room",
  entityQuery(["PendingWrite", "AiWrite"], async ({ spaceId }) => {
    const [pending, aiWrites] = await Promise.all([
      ent("PendingWrite").filter({ spaceId }),
      ent("AiWrite").filter({ spaceId }, "-at", 25),
    ]);
    const byId = new Map(aiWrites.map((w: any) => [w.id, w]));
    const ghosts = pending.map((p: any) => {
      const w = byId.get(p.writeId);
      return {
        id: p.id,
        writeId: p.writeId,
        thing: p.thing,
        ...(w?.widgetId ? { widgetId: w.widgetId } : {}),
        kind: w?.kind,
        by: w?.by,
        ...(w?.byUserId ? { byUserId: w.byUserId } : {}),
        text: w?.text ?? "",
        write: p.write,
        on: p.on,
        at: p.at,
      };
    });
    const settled = aiWrites
      .filter((w: any) => w.outcome)
      .map((w: any) => ({
        id: w.id,
        widgetId: w.widgetId,
        kind: w.kind,
        by: w.by,
        byUserId: w.byUserId,
        text: w.text ?? "",
        outcome: w.outcome,
      }));
    return { ghosts, settled };
  }),
);

/* The room's week from the ledger (convex/rightOfWay.ts `heldBack`): every
 * number computed from the write log. */
registerQueryImpl(
  "rightOfWay.heldBack",
  entityQuery(["AiWrite", "ChoiceVote", "PendingWrite"], async ({ spaceId, since }) => {
    const empty = { rows: [], week: { writes: 0, held: 0, waits: 0, asks: 0, nevers: 0, overHold: 0, checked: 0, capped: false } };
    const log = (await ent("AiWrite").filter({ spaceId }, "-at", 1000)).filter((r: any) => (r.at ?? 0) >= since);
    const parseO = (s: unknown) => { try { return s ? JSON.parse(String(s)) : null; } catch { return null; } };
    const held = log.filter((r: any) => (r.verdict === "wait" || r.verdict === "never" || r.verdict === "ask") && !String(r.outcome ?? "").includes('"replaced"'));
    const week = { ...empty.week, capped: log.length === 1000, held: held.length };
    for (const r of log) {
      const o = parseO(r.outcome);
      if (r.verdict === "wait" && !String(r.outcome ?? "").includes('"replaced"')) week.waits++;
      if (r.verdict === "ask") week.asks++;
      if (r.verdict === "never") week.nevers++;
      const reading = r.verdict === "go" ? r.others : r.verdict === "wait" && o?.state === "landed" ? o.heldBy : null;
      if (r.verdict !== "go" && !(r.verdict === "wait" && o?.state === "landed")) continue;
      week.writes++;
      if (reading === undefined || reading === null) continue;
      week.checked++;
      if (reading.length) week.overHold++;
    }
    const votes = (await ent("ChoiceVote").filter({ spaceId }, "-at", 200)).filter((x: any) => (x.at ?? 0) >= since);
    const asked = new Map<string, string[]>();
    for (const cv of votes) for (const op of cv.options ?? []) if (op.writeId) asked.set(op.writeId, (cv.voters ?? []).map((p: any) => String(p.name).toLowerCase()));
    const waiting = await ent("PendingWrite").filter({ spaceId }, undefined, 20);
    const on = new Map(waiting.map((p: any) => [p.writeId as string, (parseO(p.on) as { name?: string } | null)?.name ?? ""]));
    const rows = held.slice(0, 12).map((r: any) => {
      const o = parseO(r.outcome);
      const who = r.verdict === "ask" ? asked.get(r.id) ?? [] : r.verdict === "wait" ? [(o?.on ?? on.get(r.id) ?? "").toLowerCase()].filter(Boolean) : [];
      return { id: r.id, at: r.at, kind: r.kind, by: r.by, verdict: r.verdict, reason: r.reason ?? "", text: r.text ?? "", ...(r.outcome ? { outcome: r.outcome } : {}), ...(r.widgetId ? { widgetId: r.widgetId } : {}), who };
    });
    return { rows, week };
  }),
);

registerQueryImpl(
  "edits.recent",
  entityQuery(["AiWrite"], async ({ spaceId }) => {
    const rows = await ent("AiWrite").filter({ spaceId }, "-at", 12);
    return withIds(rows).reverse();
  }),
);

/* ---------------- room brief / what the space knows ---------------- */

type Stored = { lines?: any[]; room?: any; knows?: { people?: any[]; lines?: any[] }; told?: any[]; forgot?: any[] };

function applyCorrections(room: any, told: any[] = [], forgot: any[] = []) {
  void told;
  void forgot;
  return room;
}

registerQueryImpl(
  "roomBrief.inspect",
  entityQuery(["Brief"], async ({ spaceId, now }) => {
    const [row] = await ent("Brief").filter({ spaceId }, "-at", 1);
    if (!row) return null;
    const s = jparse<Stored>(row.facts, {});
    return {
      text: row.text,
      chars: String(row.text ?? "").length,
      at: row.at,
      ageMs: Math.max(0, (now ?? Date.now()) - (row.at ?? 0)),
      lines: s.lines ?? [],
      ...(s.room ? { room: applyCorrections(s.room, s.told, s.forgot) } : {}),
    };
  }),
);

registerQueryImpl(
  "roomBrief.knows",
  entityQuery(["Brief"], async ({ spaceId }) => {
    const [row] = await ent("Brief").filter({ spaceId }, "-at", 1);
    if (!row) return null;
    const s = jparse<Stored>(row.facts, {});
    return {
      room: s.room?.room ?? "",
      at: row.at,
      people: s.knows?.people ?? [],
      lines: s.knows?.lines ?? [],
      told: s.told ?? [],
      forgot: s.forgot ?? [],
    };
  }),
);

/* ---------------- links (card feeds card) ---------------- */

registerQueryImpl(
  "links.waiting",
  entityQuery(["Link"], async ({ spaceId }) => {
    const rows = await ent("Link").filter({ spaceId });
    return withIds(rows.filter((r: any) => !r.resolvedAt && !r.cutAt));
  }),
);

/* ---------------- work ledger ---------------- */

registerQueryImpl(
  "work.recent",
  entityQuery(["WorkLog"], async ({ spaceId, since }) => {
    const rows = await ent("WorkLog").filter(
      { spaceId, createdAt: { $gt: since ?? 0 } },
      "createdAt",
      40,
    );
    return withIds(rows);
  }),
);

/* ---------------- voice deal live mirror ---------------- */

registerQueryImpl(
  "voiceBuild.live",
  entityQuery(["Deal"], async ({ spaceId, nonce }) => {
    const rows = await ent("Deal").filter({ spaceId }, byNewest, 40);
    for (const row of rows) {
      if (!String(row.run ?? "").includes(nonce)) continue;
      const run = jparse<{ nonce?: string; answer?: string; done?: boolean }>(row.run, {});
      if (run.nonce === nonce) return { answer: run.answer ?? "", done: run.done === true };
    }
    return null;
  }),
);

/* ---------------- ask-the-space stream ---------------- */

registerQueryImpl(
  "streaming.latestAskStream",
  entityQuery(["AskStream"], async ({ spaceId }) => {
    const [row] = await ent("AskStream").filter({ spaceId }, byNewest, 1);
    return row ? withId(row) : null;
  }),
);

registerQueryImpl(
  "streaming.byId",
  entityQuery(["AskStream"], async ({ streamId }) => {
    const [row] = await ent("AskStream").filter({ streamId }, undefined, 1);
    return row ? withId(row) : null;
  }),
);

/* ---------------- recaps ---------------- */

/* Persistence half of the stream body (reloads / second viewers). */
registerQueryImpl(
  "streaming.getAskStreamBody",
  entityQuery(["AskStream"], async ({ streamId }) => {
    const [row] = await ent("AskStream").filter({ streamId }, undefined, 1);
    if (!row) return { text: "", status: "pending" };
    return {
      text: (row as any).body ?? "",
      status: (row as any).error ? "error" : (row as any).done ? "done" : (row as any).body ? "streaming" : "pending",
    };
  }),
);

/* Which ways in exist on this deployment (convex/auth.ts signInOptions). */
registerQueryImpl("auth.signInOptions", entityQuery([], async () => ({ google: true })));

/* "here now" — a global count of fresh presence heartbeats (convex/stats.ts). */
registerQueryImpl(
  "stats.getHereNow",
  entityQuery(["Presence"], async ({ now }) => {
    const cutoff = Number(now) - 30_000;
    const rows = await ent("Presence").filter({ updatedAt: { $gt: cutoff } }, undefined, 500);
    return Math.max(rows.length, 1);
  }),
);

/* The mail envelope on the canvas (convex/mailArrival.ts recentInbound). */
registerQueryImpl(
  "mailArrival.recentInbound",
  entityQuery(["EmailEvent"], async ({ spaceId, since }) => {
    const rows = (await ent("EmailEvent").filter({ spaceId }, "-createdAt", 12)).filter(
      (row: any) => row.direction === "in" && (row.createdAt ?? 0) >= since,
    );
    return rows.map((row: any) => ({
      id: row.id,
      from: row.from,
      subject: row.subject,
      createdAt: row.createdAt,
      readingAt: row.readingAt,
      label: row.label,
      because: row.because,
      widgetId: row.widgetId,
      repliedAt: row.repliedAt,
      hasDocument: (row.attachments?.length ?? 0) > 0,
    }));
  }),
);

registerQueryImpl(
  "recap.latest",
  entityQuery(["Recap"], async ({ spaceId }) => {
    const rows = await ent("Recap").filter({ spaceId, kind: "daily" }, "-createdAt", 1);
    return rows[0] ? withId(rows[0]) : null;
  }),
);

/* ---------------- games (P2 — honest empty room until ported) ---------------- */

registerQueryImpl(
  "games.forRoom",
  entityQuery(["Game", "GameRound", "GamePlayer", "Award"], async ({ spaceId, userId }) => {
    const rows = await ent("Game").filter({ spaceId }, byNewest, 1);
    const game = rows[0] ?? null;
    if (!game) return { game: null, rows: [], awards: [], me: null, played: false };
    const [players, awards] = await Promise.all([
      ent("GamePlayer").filter({ gameId: game.id }),
      ent("Award").filter({ gameId: game.id }),
    ]);
    const me = players.find((p: any) => p.userId === userId) ?? null;
    return {
      game: withId(game),
      rows: withIds(players),
      awards: withIds(awards),
      me: me ? { name: me.name, color: me.color, guest: true } : null,
      played: Boolean(me),
    };
  }),
);

registerQueryImpl("games.challenge", entityQuery([], async () => null));
registerQueryImpl("games.offer", entityQuery([], async () => []));

registerQueryImpl(
  "puzzles.forRoom",
  entityQuery(["Game", "PuzzlePiece"], async ({ spaceId }) => {
    const rows = await ent("Game").filter({ spaceId, kind: "jigsaw" }, byNewest, 1);
    const game = rows[0] ?? null;
    if (!game) return { game: null, pieces: [] };
    const pieces = await ent("PuzzlePiece").filter({ gameId: game.id });
    return { game: withId(game), pieces: withIds(pieces) };
  }),
);

/* ---------------- stats (About page totals) ---------------- */

registerQueryImpl(
  "stats.getLiveTotals",
  entityQuery(["Space", "Member", "Widget", "Vote"], async () => {
    const [spaces, members, widgets, votes] = await Promise.all([
      ent("Space").list(undefined, 5000),
      ent("Member").list(undefined, 5000),
      ent("Widget").list(undefined, 5000),
      ent("Vote").list(undefined, 5000),
    ]);
    return {
      spaces: spaces.length,
      members: members.length,
      widgets: widgets.length,
      votes: votes.length,
    };
  }),
);

/* ---------------- auth ---------------- */

registerQueryImpl(
  "auth.currentUser",
  entityQuery(["User"], async () => {
    try {
      const me = await base44.auth.me();
      if (!me) return null;
      return {
        userId: me.id,
        isAnonymous: false,
        name: me.full_name ?? undefined,
        email: me.email,
        color: (me as any).color,
        emoji: (me as any).emoji,
        image: (me as any).avatar_url ?? (me as any).image,
      };
    } catch {
      return null;
    }
  }),
);

/* ---------------- firecrawl (P2 reads — entities exist; actions unported) ---------------- */

registerQueryImpl(
  "firecrawl.getCrawlStatus",
  entityQuery(["Crawl"], async ({ crawlId }) => {
    const row = await ent("Crawl").get(crawlId).catch(() => null);
    return row ? withId(row) : null;
  }),
);

registerQueryImpl(
  "firecrawl.listCrawlPages",
  entityQuery(["CrawlPage"], async ({ crawlId }) => withIds(await ent("CrawlPage").filter({ crawlId }))),
);

/* ---------------- tavily receipt (P2) ---------------- */

registerQueryImpl("tavily.receipt", entityQuery([], async () => null));

/* ---------------- admin (P2 — no privileged client path) ---------------- */

registerQueryImpl("admin.check", entityQuery([], async () => false));
registerQueryImpl("admin.overview", entityQuery([], async () => []));

/* ---------------- misc ---------------- */

export { isoMs };
