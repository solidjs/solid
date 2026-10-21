// Shared by the client and server `from` (client/hydration.ts,
// server/signals.ts): solid-js wraps `@solidjs/signals`' `from` with the
// hydration contract for live sources.

import { from as signalsFrom, type FromSource } from "@solidjs/signals";

/** The live-source brand (registered symbol; see LIVE_SOURCE in server/signals.ts). */
const LIVE_SOURCE = Symbol.for("solid.LiveSource");

/**
 * A source that already carries the brand (a server function's `live()`):
 * `from` returns it as is. Its transport owns its lifetime, and hydration
 * stamps (`LiveResumeFrom`) must land on the object the transport reads.
 */
export function isLiveSource(source: unknown): boolean {
  return source != null && !!(source as any)[LIVE_SOURCE];
}

/**
 * Brands `from`'s iterable when the source is a subscription or an Observable,
 * the same precedence `from` itself uses. With latest-value semantics each
 * yield is the whole current value: a standing answer, which the server
 * answers with its first value and closes, and the hydrated client re-runs to
 * reconnect, instead of serializing a stream that might never end. An
 * AsyncIterable stays a plain stream, which the server streams as any other.
 */
export function brandFrom<T>(source: FromSource<T>, iterable: AsyncIterable<T>): AsyncIterable<T> {
  const s = source as any;
  const observable = (Symbol as any).observable;
  if (
    typeof s === "function" ||
    typeof s?.subscribe === "function" ||
    typeof s?.["@@observable"] === "function" ||
    (observable && typeof s?.[observable] === "function")
  )
    (iterable as any)[LIVE_SOURCE] = true;
  return iterable;
}

/**
 * Converts a callback subscription, an Observable or an AsyncIterable into an
 * AsyncIterable for a computation: `createMemo(() => from(source))`. See
 * `from` in `@solidjs/signals`; this adds the hydration brand (`brandFrom`),
 * so a subscription read during hydration reconnects once its section has
 * hydrated rather than staying at the server's value.
 */
export function from<T>(source: FromSource<T>): AsyncIterable<T> {
  if (isLiveSource(source)) return source as AsyncIterable<T>;
  return brandFrom(source, signalsFrom(source));
}
