// dailyRecap — SKELETON.
//
// Replaces convex/crons.ts "catch me up" (15:00 UTC) -> convex/recap.ts
// generateAll/generateOne. snapshot() turns each space into a compact digest;
// the model writes 2–4 lines under 18 words each, lowercase, each citing a
// real widgetId/messageId. Canned fallbacks (cannedRecap/cannedPollLine/
// cannedPotluckLine) must survive — the demo survives an AI outage.
// Bounded fan-out (was workpool maxParallelism 3): batch spaces sequentially
// or in small groups.
import { createClientFromRequest } from "npm:@base44/sdk";

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  // TODO: port snapshot() + generateAll from convex/recap.ts (~lines 299-540).
  return Response.json({ error: "not implemented — see convex/recap.ts" }, { status: 501 });
});
