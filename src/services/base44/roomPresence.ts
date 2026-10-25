/**
 * `useRoomPresence` — drop-in for @convex-dev/presence.
 *
 * The occupancy path (the rail's "·N here" count) rides the Presence
 * entity, not the actor: a row per tab keyed (spaceId, userId), refreshed
 * on `intervalMs`, swept by the `roomPresence.onlineForSpace` query's 30s
 * cutoff. Entity rows survive an actor restart; the row is deleted on
 * unmount so a closed tab drops out immediately.
 */
import { useEffect } from "react";
import { ent } from "./impl/entities";
import { getIdentity } from "../../live/identity";

export function useRoomPresence(
  _api: unknown,
  roomId: string,
  userId: string,
  intervalMs: number,
) {
  useEffect(() => {
    if (!roomId || !userId) return;
    let rowId: string | null = null;
    let cancelled = false;

    const beat = async () => {
      try {
        if (rowId) {
          await ent("Presence").update(rowId, { updatedAt: Date.now() });
          return;
        }
        const rows = userId ? await ent("Presence").filter({ spaceId: roomId, userId }) : [];
        if (cancelled) return;
        if (rows.length) {
          rowId = rows[0].id;
          await ent("Presence").update(rows[0].id, { updatedAt: Date.now() });
        } else {
          // Presence requires x, y, name, color — NO_POINTER + the tab's identity.
          const me = getIdentity();
          const row = await ent("Presence").create({
            spaceId: roomId,
            userId,
            x: -1,
            y: -1,
            name: me.name,
            color: me.color,
            emoji: me.emoji,
            avatarUrl: me.avatarUrl,
            updatedAt: Date.now(),
          });
          if (!cancelled) rowId = row.id;
        }
      } catch {
        // Occupancy is best-effort — a missed beat just drops the count later.
      }
    };

    void beat();
    const timer = window.setInterval(() => {
      if (!document.hidden) void beat();
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (rowId) void ent("Presence").delete(rowId).catch(() => {});
    };
  }, [roomId, userId, intervalMs]);
}

export default useRoomPresence;
