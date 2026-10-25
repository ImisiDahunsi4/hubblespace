// promoteMessage — SKELETON.
//
// Replaces convex/messages.ts promoteMessage: the crew demo's climax — a chat
// line ("6pm works") becomes a real note widget on the board. Reads the
// Message row, creates a widget of type "note" with promoted:true, patches
// the message's promotedWidgetId, all attributed to the caller's seat.
import { createClientFromRequest } from "npm:@base44/sdk";

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  // TODO: port from convex/messages.ts (~line 97). Verify the caller is a
  // member of the message's space before writing.
  return Response.json({ error: "not implemented — see convex/messages.ts" }, { status: 501 });
});
