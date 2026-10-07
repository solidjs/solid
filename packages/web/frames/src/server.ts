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
// The container tier's server half, installed HERE as well as in the main
// server entry: the SSR runtime itself is external to this artifact
// (`@solidjs/web`, see rollup.config.js externalizeFramesServerRuntime), but
// the sink's own codec — createJSONSerializer and the container trace plugin
// it carries — is bundled (single-file outputs can't share a chunk), so this
// copy's trace plugin needs the resolver and the sharer too. Wire
// compatibility across copies is by plugin TAG, which every seam compares;
// the resolver and sharer functions themselves come from external solid-js,
// so both copies answer identically.
import { setAsyncIterableSharer, setContainerTraceResolver } from "./frame-container-plugin.js";
import { getProjectionTrace, shareAsyncIterable } from "solid-js/internal";

setContainerTraceResolver(getProjectionTrace);
setAsyncIterableSharer(shareAsyncIterable);

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

declare const slotError: unique symbol;

/**
 * A binding slot's rejected return shape: assigning to it fails, and the
 * error names the reason `M`.
 * @experimental
 */
export type SlotError<M extends string> = { [slotError]: M };

/**
 * What a binding slot's fill may return: `J` when it is a plain object with no
 * `$`-prefixed key (reserved for occurrence identity), otherwise a
 * `SlotError` naming why not.
 * @experimental
 */
export type SlotOutput<J> = J extends readonly unknown[]
  ? SlotError<"binding slot output must be an object, not an array">
  : J extends Node
    ? SlotError<"binding slot output must be an object, not a DOM node">
    : J extends (...args: any[]) => any
      ? SlotError<"binding slot output must be an object, not a function">
      : J extends PromiseLike<unknown> | AsyncIterable<unknown>
        ? SlotError<"binding slot output must be settled, not async">
        : Extract<keyof J, `$${string}`> extends never
          ? J
          : SlotError<`reserved key: ${Extract<keyof J, `$${string}`> & string}`>;

/**
 * A binding slot (principles §9.2.3): the client renders an object instead of
 * markup, and the server template binds its properties at positions —
 * `const row = props.row({ id, completed });` then
 * `<li class={row.rowClass} hidden={row.removed}><input checked={row.done}
 * onInput={row.toggle} /></li>`. One call is one data context: any element
 * in the template may read from it, and the client owns exactly the values
 * the template read. Keys are the client's names; the position decides what
 * a property IS (attribute, class name, style property, handler, ref, or
 * text — `<strong>{list.remaining}</strong>`, a string or number). On
 * the server a property is a stand-in, never the value: bind it, never
 * branch on it or compute with it.
 *
 * The fill runs once per occurrence, untracked, as a component body does:
 * state it creates lives with the occurrence, a top-level read is a
 * one-time read, and a getter is the reactive form. Handlers and refs are
 * read once, when an element binds.
 *
 * `P` is the args the server passes (reactive props to the fill, as for
 * `Slot`); `J` is the object the fill returns — the same type a shared
 * component takes as a prop when the client renders it directly, so one
 * `TodoRow` serves both sides. `$key` is occurrence identity, as for `Slot`,
 * and optional: within a render, repeated calls with structurally equal
 * args are one occurrence (a call in a component prop is re-evaluated per
 * position the component binds), so the natural spelling needs no key;
 * `$key` is for state inside the fill's scope that must follow the entity
 * across responses. A slot with no args (`P` empty) is called bare —
 * `const filters = props.filters();` — and is one occurrence named by the
 * prop.
 * @experimental
 */
export type BindingSlot<P = {}, J extends object = Record<string, unknown>> = {} extends P
  ? (props?: P & { $key?: string | number }) => SlotOutput<J>
  : (props: P & { $key?: string | number }) => SlotOutput<J>;

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
 * Slots render as JSX — the compiler wraps each prop in a getter so the read
 * defers to the slot border, where the runtime owns it. A call form
 * (`props.status({ … })`) evaluates its args eagerly in the component body —
 * a top-level read, an error in most cases.
 *
 * ```tsx
 * <props.status progress={asyncArg(gen.progress)} stats={asyncArg(gen.stats)} />
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
} from "./frame-sink.js";
export {
  FRAME_STREAM_HEADER,
  FRAME_HAVE_HEADER,
  FRAME_HAVE_BUDGET,
  // The tier announcement's header name (frames savings pass §2). The client
  // entry reads it but does not re-export it (its one use inlines).
  FRAME_TIERS_HEADER,
  isFrameStreamResponse
} from "./frame-transport.js";
