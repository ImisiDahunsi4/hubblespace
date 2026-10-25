/**
 * Room channel — the client's end of the `spaceRoom` actor session.
 *
 * Replaces convex/presence.ts + the @convex-dev/presence occupancy hook:
 *   - cursor heartbeats   → {type:"presence"}
 *   - drag gestures       → gesture:claim / update / finish / cancel, with
 *                         claim/finish/cancel as request→reply (reqId)
 *   - peers snapshots     → {type:"peers", rows} broadcasts land in
 *                         `peersListeners`, which feeds BOTH the usePresence
 *                         hook and the `presence.listHereNow` query impl
 *   - occupancy           → {type:"occupancy", count}
 *
 * The SDK queues sends until the socket opens, so callers send immediately.
 */
import { base44 } from "./client";
import type { Connection } from "@base44/sdk";

export type PresenceRow = {
  userId: string;
  name: string;
  color: string;
  emoji?: string;
  avatarUrl?: string;
  x: number;
  y: number;
  zone?: string;
  updatedAt: number;
  gesture?: {
    sessionId: string;
    widgetId: string;
    kind: "move" | "resize";
    x: number; y: number; w: number; h: number; z: number;
    updatedAt: number;
  };
};

type Reply = { reqId: string; result: unknown };

const REPLY_TIMEOUT_MS = 5_000;

type Channel = {
  conn: Connection | null;
  peersRows: PresenceRow[];
  occupancy: number;
  peersListeners: Set<() => void>;
  occupancyListeners: Set<(count: number) => void>;
  pending: Map<string, (result: unknown) => void>;
  refs: number;
};

const channels = new Map<string, Channel>();

function openChannel(spaceId: string): Channel {
  let ch = channels.get(spaceId);
  if (ch) {
    ch.refs += 1;
    return ch;
  }
  ch = {
    conn: null,
    peersRows: [],
    occupancy: 0,
    peersListeners: new Set(),
    occupancyListeners: new Set(),
    pending: new Map(),
    refs: 1,
  };
  channels.set(spaceId, ch);

  try {
    const conn = (base44.actors as any).spaceRoom(spaceId).connect();
    ch.conn = conn;
    conn.subscribe((msg: any) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "peers") {
        ch!.peersRows = Array.isArray(msg.rows) ? msg.rows : [];
        for (const l of ch!.peersListeners) l();
      } else if (msg.type === "occupancy") {
        ch!.occupancy = msg.count ?? 0;
        for (const l of ch!.occupancyListeners) l(ch!.occupancy);
      } else if (msg.type === "reply") {
        const r = msg as unknown as Reply;
        const resolve = ch!.pending.get(r.reqId);
        if (resolve) {
          ch!.pending.delete(r.reqId);
          resolve(r.result);
        }
      }
    });
  } catch (err) {
    console.warn("[hubble] spaceRoom actor unavailable — presence is read-only", err);
  }
  return ch;
}

/** Increment the channel's ref count; call the returned release on unmount. */
export function joinRoom(spaceId: string): { release: () => void } {
  const ch = openChannel(spaceId);
  return {
    release: () => {
      ch.refs -= 1;
      if (ch.refs <= 0) {
        channels.delete(spaceId);
        try {
          ch.conn?.close();
        } catch {
          /* already closed */
        }
      }
    },
  };
}

function send(spaceId: string, msg: Record<string, unknown>) {
  const ch = channels.get(spaceId);
  if (!ch?.conn) return;
  try {
    ch.conn.send(msg as any);
  } catch {
    /* socket dropped; presence is best-effort */
  }
}

function call(spaceId: string, msg: Record<string, unknown>): Promise<unknown> {
  const ch = channels.get(spaceId);
  if (!ch?.conn) return Promise.resolve(undefined);
  const reqId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      ch.pending.delete(reqId);
      resolve(undefined);
    }, REPLY_TIMEOUT_MS);
    ch.pending.set(reqId, (result) => {
      window.clearTimeout(timer);
      resolve(result);
    });
    try {
      ch.conn!.send({ ...msg, reqId } as any);
    } catch {
      window.clearTimeout(timer);
      ch.pending.delete(reqId);
      resolve(undefined);
    }
  });
}

/* ---------------- usePresence-facing API ---------------- */

export function sendPresence(spaceId: string, payload: Record<string, unknown>) {
  send(spaceId, { type: "presence", ...payload });
}

export function claimGesture(spaceId: string, payload: Record<string, unknown>) {
  return call(spaceId, { type: "gesture:claim", ...payload }) as Promise<
    | { accepted: true }
    | { accepted: false; reason: "locked" | "missing"; owner?: { userId: string; name: string; color: string } }
    | undefined
  >;
}

export function updateGesture(spaceId: string, payload: Record<string, unknown>) {
  send(spaceId, { type: "gesture:update", ...payload });
}

export function finishGesture(spaceId: string, payload: Record<string, unknown>) {
  return call(spaceId, { type: "gesture:finish", ...payload }) as Promise<boolean | undefined>;
}

export function cancelGesture(spaceId: string, payload: Record<string, unknown>) {
  return call(spaceId, { type: "gesture:cancel", ...payload }) as Promise<boolean | undefined>;
}

/* ---------------- snapshot feeds ---------------- */

export function peersRows(spaceId: string): PresenceRow[] {
  return channels.get(spaceId)?.peersRows ?? [];
}

export function onPeers(spaceId: string, listener: () => void): () => void {
  const ch = openChannel(spaceId);
  ch.peersListeners.add(listener);
  return () => {
    ch.peersListeners.delete(listener);
    ch.refs -= 1;
    if (ch.refs <= 0) {
      channels.delete(spaceId);
      try {
        ch.conn?.close();
      } catch {
        /* already closed */
      }
    }
  };
}

export function onOccupancy(spaceId: string, listener: (count: number) => void): () => void {
  const ch = openChannel(spaceId);
  ch.occupancyListeners.add(listener);
  listener(ch.occupancy);
  return () => {
    ch.occupancyListeners.delete(listener);
    ch.refs -= 1;
    if (ch.refs <= 0) {
      channels.delete(spaceId);
      try {
        ch.conn?.close();
      } catch {
        /* already closed */
      }
    }
  };
}
