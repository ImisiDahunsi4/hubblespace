// weeklyDigest — SKELETON.
//
// Replaces convex/crons.ts "weekly digest" (Fri 16:00 UTC) ->
// convex/digest.ts weekly: each space emails its week to everyone who has
// ever emailed its inbox. Was a durable workflow (recipients -> board
// snapshot -> compose -> send, retried per step). On Base44, keep the steps
// idempotent so a re-run doesn't double-send: log DigestComplete-style rows
// (convex/digest.ts logDigestComplete) and check before sending.
// Rate limit: AgentMail free tier ~10/hour was the mailSend bucket.
import { createClientFromRequest } from "npm:@base44/sdk";

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  // TODO: port convex/digest.ts (recipients -> composeDigestText -> sendEmail).
  return Response.json({ error: "not implemented — see convex/digest.ts" }, { status: 501 });
});
