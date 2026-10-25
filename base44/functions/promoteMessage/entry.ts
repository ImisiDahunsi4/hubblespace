// promoteMessage — the demo climax: one chat row becomes a canvas card.
// Port of convex/messages.ts promoteMessage.
//
//   seat check (a seat in this room, from the session or the join row)
//   → message must belong to this space (a chat id from another room is
//     refused — listBySpace is public, so without this anyone could plant a
//     decision on any canvas)
//   → dedupe by promotedFromMessageId
//   → insert the decision widget above everything

import { createClientFromRequest } from "npm:@base44/sdk";
import { seatOf } from "./_shared/seat.ts";

const json = (body: unknown, status = 200) => Response.json(body, { status });

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const E = (base44 as any).asServiceRole.entities;
  const { messageId, spaceId, x, y, userId } = await req.json().catch(() => ({}));

  const me = await seatOf(base44, spaceId, userId);
  if (!me) return json(null);

  const message = await E.Message.get(messageId).catch(() => null);
  if (!message || message.spaceId !== spaceId) return json(null);

  const widgets = await E.Widget.filter({ spaceId });
  const existing = widgets.find(
    (w: any) => w.type === "decision" && w.data?.promotedFromMessageId === messageId,
  );
  if (existing) return json(existing.id);

  const now = Date.now();
  const highestZ = widgets.reduce((h: number, w: any) => Math.max(h, w.z ?? 0), 0);
  const widget = await E.Widget.create({
    spaceId,
    type: "decision",
    x: x ?? 120,
    y: y ?? 120,
    w: 280,
    h: 190,
    z: highestZ + 1,
    data: {
      title: "decision made",
      detail: message.text,
      author: message.authorName,
      source: "promoted from chat",
      tone: "lime",
      promotedFromMessageId: messageId,
    },
    createdBy: me.userId,
    createdAt: now,
  });
  await E.Space.update(spaceId, { lastActivityAt: now }).catch(() => {});
  return json(widget.id);
});
