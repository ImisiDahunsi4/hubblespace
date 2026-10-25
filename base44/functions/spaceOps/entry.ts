// spaceOps — the auth-sensitive space writes from convex/spaces.ts.
//
//   op:create  → createSpace — the owner comes from the Base44 session when
//                one exists; guests get a `guest:<tabId>` owner stamp so a
//                made room still names its maker (they just can't exercise
//                owner ops until they join — see note below)
//   op:join    → joinDemoSpace — upserts the caller's Member row; the seat
//                is the auth id when signed in, else the client's tab id
//                (never `seed:*` — those stay unclaimable)
//   op:rename  → renameSpace — owner only (AUTH id only; a guest owner
//                can't prove ownership — deliberate, convex effectively
//                required an account too)
//   op:delete  → deleteSpace — owner only; removes the space's rows
//
// Dispatch: { op: "create" | "join" | "rename" | "delete", ...args }

import { createClientFromRequest } from "npm:@base44/sdk";
import { authUserId } from "./_shared/seat.ts";

function slugify(name: string) {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  return stem || "space";
}

/** The slug IS the invite link — it carries entropy, like convex/spaces.ts. */
function randomSuffix() {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const E = (base44 as any).asServiceRole.entities;
  const args = await req.json().catch(() => ({}));
  const op = args.__op ?? args.op;

  if (op === "create") {
    // Rooms are open (convex/spaces.ts OPEN_ROOM_DEPLOYMENTS → openRooms()).
    const authId = await authUserId(base44);
    const ownerId = authId ?? (typeof args.userId === "string" && !args.userId.startsWith("seed:") ? `guest:${args.userId}` : null);
    if (!ownerId) return json({ error: "sign in (or open a room first) to make a space" }, { status: 401 });
    const now = Date.now();
    const slug = `${slugify(String(args.name ?? "space"))}-${randomSuffix()}`;
    const space = await E.Space.create({
      name: String(args.name ?? "space"),
      type: args.type === "event" ? "event" : "ongoing",
      icon: String(args.icon ?? "✦"),
      color: String(args.color ?? "#7c5cff"),
      ...(args.eventAt ? { eventAt: args.eventAt } : {}),
      ownerId,
      slug,
      createdAt: now,
      lastActivityAt: now,
    });
    return json({ spaceId: space.id, slug });
  }

  if (op === "join") {
    const { spaceId } = args;
    if (!spaceId) return json({ error: "spaceId required" }, { status: 400 });
    const space = await E.Space.get(spaceId).catch(() => null);
    if (!space) return json({ error: "no such space" }, { status: 404 });
    // The seat: the auth id when signed in; otherwise the tab's id — the
    // same row the screen joined with before, never a seed persona.
    const authId = await authUserId(base44);
    const userId =
      authId ??
      (typeof args.userId === "string" && !args.userId.startsWith("seed:") ? args.userId : null);
    if (!userId) return json(null);
    const lastSeen = Date.now();
    const existing = await E.Member.filter({ spaceId, userId });
    const fields = {
      name: String(args.name ?? "someone"),
      color: String(args.color ?? "#888"),
      ...(args.emoji ? { emoji: args.emoji } : {}),
      ...(args.avatarUrl ? { avatarUrl: args.avatarUrl } : {}),
      lastSeen,
    };
    if (existing.length) {
      await E.Member.update(existing[0].id, fields);
      return json(existing[0].id);
    }
    const member = await E.Member.create({ spaceId, userId, ...fields });
    return json(member.id);
  }

  if (op === "rename") {
    const authId = await authUserId(base44);
    if (!authId) return json({ error: "sign in to change this space" }, { status: 401 });
    const space = await E.Space.get(args.spaceId).catch(() => null);
    if (!space) return json({ error: "no such space" }, { status: 404 });
    if (!space.ownerId || space.ownerId !== authId)
      return json({ error: "only the person who made this space can change it" }, { status: 403 });
    const patch: Record<string, unknown> = {};
    for (const k of ["name", "tagline", "icon", "color"]) if (args[k] !== undefined) patch[k] = args[k];
    if (Object.keys(patch).length) await E.Space.update(args.spaceId, patch);
    return json(null);
  }

  if (op === "delete") {
    const authId = await authUserId(base44);
    if (!authId) return json({ error: "sign in to delete this space" }, { status: 401 });
    const space = await E.Space.get(args.spaceId).catch(() => null);
    if (!space) return json({ error: "no such space" }, { status: 404 });
    if (!space.ownerId || space.ownerId !== authId)
      return json({ error: "only the person who made this space can delete it" }, { status: 403 });
    // Everything hanging off it, like deleteSpaceBySlug.
    for (const name of [
      "Widget", "Member", "Vote", "Message", "PaintMark", "Lease", "Presence",
      "AiWrite", "PendingWrite", "ChoiceVote", "Link", "Brief", "Recap",
      "Deal", "AskStream", "Game", "GameRound", "GamePlayer", "GameAnswer",
      "PuzzlePiece", "Award", "InboundMessage", "EmailEvent", "WebhookEvent",
      "WorkLog", "Crawl", "CrawlPage", "LinkRefreshQueue",
    ]) {
      const rows = await E[name].filter({ spaceId: args.spaceId }).catch(() => []);
      for (const row of rows) await E[name].delete(row.id).catch(() => {});
    }
    await E.Space.delete(args.spaceId);
    return json(null);
  }

  return json({ error: `unknown op: ${op}` }, { status: 400 });
});
