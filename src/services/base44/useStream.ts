/**
 * `useStream` — drop-in for @convex-dev/persistent-text-streaming.
 *
 * Convex persisted the stream body server-side and the driving tab fetched
 * it over HTTP; everyone else tailed the row reactively. The Base44 path
 * keeps both halves over the AskStream entity + the askStream backend
 * function:
 *
 *   - the DRIVING tab (the one that minted the stream) invokes the
 *     `askStream` function once — it writes chunks into the row's `body`
 *   - EVERY tab (driver included) reads the row reactively via the
 *     `streaming.byId` query impl, so a reload or a second viewer sees the
 *     same in-flight answer
 *
 * Signature matches the call site: (queryRef, url, driven, streamId?).
 * `url` is accepted for shape parity and ignored — the driver invokes the
 * deployed function instead of fetching an HTTP stream.
 */
import { useEffect, useRef, useState } from "react";
import { base44 } from "./client";
import { useQuery } from "./shim";

export type StreamStatus = "pending" | "streaming" | "done" | "error" | "timeout";

export function useStream(
  _ref: unknown,
  _url: unknown,
  driven: boolean,
  streamId?: string,
) {
  const row = useQuery(
    { name: "streaming.byId" } as any,
    streamId ? { streamId } : "skip",
  ) as { body?: string; done?: boolean; error?: string; startedAt?: number } | undefined;

  // The driver kicks the function exactly once per stream.
  const invoked = useRef<string | null>(null);
  useEffect(() => {
    if (!driven || !streamId || invoked.current === streamId) return;
    invoked.current = streamId;
    void base44.functions.invoke("askStream", { streamId }).catch(() => {});
  }, [driven, streamId]);

  const [text, setText] = useState("");
  useEffect(() => {
    setText(row?.body ?? "");
  }, [row?.body]);

  // A stream that never produces a body surfaces as a timeout so the ask UI
  // can fall back to the non-streaming path (same as the Convex hook).
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    setTimedOut(false);
    if (!streamId) return;
    const timer = window.setTimeout(() => setTimedOut(true), 20_000);
    return () => window.clearTimeout(timer);
  }, [streamId]);

  const status: StreamStatus = !streamId
    ? "pending"
    : row?.error
      ? "error"
      : row?.done
        ? "done"
        : text
          ? "streaming"
          : timedOut && row !== undefined
            ? "timeout"
            : "pending";

  return { stream: streamId, text, status };
}
