/**
 * Mutation + action impls — every `api.X.y` the frontend writes/invokes,
 * backed by Base44 entity writes or deployed backend functions.
 *
 * `functions.invoke(name, args)` hits the deployed Deno functions
 * (base44/functions/). Entity writes go through the client SDK and are
 * covered by the caller's auth/RLS — privileged paths (Right of Way, voice
 * commits, promote) always route through functions.
 */
import { base44 } from "../client";
import { ent } from "./entities";
import { getIdentity } from "../../../live/identity";
import { cannedLinkQuestions } from "../../../lib/linkQuestions";

type Impl = (args: any) => Promise<any>;

const invoke = (fn: string) => async (args: any) =>
  (await base44.functions.invoke(fn, args)) as any;
// `__op` can't collide with caller args — edits.apply itself passes an `op`
// (the EditOp), so a plain `op` dispatch key would be overwritten by spread.
const opInv =
  (fn: string, op: string): Impl =>
  async (args: any) =>
    (await base44.functions.invoke(fn, { ...args, __op: op })) as any;

/** Honest stub: loud, typed, and never fakes a success. */
function notPorted(name: string, doc = "docs/migration/12-feature-parity-matrix.md"): Impl {
  return async () => {
    const err = `feature not ported to Base44 yet: ${name} (see ${doc})`;
    console.warn(`[hubble] ${err}`);
    throw new Error(err);
  };
}

const mutations = new Map<string, Impl>();
const actions = new Map<string, Impl>();
const M = (name: string, impl: Impl) => mutations.set(name, impl);
const A = (name: string, impl: Impl) => actions.set(name, impl);

const jparse = (s: unknown, fb: any) => {
  try {
    return s ? JSON.parse(String(s)) : fb;
  } catch {
    return fb;
  }
};

async function touch(spaceId: string) {
  await ent("Space").update(spaceId, { lastActivityAt: Date.now() }).catch(() => {});
}

/* ---------------- widgets ---------------- */

M("widgets.createWidget", async (args) => {
  const row = await ent("Widget").create({
    spaceId: args.spaceId,
    type: args.type,
    x: args.x,
    y: args.y,
    w: args.w,
    h: args.h,
    z: args.z,
    ...(args.rotate !== undefined ? { rotate: args.rotate } : {}),
    data: args.data,
    createdBy: args.createdBy,
    createdAt: Date.now(),
  });
  void touch(args.spaceId);
  return row.id;
});

M("widgets.moveWidget", async ({ id, x, y, z }) => {
  await ent("Widget").update(id, { x, y, ...(z !== undefined ? { z } : {}) });
  return null;
});

M("widgets.resizeWidget", async ({ id, w, h }) => {
  await ent("Widget").update(id, { w, h });
  return null;
});

M("widgets.deleteWidget", async ({ id }) => {
  await ent("Widget").delete(id);
  return null;
});

M("widgets.updateWidgetData", async ({ id, data }) => {
  await ent("Widget").update(id, { data });
  return null;
});

M("widgets.claimItem", async ({ widgetId, itemName, claimantName, claimantUserId }) => {
  const w = await ent("Widget").get(widgetId);
  const items = Array.isArray((w as any).data?.items) ? (w as any).data.items : [];
  const next = items.map((item: any) => {
    if (item.name !== itemName) return item;
    if (item.claimed && item.byUserId === claimantUserId) {
      const { byUserId: _u, by: _b, claimed: _c, ...rest } = item;
      return { ...rest, claimed: false };
    }
    return { ...item, claimed: true, by: claimantName, byUserId: claimantUserId };
  });
  await ent("Widget").update(widgetId, { data: { ...(w as any).data, items: next } });
  return null;
});

M("widgets.spinWheel", async ({ widgetId, spinNonce, resultIndex, spunBy }) => {
  const w = await ent("Widget").get(widgetId);
  await ent("Widget").update(widgetId, {
    data: { ...(w as any).data, spinNonce, resultIndex, spunBy },
  });
  return null;
});

/* ---------------- votes ---------------- */

M("votes.vote", async ({ widgetId, userId, optionId }) => {
  const existing = await ent("Vote").filter({ widgetId, userId });
  if (existing.length) {
    await ent("Vote").update(existing[0].id, { optionId });
    return existing[0].id;
  }
  const row = await ent("Vote").create({ widgetId, userId, optionId });
  return row.id;
});

/* ---------------- messages ---------------- */

M("messages.sendMessage", async (args) => {
  const row = await ent("Message").create({
    spaceId: args.spaceId,
    widgetId: args.widgetId ?? "global",
    userId: args.userId,
    text: args.text,
    createdAt: Date.now(),
    authorName: args.authorName,
    authorColor: args.authorColor,
    authorEmoji: args.authorEmoji,
    authorAvatarUrl: args.authorAvatarUrl,
    promotable: args.promotable ?? true,
  });
  void touch(args.spaceId);
  return row.id;
});

M("messages.promoteMessage", invoke("promoteMessage"));

/* ---------------- check-ins ---------------- */

M("checkIns.log", async ({ widgetId, day, value, userId }) => {
  const w = await ent("Widget").get(widgetId);
  const data = (w as any).data ?? {};
  const log = { ...(data.log ?? {}) };
  log[`${userId}:${day}`] = value;
  await ent("Widget").update(widgetId, { data: { ...data, log } });
  return null;
});

/* ---------------- spaces ---------------- */

M("spaces.createSpace", opInv("spaceOps", "create"));
M("spaces.joinDemoSpace", opInv("spaceOps", "join"));
M("spaces.renameSpace", opInv("spaceOps", "rename"));
M("spaces.deleteSpace", opInv("spaceOps", "delete"));

/* ---------------- waitlist ---------------- */

M("waitlist.join", async ({ email }) => {
  const existing = await ent("Waitlist").filter({ email });
  if (existing.length) return existing[0].id;
  const row = await ent("Waitlist").create({ email });
  return row.id;
});

/* ---------------- auth ---------------- */

M("auth.updateProfile", async (args) => {
  const { name, color, emoji, image } = args;
  await base44.auth.updateMe({
    ...(name ? { full_name: name } : {}),
    color,
    emoji,
    avatar_url: image,
  });
  return null;
});

/* ---------------- leases (your hands on the board — useHolds) ----------------
 * One Lease row per (spaceId, thing, userId); renewed each second by the
 * hook, `until` 3s out, `letGoAt` starts the short grace. The ROW door and
 * every screen read this entity — no actor round-trip needed for holds. */
M("leases.hold", async ({ spaceId, thing, kind, userId, name, color }) => {
  const now = Date.now();
  const existing = await ent("Lease").filter({ spaceId, thing, userId });
  const patch = {
    kind,
    name,
    color,
    since: existing[0]?.since ?? now,
    until: now + 3_000,
    letGoAt: undefined,
    settleAt: now + 1_500,
  };
  if (existing.length) {
    await ent("Lease").update(existing[0].id, patch);
    return existing[0].id;
  }
  const row = await ent("Lease").create({ spaceId, thing, ...patch });
  return row.id;
});

M("leases.letGo", async ({ spaceId, thing, userId }) => {
  const now = Date.now();
  const rows = await ent("Lease").filter({ spaceId, thing, userId });
  for (const row of rows) {
    await ent("Lease").update(row.id, { letGoAt: now, until: now + 600 });
  }
  return null;
});

/* ---------------- Right of Way ---------------- */

M("edits.apply", opInv("rightOfWayDoor", "apply"));
M("edits.undo", opInv("rightOfWayDoor", "undo"));

M("rightOfWay.cancel", async ({ id }) => {
  await ent("PendingWrite").delete(id);
  return null;
});

M("choiceVotes.answer", opInv("rightOfWayDoor", "answer"));

M("choiceVotes.withdraw", async ({ id }) => {
  await ent("ChoiceVote").update(id, { state: "withdrawn" });
  return null;
});

/* ---------------- room brief corrections ---------------- */

M("roomBrief.correct", async ({ spaceId, by, color, change }) => {
  const [row] = await ent("Brief").filter({ spaceId }, "-at", 1);
  if (!row) return null;
  const s = jparse(row.facts, {});
  const said = { text: change.text ?? change.key ?? "", by, color, at: Date.now() };
  const told = Array.isArray(s.told) ? [...s.told] : [];
  const forgot = Array.isArray(s.forgot) ? [...s.forgot] : [];
  if (change.kind === "tell") told.push({ id: crypto.randomUUID(), ...said });
  if (change.kind === "untell") {
    const i = told.findIndex((t: any) => t.id === change.id);
    if (i >= 0) told.splice(i, 1);
  }
  if (change.kind === "forget") forgot.push({ key: change.key, ...said });
  if (change.kind === "restore") {
    const i = forgot.findIndex((f: any) => f.key === change.key);
    if (i >= 0) forgot.splice(i, 1);
  }
  await ent("Brief").update(row.id, { facts: JSON.stringify({ ...s, told, forgot }) });
  return null;
});

/* ---------------- links ---------------- */

M("links.callIt", async ({ id, value }) => {
  await ent("Link").update(id, { resolvedAt: Date.now(), value });
  return null;
});
M("links.cut", async ({ id }) => {
  await ent("Link").update(id, { cutAt: Date.now() });
  return null;
});
M("links.lock", async ({ id }) => {
  await ent("Link").update(id, { resolvedAt: Date.now() });
  return null;
});
M("links.deal", invoke("linkOps"));

/* ---------------- voice build (deal/commit/amend) ---------------- */

M("voiceBuild.commit", opInv("voiceDeal", "commit"));
M("voiceBuild.amend", opInv("voiceDeal", "amend"));
M("voiceBuild.noteLanded", opInv("voiceDeal", "noteLanded"));
A("voiceBuild.deal", opInv("voiceDeal", "deal"));
A("voiceBuild.decide", opInv("voiceDeal", "decide"));
A("voiceBuild.answer", opInv("voiceDeal", "answer"));
A("voiceBuild.warm", async () => ({ status: 200, ms: 0 }));

/* ---------------- ask-the-space stream (P2: mint row; body via function) ---------------- */

M("streaming.createAskStream", async ({ spaceId, question }) => {
  const identity = getIdentity();
  const message = await ent("Message").create({
    spaceId,
    widgetId: "recap",
    userId: identity.userId,
    text: `**${question.trim()}**\n\n…`,
    createdAt: Date.now(),
    authorName: "the space",
    authorColor: "var(--color-ink)",
    promotable: false,
  });
  const streamId = crypto.randomUUID();
  await ent("AskStream").create({ spaceId, streamId, question, messageId: message.id });
  return streamId;
});

/* ---------------- paint / cozy coloring ---------------- */

M("paint.addStroke", async ({ spaceId, widgetId, userId, authorName, authorColor, tone, size, points, regionId, preset }) => {
  const row = await ent("PaintMark").create({
    spaceId,
    widgetId,
    userId: userId ?? getIdentity().userId,
    authorName: authorName ?? getIdentity().name,
    authorColor: authorColor ?? getIdentity().color,
    tone,
    size,
    points,
    regionId,
    preset,
    createdAt: Date.now(),
  });
  return row.id;
});

M("paint.clear", async ({ spaceId, widgetId, regionPrefix }) => {
  const rows = await ent("PaintMark").filter({ spaceId, widgetId });
  const doomed = regionPrefix
    ? rows.filter((r: any) => String(r.regionId ?? "").startsWith(regionPrefix))
    : rows;
  for (const row of doomed) await ent("PaintMark").delete(row.id);
  return doomed.length;
});

M("paint.ensureCozyColorWidget", async ({ spaceId, createdBy }) => {
  const existing = await ent("Widget").filter({ spaceId, type: "cozyColor" });
  if (existing.length) return existing[0].id;
  const row = await ent("Widget").create({
    spaceId,
    type: "cozyColor",
    x: 120,
    y: 140,
    w: 640,
    h: 640,
    z: 1,
    data: { preset: "sunset" },
    createdBy,
    createdAt: Date.now(),
  });
  return row.id;
});

/* ---------------- photos ----------------
 * generateUploadUrl/storageUrl are folded into src/services/base44/uploads.ts
 * (integrations.Core.UploadFile); these remain for call sites that pass a
 * storage id straight through. addPhoto appends to a photoWall widget's
 * `photos` array — the shape the gallery reads. */
M("photos.addPhoto", async ({ spaceId: _spaceId, widgetId, storageId, url, caption, by }) => {
  const w = await ent("Widget").get(widgetId);
  const photos = Array.isArray((w as any).data?.photos) ? (w as any).data.photos : [];
  const photo = { id: crypto.randomUUID(), url: url ?? storageId, caption, by, at: Date.now() };
  await ent("Widget").update(widgetId, { data: { ...(w as any).data, photos: [...photos, photo] } });
  return photo.id;
});
M("photos.storageUrl", async ({ storageId }) => storageId);
M("photos.generateUploadUrl", notPorted("photos.generateUploadUrl"));

/* ---------------- spark questions (conversation starters) ---------------- */

A("questions.sparkQuestions", async () => cannedLinkQuestions(""));

/* ---------------- recaps ---------------- */

A("recap.generate", invoke("dailyRecap"));
A("recap.ask", invoke("voiceDeal"));

/* ---------------- games (P2 — honest not-ported) ---------------- */

for (const name of ["games.start", "games.join", "games.begin", "games.pick", "games.next", "games.react"]) {
  M(name, notPorted(name));
}
for (const name of ["puzzles.start", "puzzles.grab", "puzzles.move", "puzzles.drop"]) {
  M(name, notPorted(name));
}

/* ---------------- external integrations (P1/P2 — honest not-ported) ---------------- */

for (const name of ["firecrawl.scrapeLink", "firecrawl.searchTopic", "firecrawl.crawlSite"]) {
  A(name, notPorted(name));
}
for (const name of ["tavily.readLink", "tavily.planPlace"]) {
  M(name, notPorted(name));
}

/* ---------------- presence: handled by the spaceRoom actor ---------------- */

for (const name of [
  "presence.heartbeat",
  "presence.claimGesture",
  "presence.updateGesture",
  "presence.finishGesture",
  "presence.cancelGesture",
]) {
  M(name, notPorted(`${name} — presence now runs over the spaceRoom actor`));
}

/* ---------------- admin (P2) ---------------- */

for (const name of ["admin.resetToBaseline", "admin.resetAll", "admin.saveBaseline", "admin.setDoor"]) {
  M(name, notPorted(name));
}

/* ---------------- dispatch ---------------- */

export function getMutationImpl(name: string): Impl {
  return mutations.get(name) ?? notPorted(name);
}

export function getActionImpl(name: string): Impl {
  return actions.get(name) ?? notPorted(name);
}
