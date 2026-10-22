// @ts-nocheck
// @ts-expect-error seroval's published types omit these ESM named exports
import {
  Feature,
  Serializer,
  crossSerializeStream,
  getCrossReferenceHeader,
  toCrossJSONStream,
  createPlugin as createPluginImpl,
  OpaqueReference as OpaqueReferenceImpl
} from "seroval";
import { resolveCodecOptions, resolveSerializerPlugins } from "./serializer-decode.js";
import type {
  JSONCodecOptions,
  PluginInfo,
  SerializerPlugin,
  SerovalNode
} from "./serializer-decode.js";

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
export type * from "./serializer-decode.js";

/**
 * Options for `createSerializer`.
 *
 * Integration-facing; may change (see the entry banner).
 */
export interface WebSerializerOptions {
  /** Name of the global object the emitted scripts write resolved values into. */
  globalIdentifier: string;
  /** Cross-reference scope id, for isolating multiple streams on one page. */
  scopeId?: string;
  /**
   * Seroval feature bitflags to exclude from output. Defaults to disabling
   * post-ES2017 features (AggregateError, BigInt typed arrays). Outside
   * development, `Error.prototype.stack` is additionally stripped on top of
   * any override — serialized stacks leak server paths to the client.
   */
  disabledFeatures?: number;
  /**
   * Whether serialized `Error`s carry their `.stack`. Defaults to
   * `NODE_ENV === "development"`; set `false` to pin production disclosure
   * to the deployment rather than the ambient variable (#3152 — see
   * `JSONCodecOptions.serializeErrorStacks`).
   */
  serializeErrorStacks?: boolean;
  /** Extra plugins, composed ahead of `DEFAULT_WEB_PLUGINS`. */
  plugins?: SerializerPlugin[];
  /** Receives each emitted script chunk. */
  onData: (result: string) => void;
  onError?: (error: unknown) => void;
  /** Fires once all async values have settled. */
  onDone?: () => void;
}

/**
 * Options for `createHydrationSerializer` — `WebSerializerOptions` minus
 * the knobs hydration pins (`globalIdentifier`, `disabledFeatures`).
 * @internal
 */
export type HydrationSerializerOptions = Omit<
  WebSerializerOptions,
  "globalIdentifier" | "disabledFeatures"
>;

// ---- JSON codec (server function transports) ----
// (`JSONCodecOptions` and the decode half are declared in
// serializer-decode.d.ts and re-exported above.)

/**
 * Options for `serializeJSON`.
 *
 * Integration-facing; may change (see the entry banner).
 */
export interface JSONSerializeOptions extends JSONCodecOptions {
  /**
   * Receives each serialized node; `initial` is true for the first chunk
   * (the source value itself). Async values produce additional chunks as
   * they resolve.
   */
  onParse: (node: SerovalNode, initial: boolean) => void;
  onError?: (error: unknown) => void;
  /** Fires once all async values have settled. */
  onDone?: () => void;
}

/** Options for `createJSONSerializer`. */
export interface JSONSerializerOptions extends JSONCodecOptions {
  /**
   * Receives each keyed record — `initial` is true for a key's first node
   * (the written value itself); async values patch through later records
   * under the same key. The decoding peer is `createJSONDataTable`.
   */
  onData: (record: { key: string; node: SerovalNode; initial: boolean }) => void;
  onError?: (error: unknown) => void;
  /**
   * Fires once `flush()` has been called and every pending value settled, or
   * once `close()` runs.
   */
  onDone?: () => void;
}

// Features excluded from emitted scripts so output stays runnable on ~ES2017
// targets (AggregateError is ES2021, BigInt typed arrays are ES2020). Read
// in `createSerializer`, not hoisted: a module-level read of `Feature`'s
// members is a side effect to Rolldown and esbuild, so every bundle of the
// server entry would retain it, serializing or not.
const defaultDisabledFeatures = () => Feature.AggregateError | Feature.BigIntTypedArray;

// A serialized Error's `.stack` leaks server file paths, internal function
// names and the shape of the deployment to anyone who can trigger a throw,
// so it's stripped from everything serialized outside development — there
// the paths are the developer's own and the stack is actually useful.
// Serialize-side only and applied on top of any `disabledFeatures` override
// (compat tuning shouldn't silently reopen the leak); the decode side stays
// permissive so a payload that does carry a stack (e.g. from a development
// peer) still deserializes. NODE_ENV is read at call time so the default
// tracks the environment — but it describes the PROCESS, not the artifact:
// a production build run with NODE_ENV=development (a base image, a stray
// dotenv) would ship stacks — application-code stacks, for errors marked
// safe with markSafeError — to ordinary callers (#3152). The explicit
// `serializeErrorStacks` option exists to pin the policy to the deployment
// instead of the ambient variable.
const serializeOnlyDisabledFeatures = (serializeErrorStacks?: boolean) =>
  (
    serializeErrorStacks === undefined
      ? process.env.NODE_ENV === "development"
      : serializeErrorStacks
  )
    ? 0
    : Feature.ErrorPrototypeStack;

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
export const createPlugin = createPluginImpl as <Value, Info extends PluginInfo>(
  plugin: SerializerPlugin<Value, Info>
) => SerializerPlugin<Value, Info>;

export interface OpaqueReference<V = unknown, R = undefined> {
  readonly value: V;
  readonly replacement?: R;
}

export const OpaqueReference: {
  new <V, R = undefined>(value: V, replacement?: R): OpaqueReference<V, R>;
} = OpaqueReferenceImpl as any;
/**
 * Creates a streaming Seroval serializer preconfigured with the web plugin
 * set and the default feature policy. Emits JavaScript chunks (through
 * `onData`) that reconstruct the values under `globalIdentifier` when
 * evaluated — the script-injection form of serialization renderers build
 * on. For a JSON-based wire codec (no eval on the receiving side), use
 * `serializeJSON` / `createJSONDeserializer` instead.
 *
 * Integration-facing; may change (see the entry banner).
 */
export function createSerializer(options: WebSerializerOptions): Serializer;

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
        ? defaultDisabledFeatures()
        : options.disabledFeatures) | serializeOnlyDisabledFeatures(options.serializeErrorStacks)
  });
} /**
 * Renderer primitive — the serializer SSR uses for hydration output. Pins
 * the hydration global (`_$HY.r`) and feature policy; only the wiring
 * options (callbacks, scope, extra plugins) are configurable. Not meant
 * for hand-written code — custom serialization should use
 * `createSerializer` or the JSON codec.
 * @internal
 */
export function createHydrationSerializer(options: HydrationSerializerOptions): {
  write(key: string, value: unknown): void;
  flush(): void;
  close(): void;
};

// The keyed writes both render codecs share. Each `write` runs one seroval
// stream session: `serialize(key, value, callbacks, live)` starts it and
// returns its dispose, and the codec checks `live(initial)` before it hands
// out a chunk, which is false once `close()` ran. Writes after `flush()` are
// dropped, and `onDone` fires once `flush()` was called and every write
// settled. A write settles on its own `onDone`, except one whose value fails
// inside the call and hands out no initial chunk: seroval reports that
// through `onError`, and when the value failed to parse it never reaches the
// write's `onDone`, so a render with such a write never completed. That
// write settles on return instead, disposed so nothing it started outlives
// it. A write whose initial chunk went out by the time the call returns
// keeps its session, even if a chunk replayed from a stream's buffer failed
// before it, and settles on `onDone` like any later failure. Without
// `onError` seroval throws, as before.
function createKeyedSerializer(serialize, onError, onDone) {
  const cancels = new Set();
  let pendingWrites = 0;
  let flushed = false;
  let done = false;
  let closed = false;
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
      // Sync values settle inside the serialize call, before the cancel
      // function exists — track with a flag instead of the handle.
      let settled = false;
      let failed = false;
      let started = false;
      let cancel = null;
      const settle = () => {
        if (settled) return;
        settled = true;
        if (cancel) cancels.delete(cancel);
        pendingWrites--;
        maybeDone();
      };
      const stream = serialize(
        key,
        value,
        {
          onError:
            onError &&
            (err => {
              failed = true;
              onError(err);
            }),
          onDone: settle
        },
        initial => {
          if (initial) started = true;
          return !closed;
        }
      );
      if (settled) return;
      // A `close()` from inside the call could not dispose this write yet.
      if (closed || (failed && !started)) {
        stream();
        settle();
        return;
      }
      cancel = stream;
      cancels.add(cancel);
    },
    flush() {
      flushed = true;
      maybeDone();
    },
    // Disposes every write still in flight, then completes: `renderToStream`
    // tears down through here and its `onDone` returns early on a dead
    // render.
    close() {
      closed = flushed = true;
      for (const cancel of cancels) cancel();
      cancels.clear();
      if (!done) {
        done = true;
        onDone && onDone();
      }
    }
  };
}

// seroval's `serializeString`, which its entry doesn't export: a key goes
// into a double-quoted literal inside a <script>, so `<` is escaped too.
const KEY_ESCAPES = {
  '"': '\\"',
  "\\": "\\\\",
  "\n": "\\n",
  "\r": "\\r",
  "\b": "\\b",
  "\t": "\\t",
  "\f": "\\f",
  "<": "\\x3C",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029"
};
const serializeKey = key =>
  ("" + key).replace(/["\\\n\r\b\t\f<\u2028\u2029]/g, c => KEY_ESCAPES[c]);

/**
 * Serializer for SSR hydration output. Pins the hydration global (`_$HY.r`)
 * and feature policy — only the wiring options (callbacks, scope, extra
 * plugins) are configurable. Keyed like seroval's `Serializer` (same
 * output), but every write settles, failed ones included.
 */
export function createHydrationSerializer({ onData, onDone, scopeId, onError, plugins }) {
  const resolvedPlugins = resolveSerializerPlugins(plugins);
  const disabledFeatures = defaultDisabledFeatures() | serializeOnlyDisabledFeatures();
  const refs = new Map();
  return createKeyedSerializer(
    (key, value, callbacks, live) =>
      crossSerializeStream(value, {
        scopeId,
        refs,
        plugins: resolvedPlugins,
        disabledFeatures,
        onSerialize(data, initial) {
          if (!live(initial)) return;
          onData(initial ? HYDRATION_GLOBAL + '["' + serializeKey(key) + '"]=' + data : data);
        },
        ...callbacks
      }),
    onError,
    onDone
  );
} /**
 * Renderer primitive — returns the cross-reference bootstrap script SSR
 * emits ahead of hydration data for a render scope. Not meant for
 * hand-written code.
 * @internal
 */
export function getLocalHeaderScript(id?: string): string;

export function getLocalHeaderScript(id) {
  return getCrossReferenceHeader(id) + ";";
} /**
 * Serializes `value` as SerovalNode chunks delivered through `onParse` —
 * the encoding half of the eval-free JSON codec (RPC-style transports;
 * the deserializing peer needs no script evaluation, so CSP-safe). Wire
 * framing of the nodes is the transport's concern. Returns a cancel
 * function that aborts pending async serialization.
 *
 * Integration-facing; may change (see the entry banner).
 */
export function serializeJSON(value: unknown, options: JSONSerializeOptions): () => void;

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
    disabledFeatures:
      resolved.disabledFeatures | serializeOnlyDisabledFeatures(resolved.serializeErrorStacks)
  });
} /**
 * The keyed, streaming encoder of the eval-free JSON codec — the render
 * stream's data serializer (frames default to it). Each `write(key, value)`
 * shares one reference space, so cross-record identity holds; `flush()`
 * marks the write set complete (writes after it are dropped, mirroring the
 * hydration serializer); `close()` aborts pending async serialization and
 * calls `onDone` once.
 */
export function createJSONSerializer(options: JSONSerializerOptions): {
  write(key: string, value: unknown): void;
  flush(): void;
  close(): void;
};

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
 * has been called and every pending value has settled, or once `close()`
 * runs. Writes after flush are dropped, mirroring the hydration serializer.
 */
export function createJSONSerializer({
  onData,
  onDone,
  onError,
  plugins,
  disabledFeatures,
  depthLimit,
  serializeErrorStacks
}) {
  const resolved = resolveCodecOptions({
    plugins,
    disabledFeatures,
    depthLimit,
    serializeErrorStacks
  });
  const refs = new Map();
  return createKeyedSerializer(
    (key, value, callbacks, live) =>
      toCrossJSONStream(value, {
        refs,
        plugins: resolved.plugins,
        disabledFeatures:
          resolved.disabledFeatures | serializeOnlyDisabledFeatures(resolved.serializeErrorStacks),
        onParse(node, initial) {
          if (live(initial)) onData({ key, node, initial });
        },
        ...callbacks
      }),
    onError,
    onDone
  );
}
