// @solidjs/web/frames — server half. Frame streams: render server components
// (functions returned from server functions) to transport-agnostic chunk
// streams, and serve them as framed HTTP responses through the
// server-function handler's transformResult hook.

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
 */
export type Slot<P = {}> = (props: P & { $key?: string | number }) => SolidElement;

export {
  renderToFrameStream,
  renderServerComponent,
  serverComponentResponse,
  frameTransformResult,
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
