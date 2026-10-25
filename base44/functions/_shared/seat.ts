// seat.ts — port of convex/seat.ts over Base44 entities.
//
// A "seat" is the caller's Member row in the space. Convex derived it from
// the auth session only; Base44 has no anonymous accounts, so the seat
// falls back to the Member row the client-side join (spaceOps join) made
// for this tab's identity — never for `seed:*` ids, which are showcase
// cast and must stay unclaimable.
//
// Identity rules that must hold:
//   - an authenticated Base44 user's seat is THEIR auth id, always
//   - a guest's seat is their tab id's Member row (created by join)
//   - nothing honours a client-supplied `seed:*` seat
//   - rename/delete and other owner ops use the auth id only

export type Seat = {
  userId: string;
  name: string;
  color: string;
  emoji?: string;
  avatarUrl?: string;
};

type Client = {
  auth: { me(): Promise<{ id: string; full_name?: string | null } | null> };
  asServiceRole: { entities: Record<string, any> };
};

/** The verified caller id: the Base44 session, else null. */
export async function authUserId(base44: Client): Promise<string | null> {
  try {
    const me = await base44.auth.me();
    return me?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * The caller's seat in the space. `claimedUserId` is the client-supplied
 * identity used only when there is no Base44 session — the seat still has
 * to exist as a Member row (join made it), so a forged id finds nothing.
 */
export async function seatOf(
  base44: Client,
  spaceId: string,
  claimedUserId?: string,
): Promise<Seat | null> {
  const authId = await authUserId(base44);
  const userId = authId ?? claimedUserId;
  if (!userId || userId.startsWith("seed:")) return null;
  const rows = await base44.asServiceRole.entities.Member.filter({ spaceId, userId });
  const row = rows[0];
  return row
    ? {
        userId: row.userId,
        name: row.name,
        color: row.color,
        emoji: row.emoji,
        avatarUrl: row.avatarUrl,
      }
    : null;
}

/** seatOrMaker: the caller's seat, or the room's maker before they've walked in. */
export async function seatOrMaker(
  base44: Client,
  spaceId: string,
  claimedUserId?: string,
): Promise<Seat | null> {
  const seat = await seatOf(base44, spaceId, claimedUserId);
  if (seat) return seat;
  const authId = await authUserId(base44);
  if (!authId) return null;
  const space = await base44.asServiceRole.entities.Space.get(spaceId).catch(() => null);
  if (!space?.ownerId || space.ownerId !== authId) return null;
  const me = await base44.auth.me().catch(() => null);
  return { userId: authId, name: me?.full_name ?? "", color: "" };
}

/** canRead: members always; ownerless showcase spaces are open; owned spaces need a seat or the maker. */
export async function canRead(
  base44: Client,
  spaceId: string,
  claimedUserId?: string,
): Promise<boolean> {
  if (await seatOf(base44, spaceId, claimedUserId)) return true;
  const space = await base44.asServiceRole.entities.Space.get(spaceId).catch(() => null);
  if (!space) return false;
  if (!space.ownerId) return true;
  return (await seatOrMaker(base44, spaceId, claimedUserId)) !== null;
}
