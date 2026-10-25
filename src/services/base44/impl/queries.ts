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
import { isIn, scoreRows } from "../../../lib/games/engine";
import { LOCKS, seeState } from "../../../lib/answerToSee";

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

/** Every space on the deployment — the rail uses it to know which fixture
 * rooms actually exist live (dead slugs get disabled tiles, not a
 * "no space at this link" dead end). */
registerQueryImpl(
  "spaces.listAll",
  entityQuery(["Space"], async () =>
    withIds(await ent("Space").filter({}, undefined, 200))
      .sort((a: any, b: any) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)),
  ),
);

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

/* Ported from convex/games.ts `forRoom`: the week's loaded games (players +
   rounds + answers merged into each game doc, hidden picks redacted the same
   way), the scoreboard rows they imply, and the caller's seat. The flat
   contract matters — LiveSpace reads g.players / g.rounds unconditionally
   once a game exists. */
const sameName = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

function weekStart(now: number): number {
  const d = new Date(now);
  d.setUTCHours(16, 0, 0, 0); // sun 9:00 pacific, near enough
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.getTime() > now ? d.getTime() - 7 * 86_400_000 : d.getTime();
}

async function loadGame(doc: any) {
  const [players, rounds, answers] = await Promise.all([
    ent("GamePlayer").filter({ gameId: doc.id }, undefined, 40),
    ent("GameRound").filter({ gameId: doc.id }, undefined, 12),
    ent("GameAnswer").filter({ gameId: doc.id }, undefined, 400),
  ]);
  return {
    id: doc.id,
    room: String(doc.spaceId),
    kind: doc.kind,
    name: doc.name,
    startedBy: { name: doc.startedBy?.name ?? "", color: doc.startedBy?.color ?? "" },
    startedAt: doc.startedAt,
    phase: doc.phase,
    round: doc.round,
    phaseEndsAt: doc.phaseEndsAt,
    players: players.map((p: any) => ({
      name: p.name, color: p.color, joinedAt: p.joinedAt, fromRound: p.fromRound,
    })),
    cast: doc.cast ?? [],
    rounds: rounds.map((r: any) => ({
      n: r.n,
      prompt: r.prompt,
      answers: answers
        .filter((a: any) => a.n === r.n)
        .map((a: any) => ({ by: a.by, pick: a.pick, at: a.at })),
      endsAt: r.endsAt,
      revealedAt: r.revealedAt,
      winners: r.winners,
      ...(r.asks ? { asks: jparse(r.asks, []) } : {}),
      ...(r.reactions ? { reactions: r.reactions } : {}),
      ...(r.ready?.length ? { ready: r.ready } : {}),
    })),
    ...(doc.seat ? { seat: doc.seat } : {}),
    ...(doc.seatWhy ? { seatWhy: doc.seatWhy } : {}),
    ...(doc.known !== undefined ? { known: doc.known } : {}),
  };
}

function redactGame(game: any, me: string | null) {
  return {
    ...game,
    rounds: game.rounds.map((r: any) => {
      const facts = {
        mine: false, answered: r.answers.length,
        of: game.players.length, now: 0,
        resolved: r.revealedAt !== undefined,
      };
      const answersOpen = seeState(LOCKS.round, facts).open;
      const rightOpen = seeState(LOCKS.rightAnswer, facts).open;
      return {
        ...r,
        answers: answersOpen
          ? r.answers
          : r.answers.map((a: any) => (me && sameName(a.by, me) ? a : { ...a, pick: "" })),
        ...(r.asks
          ? { asks: rightOpen ? r.asks : r.asks.map((q: any) => (me && sameName(q.about, me) ? q : { ...q, right: "" })) }
          : {}),
      };
    }),
  };
}

registerQueryImpl(
  "games.forRoom",
  entityQuery(["Game", "GameRound", "GamePlayer", "GameAnswer", "Award", "Member"], async ({ spaceId, userId }) => {
    const now = Date.now();
    const recent = (await ent("Game").filter({ spaceId }, byNewest, 12))
      .filter((g: any) => g.kind !== "jigsaw");
    const week = recent.filter((g: any) => g.startedAt >= weekStart(now));
    const loaded = await Promise.all(week.map(loadGame));
    const [memberRows, awardRows] = await Promise.all([
      ent("Member").filter({ spaceId }),
      ent("Award").filter({ spaceId }, undefined, 100),
    ]);
    const cast = memberRows.map((m: any) => ({ name: m.name, color: m.color }));
    const rows = scoreRows({ cast, seed: {}, seedAwards: [], games: loaded });
    const awards = awardRows
      .filter((a: any) => (a.at ?? 0) >= weekStart(now))
      .map((a: any, i: number) => ({
        id: String(a.id), room: String(spaceId), gameId: String(a.gameId),
        to: a.to, title: a.title, glyph: a.glyph, prompt: a.prompt,
        tone: a.tone ?? i % 6, at: a.at,
      }));
    for (const row of rows) row.awards = awards.filter((a: any) => sameName(a.to, row.name));

    const latest = recent[0];
    const seat = memberRows.find((m: any) => m.userId === userId) ?? null;
    const me = seat ? { userId: seat.userId, name: seat.name, color: seat.color, guest: true } : null;
    const meIn = me && latest
      ? (() => {
          const players = loaded.find((g) => g.id === latest.id)?.players ?? [];
          const mine = players.find((p: any) => p.userId === me.userId);
          if (mine) return { ...me, name: mine.name };
          const twins = players.filter(
            (p: any) => sameName(p.name, me.name) || sameName(p.name.replace(/ \d+$/, ""), me.name),
          ).length;
          return twins ? { ...me, name: `${me.name} ${twins + 1}` } : me;
        })()
      : me;
    const game = latest ? loaded.find((g) => g.id === latest.id) ?? await loadGame(latest) : null;
    return {
      game: game ? redactGame(game, meIn?.name ?? null) : null,
      rows,
      awards,
      me: meIn,
      played: Boolean(
        me && loaded.some((g) => isIn(g, me.name) && g.rounds.some((r: any) => r.revealedAt !== undefined)),
      ),
    };
  }),
);

registerQueryImpl("games.challenge", entityQuery([], async () => null));
registerQueryImpl("games.offer", entityQuery([], async () => []));

/* Shape contract is flat (convex/puzzles.ts forRoom): the room's jigsaw as
 * { id, phase, photo, pieces, startedAt, startedBy, helper, players, rows }
 * or null — never a { game } wrapper. useLiveJigsaw reads data.players
 * unconditionally once data is non-null. */
registerQueryImpl(
  "puzzles.forRoom",
  entityQuery(["Game", "GamePlayer", "PuzzlePiece", "Lease", "PendingWrite"], async ({ spaceId }) => {
    const games = await ent("Game").filter({ spaceId, kind: "jigsaw" }, byNewest, 1);
    const game = games[0] ?? null;
    if (!game) return null;
    const [pieces, players, leases, pending] = await Promise.all([
      ent("PuzzlePiece").filter({ gameId: game.id }, undefined, 64),
      ent("GamePlayer").filter({ gameId: game.id }, undefined, 40),
      ent("Lease").filter({ spaceId }),
      ent("PendingWrite").filter({ spaceId }),
    ]);
    const prefix = `piece:${game.id}:`;
    const held = leases.filter(
      (l: any) => typeof l.thing === "string" && l.thing.startsWith(prefix) && l.letGoAt === undefined,
    );
    const holderOf = (i: number) =>
      held.find((l: any) => l.thing === `${prefix}${i}`);
    const waiting = pending.filter(
      (p: any) => typeof p.thing === "string" && p.thing.startsWith(prefix),
    );
    return {
      id: game.id,
      phase: game.phase,
      photo: game.photo ?? "friday",
      pieces: game.known ?? 20,
      startedAt: game.startedAt,
      startedBy: { name: game.startedBy?.name ?? "", color: game.startedBy?.color ?? "" },
      helper: waiting.length
        ? {
            piece: Number(waiting[0].thing.split(":")[2]),
            on: (() => {
              try { return JSON.parse(waiting[0].on).name; } catch { return ""; }
            })(),
          }
        : null,
      players: players.map((p: any) => ({ name: p.name, color: p.color, userId: p.userId })),
      rows: pieces.map((r: any) => {
        const h = holderOf(r.i);
        return {
          i: r.i, x: r.x, y: r.y, placed: r.placed,
          by: r.by ?? null, holder: h?.name ?? null,
          holderId: h?.userId ?? null, until: h?.until ?? 0,
        };
      }),
    };
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
