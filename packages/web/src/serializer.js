import { Feature, Serializer, getCrossReferenceHeader, toCrossJSONStream } from "seroval";
import { resolveCodecOptions, resolveSerializerPlugins } from "./serializer-decode.js";

// The decode half (plugin set, JSON codec defaults, `createJSONDeserializer`,
// `createJSONDataTable`) lives in serializer-decode.js so lazy client
// consumers can load it without this module's encode machinery; re-exported
// here so this remains the FULL serialization surface (the public
// `@solidjs/web/serialization` entry and every existing import are
// unchanged).
export {
  DEFAULT_WEB_PLUGINS,
  createJSONDataTable,
  createJSONDeserializer,
  resolveSerializerPlugins
} from "./serializer-decode.js";

// Features excluded from emitted scripts so output stays runnable on ~ES2017
// targets (AggregateError is ES2021, BigInt typed arrays are ES2020).
const DEFAULT_DISABLED_FEATURES = Feature.AggregateError | Feature.BigIntTypedArray;

// A serialized Error's `.stack` leaks server file paths, internal function
// names and the shape of the deployment to anyone who can trigger a throw,
// so it's stripped from everything serialized outside development — there
// the paths are the developer's own and the stack is actually useful.
// Serialize-side only and applied on top of any `disabledFeatures` override
// (compat tuning shouldn't silently reopen the leak); the decode side stays
// permissive so a payload that does carry a stack (e.g. from a development
// peer) still deserializes. Read at call time so the policy tracks NODE_ENV.
const serializeOnlyDisabledFeatures = () =>
  process.env.NODE_ENV === "development" ? 0 : Feature.ErrorPrototypeStack;

// Part of the hydration wire protocol since the streaming serializer landed
// (#275): the bootstrap from `generateHydrationScript` creates it and the
// client runtime reads resolved values out of it. Terse on purpose — it ships
// in every SSR payload.
const HYDRATION_GLOBAL = "_$HY.r";

// Seroval's plugin-authoring API, re-exported so custom plugins are built
// against the SAME seroval instance/version the runtime serializes with. A
// plugin from the author's own seroval dependency edge would not fail the
// build — it would emit nodes the peer can't interpret, and an
// `OpaqueReference` from another copy fails seroval's instanceof check and
// silently serializes as a plain value (solid-start #1474 is the case study).
export { createPlugin, OpaqueReference } from "seroval";

/**
 * Creates a streaming Seroval serializer preconfigured with the web plugin
 * set and the default feature policy. `globalIdentifier` is required and
 * names the object the emitted scripts write resolved values into.
 */
export function createSerializer(options) {
  return new Serializer({
    ...options,
    plugins: resolveSerializerPlugins(options.plugins),
    disabledFeatures:
      (options.disabledFeatures === undefined
        ? DEFAULT_DISABLED_FEATURES
        : options.disabledFeatures) | serializeOnlyDisabledFeatures()
  });
}

/**
 * Serializer for SSR hydration output. Pins the hydration global (`_$HY.r`)
 * and feature policy — only the wiring options (callbacks, scope, extra
 * plugins) are configurable.
 */
export function createHydrationSerializer({ onData, onDone, scopeId, onError, plugins }) {
  return createSerializer({
    scopeId,
    plugins,
    globalIdentifier: HYDRATION_GLOBAL,
    onData,
    onDone,
    onError
  });
}

export function getLocalHeaderScript(id) {
  return getCrossReferenceHeader(id) + ";";
}

// ---- JSON codec (server function transports) ----
//
// Unlike hydration output (executable JS targeting a global), the JSON codec
// streams SerovalNode values that a peer decodes without eval. Framing the
// nodes on the wire (chunk delimiting, HTTP plumbing) is the transport's
// concern; this layer only guarantees both sides agree on plugins and
// feature policy.

/**
 * Serializes `value` as SerovalNode chunks delivered through
 * `onParse(node, initial)`. Async values (promises, streams) produce
 * additional chunks as they resolve; `onDone` fires when everything has
 * settled. Returns a cancel function that aborts any pending async
 * serialization.
 */
export function serializeJSON(value, { onParse, onDone, onError, ...codecOptions }) {
  const resolved = resolveCodecOptions(codecOptions);
  return toCrossJSONStream(value, {
    onParse,
    onDone,
    onError,
    ...resolved,
    disabledFeatures: resolved.disabledFeatures | serializeOnlyDisabledFeatures()
  });
}

/**
 * Keyed streaming variant of the JSON codec, matching the hydration
 * serializer's contract (`write(id, value)` / `flush()`) so the render core
 * can drive either through the same serializer seam. Every write shares one
 * parse-refs map, so a value referenced from multiple writes dedupes on the
 * wire and decodes to a single instance; async values (promises, streams)
 * keep emitting patch nodes after their initial keyed node.
 *
 * `onData` receives `{ key, node, initial }` records — passive data, no eval
 * on the consumer (see `createJSONDataTable`). `onDone` fires once `flush()`
 * has been called and every pending value has settled. Writes after flush
 * are dropped, mirroring the hydration serializer.
 */
export function createJSONSerializer({
  onData,
  onDone,
  onError,
  plugins,
  disabledFeatures,
  depthLimit
}) {
  const resolved = resolveCodecOptions({ plugins, disabledFeatures, depthLimit });
  const refs = new Map();
  const cancels = new Set();
  let pendingWrites = 0;
  let flushed = false;
  let done = false;
  const maybeDone = () => {
    if (flushed && pendingWrites === 0 && !done) {
      done = true;
      onDone && onDone();
    }
  };
  return {
    write(key, value) {
      if (flushed) return;
      pendingWrites++;
      // Sync values settle inside the toCrossJSONStream call, before the
      // cancel function exists — track with a flag instead of the handle.
      let settled = false;
      let cancel = null;
      const stream = toCrossJSONStream(value, {
        refs,
        plugins: resolved.plugins,
        disabledFeatures: resolved.disabledFeatures | serializeOnlyDisabledFeatures(),
        onParse(node, initial) {
          onData({ key, node, initial });
        },
        onError,
        onDone() {
          settled = true;
          if (cancel) cancels.delete(cancel);
          pendingWrites--;
          maybeDone();
        }
      });
      if (!settled) {
        cancel = stream;
        cancels.add(cancel);
      }
    },
    flush() {
      flushed = true;
      maybeDone();
    },
    close() {
      flushed = true;
      for (const cancel of cancels) cancel();
      cancels.clear();
    }
  };
}
