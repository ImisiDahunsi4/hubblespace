// rightOfWayDoor — SKELETON.
//
// Replaces convex/rightOfWay.ts: the one door every AI write passes.
// Reads live holds, asks the pure gate (src/lib/rightOfWay.ts — vendor it into
// ../_shared/), returns go | ask | wait | never and records the AiWrite ledger
// row. In Convex the check and the commit were atomic inside one mutation.
// On Base44 there are no cross-entity transactions, so serialization comes
// from the spaceRoom actor (the single writer of lease state). This function
// is the entry point for callers that are NOT inside a room session
// (e.g. the inbound mail router); it should route the decision through the
// actor session for that space so it cannot race a live lease.
//
// Contract (from convex/rightOfWay.ts):
//   in:  AiWrite { kind, spaceId, widgetId?, thing?, by{ name, userId? },
//                  fields[{field, old, new}], text?, undo?, rect?, choice?,
//                  consented?, refused?, finishes?, replay? }
//   out: Door   { verdict, reason, writeId, on?, onThing?, pendingId?, who?, stake? }
//
// - "wait"  -> create PendingWrite row (the ghost); actor replays on release
// - "ask"   -> create ChoiceVote row riding the card; a passed vote resends
//              the write with `consented` set
// - "never" -> ledger row only; caller places elsewhere / drops
import { createClientFromRequest } from "npm:@base44/sdk";

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  // TODO: verify the caller's seat in the space (port seatOf — identity from
  // auth, never from args), read leases from the spaceRoom actor (or the
  // Lease entity fallback), run the vendored gate, write the AiWrite row,
  // and answer the Door shape above.
  return Response.json({ error: "not implemented — see convex/rightOfWay.ts and docs/migration/05", user: user?.id ?? null }, { status: 501 });
});
