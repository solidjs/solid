// Serialization surface (published as `@solidjs/web/serialization`): the
// runtime's Seroval machinery, exposed for the runtime's own entries and
// for integrations building transports on the same codec. This is
// INTEGRATION-FACING plumbing, not application API — it is exempt from the
// 2.0 stability guarantee and may change between releases. Application and
// router code should configure `codec` on the server-function entries
// instead of importing from here.
import type { Serializer } from "seroval";
import {
  JSONCodecOptions,
  PluginInfo,
  SerializerPlugin,
  SerovalNode
} from "./serializer-decode.js";

// The decode half — `SerovalNode`, the plugin TYPES, `DEFAULT_WEB_PLUGINS`,
// `resolveSerializerPlugins`, `JSONCodecOptions`, `createJSONDeserializer`,
// `createJSONDataTable` — is declared in serializer-decode.d.ts (published
// as `@solidjs/web/serialization/decode`, the module lazy client consumers
// load) and re-exported here so this remains the full surface.
export * from "./serializer-decode.js";

// ---- Plugin authoring ----
//
// Unlike the rest of this entry, plugin authoring is APPLICATION-FACING —
// it is the supported way to feed the serializers' `plugins` options and
// the server-function entries' `codec.plugins`. The values re-export
// seroval's own (`createPlugin`, `OpaqueReference` — see serializer.js);
// the plugin TYPES live in serializer-decode.d.ts (hand-declared there —
// see its banner for why).

/**
 * Builds a `SerializerPlugin` — seroval's `createPlugin`, re-exported so
 * plugin authors stay on the exact seroval instance/version the runtime
 * serializes with. Import it from HERE, not from your own `seroval`
 * dependency: a plugin built against a different copy/version would not
 * fail the build — it would emit nodes the other peer can't interpret.
 *
 * Application-facing (see the plugin-authoring banner above).
 */
export function createPlugin<Value, Info extends PluginInfo>(
  plugin: SerializerPlugin<Value, Info>
): SerializerPlugin<Value, Info>;

/**
 * Seroval's `OpaqueReference`, re-exported from the runtime's own instance
 * (an `OpaqueReference` from another seroval copy fails the serializer's
 * instanceof check and serializes as a plain value): wraps a value so it
 * crosses the wire as its `replacement` (default `undefined`) while
 * staying readable in-process through `.value`.
 *
 * Application-facing (see the plugin-authoring banner above).
 */
export class OpaqueReference<V, R = undefined> {
  readonly value: V;
  readonly replacement?: R;
  constructor(value: V, replacement?: R);
}

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
  /** Extra plugins, composed ahead of `DEFAULT_WEB_PLUGINS`. */
  plugins?: SerializerPlugin[];
  /** Receives each emitted script chunk. */
  onData: (result: string) => void;
  onError?: (error: unknown) => void;
  /** Fires once all async values have settled. */
  onDone?: () => void;
}

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
 * Options for `createHydrationSerializer` — `WebSerializerOptions` minus
 * the knobs hydration pins (`globalIdentifier`, `disabledFeatures`).
 * @internal
 */
export type HydrationSerializerOptions = Omit<
  WebSerializerOptions,
  "globalIdentifier" | "disabledFeatures"
>;

/**
 * Renderer primitive — the serializer SSR uses for hydration output. Pins
 * the hydration global (`_$HY.r`) and feature policy; only the wiring
 * options (callbacks, scope, extra plugins) are configurable. Not meant
 * for hand-written code — custom serialization should use
 * `createSerializer` or the JSON codec.
 * @internal
 */
export function createHydrationSerializer(options: HydrationSerializerOptions): Serializer;

/**
 * Renderer primitive — returns the cross-reference bootstrap script SSR
 * emits ahead of hydration data for a render scope. Not meant for
 * hand-written code.
 * @internal
 */
export function getLocalHeaderScript(id?: string): string;

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

/**
 * Serializes `value` as SerovalNode chunks delivered through `onParse` —
 * the encoding half of the eval-free JSON codec (RPC-style transports;
 * the deserializing peer needs no script evaluation, so CSP-safe). Wire
 * framing of the nodes is the transport's concern. Returns a cancel
 * function that aborts pending async serialization.
 *
 * Integration-facing; may change (see the entry banner).
 */
export function serializeJSON(value: unknown, options: JSONSerializeOptions): () => void;

/** Options for `createJSONSerializer`. */
export interface JSONSerializerOptions extends JSONCodecOptions {
  /**
   * Receives each keyed record — `initial` is true for a key's first node
   * (the written value itself); async values patch through later records
   * under the same key. The decoding peer is `createJSONDataTable`.
   */
  onData: (record: { key: string; node: SerovalNode; initial: boolean }) => void;
  onError?: (error: unknown) => void;
  /** Fires once `flush()` has been called and every pending value settled. */
  onDone?: () => void;
}

/**
 * The keyed, streaming encoder of the eval-free JSON codec — the render
 * stream's data serializer (frames default to it). Each `write(key, value)`
 * shares one reference space, so cross-record identity holds; `flush()`
 * marks the write set complete (writes after it are dropped, mirroring the
 * hydration serializer); `close()` aborts pending async serialization.
 */
export function createJSONSerializer(options: JSONSerializerOptions): {
  write(key: string, value: unknown): void;
  flush(): void;
  close(): void;
};
