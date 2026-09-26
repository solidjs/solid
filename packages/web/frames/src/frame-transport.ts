// @ts-nocheck
/**
 * Frame stream HTTP transport, client half: recognize a frame-tagged
 * server-function Response and pump its framed chunks into a frame host.
 *
 * The wire convention is shared with the server-function transport — each
 * chunk is length-prefixed (`;0x` + 32-bit hex byte length + `;`) UTF-8 of
 * `JSON.stringify(FrameChunk)` — so both transports read and write through
 * the one framing implementation in server-functions/shared.js. The server
 * half (`serverComponentResponse` / `frameTransformResult`) lives in
 * frame-sink.js; this module stays importable from client bundles.
 */
import {
  ChunkReader,
  ERROR_HEADER,
  LIVE_WIRE,
  SINGLE_FLIGHT_HEADER,
  createChunk,
  deliverFlightData,
  deserializeStream,
  frameAddress,
  getServerFunctionsCodec,
  hasFlightMetadata,
  isEventStream
} from "../../server-functions/src/shared.js";
import { observeFrameApply } from "../../src/observe.js";

// Replaced per build (see src/observe.ts): the observe emitters fold out of
// the prod artifact behind it, call sites included.
const IS_OBSERVE = "_SOLID_OBSERVE_" as unknown as boolean;

// EXPERIMENTAL — the frames/server-components surface ships as an
// experimental preview, excluded from the 2.0 stability guarantee: API
// shapes and the wire format may change between prereleases (RFC 11).
// Every export in this module is @experimental.
import { FrameChunk, FrameHost } from "./frame-client.js";

import { JSONCodecOptions } from "../../serialization/src/serializer-decode.js";

/**
 * Options for `applyFrameResponse`.
 * @experimental
 */
export interface ApplyFrameResponseOptions {
  /**
   * Remap the producer's root frame id onto a local one — the id your
   * insertable/frame registered under — so navigations to the same boundary
   * reuse the same frame regardless of what the server called it. Boundary
   * identity belongs to the client.
   */
  as?: string;
  /**
   * Restamp every chunk of the response with this version (one response IS
   * one version). Versions belong to the client too: the producer cannot
   * know how many streams a boundary has consumed, so pass the Nth-response
   * counter to make policy A's stale-guard real across navigations. A
   * single-flight response addresses several boundaries, each with its own
   * history — pass a function and it is called once per frame in the
   * response.
   */
  version?: number | ((frameId: string) => number);
  /**
   * Receives the payload text of each `outcome` chunk — the response-scoped
   * single-flight envelope, the caller's result rather than anything the
   * host renders.
   */
  onOutcome?(payload: string): void;
}

/**
 * The value under `COMPONENT_BINDING` on a transport-resolved binding.
 * @experimental
 */
export interface ComponentBinding<C = unknown> {
  /** The per-function mount component (the equals-gate identity). */
  component: C;
  /** The call's intrinsic (function, arguments) address — its store's key. */
  address: string;
}

/**
 * Options for `createServerComponentHandler`.
 * @experimental
 */
export interface ServerComponentHandlerOptions<C = unknown> {
  host: FrameHost;
  /**
   * Builds the framework's mount component for a server FUNCTION. Invoked
   * once per function and cached — this is the equals-gate identity every
   * call of the function resolves through. The component is CALLED (by the
   * binding wrapper or a gated reader), receiving its current address as a
   * second argument (`() => string`); it should (re-)bind its frame's pull
   * to that address's store. Multi-mount fans out per site.
   */
  component(fnId: string): C;
  /**
   * A new response is about to stream into an address: rotate
   * response-scoped state (codec data tables) here. `version` is the
   * client-owned stream counter the chunks will be stamped with.
   */
  onStream?(address: string, version: number, response: Response): void;
  /**
   * Answer a call before any request is made (t = 0 local answers — a
   * boundary the document already carries). Returning `undefined` is a
   * miss; any other value is a hit, SYNCHRONOUS, resolving the call with
   * its binding — a hydrating consumer never observes a pending beat. A
   * PROMISE is a deferred hit (a boundary the document is still
   * delivering): the call resolves with its binding when it settles truthy,
   * and is a miss after all — the caller fetches — when it settles falsy.
   */
  intercept?(info: { id: string; meta: unknown; args: unknown[] }): unknown | PromiseLike<unknown>;
}

/**
 * Header tagging a Response as a frame stream; its value is the producing
 * frame's id. Frame-owned contract (hence the namespace) — deliberately not
 * a `BodyFormat` entry, since the body is frame chunks, not a serialized
 * value.
 */
export const FRAME_STREAM_HEADER = "X-Frame-Stream";

/**
 * The resume request's have-list (RFC 11 §9.5, Resume request): the
 * digests the client holds for the address it is reconnecting — the root
 * skeleton under `""`, then one entry per live hole (`lh:N`), attr hole
 * (`lha:N`) and revealed fragment (`pl-N`). Its PRESENCE makes the render a
 * conditional one: the server emits a hole or fragment only when it has
 * settled and its digest differs, and never a root or a fallback over
 * content the list names. Rides only to the live address (a `no-store`
 * response nothing keys on) — never as an argument. Decision (f): this
 * name; a list whose encoding would exceed `FRAME_HAVE_BUDGET` bytes is
 * omitted and the client accepts a full snapshot.
 * @experimental
 */
export const FRAME_HAVE_HEADER = "X-Frame-Have";

/** The have-list's size ceiling in encoded bytes (see FRAME_HAVE_HEADER). */
export const FRAME_HAVE_BUDGET = 4096;

/**
 * Encodes a have-list for the header: `key=digest` pairs, comma-joined
 * (keys never contain either separator; the root's key is empty).
 * `undefined` when the list is empty or over budget.
 * @internal
 */
export function encodeHaveList(have: Record<string, string>): string | undefined;

export function encodeHaveList(have) {
  let out = "";
  for (const key in have) {
    const digest = have[key];
    if (typeof digest !== "string") continue;
    out += (out ? "," : "") + key + "=" + digest;
    if (out.length > FRAME_HAVE_BUDGET) return undefined;
  }
  return out || undefined;
}

/**
 * Decodes a have-list header value; `undefined` for an absent/empty one.
 * Tolerant of malformed entries (skipped) — a wrong entry costs one
 * unneeded emission, never a wrong skip.
 * @internal
 */
export function decodeHaveList(text: string | null | undefined): Record<string, string> | undefined;

export function decodeHaveList(text) {
  if (!text) return undefined;
  const have = {};
  let any = false;
  for (const entry of text.split(",")) {
    const eq = entry.indexOf("=");
    if (eq === -1) continue;
    const digest = entry.slice(eq + 1).trim();
    if (!/^[0-9a-f]{16}$/.test(digest)) continue;
    have[entry.slice(0, eq).trim()] = digest;
    any = true;
  }
  return any ? have : undefined;
} /**
 * Whether a fetch Response carries a frame stream.
 * @experimental
 */
export function isFrameStreamResponse(response: Response): boolean;

/** Whether a fetch Response carries a frame stream. */
export function isFrameStreamResponse(response) {
  return response.headers.has(FRAME_STREAM_HEADER);
} /**
 * Reads a frame-stream Response to completion, applying every chunk to
 * `host`. Chunks are length-prefixed JSON over the server-function wire
 * framing. Resolves with the id the chunks were applied under once the
 * stream ends; rejects on a malformed or errored stream.
 *
 * @example
 * ```ts
 * const response = await getStory(id); // frame-tagged server function result
 * if (isFrameStreamResponse(response)) {
 *   await applyFrameResponse(response, host, { as: "story-pane" });
 * }
 * ```
 * @experimental
 */
export const applyFrameResponse: (
  response: Response,
  host: FrameHost,
  options?: ApplyFrameResponseOptions
) => Promise<string> = IS_OBSERVE ? observedApplyFrameResponse : applyFrames;

// Observe tier: the client half of the `"frame"` record (`OBSERVE.records`,
// see `FrameAppliedEvent`) — one per stream in the response, start →
// complete as applied here, with the chunk census; an apply that threw (a
// read that failed, a chunk that would not parse, a host that rejected one)
// closes the open stream as `error` with the failure beside it. Nothing is
// read, not even the clock, without a listener. This wrapper exists in the
// observe and dev artifacts only: `applyFrameResponse` above IS `applyFrames`
// where the literal folds, so prod pays neither the extra frame nor the
// promise hop.
async function observedApplyFrameResponse(response, host, options = {}) {
  const observation = observeFrameApply(response);
  if (!observation) return applyFrames(response, host, options);
  let applied;
  try {
    applied = await applyFrames(response, host, options, observation);
  } catch (error) {
    observation.end(error);
    throw error;
  }
  observation.end();
  return applied;
}

/**
 * Reads a frame-stream Response to completion, applying every chunk to
 * `host`. The client owns boundary identity: pass `options.as` to remap the
 * producer's root frame id onto a local one (the id your insertable/frame
 * registered under), so navigations to the same boundary reuse the same
 * frame regardless of what the server called it. Resolves with the id the
 * chunks were applied under once the stream ends.
 *
 * The client owns versions too: the producer can't know how many streams a
 * boundary has consumed, so `options.version` restamps the response's
 * chunks, making policy A's stale-guard real across navigations. A number
 * versions the whole response — one response IS one version — which holds
 * while a response addresses one boundary. A single-flight response
 * addresses several (each invalidated region is its own boundary, with its
 * own history), so `version` may instead be a function called once per
 * frame in the response.
 *
 * `options.onOutcome` receives the payload text of each `outcome` chunk —
 * the response-scoped single-flight envelope, which is the caller's result
 * rather than anything the host renders.
 */
function applyFrames(response, host, options = {}, observation) {
  const rootId = response.headers.get(FRAME_STREAM_HEADER) ?? "";
  const as = options.as;
  const version = options.version;
  const perFrame = typeof version === "function" ? new Map() : null;
  // A `live` loop's call (the slot it threads through its invoke options —
  // see LIVE_WIRE): the body is read through the loop's own reader when it
  // is framed as an event stream, and the connection's end is reported to
  // the loop instead of being judged here.
  const wire = options[LIVE_WIRE];
  const connection = wire && wire.connection;
  const reader =
    wire && isEventStream(response) ? wire.open(response.body) : new ChunkReader(response.body);
  // The frames this response has begun (`start`) and not yet ended —
  // `complete` is the bounded signal (a frame the server declared done), an
  // unkeyed `error` the failing kind of it. A body that ends with any still
  // open is a DEATH, never a completion (RFC 11 §9.5, Wire): what the
  // server never declared done was cut off. A nested region's chunks ride
  // inside its parent's start/complete and are not counted apart. Frame
  // ids as applied (remapped, per-frame versioned), so an error record
  // written for one lands in its store.
  const open = new Map();
  // Supersession (§9.5, Client face 4): the handler cancels this connection
  // when a newer response writes the address — the read ends as a death
  // carrying the reason, and the loop reconnects from it.
  let cancelled;
  let resolveEnd;
  if (connection) {
    connection.ended = new Promise(resolve => (resolveEnd = resolve));
    connection.cancel = reason => {
      if (cancelled !== undefined) return;
      cancelled = reason;
      // The reader owns the body's lock; cancelling through it ends the
      // drain as a clean body end (the death is in `open`, not the error).
      try {
        const r = reader.cancel && reader.cancel(reason);
        if (r && typeof r.then === "function") r.then(undefined, () => {});
      } catch {}
    };
  }
  const errorRecord = (id, error) => ({
    type: "error",
    id,
    version: open.get(id),
    error: { message: String(error && error.message) }
  });
  const drain = async () => {
    let result = await reader.next();
    while (!result.done) {
      const chunk = JSON.parse(result.value);
      if (chunk.type === "outcome") {
        if (options.onOutcome) options.onOutcome(chunk.payload);
      } else {
        const wireId = chunk.id;
        if (as !== undefined && chunk.id === rootId) chunk.id = as;
        if (perFrame) {
          let v = perFrame.get(chunk.id);
          if (v === undefined) perFrame.set(chunk.id, (v = version(chunk.id)));
          chunk.version = v;
        } else if (version !== undefined) chunk.version = version;
        if (chunk.type === "start") open.set(chunk.id, chunk.version);
        else if (chunk.type === "complete" || (chunk.type === "error" && !chunk.key))
          open.delete(chunk.id);
        // The observe tier's chunk census (see `observedApplyFrameResponse`);
        // folds with the literal.
        if (IS_OBSERVE && observation) observation.chunk(chunk, wireId);
        // Codec-free until a `data` chunk actually arrives: a host whose
        // deserializer loads lazily (`prepareData`) gets awaited here, and
        // because the loop is sequential every later chunk — the records
        // referencing this data included — queues behind the load. Chunk
        // ORDER is the only contract downstream (network jitter already
        // stretches time between chunks), so nothing else observes the wait.
        if (chunk.type === "data" && host.prepareData) await host.prepareData();
        host.apply(chunk);
      }
      result = await reader.next();
    }
  };
  // How the body ended, judged by what it left open. A live loop is TOLD
  // (the connection's lifetime signal — death or completion — and the sweep
  // it may run over the open frames if the iteration ends for good by
  // error; `close` leaves them as they stand, since a superseding
  // reconnect re-renders them). Without a loop, an open frame's death is an
  // ERROR on the frame — a bounded server component the server never
  // declared complete was cut off mid-render, and nothing resumes it
  // (undeclared death, D1): the record surfaces through `frame.error`, and
  // the content already applied stays.
  const end = error => {
    const dead = error || cancelled || new Error("Frame stream ended before the frame completed.");
    const sweep = () => {
      for (const id of open.keys()) host.apply(errorRecord(id, dead));
    };
    if (connection) {
      connection.done = true;
      resolveEnd({ open: open.size, error: dead, sweep, close: () => {} });
    } else if (error === undefined) sweep();
  };
  return drain().then(
    () => {
      end(undefined);
      return as !== undefined ? as : rootId;
    },
    error => {
      end(error);
      throw error;
    }
  );
}

/** Brands an inline-rendered server component with its function id. */
export const SERVER_COMPONENT = /*#__PURE__*/ Symbol.for("solid.server-component");

/** The unwrapped server component behind an inline-render wrap. */
export const SERVER_COMPONENT_SOURCE = /*#__PURE__*/ Symbol.for("solid.server-component-source");

/** The call's wire address (`frameAddress`), for regions to be emitted under. */
export const SERVER_COMPONENT_ADDRESS = /*#__PURE__*/ Symbol.for("solid.server-component-address");

/**
 * The binding brand on values the transport resolves: `{ component, address }`
 * (see `createServerComponentHandler`). The identity split (DR-1,
 * docs/server-components-principles.md): `component` is the MOUNT identity —
 * one per server function, stable across every call — while `address` names
 * the call's content store. An equals-gated reader (a framework's `dynamic`)
 * compares `component` across resolutions: same function means "same
 * instance, new binding" — it keeps its mounted instance and delivers the
 * new address into it (the instance's frame re-binds its pull to that
 * address's resident store) — and a different function swaps normally.
 * `Symbol.for`, so consumers honor it without importing this module.
 */
export const COMPONENT_BINDING = /*#__PURE__*/ Symbol.for("solid.component-binding");

// The live transport registry's resolver, installed by
// createServerComponentHandler. Module state on the config pattern (one
// active handler at a time, a later creation replaces the current one):
// the codec plugin below has no path to the handler instance — codecs are
// configured, handlers are created — and both live in this module, so the
// seam never needs a global.
let resolveServerComponent;

// The registry bootstrap ships with the FIRST reference each script
// serializes (see `serialize` below) — but the bootstrap text and its
// first-use tracking are server-only weight, so the document-SSR module
// (frame-sink) installs a prefix resolver at load rather than this module
// carrying them: this module is shared with client bundles, whose only
// interest in the plugin is `deserialize`. Unset (an integration
// serializing eval-style without loading the document surface), references
// emit as bare registry reads and the shell must install `_$SC` itself —
// the pre-self-bootstrap contract.
let serverComponentRegistryExpr; /**
 * Installs the hydration-serializer registry prefix: given the emitted
 * script's serializer context, returns the expression the next serialized
 * reference reads the `_$SC` registry through (the self-bootstrapping form
 * on a script's first reference, a bare read after). Loaded document-SSR
 * modules install this (see frame-sink); client bundles never carry the
 * bootstrap text.
 * @experimental
 */
export function setServerComponentBootstrap(resolve: (ctx: unknown) => string): void;

export function setServerComponentBootstrap(resolve) {
  serverComponentRegistryExpr = resolve;
}

/**
 * Seroval plugin for a server component crossing a serialization boundary.
 * A branded component (see `frameTransformDirectResult`) serializes as a
 * REFERENCE — its markup never rides as data.
 *
 * Two distinct consumers share the one tag:
 *
 * - `serialize` (eval-style, the document hydration serializer): emits
 *   `self._$SC.r("<function id>", "<address>")`. The document shell's inline
 *   bootstrap memoizes a stable placeholder per FUNCTION — a delegating
 *   shell whose every mount binds to its own SSR'd element during adoption
 *   — and resolves the addressed reference to the call's BINDING over it
 *   (`COMPONENT_BINDING`, the same shape `bindingFor` below mints), so a
 *   reader that adopted the reference during hydration (an async
 *   `dynamic()` instance's record) holds the same identity a later answer
 *   for the call resolves to.
 * - `deserialize` (the JSON codec): the codec only ever carries a component
 *   inside a single-flight envelope, so this is a FLIGHT reference. It must
 *   resolve to the exact object the reading call site already holds — an
 *   integration seeding its cache with anything else fails the consumer's
 *   equals-gate and remounts the boundary — so it resolves through the live
 *   transport registry by the call's address.
 */
// One parser serves the sync and stream modes (identical signatures); async
// awaits the same two fields.
function parseServerComponent(value, ctx) {
  return {
    id: ctx.parse(value[SERVER_COMPONENT]),
    address: ctx.parse(value[SERVER_COMPONENT_ADDRESS])
  };
}

// A plain descriptor, NOT wrapped in seroval's `createPlugin`: that helper
// is the identity function (it exists for type inference only), and seroval
// ships without `sideEffects: false` — one named import retains the entire
// library in this module's eager graph, defeating the lazy-codec split the
// transports are built around. The JSDoc cast keeps the type contract.
/** @type {import("seroval").Plugin<Function, { id: any, address: any }>} */
export const ServerComponentPlugin = {
  tag: "solid/server-component",
  test(value) {
    return typeof value === "function" && SERVER_COMPONENT in value;
  },
  parse: {
    sync: parseServerComponent,
    async async(value, ctx) {
      return {
        id: await ctx.parse(value[SERVER_COMPONENT]),
        address: await ctx.parse(value[SERVER_COMPONENT_ADDRESS])
      };
    },
    stream: parseServerComponent
  },
  serialize(node, ctx) {
    // The reference resolves per FUNCTION (the bootstrap memoizes one
    // placeholder per id), but it CARRIES the call's address: the bootstrap
    // records address -> id, and the client registers those records with the
    // transport — that record is how a post-load call for the same
    // (function, arguments) finds its way back to the adopted boundary even
    // though the document's value never traveled through the transport.
    //
    // The registry ships WITH the first reference each script serializes —
    // demand-driven, so a document only carries the bootstrap when it
    // actually serializes a server component, and ordering is correct by
    // construction: inline scripts execute in document order, and every
    // script that reads `_$SC` contains (or follows) a script that defined
    // it. Nothing may sit ahead of the authored `<head>` elements — a
    // head-open splice claims as the first walked child and drifts every
    // positional hydration claim after it.
    const registry = serverComponentRegistryExpr ? serverComponentRegistryExpr(ctx) : "self._$SC";
    return registry + ".r(" + ctx.serialize(node.id) + "," + ctx.serialize(node.address) + ")";
  },
  deserialize(node, ctx) {
    const id = ctx.deserialize(node.id);
    const address = ctx.deserialize(node.address);
    if (address !== undefined && resolveServerComponent) {
      return resolveServerComponent(id, address);
    }
    // No transport installed (or an unaddressed brand): fall back to the
    // document registry's per-function placeholder.
    return globalThis._$SC.r(id);
  }
}; /**
 * The codec options for a single-flight envelope: `codec` plus
 * `ServerComponentPlugin` (deduped by tag). Injected by the protocol on both
 * legs; exported for integrations composing their own flight carriers.
 * @experimental
 */
export function flightCodec(codec?: JSONCodecOptions): JSONCodecOptions;

/**
 * The codec options for a single-flight envelope: the configured codec plus
 * `ServerComponentPlugin`. The envelope is the only place a component
 * crosses the codec, and both legs of that path are frame-owned code (the
 * flight transform serializing it, this transport decoding it), so the
 * protocol injects the plugin itself — nothing to register anywhere.
 * (Container traces need no injection here: the trace plugin rides the
 * codec's DEFAULT plugin set — see serializer-decode.js — which keeps its
 * weight in the lazy codec chunk instead of this eager module.)
 */
export function flightCodec(codec) {
  const plugins = (codec && codec.plugins) || [];
  // Tag equality, not instance equality: the two peers (and separately
  // bundled copies of this module) each carry their own plugin object.
  if (plugins.some(plugin => plugin && plugin.tag === ServerComponentPlugin.tag)) return codec;
  return { ...codec, plugins: [...plugins, ServerComponentPlugin] };
} /**
 * The client mirror of `frameTransformResult`, shaped for the server-function
 * client's `responseHandler` seam: frame-stream responses resolve the call
 * with a **binding** — a callable wrapper branded `COMPONENT_BINDING` — so
 * an equals-gated consumer (Solid's `dynamic`) never remounts across
 * refetches or argument changes; the response streams into the address's
 * resident store as the only observable effect.
 *
 * The identity split (DR-1): stores are keyed per-ADDRESS — the call's
 * intrinsic (function, arguments) name, one-to-one with a query cache's
 * per-args entries — while mounts are per-SITE, rendering the per-function
 * component and following delivered addresses. An address nothing is bound
 * to warms its store (preload isolation is the default, not a rule).
 * @experimental
 */
export function createServerComponentHandler<C>(options: ServerComponentHandlerOptions<C>): {
  intercept?(info: { id: string; meta: unknown; args: unknown[] }): unknown;
  handle(
    response: Response,
    ctx: { id: string; meta: unknown; args: unknown[]; context: unknown }
  ): unknown;
  /**
   * What a `live` (re)connect of the call resumes from (RFC 11 §9.5,
   * Resume request): the address's version ordinal as the position
   * (`Last-Event-ID`) and, when a mount shows the address with a ledger,
   * its have-list under `FRAME_HAVE_HEADER` — omitted over budget, so the
   * render is a full snapshot then. `undefined` when nothing here has
   * shown the call.
   */
  resume(info: {
    id: string;
    meta: unknown;
    args: unknown[];
  }): { position: string; headers?: Record<string, string> } | undefined;
  /**
   * Declares that the document is showing a call: hydration-data references
   * carry their call's address (`_$SC.r(id, address)`) but never travel
   * through the transport, so the integration forwards those records here.
   * Mints the call's binding (a post-load refetch then resolves a value
   * whose component matches what the document mounted) and brands the
   * per-function component so cache-seeded readers deliver instead of
   * remounting when their site later switches calls.
   */
  showing(address: string, functionId: string): void;
};

/**
 * The client mirror of `frameTransformResult`, shaped for the server-function
 * client's `responseHandler` seam: frame-stream responses resolve the call
 * with a **binding** instead of data — a callable wrapper branded
 * `COMPONENT_BINDING: { component, address }` — so an equals-gated consumer
 * (Solid's `dynamic`) never remounts across refetches OR argument changes;
 * the response streams into the address's resident store as the only
 * observable effect.
 *
 * The identity split (DR-1, docs/server-components-principles.md):
 *
 * - The **store** is keyed per-ADDRESS — the call's intrinsic
 *   `(function, arguments)` name, the same per-args rule an integration's
 *   query cache keys values by, so the two stay one-to-one and a cached
 *   binding is honest by construction (it names the content it was cached
 *   for; a mount bound to a different address never observes it). Every
 *   response applies AS its call's address; an address nothing is bound to
 *   simply warms its store (a hover preload never touches the page).
 * - The **mount** is keyed per-SITE. `component(fnId)` builds the
 *   framework's mount component once per FUNCTION; every call of that
 *   function resolves a binding wrapping that same component, so a live
 *   site switching arguments passes its reader's equals-gate ("same
 *   component") and receives the new address as a NEW BINDING into the same
 *   instance — the semantics compiled components already have for props.
 *   The instance re-binds its frame's pull to the new address's store:
 *   warm store re-materializes instantly, in-flight stream morphs in.
 *   Client slot state on occurrences whose ids persist survives; there is
 *   no mount to steal, so no handoff protocol, no forwarding, and no
 *   preload special-casing exist.
 *
 * The address reaches the mount as a second argument (`() => address`): an
 * equals-gated reader calls the component itself with a live accessor it
 * updates on delivery; calling the binding directly (a non-gated mount)
 * passes the binding's own constant address.
 */
export function createServerComponentHandler({ host, component, onStream, intercept }) {
  // Mount components, one per FUNCTION (the equals-gate identity).
  const byFn = new Map();
  const componentFor = fnId => {
    let comp = byFn.get(fnId);
    if (comp === undefined) byFn.set(fnId, (comp = component(fnId)));
    return comp;
  };
  // Bindings, one per ADDRESS — the stable resolution value for a call
  // (repeat calls, cache reads, and flight references all resolve the
  // identical object). Purely derived: (function component, address) —
  // no routing state lives here.
  const byAddress = new Map();
  const bindingFor = (address, fnId) => {
    let binding = byAddress.get(address);
    if (!binding) {
      const comp = componentFor(fnId);
      // The address rides as a SECOND argument (an accessor): the binding is
      // called, never compiled against, so the convention is free — and it
      // leaves props untouched for the framework's own reactivity. A gated
      // reader that kept its instance calls `component` itself with a LIVE
      // accessor instead; this constant one serves direct mounts.
      binding = props => comp(props, () => address);
      binding[COMPONENT_BINDING] = { component: comp, address };
      byAddress.set(address, binding);
    }
    return binding;
  };
  /** Resolve a flight reference (see `ServerComponentPlugin`) to the call's
   *  binding. Registered so repeat references stay identity-stable. */
  resolveServerComponent = (id, address) => bindingFor(address, id);
  // Version history per address, client-stamped: the client is the only
  // party that observes ordering across transports (a getter refetch, a
  // mutation's regions, a preload), so stale-guarding is per-address here.
  const versions = new Map();
  // The live connection per address — the `live` loop's call whose body is
  // currently streaming into the store (its lifetime slot, see LIVE_WIRE).
  // One per address: content is keyed by call, so two live readers of one
  // call share one connection (the second joins the first's lifetime below)
  // — otherwise each would supersede the other's stream and the two loops
  // would cycle for as long as both were mounted.
  const connections = new Map();
  const bump = address => {
    const version = (versions.get(address) || 0) + 1;
    versions.set(address, version);
    // Supersession is a death (§9.5, Client face 4): a newer version from
    // another response — a getter refetch, a preload, a mutation's region —
    // makes the open connection's later chunks inert under the stale-guard,
    // so it is cancelled and the loop reconnects from the death. Run for
    // every bump, the loop's own reconnect included (whose predecessor has
    // already ended and left the slot).
    const connection = connections.get(address);
    if (connection) {
      connections.delete(address);
      connection.cancel(new Error("Superseded by a newer response for the address."));
    }
    return version;
  };
  /** Register a live connection under its address until its body ends. */
  const hold = (address, connection) => {
    connections.set(address, connection);
    connection.ended.then(() => {
      if (connections.get(address) === connection) connections.delete(address);
    });
  };
  return {
    intercept:
      intercept &&
      (info => {
        const hit = intercept(info);
        // A locally-answered call (t=0 document adoption) resolves the
        // call's binding like a network answer would — the reader mounts
        // the same per-function component, and the record under the address
        // is how later calls for the same (function, args) find the content.
        // A DEFERRED answer (the boundary is still arriving) resolves the
        // binding when it lands, or `undefined` — a miss after all — when
        // the page has nothing left to deliver it; the caller fetches then.
        if (hit === undefined) return undefined;
        const binding = () => bindingFor(frameAddress(info.id, info.args), info.id);
        if (typeof hit.then === "function")
          return hit.then(landed => (landed ? binding() : undefined));
        return binding();
      }),
    resume(info) {
      const address = frameAddress(info.id, info.args);
      const version = versions.get(address);
      // The ledger is the MOUNT's (it tracks what the DOM shows); the first
      // mount under the address speaks for all — they show the same store.
      const frame = host.get(address);
      const have = frame && frame.have ? frame.have() : undefined;
      if (version === undefined && !have) return undefined;
      const encoded = have && encodeHaveList(have);
      return {
        position: String(version || 0),
        headers: encoded ? { [FRAME_HAVE_HEADER]: encoded } : undefined
      };
    },
    handle(response, ctx) {
      if (!isFrameStreamResponse(response)) return undefined;
      // The call's address names its store: a repeat call — refetch,
      // preload, cache read — writes into the same store, morphing whatever
      // mounts are bound to it; other args write elsewhere and mounted
      // content is untouched (preload isolation is the default, not a rule).
      const address = frameAddress(ctx.id, ctx.args);
      const binding = bindingFor(address, ctx.id);
      // A single-flight response is a MUTATION's: it carries regions for the
      // calls it invalidated, and the caller wants the mutation's value
      // rather than a component.
      if (response.headers.has(SINGLE_FLIGHT_HEADER)) {
        return applyFlightResponse(response, address, binding);
      }
      // A `live` loop's call: the binding resolves it now, and the
      // response's lifetime — its end and how it ended — reaches the loop
      // through its wire slot (§9.5, Client face 2), so frames CONSUME the
      // loop rather than mirror it: death → the loop's backoff and
      // re-invoke, which resolves this same binding again (stable per
      // address, so an equals-gated reader keeps its instance); completion
      // → the loop completes.
      const wire = ctx[LIVE_WIRE];
      const connection = wire && wire.connection;
      if (connection) {
        // A live connection already streams this address: join its
        // lifetime instead of opening a second stream into the same store
        // (see `connections`). This response is ended here — the server
        // tears its render down on the cancel — and the joining loop sees
        // the shared connection's death when it comes, reconnecting like
        // the loop that owns it (one of the two wins the next slot; the
        // other joins again).
        const current = connections.get(address);
        if (current && !current.done) {
          connection.ended = current.ended;
          const body = response.body;
          if (body) body.cancel().catch(() => {});
          return binding;
        }
        const version = bump(address);
        if (onStream) onStream(address, version, response);
        // The end is judged by the loop from `connection.ended` (set
        // synchronously by applyFrames); a rejected read is a death it
        // already sees, not an error record — the loop decides what the
        // open frames become (a sweep when it ends by error, nothing when
        // it reconnects).
        applyFrameResponse(response, host, { as: address, version, [LIVE_WIRE]: wire }).catch(
          () => {}
        );
        hold(address, connection);
        return binding;
      }
      const version = bump(address);
      if (onStream) onStream(address, version, response);
      applyFrameResponse(response, host, { as: address, version }).catch(err =>
        host.apply({
          type: "error",
          id: address,
          version,
          error: { message: String(err && err.message) }
        })
      );
      return binding;
    },

    /**
     * Declares that the document is showing a call. Hydration-data values
     * never travel through the transport (the integration seeds its cache
     * straight from the serialized state), so the call's address arrives
     * through this seam instead — the t=0 reference carries it (see
     * ServerComponentPlugin.serialize). Minting the binding here keeps a
     * post-load refetch of the same call resolving a value whose component
     * matches what the document mounted; branding the document's per-
     * function placeholder (the cache-seeded value readers hold at t=0)
     * lets an equals-gated reader deliver instead of remounting when its
     * site later switches calls.
     */
    showing(address, functionId) {
      bindingFor(address, functionId);
      const comp = componentFor(functionId);
      if (
        comp &&
        (typeof comp === "function" || typeof comp === "object") &&
        !comp[COMPONENT_BINDING]
      ) {
        comp[COMPONENT_BINDING] = { component: comp, address };
      }
    }
  };

  /**
   * A mutation whose payload includes markup. The regions stream to the
   * boundaries showing the calls they refresh — untouched by this call
   * site's identity, since they belong to whatever is reading those calls —
   * while the `outcome` chunks carry the `{ value, data }` envelope a plain
   * single-flight body would have held, component-valued entries included
   * (as flight references resolving to the very components those boundaries
   * hold). The decoded envelope then takes the SAME delivery path a plain
   * body takes (`deliverFlightData`: each registered consumer receives its
   * source's slice, in registration order), and the caller gets the same
   * value, so a mutation reads identically whether or not any of what it
   * invalidated was markup.
   */
  async function applyFlightResponse(response, address, binding) {
    // The mutation's own markup (when it returned a component) belongs to
    // this call's address; every other frame in the response already
    // arrives under the address of the call it refreshes — mounts are bound
    // to addresses, so region roots need no routing: a bound address morphs,
    // an unbound one warms its store until something binds it (the
    // envelope's reference to the same call resolves this handler's
    // binding, so the content mounts wherever the seeded value is read).
    const rootId = response.headers.get(FRAME_STREAM_HEADER) ?? "";
    const as = rootId ? address : undefined;

    // The envelope decodes progressively, exactly as a plain single-flight
    // body does: outcome chunks are the codec's own nodes, so replaying them
    // framed lets async values inside flight data settle as they arrive.
    let feed;
    const source = new ReadableStream({
      start(controller) {
        feed = controller;
      }
    });
    const payload = deserializeStream(new Response(source), flightCodec(getServerFunctionsCodec()));
    let carried = false;

    await applyFrameResponse(response, host, {
      as,
      // Every frame in the response gets its own bump, and the integration
      // rotates that frame's response-scoped state (data tables) — a region
      // is as much a new stream into a boundary as a navigation is.
      version: frameId => {
        const version = bump(frameId);
        if (onStream) onStream(frameId, version, response);
        return version;
      },
      onOutcome: text => {
        carried = true;
        feed.enqueue(createChunk(text));
      }
    });
    feed.close();

    // A frame stream tagged single-flight always carries its envelope; an
    // absent one is a truncated response, not an empty payload.
    if (!carried) throw new Error("Single-flight frame response carried no outcome");

    const envelope = await payload;
    // The one delivery path (see server-functions/shared.js): the response
    // header names the folded sources, each consumer gets its slice.
    await deliverFlightData(response, envelope.data);
    // Mirrors the data-only path: responses carrying integration metadata
    // (the redirect carrier, `X-Revalidate`) are control flow for the
    // consumers to interpret; a bare error-tagged one throws.
    if (response.headers.has(ERROR_HEADER) && !hasFlightMetadata(response)) {
      throw envelope.value;
    }
    // A mutation that answered with markup for its own boundary resolves to
    // the call's binding, like a getter would.
    return rootId ? binding : envelope.value;
  }
}
