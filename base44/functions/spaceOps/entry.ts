// spaceOps — SKELETON.
//
// Replaces the auth-sensitive parts of convex/spaces.ts:
//   createSpace  — registered users only; stamps ownerId from the session,
//                  never from args; creates starter cards before the maker
//                  passes the gate (seatOrMaker)
//   renameSpace / deleteSpace — owner only
//   joinSpace    — upserts the caller's Member row (by_space_user)
//   roomsOpen / listMine / getBySlug
//
// Server-side rules that must survive the port:
//   - ownerId comes from base44.auth.me(), never the request body
//   - "no ownerId" on a showcase space means rename/delete is refused
//   - Member rows keep userId as a string (Base44 user id OR 'seed:*')
import { createClientFromRequest } from "npm:@base44/sdk";

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  // TODO: port from convex/spaces.ts (lines ~183-467) and convex/seat.ts.
  return Response.json({ error: "not implemented — see convex/spaces.ts", user: user?.id ?? null }, { status: 501 });
});
