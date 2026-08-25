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
  SINGLE_FLIGHT_HEADER,
  createChunk,
  deserializeStream,
  frameAddress,
  getFlightDataConsumer,
  getServerFunctionsCodec
} from "../../server-functions/src/shared.js";
import { REVALIDATE_HEADER } from "../../src/response.js";

// EXPERIMENTAL — the frames/server-components surface ships as an
// experimental preview, excluded from the 2.0 stability guarantee: API
// shapes and the wire format may change between prereleases (RFC 11).
// Every export in this module is @experimental.
import { FrameChunk, FrameHost } from "./frame-client.js";

import { JSONCodecOptions } from "../../serialization/src/serializer-decode.js";

// Structural mirror of server-functions/shared.js's FlightDataConsumer:
// this file may only reference siblings that ship with it when integrations
// copy the frames declaration set (solid-web's types build), and the
// server-functions declarations are copied to a different root.
type FlightConsumer = (data: unknown, context: { response: Response }) => void | Promise<void>;

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
   * Answer a call SYNCHRONOUSLY before any request is made (t = 0 local
   * answers — e.g. a boundary the document already carries). Returning a
   * non-undefined value resolves the call with it; a hydrating consumer
   * never observes a pending beat.
   */
  intercept?(info: { id: string; meta: unknown; args: unknown[] }): C | undefined;
  /**
   * Reads the registered single-flight consumer at delivery time. The
   * consumer is module state in the server-function client's SHARED
   * instance; pass a getter reading that instance when your bundling gives
   * this module a private copy. Defaults to the local copy's reader.
   */
  consumer?(): FlightConsumer | undefined;
  /**
   * Reads the configured codec options at decode time — same instance-
   * identity contract as `consumer`. Defaults to the local copy's reader.
   */
  codec?(): JSONCodecOptions | undefined;
}

/**
 * Header tagging a Response as a frame stream; its value is the producing
 * frame's id. Frame-owned contract (hence the namespace) — deliberately not
 * a `BodyFormat` entry, since the body is frame chunks, not a serialized
 * value.
 */
export const FRAME_STREAM_HEADER = "X-Frame-Stream"; /**
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
export function applyFrameResponse(
  response: Response,
  host: FrameHost,
  options?: ApplyFrameResponseOptions
): Promise<string>;

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
export async function applyFrameResponse(response, host, options = {}) {
  const rootId = response.headers.get(FRAME_STREAM_HEADER) ?? "";
  const as = options.as;
  const version = options.version;
  const perFrame = typeof version === "function" ? new Map() : null;
  const reader = new ChunkReader(response.body);
  let result = await reader.next();
  while (!result.done) {
    const chunk = JSON.parse(result.value);
    if (chunk.type === "outcome") {
      if (options.onOutcome) options.onOutcome(chunk.payload);
    } else {
      if (as !== undefined && chunk.id === rootId) chunk.id = as;
      if (perFrame) {
        let v = perFrame.get(chunk.id);
        if (v === undefined) perFrame.set(chunk.id, (v = version(chunk.id)));
        chunk.version = v;
      } else if (version !== undefined) chunk.version = version;
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
  return as !== undefined ? as : rootId;
}

/** Brands an inline-rendered server component with its function id. */
export const SERVER_COMPONENT = /*#__PURE__*/ Symbol.for("dom-expressions.server-component");

/** The unwrapped server component behind an inline-render wrap. */
export const SERVER_COMPONENT_SOURCE = /*#__PURE__*/ Symbol.for(
  "dom-expressions.server-component-source"
);

/** The call's wire address (`frameAddress`), for regions to be emitted under. */
export const SERVER_COMPONENT_ADDRESS = /*#__PURE__*/ Symbol.for(
  "dom-expressions.server-component-address"
);

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
export const COMPONENT_BINDING = /*#__PURE__*/ Symbol.for("dom-expressions.component-binding");

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
 *   `self._$SC.r("<function id>")`. The document shell's inline bootstrap
 *   memoizes a stable placeholder per FUNCTION — a delegating shell whose
 *   every mount binds to its own SSR'd element during adoption — so the
 *   address adds nothing at t=0 and the reference stays id-keyed.
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
  tag: "dom-expressions/server-component",
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
export function createServerComponentHandler({
  host,
  component,
  onStream,
  intercept,
  // The flight consumer and codec are module state in the server-function
  // client's SHARED instance; a bundler may give this module a private copy
  // (solid-web's frames client does), so an integrator whose bundle splits
  // them passes getters that read the built instance. The defaults read the
  // local copy — correct whenever there is only one.
  consumer = getFlightDataConsumer,
  codec = getServerFunctionsCodec
}) {
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
  const bump = address => {
    const version = (versions.get(address) || 0) + 1;
    versions.set(address, version);
    return version;
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
        if (hit === undefined) return undefined;
        return bindingFor(frameAddress(info.id, info.args), info.id);
      }),
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
   * hold). Data reaches the integration through the same consumer, and the
   * caller gets the same value, so a mutation reads identically whether or
   * not any of what it invalidated was markup.
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
    const payload = deserializeStream(new Response(source), flightCodec(codec()));
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
    const deliver = consumer();
    if (deliver) await deliver(envelope.data, { response });
    // Mirrors the data-only path: responses carrying integration metadata
    // are control flow for the consumer to interpret; a bare error-tagged
    // one throws.
    if (
      response.headers.has(ERROR_HEADER) &&
      !response.headers.has("Location") &&
      !response.headers.has(REVALIDATE_HEADER)
    ) {
      throw envelope.value;
    }
    // A mutation that answered with markup for its own boundary resolves to
    // the call's binding, like a getter would.
    return rootId ? binding : envelope.value;
  }
}
