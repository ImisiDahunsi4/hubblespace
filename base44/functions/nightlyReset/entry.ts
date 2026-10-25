// nightlyReset — SKELETON.
//
// Replaces convex/crons.ts "nightly room reset" (07:00 UTC) ->
// convex/admin.ts nightlyReset. Every room with a saved Baseline row returns
// to its baseline snapshot. Rooms without a baseline are skipped, never
// wiped. Members, the AgentMail inbox and ownership are never touched
// (docs/local/admin-reset.md in the source repo).
import { createClientFromRequest } from "npm:@base44/sdk";

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  // Automations run service-side; use asServiceRole after confirming the
  // caller is the scheduler, then port convex/admin.ts resetToBaseline.
  return Response.json({ error: "not implemented — see convex/admin.ts" }, { status: 501 });
});
