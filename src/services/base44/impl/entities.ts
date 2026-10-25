/**
 * Entity helpers shared by the query impls.
 *
 * Every impl follows the same shape: produce a value from entities, then
 * re-produce it whenever any entity it reads emits a change event. That is
 * the Base44 equivalent of a Convex reactive query.
 */
import { base44 } from "../client";
import type { QueryImpl } from "../store";

type EntityApi<T> = {
  list(sort?: string, limit?: number, skip?: number): Promise<T[]>;
  filter(query: Record<string, any>, sort?: string, limit?: number, skip?: number): Promise<T[]>;
  get(id: string): Promise<T>;
  create(data: Partial<T>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T>;
  delete(id: string): Promise<{ success: boolean }>;
  deleteMany(query: Partial<T>): Promise<{ deleted: number }>;
  bulkCreate(data: Partial<T>[]): Promise<T[]>;
  updateMany(query: Partial<T>, data: Record<string, any>): Promise<{ updated: number; has_more: boolean }>;
  subscribe(cb: (event: { type: string; data: T }) => void): () => void;
};

/** Anonymous traffic shares a 70-req/min pool per app — honor Retry-After
 * instead of leaving the board on skeletons forever. */
function retryAfterMs(err: any): number | null {
  if (err?.status !== 429) return null;
  const msg = String(err?.data?.message ?? err?.message ?? "");
  const match = /Retry after (\d+)s/i.exec(msg);
  return (match ? Number(match[1]) * 1000 : 15_000) + 500;
}

async function withRetry<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const wait = retryAfterMs(err);
    if (wait === null || attempt >= 4) throw err;
    await new Promise((r) => setTimeout(r, wait));
    return withRetry(fn, attempt + 1);
  }
}

/** Anonymous reads share one 70-req/min pool per app+IP. Every watched query
 * refires on each entity event, and several queries read the same rows — so
 * identical reads inside a 2s window share one request. */
const readCache = new Map<string, { at: number; promise: Promise<any> }>();
const READ_TTL_MS = 2000;

function cachedRead<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = readCache.get(key);
  if (hit && Date.now() - hit.at < READ_TTL_MS) return hit.promise;
  const promise = fn();
  readCache.set(key, { at: Date.now(), promise });
  promise.catch(() => readCache.delete(key));
  return promise;
}

export function ent<T = any>(name: string): EntityApi<T> {
  const api = base44.entities[name] as EntityApi<T>;
  return {
    ...api,
    list: (...a) => cachedRead(`l:${name}:${JSON.stringify(a)}`, () => withRetry(() => api.list(...a))),
    filter: (...a) => cachedRead(`f:${name}:${JSON.stringify(a)}`, () => withRetry(() => api.filter(...a))),
    get: (id) => cachedRead(`g:${name}:${id}`, () => withRetry(() => api.get(id))),
    create: (d) => withRetry(() => api.create(d)),
    update: (id, d) => withRetry(() => api.update(id, d)),
    delete: (id) => withRetry(() => api.delete(id)),
    deleteMany: (q) => withRetry(() => api.deleteMany(q)),
    bulkCreate: (d) => withRetry(() => api.bulkCreate(d)),
    updateMany: (q, d) => withRetry(() => api.updateMany(q, d)),
  };
}

/** Base44 rows carry `id`; the codebase was written against Convex's `_id`. Normalize once at the boundary. */
export function withId<T extends { id?: string }>(row: T): T & { _id: string } {
  return { ...row, _id: row.id as string };
}

export function withIds<T extends { id?: string }>(rows: T[]): (T & { _id: string })[] {
  return rows.map(withId);
}

/** "spaces" → "Space"; table segment of an impl name → Base44 entity. */
export function resolveEntityName(segment: string): string {
  const explicit: Record<string, string> = {
    spaces: "Space", space: "Space", widgets: "Widget", messages: "Message",
    members: "Member", votes: "Vote", leases: "Lease", edits: "AiWrite",
    aiWrites: "AiWrite", pendingWrites: "PendingWrite", rightOfWay: "PendingWrite",
    choiceVotes: "ChoiceVote", presence: "Presence", paint: "PaintMark",
    photos: "Widget", links: "Link", briefs: "Brief", roomBrief: "Brief",
    recaps: "Recap", deals: "Deal", voiceBuild: "Deal", streams: "AskStream",
    streaming: "AskStream", crawls: "Crawl", crawlPages: "CrawlPage",
    linkRefreshQueue: "LinkRefreshQueue", inboundMessages: "InboundMessage",
    emailEvents: "EmailEvent", webhookEvents: "WebhookEvent", workLogs: "WorkLog",
    users: "User", auth: "User", waitlist: "Waitlist", baselines: "Baseline",
    games: "Game", gameRounds: "GameRound", gamePlayers: "GamePlayer",
    gameAnswers: "GameAnswer", puzzlePieces: "PuzzlePiece", awards: "Award",
    stats: "Space", admin: "Space", checkIns: "Widget", tavily: "Link",
    questions: "Link",
  };
  if (explicit[segment]) return explicit[segment];
  return segment.replace(/(^|_)(\w)/g, (_m, _b, c: string) => c.toUpperCase());
}

/** "api.spaces.getBySlug" → ["spaces", "getBySlug"] */
export function parseImplName(name: string): [string, string] {
  const clean = name.replace(/^api\./, "");
  const dot = clean.indexOf(".");
  return dot < 0 ? [clean, ""] : [clean.slice(0, dot), clean.slice(dot + 1)];
}

/** Millisecond timestamps the codebase expects from created_date/updated_date ISO strings. */
export function isoMs(value: unknown): number | undefined {
  const t = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? t : undefined;
}

/**
 * Standard query impl: produce(args) -> value, re-run when any of `watches`
 * emits an entity change. Emits nothing until the first produce resolves.
 */
export function entityQuery(
  watches: string[] | ((args: any) => string[]),
  produce: (args: any) => Promise<any>,
): QueryImpl {
  return (args, emit) => {
    let cancelled = false;
    let running = false;
    let dirty = false;
    const run = async () => {
      if (running) {
        dirty = true;
        return;
      }
      running = true;
      try {
        const value = await produce(args);
        if (!cancelled) emit(value);
      } catch (err) {
        console.error("[hubble] query failed", err);
        if (!cancelled) setTimeout(run, 20_000);
      } finally {
        running = false;
        if (dirty && !cancelled) {
          dirty = false;
          void run();
        }
      }
    };
    void run();
    const names = typeof watches === "function" ? watches(args) : watches;
    // Coalesce a burst of entity events into one re-produce — a join or a
    // heartbeat otherwise fans out into N redundant reads at once.
    let queued: number | null = null;
    const schedule = () => {
      if (cancelled || queued !== null) return;
      queued = window.setTimeout(() => {
        queued = null;
        void run();
      }, 250);
    };
    const unsubs = [...new Set(names)].map((name) =>
      ent(name).subscribe(schedule),
    );
    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  };
}
