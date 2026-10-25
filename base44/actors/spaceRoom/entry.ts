// HubbleSpace — spaceRoom actor.
//
// The single serializer for the hot realtime path that has no entity
// equivalent — a 1:1 port of convex/presence.ts + convex/roomPresence.ts:
//
//   presence heartbeats  (~50ms cursor writes, 30s TTL)
//   drag gestures        (claim / update / finish / cancel — the widget
//                         drag lock; finishGesture commits the rect to the
//                         Widget entity so the write is ordered after the
//                         lock, exactly like the Convex mutation did)
//   occupancy            (who has this room open, for the rail count)
//
// One session per space: instanceId = the Space entity id.
// Client: src/services/base44/roomChannel.ts (base44.actors.spaceRoom(id)).
//
// Right of Way leases still ride the Lease entity (convex/leases.ts parity)
// because every screen reads them via query — the rightOfWayDoor function
// is the gate. See docs/migration/05-realtime-and-right-of-way.md.

import { Actor } from "base44:runtime/actors";

type Seat = { userId: string; name: string; color: string; emoji?: string; avatarUrl?: string };

type Gesture = {
  sessionId: string;
  widgetId: string;
  kind: "move" | "resize";
  x: number; y: number; w: number; h: number; z: number;
  updatedAt: number;
};

type PeerRow = Seat & {
  x: number; y: number;
  zone?: string;
  updatedAt: number;
  gesture?: Gesture;
};

type Conn = {
  id: string;
  identity: { type: string; userId?: string; anonymousId?: string };
  send: (d: any) => void;
  reject: (code: number, reason: string) => void;
};

const CURSOR_TTL_MS = 30_000;
const GESTURE_TTL_MS = 1_500;
const CLAIM_STALE_MS = 3_000;

export default class SpaceRoom extends Actor {
  // Presence is ephemeral by design — in-memory only, like the Convex
  // presence table's 30s TTL made it in practice.
  private peers = new Map<string, PeerRow>(); // keyed by userId (the tab id)
  private connUser = new Map<string, string>(); // conn.id -> userId
  private dirty = false;

  tickIntervalMs = 1_000;

  handleConnect(conn: Conn) {
    conn.send({ type: "peers", rows: this.rows() });
    conn.send({ type: "occupancy", count: this.getConnections().length });
  }

  async handleMessage(conn: Conn, msg: any) {
    const now = Date.now();
    switch (msg?.type) {
      case "presence": {
        if (typeof msg.userId !== "string") return;
        this.connUser.set(conn.id, msg.userId);
        const prev = this.peers.get(msg.userId);
        this.peers.set(msg.userId, {
          userId: msg.userId,
          name: msg.name ?? "someone",
          color: msg.color ?? "#888",
          ...(msg.emoji ? { emoji: msg.emoji } : {}),
          ...(msg.avatarUrl ? { avatarUrl: msg.avatarUrl } : {}),
          x: msg.x ?? -1e9,
          y: msg.y ?? -1e9,
          ...(msg.zone ? { zone: msg.zone } : {}),
          updatedAt: now,
          ...(prev?.gesture ? { gesture: prev.gesture } : {}),
        });
        this.dirty = true;
        return;
      }

      case "gesture:claim": {
        // Port of convex/presence.ts claimGesture. Arbitration lives at the
        // two edges that persist something: claim and finish. In-between
        // updates never re-check — matching the OCC-conflict fix the Convex
        // mutation made for the same reason.
        const reply = (result: unknown) =>
          conn.send({ type: "reply", reqId: msg.reqId, result });
        if (typeof msg.userId !== "string" || typeof msg.widgetId !== "string") {
          return reply({ accepted: false, reason: "missing" });
        }
        this.connUser.set(conn.id, msg.userId);

        let widgetOk = false;
        try {
          const w = await (this.client as any).asServiceRole.entities.Widget.get(msg.widgetId);
          widgetOk = Boolean(w) && String(w.spaceId) === String(msg.spaceId ?? this.instanceId);
        } catch {
          widgetOk = false;
        }
        if (!widgetOk) return reply({ accepted: false, reason: "missing" });

        const owner = [...this.peers.values()]
          .filter(
            (p) =>
              p.userId !== msg.userId &&
              p.gesture?.widgetId === msg.widgetId &&
              now - p.gesture.updatedAt < GESTURE_TTL_MS,
          )
          .sort(
            (a, b) =>
              (b.gesture!.updatedAt - a.gesture!.updatedAt) ||
              a.userId.localeCompare(b.userId),
          )[0];

        this.touchPeer(msg, now);
        if (owner) {
          this.dirty = true;
          return reply({
            accepted: false,
            reason: "locked",
            owner: { userId: owner.userId, name: owner.name, color: owner.color },
          });
        }

        this.setGesture(msg, now);
        this.dirty = true;
        return reply({ accepted: true });
      }

      case "gesture:update": {
        const p = msg.userId && this.peers.get(msg.userId);
        if (
          !p?.gesture ||
          p.gesture.sessionId !== msg.sessionId ||
          p.gesture.widgetId !== msg.widgetId ||
          now - p.gesture.updatedAt >= GESTURE_TTL_MS
        ) {
          if (p?.gesture?.sessionId === msg.sessionId) {
            delete p.gesture;
            this.dirty = true;
          }
          return;
        }
        this.touchPeer(msg, now);
        this.setGesture(msg, now);
        this.dirty = true;
        return;
      }

      case "gesture:finish": {
        const reply = (result: unknown) =>
          conn.send({ type: "reply", reqId: msg.reqId, result });
        const p = msg.userId && this.peers.get(msg.userId);
        const competing = [...this.peers.values()].some(
          (q) =>
            q.userId !== msg.userId &&
            q.gesture?.widgetId === msg.widgetId &&
            now - q.gesture.updatedAt < GESTURE_TTL_MS,
        );
        if (
          !p?.gesture ||
          p.gesture.sessionId !== msg.sessionId ||
          p.gesture.widgetId !== msg.widgetId ||
          now - p.gesture.updatedAt >= GESTURE_TTL_MS ||
          competing
        ) {
          if (p?.gesture?.sessionId === msg.sessionId) {
            delete p.gesture;
            this.dirty = true;
          }
          return reply(false);
        }

        try {
          const entities = (this.client as any).asServiceRole.entities;
          const w = await entities.Widget.get(msg.widgetId);
          if (!w || String(w.spaceId) !== String(msg.spaceId ?? this.instanceId)) {
            delete p.gesture;
            this.dirty = true;
            return reply(false);
          }
          // The commit is ordered after the lock check — the whole reason
          // the drop used to run inside the same Convex mutation.
          await entities.Widget.update(msg.widgetId, {
            x: msg.x, y: msg.y, w: msg.w, h: msg.h, z: msg.z,
          });
          await entities.Space.update(String(msg.spaceId ?? this.instanceId), {
            lastActivityAt: now,
          }).catch(() => {});
        } catch {
          delete p.gesture;
          this.dirty = true;
          return reply(false);
        }

        this.touchPeer(msg, now);
        delete p.gesture;
        this.dirty = true;
        return reply(true);
      }

      case "gesture:cancel": {
        const reply = (result: unknown) =>
          conn.send({ type: "reply", reqId: msg.reqId, result });
        const p = msg.userId && this.peers.get(msg.userId);
        if (!p?.gesture || p.gesture.sessionId !== msg.sessionId) return reply(false);
        delete p.gesture;
        p.updatedAt = now;
        this.dirty = true;
        return reply(true);
      }
    }
  }

  handleClose(conn: Conn) {
    const userId = this.connUser.get(conn.id);
    this.connUser.delete(conn.id);
    if (userId) {
      // A dropped connection releases its cursors AND its gesture — a dead
      // tab must never hold a card hostage.
      this.peers.delete(userId);
      this.dirty = true;
    }
    this.broadcast({ type: "occupancy", count: this.getConnections().length });
  }

  shouldTick() {
    return this.getConnections().length > 0;
  }

  async handleTick() {
    const now = Date.now();
    for (const [userId, p] of this.peers) {
      if (now - p.updatedAt > CURSOR_TTL_MS) {
        this.peers.delete(userId);
        this.dirty = true;
        continue;
      }
      // A gesture whose updates stopped (held-still past GESTURE_TTL_MS or a
      // dead tab) drops the lock, same as the Convex freshness check.
      if (p.gesture && now - p.gesture.updatedAt > CLAIM_STALE_MS) {
        delete p.gesture;
        this.dirty = true;
      }
    }
    if (this.dirty) {
      this.dirty = false;
      this.broadcast({ type: "peers", rows: this.rows() });
    }
  }

  private touchPeer(msg: any, now: number) {
    const prev = this.peers.get(msg.userId);
    this.peers.set(msg.userId, {
      userId: msg.userId,
      name: msg.name ?? prev?.name ?? "someone",
      color: msg.color ?? prev?.color ?? "#888",
      ...(msg.emoji ?? prev?.emoji ? { emoji: msg.emoji ?? prev?.emoji } : {}),
      ...(msg.avatarUrl ?? prev?.avatarUrl
        ? { avatarUrl: msg.avatarUrl ?? prev?.avatarUrl }
        : {}),
      x: msg.cursorX ?? prev?.x ?? -1e9,
      y: msg.cursorY ?? prev?.y ?? -1e9,
      ...(prev?.zone ? { zone: prev.zone } : {}),
      updatedAt: now,
      ...(prev?.gesture ? { gesture: prev.gesture } : {}),
    });
  }

  private setGesture(msg: any, now: number) {
    const p = this.peers.get(msg.userId);
    if (!p) return;
    p.gesture = {
      sessionId: msg.sessionId,
      widgetId: msg.widgetId,
      kind: msg.kind,
      x: msg.x, y: msg.y, w: msg.w, h: msg.h, z: msg.z,
      updatedAt: now,
    };
  }

  private rows(): PeerRow[] {
    const now = Date.now();
    return [...this.peers.values()]
      .filter((p) => now - p.updatedAt <= CURSOR_TTL_MS)
      .map((p) => ({
        ...p,
        ...(p.gesture && now - p.gesture.updatedAt > CLAIM_STALE_MS
          ? { gesture: undefined }
          : {}),
      }));
  }
}
