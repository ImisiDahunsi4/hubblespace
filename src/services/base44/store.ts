/**
 * The live-query store — the Base44 replacement for Convex's reactive
 * useQuery + OptimisticLocalStore.
 *
 * A query "ref" is just a name ("spaces.getSpaceWithWidgets"). Each ref has
 * an impl (see impl/queries.ts) that knows how to produce a value for given
 * args: fetch entities, subscribe to entity changes, and re-emit. The store
 * keeps one live producer per (ref, args) — every useQuery with the same
 * args shares it, exactly like Convex query sharing.
 *
 * Optimistic updates write straight into the store with setQuery; the next
 * real entity event overwrites the guess with the truth. (Convex could roll
 * a failed mutation back; we can't — on failure the impl's entity
 * subscriptions push the real value on the next change. Same net effect.)
 */

export type QueryRef = { name: string };

/** Produces values for args until stopped. `emit` may be called any number of times. */
export type QueryImpl = (args: any, emit: (value: any) => void) => () => void;

type Entry = {
  ref: QueryRef;
  args: unknown;
  key: string;
  value: unknown;
  hasValue: boolean;
  listeners: Set<() => void>;
  stop?: () => void;
};

function argsKey(args: unknown): string {
  return JSON.stringify(args ?? null, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
      : v,
  );
}

const impls = new Map<string, QueryImpl>();
const entries = new Map<string, Entry>();

export function registerQueryImpl(name: string, impl: QueryImpl) {
  impls.set(name, impl);
}

function entryFor(ref: QueryRef, args: unknown): Entry {
  const key = `${ref.name}|${argsKey(args)}`;
  let entry = entries.get(key);
  if (!entry) {
    entry = { ref, args, key, value: undefined, hasValue: false, listeners: new Set() };
    entries.set(key, entry);
  }
  return entry;
}

function startIfNeeded(entry: Entry) {
  if (entry.stop || entry.listeners.size === 0) return;
  const impl = impls.get(entry.ref.name);
  if (!impl) {
    // No port yet — resolve to undefined forever rather than throwing inside render.
    console.warn(`[hubble] no Base44 implementation for query ${entry.ref.name}`);
    return;
  }
  try {
    entry.stop = impl(entry.args, (value) => {
      entry.value = value;
      entry.hasValue = true;
      for (const l of entry.listeners) l();
    });
  } catch (err) {
    console.error(`[hubble] query ${entry.ref.name} failed to start`, err);
  }
}

function stopIfIdle(entry: Entry) {
  if (entry.listeners.size === 0 && entry.stop) {
    entry.stop();
    entry.stop = undefined;
  }
}

/** React-side: subscribe to a live query. Returns the unsubscribe. */
export function subscribe(ref: QueryRef, args: unknown, listener: () => void): () => void {
  const entry = entryFor(ref, args);
  entry.listeners.add(listener);
  startIfNeeded(entry);
  return () => {
    entry.listeners.delete(listener);
    stopIfIdle(entry);
  };
}

/** Current value for a (ref, args), or undefined until the first emit. */
export function getQuery(ref: QueryRef, args: unknown): unknown {
  const key = `${ref.name}|${argsKey(args)}`;
  const entry = entries.get(key);
  return entry && entry.hasValue ? entry.value : undefined;
}

/** OptimisticLocalStore parity — every live query for a ref, regardless of args. */
export function getAllQueries(ref: QueryRef): { args: unknown; value: unknown }[] {
  const out: { args: unknown; value: unknown }[] = [];
  for (const entry of entries.values()) {
    if (entry.ref.name === ref.name && entry.hasValue) {
      out.push({ args: entry.args, value: entry.value });
    }
  }
  return out;
}

/** OptimisticLocalStore parity — overwrite a live query's value and notify. */
export function setQuery(ref: QueryRef, args: unknown, value: unknown): void {
  const entry = entryFor(ref, args);
  entry.value = value;
  entry.hasValue = true;
  for (const l of entry.listeners) l();
}

/**
 * One-shot read for `convex.query(ref, args)` compatibility: reuse the live
 * value when a query is already running, else run the impl once.
 */
export function queryOnce(ref: QueryRef, args: unknown): Promise<unknown> {
  const cached = getQuery(ref, args);
  if (cached !== undefined) return Promise.resolve(cached);
  const impl = impls.get(ref.name);
  if (!impl) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let done = false;
    const stop = impl(args, (value) => {
      if (done) return;
      done = true;
      stop();
      resolve(value);
    });
  });
}

/** `convex.watchQuery` parity — for useVoiceBuild's streaming mirror. */
export function watchQuery(ref: QueryRef, args: unknown) {
  const listeners = new Set<() => void>();
  let unsub: (() => void) | null = null;
  return {
    onUpdate(cb: () => void) {
      listeners.add(cb);
      if (!unsub) {
        unsub = subscribe(ref, args, () => {
          for (const l of listeners) l();
        });
      }
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0 && unsub) {
          unsub();
          unsub = null;
        }
      };
    },
    localQueryResult() {
      return getQuery(ref, args);
    },
  };
}
