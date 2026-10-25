// roomBriefRefresh — SKELETON.
//
// Replaces convex/crons.ts "room briefs" (every 10 min) ->
// convex/roomBrief.ts refreshActive: rooms with activity since their brief,
// and each room once a day, get a fresh Brief row — so a voice ask reads one
// stored row instead of the whole board.
import { createClientFromRequest } from "npm:@base44/sdk";

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  // TODO: port convex/roomBrief.ts refresh/refreshActive (~lines 672-750).
  return Response.json({ error: "not implemented — see convex/roomBrief.ts" }, { status: 501 });
});
