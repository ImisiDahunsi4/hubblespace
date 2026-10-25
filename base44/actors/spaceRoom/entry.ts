// HubbleSpace — spaceRoom actor (SKELETON — not yet functional).
//
// Replaces the Convex hot paths that have no entity equivalent:
//   convex/presence.ts      — ~90ms cursor heartbeats + the gesture object that
//                             doubles as the widget drag lock (claimGesture /
//                             updateGesture / finishGesture)
//   convex/roomPresence.ts  — "who has this space open" occupancy (Rail's ·N here)
//   convex/leases.ts        — Right of Way holds (thing = widgetId | piece:<g>:<i>)
//   convex/rightOfWay.ts    — the one door every AI write passes, which MUST be
//                             serialized against the leases it reads. In Convex
//                             that atomicity came free inside a mutation. Here
//                             the actor is the serializer: it is the single
//                             writer of lease state, so a gate decision and the
//                             commit that follows it cannot interleave with a
//                             competing claim.
//
// One session per space: sessionId = the Space entity id.
// Client: base44.actors.spaceRoom(spaceId).connect()
//
// The pure verdict logic is already platform-free: port
//   src/lib/rightOfWay.ts   (gate: Write + Lease[] -> go|ask|wait|never)
//   src/lib/deck/edits.ts   (applyEdit — finds the people's-choices a write
//                            would override)
// into this directory (or a shared functions lib) unchanged where possible.
// Do NOT reimplement them — the case table in src/lib/rightOfWay.ts is the spec.

import { Actor } from "base44:runtime/actors";

// ---- message shapes (mirroring src/live/presenceTypes.ts + leases) ----

type Seat = { userId: string; name: string; color: string; emoji?: string; avatarUrl?: string };

type Gesture = {
  sessionId: string;
  widgetId: string;
  kind: "move" | "resize";
  x: number; y: number; w: number; h: number; z: number;
  updatedAt: number;
};

type Incoming =
  | { type: "hello"; seat: Seat }                                    // join the room view
  | { type: "cursor"; x: number; y: number; zone?: string }         // ~90ms heartbeat
  | { type: "gesture:claim"; gesture: Gesture }                      // claimGesture — the drag lock
  | { type: "gesture:update"; gesture: Gesture }
  | { type: "gesture:finish"; widgetId: string; rect: { x: number; y: number; w: number; h: number; z: number } } // commit on release
  | { type: "gesture:cancel"; widgetId: string }
  | { type: "lease:hold"; thing: string; kind: "drag" | "type" | "vote" | "piece"; ttlMs: number }
  | { type: "lease:release"; thing: string }
  | { type: "ai:write"; write: unknown };                            // TODO: Replay/AiWrite shape from convex/rightOfWay.ts

type Outgoing =
  | { type: "peers"; peers: { connId: string; seat: Seat; x: number; y: number; zone?: string; gesture?: Gesture }[] }
  | { type: "cursor"; connId: string; seat: Seat; x: number; y: number; zone?: string; gesture?: Gesture }
  | { type: "peer:left"; connId: string }
  | { type: "gesture:denied"; widgetId: string; heldBy: Seat }       // two people can't drag the same card
  | { type: "occupancy"; count: number }
  | { type: "ai:verdict"; writeId: string; verdict: "go" | "ask" | "wait" | "never"; reason?: string; on?: Seat };

// TTLs carried over from convex/presence.ts: presence 30s, gesture 1.5s.
const CURSOR_TTL_MS = 30_000;
const GESTURE_TTL_MS = 1_500;

type PeerState = { seat: Seat; x: number; y: number; zone?: string; gesture?: Gesture; lastSeen: number };

export default class SpaceRoom extends Actor<Incoming, Outgoing> {
  // In-memory only — presence and gestures are ephemeral by design; canonical
  // widget state lives in the Widget entity, not here.
  private peers = new Map<string, PeerState>();
  // Right of Way lease table, keyed by thing. Persisted to this.storage so a
  // room that goes idle mid-hold doesn't let an AI write slip in.
  private leases = new Map<string, { by: Seat; kind: string; since: number; until: number }>();

  tickIntervalMs = 5_000;

  async handleStart() {
    const saved = await this.storage.get<[string, { by: Seat; kind: string; since: number; until: number }][]>("leases");
    this.leases = new Map(saved ?? []);
  }

  handleConnect(conn: { id: string; identity: { type: string; userId?: string; anonymousId?: string }; send: (d: Outgoing) => void; reject: (code: number, reason: string) => void }) {
    // Guests are a complete product — anonymous connections are welcome.
    // Send the joiner the current peer set so cursors/gestures render immediately.
    conn.send({ type: "peers", peers: [...this.peers.entries()].map(([connId, p]) => ({ connId, ...peerPublic(p) })) });
    this.broadcast({ type: "occupancy", count: this.getConnections().length });
  }

  async handleMessage(conn: { id: string; identity: { type: string; userId?: string; anonymousId?: string }; send: (d: Outgoing) => void }, msg: Incoming) {
    // TODO(port): convex/presence.ts semantics —
    //   hello          -> register seat under conn.id
    //   cursor         -> update peers, broadcast {type:"cursor"} to the others
    //   gesture:claim  -> deny if another live peer holds a gesture on widgetId
    //                     (or a lease); else store and echo the gesture to peers
    //   gesture:finish -> clear the gesture AND commit the rect to the Widget
    //                     entity via this.client.asServiceRole.entities.Widget.update
    //                     — the commit lives here so it is ordered after the lock
    //   lease:hold     -> write this.leases + this.storage.put("leases", ...)
    //   ai:write       -> run the ported rightOfWay gate against this.leases,
    //                     ledger to AiWrite entity, then commit/queue/vote per
    //                     verdict (see docs/migration/05-realtime-and-right-of-way.md)
    void conn; void msg;
  }

  handleClose(conn: { id: string }) {
    // A dropped connection releases its cursors AND its gesture — a dead tab
    // must never hold a card hostage (convex/presence.ts disconnect).
    this.peers.delete(conn.id);
    this.broadcast({ type: "peer:left", connId: conn.id });
    this.broadcast({ type: "occupancy", count: this.getConnections().length });
  }

  shouldTick() {
    return this.getConnections().length > 0;
  }

  async handleTick() {
    // Sweep stale cursors/gestures (CURSOR_TTL_MS / GESTURE_TTL_MS) and expired
    // leases; replay PendingWrite ghosts whose holders let go (the landWaiting
    // path from convex/rightOfWay.ts — re-check it still makes sense first).
    const now = Date.now();
    for (const [connId, p] of this.peers) {
      if (now - p.lastSeen > CURSOR_TTL_MS) {
        this.peers.delete(connId);
        this.broadcast({ type: "peer:left", connId });
      }
    }
    let leasesChanged = false;
    for (const [thing, l] of this.leases) {
      if (l.until < now) { this.leases.delete(thing); leasesChanged = true; }
    }
    if (leasesChanged) await this.storage.put("leases", [...this.leases.entries()]);
  }

  async handleWake(key: string) {
    // Scheduled work, e.g. `schedule("pending:<writeId>", ...)` for the 30s
    // PendingWrite drop deadline (WAIT_MS in convex/rightOfWay.ts).
    void key;
  }
}

function peerPublic(p: PeerState) {
  return { seat: p.seat, x: p.x, y: p.y, zone: p.zone, gesture: p.gesture };
}
