// linkRefreshSweep — SKELETON.
//
// Replaces convex/crons.ts "refresh stale links" (Fri 17:00 UTC) ->
// convex/batch.ts enqueueStaleLinkRefresh + processBatch: drains
// LinkRefreshQueue rows a few at a time back through the cached/retried
// Firecrawl scraper (convex/batch.ts applyRefresh patches the linkCard).
import { createClientFromRequest } from "npm:@base44/sdk";

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  // TODO: port convex/batch.ts — enqueue stale linkCards, then drain the
  // queue (LinkRefreshQueue ordered by queuedAt; Convex used a commit-ts
  // cursor — use queuedAt ms).
  return Response.json({ error: "not implemented — see convex/batch.ts" }, { status: 501 });
});
