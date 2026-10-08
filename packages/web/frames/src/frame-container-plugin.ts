// @ts-nocheck
/**
 * The container tier at the slot border: reactive containers (projections)
 * cross serialization boundaries as TRACES — an async iterable whose first
 * yield is a full state snapshot and whose later yields are patch batches —
 * and materialize back into live local containers. Renderer-agnostic glue;
 * the reactive core injects both halves. See frame-container-plugin.js.
 * @experimental
 */
import { DESCEND, rewriteTree } from "./tree-rewrite.js";

/** A container's border serialization: one subscribe() per consumer. */
export interface ContainerTrace {
  subscribe(): AsyncIterable<any>;
  /** Whether the container's root is an array — the consumer's seed shape. */
  array: boolean;
}

/** The eval-face wire literal a trace decodes to before materialization. */
export interface ContainerTraceMarker {
  $tr: AsyncIterable<any>;
  $ta?: number;
}
// The container tier at the slot border (DR-2 case 3): a reactive container
// (a projection) crossing a serialization boundary ships as its TRACE — an
// async iterable whose first yield is a full state snapshot and whose later
// yields are patch batches (the reactive core's own continuation protocol,
// the same one hydration resume uses). The client materializes the trace
// back into a live read-only container: fine-grained updates without wire
// diffing — patches are RECORDED at write time by the producer, never
// computed — and without domain keys (paths are framework-owned identity).
//
// This module is renderer-agnostic glue: the reactive core owns both halves
// of the protocol and injects them here —
//
//   - the SERVER half (`setContainerTraceResolver`) answers "is this value a
//     traced container, and what is its trace" (solid: getProjectionTrace);
//   - the CLIENT half (`setContainerTraceMaterializer`) turns a received
//     trace into a live local container (solid: a projection consuming the
//     iterable).
//
// With neither hook installed the plugin matches nothing and markers pass
// through untouched, so it is safe to register unconditionally — which is
// how it ships: the plugin rides the codec's DEFAULT plugin set
// (serializer-decode.js), so every serializer face carries it with nothing
// for integrations to wire, and its weight stays in the lazy codec graph.

// Hook state is shared ACROSS MODULE COPIES, like the TRACE symbol below:
// integration bundles carry this module once per entry (the frames client's
// TRACES TIER chunk — `@solidjs/web/frames/trace`, loaded on demand —
// installs the materializer on its copy; the LAZY CODEC chunk's copy is the
// one whose plugin deserializes stream data), and module-local state would
// leave the codec copy hookless — deserialize falls back to the inert
// marker, the arg reads as a plain object, and the meter just renders
// nothing (chat example, 2026-08-10). One registered global carries the
// hooks and the materialization memo, so every copy is the same protocol
// endpoint. The EAGER frames client carries no copy at all: it reads the
// container probe (`materializedValues`) off this object by its registered
// symbol, and nothing else of the client half until the tier installs.
/**
 * @type {{
 *   resolveTrace?: (value: unknown) => ({ subscribe(): AsyncIterable<any>, array: boolean } | undefined),
 *   shareIterable?: (source: AsyncIterable<any>) => AsyncIterable<any>,
 *   materializeTrace?: (marker: { $tr: any, $ta?: number }, claiming?: boolean) => unknown,
 *   streamOf?: (iterable: AsyncIterable<any>) => any,
 *   materialized: WeakMap<object, unknown>,
 *   materializedValues: WeakSet<object>
 * }}
 */
const STATE = Symbol.for("solid.container-trace-state");
const state =
  globalThis[STATE] ||
  (globalThis[STATE] = {
    materialized: new WeakMap(),
    materializedValues: new WeakSet()
  }); /** Server half: install the reactive core's trace resolver. */
export function setContainerTraceResolver(fn: (value: unknown) => ContainerTrace | undefined): void;

/** Server half: install the reactive core's trace resolver. */
export function setContainerTraceResolver(fn) {
  state.resolveTrace = fn;
} /** Server half: install the reactive core's async-iterable sharer. */
export function setAsyncIterableSharer(
  fn: (source: AsyncIterable<any>) => AsyncIterable<any>
): void;

/**
 * Server half: install the reactive core's async-iterable sharer (solid:
 * `shareAsyncIterable`). A generator yields to ONE reader; the serializer
 * pumping a value and a memo reading the same source inside it would split
 * its yields between them. The sharer answers with a seat on a multicast
 * of the source — every seat sees the whole sequence — and the border walk
 * below swaps each async iterable it meets for one.
 */
export function setAsyncIterableSharer(fn) {
  state.shareIterable = fn;
} /** Client half: install the reactive core's trace materializer. */
export function setContainerTraceMaterializer(
  fn: (marker: ContainerTraceMarker, claiming?: boolean) => unknown
): void;

/**
 * Client half: install the reactive core's trace materializer. Installed by
 * the frames client's traces tier (`@solidjs/web/frames/trace`) when it
 * loads — never at the eager client's module load. `claiming` is the
 * revival site's hint (see reviveContainerTraces).
 */
export function setContainerTraceMaterializer(fn) {
  state.materializeTrace = fn;
}

/**
 * Serializer half: install the async-iterable → raw-seroval-stream mint
 * (serializer-decode.js, which already carries seroval — this module must
 * stay seroval-free because it also rides the EAGER frames-client graph,
 * and seroval ships without `sideEffects: false`).
 *
 * Why a raw stream and not the iterable itself: seroval decodes an async
 * iterable as a generator WRAPPER over its internal stream, so every
 * buffered value is microtasks away — but hydration's claim walk is
 * SYNCHRONOUS. A trace whose snapshot the document already delivered must
 * read as ready DURING the walk (every other async source has a sync
 * hydration answer: promise stamps, serialized records), or the consuming
 * boundary renders a phantom fallback over settled markup (the chat
 * welcome/status meter miss). A raw stream decodes as the stream object
 * itself, whose `.on()` replays the buffer synchronously at subscribe.
 */
export function setContainerTraceStreamMint(fn) {
  state.streamOf = fn;
} /** Whether a value is a traced container (server side; WeakMap probe, trap-safe). */
export function isContainerTraced(value: unknown): boolean;

/**
 * Whether a value is a traced container (server side). The slot
 * classifiers check this FIRST: a container is DATA however object-shaped
 * it looks — and the test is a WeakMap probe, safe on a pending projection
 * proxy whose property reads throw not-ready.
 */
export function isContainerTraced(value) {
  const resolve = state.resolveTrace;
  return !!(resolve && value && typeof value === "object" && resolve(value));
}

// The envelope: what actually crosses the serializer. Seroval consults
// plugins only after its own classification pass — it reads `.constructor`
// (which detonates a pending proxy) and claims arrays outright (an
// array-rooted container would serialize as a dead snapshot) — so a raw
// container can never be intercepted reliably. The sink swaps each traced
// container for a plain `{ [TRACE]: trace }` object before the value enters
// the serializer; the plugin matches THAT. A REGISTERED symbol, not a
// module-private one: the envelope is a protocol between module copies —
// integration bundles carry this module once per entry (a frames entry
// mints the envelope, the document entry's serializer tests it), and a
// per-instance Symbol() would silently never match across copies (the
// envelope then serializes as `{}`: an empty object, no error anywhere).
const TRACE = Symbol.for("solid.container-trace"); /**
 * A value's form at the serialization border (copy-on-write): traced
 * containers become envelopes, async iterables become seats on a shared
 * multicast. What a face passes to the serializer — seroval's own
 * classification (constructor reads, array claims) runs before plugins, so
 * raw containers can't be intercepted reliably, and a generator handed to
 * seroval raw is consumed by seroval alone.
 */
export function toBorderForm(value: unknown, envelopeContainers: boolean): unknown;

/**
 * A value's form at the serialization border. Two swaps, ANYWHERE in the
 * value (a container or a stream can sit at any depth of an argument or a
 * memo's answer — `{ filters: { user: proj } }`, `{ meta, progress: gen }`):
 *
 * - a traced container → its serialization envelope (`{ [TRACE] }`), when
 *   `envelopeContainers` — the frame sink's slot-arg records, whose
 *   receiving side materializes traces (the document face's memo values
 *   don't opt in: no revival exists there yet, a marker literal would reach
 *   the reading memo);
 * - an async iterable → a seat on the source's shared multicast (see
 *   setAsyncIterableSharer), every face: a generator yields to one reader,
 *   and the serializer is rarely the only one (a memo reading `answer()
 *   .progress` is the common case). A seat handed back in is left alone.
 *   Seroval's own async carriers (its streams, ReadableStream) are not
 *   touched.
 *
 * Copy-on-write: author objects are never mutated, untouched subtrees pass
 * through by reference. Only plain objects/arrays are walked — anything
 * exotic is a container (probed FIRST, by WeakMap — property-read safe), an
 * iterable (probed under a guard: an unknown proxy's reads may throw), or
 * an app value the serializer owns. No-op until the hooks are installed.
 * A cyclic value is rewritten as a cycle (see rewriteTree).
 */
export function toBorderForm(value, envelopeContainers) {
  if (value == null || typeof value !== "object") return value;
  const resolve = envelopeContainers ? state.resolveTrace : undefined;
  const share = state.shareIterable;
  if (!resolve && !share) return value;
  return rewriteTree(
    value,
    v => {
      if (resolve) {
        const trace = resolve(v);
        if (trace) return { [TRACE]: trace };
      }
      // Before the plain-object walk: an iterable spelled as a literal
      // (`{ [Symbol.asyncIterator]() {} }`) is a source, not a record.
      if (share && isShareableIterable(v)) return share(v);
      return DESCEND;
    },
    false
  );
}

// A raw seroval stream, in either of its shapes: the literal tagged
// `__SEROVAL_STREAM__` that the eval path (`deserialize`, the hydration
// scripts) builds, or seroval's internal stream class, which `createStream`
// and the JSON path (`fromCrossJSON`) produce untagged since seroval 1.6.8.
// This module stays seroval-free (see setContainerTraceStreamMint), so the
// class is recognized by its surface: an `.on()` subscription and no async
// iterator — what tells it apart from the async-iterable `$tr` form, and
// from a Node stream (`.on()` too, but iterable).
function isSerovalStream(value) {
  return (
    value.__SEROVAL_STREAM__ === true ||
    (typeof value.on === "function" && typeof value[Symbol.asyncIterator] !== "function")
  );
}

// An async iterable the sharer may take over: not one of seroval's own
// async carriers (a seroval stream — `.on()`-shaped, not iterable, but
// probed explicitly; a ReadableStream, which seroval encodes as itself).
// The probe reads well-known keys off an unknown exotic value under a
// guard — a proxy whose reads throw is not ours.
function isShareableIterable(value) {
  try {
    if (isSerovalStream(value)) return false;
    if (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) return false;
    return typeof value[Symbol.asyncIterator] === "function";
  } catch {
    return false;
  }
}

// One live container per trace, however many places reference it: seroval's
// refs already dedupe the NODE within a stream, and the shared memo (on
// `state`, cross-copy like the hooks) makes the materialization idempotent
// across independent revival sites (an eval-face marker read by two
// occurrences, a codec node re-resolved per record — possibly by DIFFERENT
// copies of this module).
function materialize(marker, claiming) {
  let value = state.materialized.get(marker.$tr);
  if (value === undefined) {
    value = state.materializeTrace(marker, claiming);
    state.materialized.set(marker.$tr, value);
    if (value !== null && typeof value === "object") state.materializedValues.add(value);
  }
  return value;
} /**
 * Whether a value is a container this module materialized (client side;
 * WeakSet probe, trap-safe — a pending container's property reads throw
 * not-ready, so classify with this BEFORE any async probe or compare).
 */
export function isMaterializedContainer(value: unknown): boolean;

/**
 * Whether a value is a container this module materialized (client side).
 * Arg classifiers must check this FIRST: a pending container's property
 * reads throw not-ready, so an async probe (`.then`, `Symbol.asyncIterator`)
 * or a serialization compare would detonate it. A WeakSet probe never
 * triggers the proxy's traps.
 */
export function isMaterializedContainer(value) {
  return value !== null && typeof value === "object" && state.materializedValues.has(value);
} /** Whether a decoded value is a trace marker (client side, eval face). */
export function isContainerTraceMarker(value: unknown): value is ContainerTraceMarker;

/**
 * Whether a decoded value is a trace marker: the eval face serializes a
 * trace as `{ $tr: stream, $ta: 0|1 }` (a plain literal — data scripts
 * execute before any runtime that could materialize is guaranteed
 * resident, so revival is deferred to the arg-read site). `$tr` is a raw
 * seroval stream (see setContainerTraceStreamMint) — tagged from the eval
 * face, seroval's untagged class from the codec face's hookless fallback;
 * the async-iterable shape is accepted for payloads minted before the
 * stream protocol.
 */
export function isContainerTraceMarker(value) {
  if (value == null || typeof value !== "object" || value.$tr == null) return false;
  const tr = value.$tr;
  return isSerovalStream(tr) || typeof tr[Symbol.asyncIterator] === "function";
} /** Deep-revive trace markers inside a decoded value (document-face slot args). */
export function reviveContainerTraces(value: unknown, claiming?: boolean): unknown;

/**
 * Deep-revive trace markers inside a decoded value (document-face slot args
 * arrive as literals, and a container can sit at ANY depth of an argument —
 * `{ filters: { user: proj } }` is one arg). In-place: args records are
 * per-record decoded copies. No-op until the materializer is installed.
 * The traces tier installs this as the shared frame host's `revive`, so it
 * runs at the mount's arg-read (`FrameHostOptions.revive`). `claiming`: the
 * value's reader is about to hydrate server markup rendered from it (a
 * frame's adopt-time mount) — the materializer parks a trace's backlog
 * beyond the snapshot the markup shows until hydration ends
 * (frames-rulings 3.6 (iii)).
 */
export function reviveContainerTraces(value, claiming) {
  if (!state.materializeTrace || value == null || typeof value !== "object") return value;
  if (isContainerTraceMarker(value)) return materialize(value, claiming);
  // Plain containers only — anything exotic was either produced by the
  // codec plugin (already materialized) or is an app value not ours to walk.
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = reviveContainerTraces(value[i], claiming);
  } else if (Object.getPrototypeOf(value) === Object.prototype) {
    for (const key of Object.keys(value)) value[key] = reviveContainerTraces(value[key], claiming);
  }
  return value;
}

// The subscription crosses as a RAW seroval stream when the mint is
// installed (it always is on a parsing face — the plugin set itself
// resolves through the module that installs it): the decode side then holds
// the stream object directly, whose `.on()` replays buffered emissions
// SYNCHRONOUSLY — a snapshot the document already delivered is readable
// during hydration's synchronous claim walk. Parsing the iterable directly
// (the fallback) wraps it in seroval's async generator on decode, pushing
// every buffered value at least a microtask away.
function parseTrace(value, ctx) {
  const trace = value[TRACE];
  const sub = trace.subscribe();
  return { a: trace.array ? 1 : 0, i: ctx.parse(state.streamOf ? state.streamOf(sub) : sub) };
}

/**
 * Seroval plugin carrying reactive containers across the slot border as
 * traces. Part of the codec's DEFAULT plugin set (serializer-decode.js), so
 * every face — the hydration serializer, the frames codec, flight
 * payloads, the client data tables — carries it with nothing to wire, and
 * its weight lives in the (lazy) codec graph, never the eager client.
 *
 * @type {import("seroval").Plugin<object, { a: number, i: any }>}
 */
export const ContainerTracePlugin = {
  tag: "solid/container-trace",
  test(value) {
    // Matches the ENVELOPE, never a raw container (see TRACE above). The
    // symbol probe is trap-safe on anything.
    return value != null && typeof value === "object" && TRACE in value;
  },
  parse: {
    sync() {
      // A trace is a stream; a sync parse has nowhere to put its later
      // yields and would freeze the container silently.
      throw new Error("A reactive container can only be serialized by a streaming serializer.");
    },
    async async(value, ctx) {
      const trace = value[TRACE];
      const sub = trace.subscribe();
      return {
        a: trace.array ? 1 : 0,
        i: await ctx.parse(state.streamOf ? state.streamOf(sub) : sub)
      };
    },
    stream: parseTrace
  },
  serialize(node, ctx) {
    // Eval face: a marker literal, revived at the arg-read site (see
    // reviveContainerTraces). `$ta` seeds the consumer's root shape.
    return "{$tr:" + ctx.serialize(node.i) + ",$ta:" + node.a + "}";
  },
  deserialize(node, ctx) {
    const iterable = ctx.deserialize(node.i);
    const marker = { $tr: iterable, $ta: node.a };
    // Codec face: the decode runs where the materializer is resident — the
    // `data` chunk that carries this node announces the traces tier
    // (`chunk.tiers`, frame-sink.ts), and the transport awaits the tier's
    // install before it lets the chunk decode — so the value leaves the
    // table already live. A fresh value, never a claim's: no `claiming`.
    // The marker fallback keeps a hookless decode (an un-announced chunk
    // from a producer that predates the tier) inert instead of broken.
    return state.materializeTrace ? materialize(marker) : marker;
  }
};
