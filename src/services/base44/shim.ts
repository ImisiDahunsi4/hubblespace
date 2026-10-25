/**
 * Convex-compatible surface over the Base44 service layer.
 *
 * The live hooks were written against `useQuery`/`useMutation`/`useAction`
 * and `api.<module>.<fn>` references. Rather than rewriting ~200 call sites,
 * this module provides the same surface backed by the Base44 impl tables in
 * impl/. Every dispatch is explicit in one place — the impl tables ARE the
 * typed service interface and the migration ledger of what's ported.
 */
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { getMutationImpl, getActionImpl } from "./impl/calls";
import "./impl/queries"; // side-effect: registers every query impl
import * as store from "./store";
import type { QueryRef } from "./store";
import type { RoomFacts } from "../../lib/deck/resolve";
import type { RoomKnows } from "../../lib/roomKnows";

export type { QueryRef } from "./store";

/** Convex `Id<"table">` parity — Base44 ids are plain strings. */
export type Id<T extends string = string> = string & { __table?: T };
/** Convex `Doc<"table">` parity — row type is open; tables are JSON-schema'd. */
export type Doc<T extends string = string> = Record<string, any> & { __table?: T };

/**
 * Query endpoint → result shape. Leaves are `any` — the JSON-schema'd rows
 * don't have generated types like Convex's — but the collection-vs-scalar
 * distinction is real, so `.map(row => …)` call sites keep contextual types.
 */
export interface QueryResults {
  "admin.check": boolean;
  "admin.overview": any[];
  "auth.currentUser": any;
  "auth.signInOptions": { google: boolean };
  "choiceVotes.room": any[];
  "edits.recent": any[];
  "firecrawl.getCrawlStatus": any;
  "firecrawl.listCrawlPages": any[];
  "games.challenge": any;
  "games.forRoom": any[];
  "games.offer": any[];
  "leases.forRoom": any[];
  "links.waiting": any[];
  "mailArrival.recentInbound": any[];
  "messages.listBySpace": any[];
  "paint.listBySpace": any[];
  "presence.listHereNow": any[];
  "puzzles.forRoom": any;
  "recap.latest": { lines: any[]; [k: string]: any };
  "rightOfWay.heldBack": { rows?: any[]; week?: any; [k: string]: any };
  "rightOfWay.room": { heldBack?: any[]; ghosts?: any[]; settled?: any[]; [k: string]: any };
  "roomBrief.inspect": { room: RoomFacts | null; [k: string]: any };
  "roomBrief.knows": RoomKnows | null;
  "roomPresence.onlineForSpace": { total?: number; others?: number; [k: string]: any };
  "spaces.getBySlug": any;
  "spaces.getSpaceWithWidgets": { space?: any; widgets: any[]; [k: string]: any };
  "spaces.listMine": any[];
  "spaces.roomsOpen": boolean;
  "stats.getHereNow": number;
  "stats.getLiveTotals": any;
  "streaming.byId": any;
  "streaming.getAskStreamBody": { text: string; status: string };
  "streaming.latestAskStream": any;
  "tavily.receipt": any;
  "voiceBuild.live": any;
  "votes.getResults": any[];
  "votes.inSpace": any[];
  "widgets.listBySpace": any[];
  "work.recent": any[];
}

type RefFor<K extends string> = QueryRef & { name: K };

const refCache = new Map<string, QueryRef>();

/** `api.mod.fn` -> { name: "mod.fn" }, cached so refs are stable across renders. */
function makeRef(name: string): QueryRef {
  let ref = refCache.get(name);
  if (!ref) {
    ref = { name };
    refCache.set(name, ref);
  }
  return ref;
}

// Resolve `api.a.b` two levels deep eagerly-ish: the proxy returns another
// proxy until the property is used as a value, so we need leaf objects to be
// the ref itself. We make each proxy node ALSO a ref of its own path, so
// api.spaces.getSpaceWithWidgets is { name:"spaces.getSpaceWithWidgets" }
// while api.spaces can still be traversed.
const proxyCache = new Map<string, QueryRef>();

/** The proxy identity must be stable — a fresh Proxy per `api.x.y` access
 * makes useQuery's subscribe callback change every render, which cancels and
 * restarts the entity fetch in a loop (rate-limit storm + render thrash). */
function refProxy(path: string): QueryRef {
  const cached = proxyCache.get(path);
  if (cached) return cached;
  const ref = makeRef(path);
  const proxy = new Proxy(ref as any, {
    get(_t, prop: string | symbol) {
      if (typeof prop !== "string") return (ref as any)[prop];
      if (prop === "name") return path;
      if (prop === "toJSON") return () => path;
      return refProxy(`${path}.${prop}`);
    },
  });
  proxyCache.set(path, proxy);
  return proxy;
}

/**
 * Typed `api` tree: query endpoints carry their literal name so `useQuery`
 * can map to a result shape; everything else resolves to a generic ref.
 */
type ModuleOf<K> = K extends `${infer M}.${string}` ? M : never;
type ApiTree = {
  [M in ModuleOf<keyof QueryResults>]: {
    [N in keyof QueryResults as N extends `${M}.${infer Fn}` ? Fn : never]: RefFor<N>;
  } & Record<string, QueryRef>;
};

export const api = new Proxy({} as Record<string, any>, {
  get(_t, prop: string | symbol) {
    if (typeof prop !== "string") return undefined;
    return refProxy(prop);
  },
}) as ApiTree & Record<string, Record<string, QueryRef>>;

/** OptimisticLocalStore parity — the object handed to withOptimisticUpdate callbacks. */
export type OptimisticLocalStore = {
  getQuery: (ref: QueryRef, args: unknown) => any;
  getAllQueries: (ref: QueryRef) => { args: unknown; value: any }[];
  setQuery: (ref: QueryRef, args: unknown, value: unknown) => void;
};

export const optimisticStore: OptimisticLocalStore = {
  getQuery: store.getQuery,
  getAllQueries: store.getAllQueries,
  setQuery: store.setQuery,
};

const SKIP = undefined;
type Args = Record<string, unknown> | "skip";

export function useQuery<K extends keyof QueryResults>(ref: RefFor<K>, args: Args): QueryResults[K] | undefined;
export function useQuery(ref: QueryRef, args: Args): any;
export function useQuery(ref: QueryRef, args: Args): any {
  const skipped = args === "skip" || !ref;
  // Args are object literals — a fresh identity each render. Key by JSON so
  // the subscription only restarts when args actually change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableArgs = useMemo(() => args, [skipped ? "skip" : JSON.stringify(args)]);
  const subscribe = useCallback(
    (listener: () => void) =>
      skipped ? () => {} : store.subscribe(ref, stableArgs, listener),
    [ref, skipped, stableArgs],
  );
  const getSnapshot = useCallback(
    () => (skipped ? SKIP : store.getQuery(ref, stableArgs)),
    [ref, skipped, stableArgs],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => SKIP);
}

export function useMutation(ref: QueryRef) {
  return useMemo(() => {
    const impl = getMutationImpl(ref.name);
    const call = (args: any) => impl(args);
    call.withOptimisticUpdate = (update: (s: OptimisticLocalStore, args: any) => void) => {
      const optimistic = (args: any) => {
        update(optimisticStore, args);
        return impl(args);
      };
      optimistic.withOptimisticUpdate = (next: (s: OptimisticLocalStore, a: any) => void) =>
        call.withOptimisticUpdate((s, a) => {
          update(s, a);
          next(s, a);
        });
      return optimistic;
    };
    return call as ((args: any) => Promise<any>) & {
      withOptimisticUpdate: (
        update: (s: OptimisticLocalStore, args: any) => void,
      ) => (args: any) => Promise<any>;
    };
  }, [ref]);
}

export function useAction(ref: QueryRef) {
  return useMemo(() => {
    const impl = getActionImpl(ref.name);
    return (args: any) => impl(args);
  }, [ref]);
}

/** `useConvexConnectionState` parity — the header's connected dot. */
export function useConvexConnectionState() {
  const subscribe = useCallback((listener: () => void) => {
    window.addEventListener("online", listener);
    window.addEventListener("offline", listener);
    return () => {
      window.removeEventListener("online", listener);
      window.removeEventListener("offline", listener);
    };
  }, []);
  const connected = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  return {
    isWebSocketConnected: connected,
    hasInflightRequests: false,
    connectionState: { isWebSocketConnected: connected },
  };
}

/** `convex` client parity: query/mutation/action + watchQuery (useVoiceBuild). */
export function useConvex() {
  return useMemo(
    () => ({
      query: (ref: QueryRef, args: unknown): Promise<any> => store.queryOnce(ref, args),
      mutation: (ref: QueryRef, args: unknown): Promise<any> => getMutationImpl(ref.name)(args),
      action: (ref: QueryRef, args: unknown): Promise<any> => getActionImpl(ref.name)(args),
      watchQuery: (ref: QueryRef, args: unknown) =>
        store.watchQuery(ref, args) as {
          localQueryResult(): any;
          onUpdate(cb: () => void): () => void;
        },
    }),
    [],
  );
}

/**
 * `usePaginatedQuery` parity (messages). The impl receives
 * `paginationOpts.numItems`; loadMore grows it and resubscribes.
 */
export function usePaginatedQuery(
  ref: QueryRef,
  args: Args,
  options: { initialNumItems: number },
) {
  const [numItems, setNumItems] = useState(options.initialNumItems);
  const fullArgs = useMemo(
    () =>
      args === "skip"
        ? ("skip" as const)
        : { ...args, paginationOpts: { numItems } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [args === "skip" ? null : JSON.stringify(args), numItems],
  );
  const rows = useQuery(ref, fullArgs as Args);
  const status =
    args === "skip"
      ? "LoadingFirstPage"
      : rows === undefined
        ? "LoadingFirstPage"
        : Array.isArray(rows) && rows.length >= numItems
          ? "CanLoadMore"
          : "Exhausted";
  const results: any[] = status === "LoadingFirstPage" ? [] : Array.isArray(rows) ? rows : [];
  return {
    results,
    status,
    isLoading: status === "LoadingFirstPage",
    loadMore: (n: number) => setNumItems((c) => c + n),
  };
}
