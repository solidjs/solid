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
// integration bundles carry this module once per entry (the frames client
// installs the materializer on its copy; the LAZY CODEC chunk's copy is the
// one whose plugin deserializes stream data), and module-local state would
// leave the codec copy hookless — deserialize falls back to the inert
// marker, the arg reads as a plain object, and the meter just renders
// nothing (chat example, 2026-08-10). One registered global carries the
// hooks and the materialization memo, so every copy is the same protocol
// endpoint.
/**
 * @type {{
 *   resolveTrace?: (value: unknown) => ({ subscribe(): AsyncIterable<any>, array: boolean } | undefined),
 *   materializeTrace?: (marker: { $tr: any, $ta?: number }) => unknown,
 *   streamOf?: (iterable: AsyncIterable<any>) => any,
 *   materialized: WeakMap<object, unknown>,
 *   materializedValues: WeakSet<object>
 * }}
 */
const STATE = Symbol.for("dom-expressions.container-trace-state");
const state =
  globalThis[STATE] ||
  (globalThis[STATE] = {
    materialized: new WeakMap(),
    materializedValues: new WeakSet()
  });

/** Server half: install the reactive core's trace resolver. */
export function setContainerTraceResolver(fn) {
  state.resolveTrace = fn;
}

/** Client half: install the reactive core's trace materializer. */
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
}

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
const TRACE = Symbol.for("dom-expressions.container-trace");

/**
 * Replace traced containers ANYWHERE in a value (a container can sit at any
 * depth of an argument — `{ filters: { user: proj } }` is one arg) with
 * their serialization envelopes. Copy-on-write: author objects are never
 * mutated, untouched subtrees pass through by reference. Only plain
 * objects/arrays are walked — anything exotic is either a container (probed
 * first, by WeakMap — property-read safe) or an app value the serializer
 * owns. No-op until the resolver is installed.
 */
export function envelopeContainerTraces(value) {
  if (!state.resolveTrace || value == null || typeof value !== "object") return value;
  const trace = state.resolveTrace(value);
  if (trace) return { [TRACE]: trace };
  if (Array.isArray(value)) {
    let out = value;
    for (let i = 0; i < value.length; i++) {
      const next = envelopeContainerTraces(value[i]);
      if (next !== value[i]) {
        if (out === value) out = value.slice();
        out[i] = next;
      }
    }
    return out;
  }
  if (Object.getPrototypeOf(value) === Object.prototype) {
    let out = value;
    for (const key of Object.keys(value)) {
      const next = envelopeContainerTraces(value[key]);
      if (next !== value[key]) {
        if (out === value) out = { ...value };
        out[key] = next;
      }
    }
    return out;
  }
  return value;
}

// One live container per trace, however many places reference it: seroval's
// refs already dedupe the NODE within a stream, and the shared memo (on
// `state`, cross-copy like the hooks) makes the materialization idempotent
// across independent revival sites (an eval-face marker read by two
// occurrences, a codec node re-resolved per record — possibly by DIFFERENT
// copies of this module).
function materialize(marker) {
  let value = state.materialized.get(marker.$tr);
  if (value === undefined) {
    value = state.materializeTrace(marker);
    state.materialized.set(marker.$tr, value);
    if (value !== null && typeof value === "object") state.materializedValues.add(value);
  }
  return value;
}

/**
 * Whether a value is a container this module materialized (client side).
 * Arg classifiers must check this FIRST: a pending container's property
 * reads throw not-ready, so an async probe (`.then`, `Symbol.asyncIterator`)
 * or a serialization compare would detonate it. A WeakSet probe never
 * triggers the proxy's traps.
 */
export function isMaterializedContainer(value) {
  return value !== null && typeof value === "object" && state.materializedValues.has(value);
}

/**
 * Whether a decoded value is a trace marker: the eval face serializes a
 * trace as `{ $tr: stream, $ta: 0|1 }` (a plain literal — data scripts
 * execute before any runtime that could materialize is guaranteed
 * resident, so revival is deferred to the arg-read site). `$tr` is a raw
 * seroval stream (see setContainerTraceStreamMint); the async-iterable
 * shape is accepted for payloads minted before the stream protocol.
 */
export function isContainerTraceMarker(value) {
  if (value == null || typeof value !== "object" || value.$tr == null) return false;
  const tr = value.$tr;
  return tr.__SEROVAL_STREAM__ === true || typeof tr[Symbol.asyncIterator] === "function";
}

/**
 * Deep-revive trace markers inside a decoded value (document-face slot args
 * arrive as literals, and a container can sit at ANY depth of an argument —
 * `{ filters: { user: proj } }` is one arg). In-place: args records are
 * per-record decoded copies. No-op until the materializer is installed.
 */
export function reviveContainerTraces(value) {
  if (!state.materializeTrace || value == null || typeof value !== "object") return value;
  if (isContainerTraceMarker(value)) return materialize(value);
  // Plain containers only — anything exotic was either produced by the
  // codec plugin (already materialized) or is an app value not ours to walk.
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = reviveContainerTraces(value[i]);
  } else if (Object.getPrototypeOf(value) === Object.prototype) {
    for (const key of Object.keys(value)) value[key] = reviveContainerTraces(value[key]);
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
  tag: "dom-expressions/container-trace",
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
    // Codec face: the decode runs where the reactive core is resident (the
    // frames client installs the materializer at module load, before any
    // response can decode), so the value leaves the table already live. The
    // marker fallback keeps a hookless decode inert instead of broken.
    return state.materializeTrace ? materialize(marker) : marker;
  }
};
