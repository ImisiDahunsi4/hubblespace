// voiceDeal — SKELETON.
//
// Replaces convex/voiceBuild.ts: say it → it builds. Split in two so the room
// can start while the asker is still talking:
//   deal   — asks the model for cards, returns them; never writes a widget.
//            Speculative: runs on a phrase that may still grow.
//   commit — takes the cards the asker kept, re-checks each through the Right
//            of Way door, creates them in one shot; entity subscriptions put
//            them on every screen.
//   amend  — rewrites a just-committed card when a late word changed the ask.
//   decide / answer — the A/B "which of these" follow-up paths.
//
// AI routing (port from convex/nebius.ts + convex/ai.ts):
//   primary: NVIDIA Nemotron on Nebius Token Factory (chat_template_kwargs
//            enable_thinking=false — Lightning spends its budget reasoning
//            otherwise). NEBIUS_API_KEY via secrets.get().
//   shared : completeJson() -> JSON | null; EVERY caller degrades to canned
//            output when it returns null. Never fake a success.
//
// The model only decides what a model must decide: code picks actions, places
// cards (placeCards/shortlist in src/lib/deck/), resolves pointers like "the
// people who are coming" to real member names, and the Right of Way door
// checks every write. The model never gets a database handle.
import { createClientFromRequest } from "npm:@base44/sdk";
import { secrets } from "base44:runtime";

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  const nebiusKey = await secrets.get("NEBIUS_API_KEY");
  // TODO: port deal/commit/amend from convex/voiceBuild.ts, vendoring
  // src/lib/deck/* (deckPrompt, dealTurn, applyCard, parseDeal, roomContext,
  // placeCards). Write receipts to the Deal entity; route every widget write
  // through rightOfWayDoor.
  return Response.json({
    error: "not implemented — see convex/voiceBuild.ts and docs/migration/06",
    modelConfigured: Boolean(nebiusKey),
    user: user?.id ?? null,
  }, { status: 501 });
});
