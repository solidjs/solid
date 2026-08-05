// @solidjs/web/frames — server half. Frame streams: render server components
// (functions returned from server functions) to transport-agnostic chunk
// streams, and serve them as framed HTTP responses through the
// server-function handler's transformResult hook.
//
// EXPERIMENTAL — the frames/server-components surface ships as an
// experimental preview, excluded from the 2.0 stability guarantee: API
// shapes and the wire format may change between prereleases (RFC 11).
// Every export in this entry is @experimental.

import type { Element as SolidElement } from "solid-js";

/**
 * A client position in a server component: a prop the server renders (as JSX
 * or by calling it) where client-owned markup belongs. `P` is the client
 * component's own props, so a server component can reference the client
 * component's type directly instead of restating it.
 *
 * Arguments are classified by VALUE, not by name — any prop may carry any of
 * these:
 *
 * - primitives ride the chunk;
 * - server JSX streams as a nested region (html once, never data);
 * - anything else serializes as a data record.
 *
 * Async server JSX in an argument needs its own boundary: the region is
 * emitted as one finished string, so a bare async read has no fallback to
 * show and no fragment to reveal into.
 *
 * `$key` names the occurrence so client state follows an entity across
 * responses rather than being positional — the slot-level analogue of `For`'s
 * `keyed`, for when references can't carry identity because every response
 * re-creates everything. It is occurrence identity, not client data: it is
 * stripped before the client component sees its props. Positional identity is
 * the right default; `$key` matters when a live list reorders.
 * @experimental
 */
export type Slot<P = {}> = (props: P & { $key?: string | number }) => SolidElement;

/**
 * Types an async value crossing the slot border (DR-2, value tier). What you
 * pass is what ships — the promise / async iterable itself rides the data
 * channel — but the client's prop READ settles: it suspends into the covering
 * boundary until first arrival (a promise's resolution, an iterable's first
 * yield), then reads as the settled value, updating per yield for iterables.
 *
 * `asyncArg` is the type-level statement of that contract: identity at
 * runtime, settled type at the border, so `Slot<P>` keeps the fill's props
 * truthful to what its reads actually return.
 *
 * ```tsx
 * props.status({ progress: asyncArg(gen.progress), stats: asyncArg(gen.stats) })
 * ```
 */
export function asyncArg<T>(value: PromiseLike<T> | AsyncIterable<T>): T {
  return value as T;
}

export {
  renderToFrameStream,
  renderServerComponent,
  serverComponentResponse,
  frameTransformResult,
  // Single-flight: mutations whose invalidated payload includes markup
  // stream it as regions in one response (install as transformFlightResult)
  frameTransformFlightResult,
  createFrameSink,
  // Document SSR (t=0): inline rendering + the hydration reference
  frameTransformDirectResult,
  ServerComponentPlugin,
  SERVER_COMPONENT_BOOTSTRAP
} from "@dom-expressions/runtime/src/frame-sink.js";
export {
  FRAME_STREAM_HEADER,
  isFrameStreamResponse
} from "@dom-expressions/runtime/src/frame-transport.js";
