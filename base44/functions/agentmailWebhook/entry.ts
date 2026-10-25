// agentmailWebhook — SKELETON.
//
// Replaces convex/http.ts POST /api/agentmail/webhook:
//   inbound email -> svix HMAC verify (hand-rolled WebCrypto, port it
//   verbatim — see b64ToBytes/svixVerified in convex/http.ts) -> dedup via
//   WebhookEvent entity -> store InboundMessage -> invoke inboundRouter ->
//   reply in-thread + label (AgentMail REST).
//
// Secrets: AGENTMAIL_WEBHOOK_SECRET, AGENTMAIL_API_KEY (secrets.get).
// The svix check signs `${svix-id}.${svix-timestamp}.${raw body}` with the
// base64 secret after `whsec_` and compares to the `v1,` signatures.
// When AGENTMAIL_WEBHOOK_SECRET is unset the original accepted the request
// (dev convenience) — decide whether to keep that.
import { createClientFromRequest } from "npm:@base44/sdk";
import { secrets } from "base44:runtime";

Deno.serve(async (req) => {
  const _base44 = createClientFromRequest(req);
  const secret = await secrets.get("AGENTMAIL_WEBHOOK_SECRET");
  // TODO: port svixVerified + ingestWebhook + processInbound chain.
  return Response.json({ error: "not implemented — see convex/http.ts + convex/agentmail.ts", secretConfigured: Boolean(secret) }, { status: 501 });
});
