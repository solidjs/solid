// The DECODE half of the serialization surface (published as
// `@solidjs/web/serialization/decode`): what reading a serialized payload
// needs — `fromCrossJSON`-backed deserializers and the shared plugin set —
// with none of the encode machinery. Lazy client consumers (the frames
// data tables, `deserializeStream`) load this module so the encode half
// never ships to a browser that only reads. The full serializer.d.ts
// re-exports everything here; see its banner for the stability contract
// (integration-facing, exempt from the 2.0 stability guarantee).
// ---- Plugin types ----
//
// Declared here by hand (seroval's published d.ts use extensionless
// ESM-relative imports that `moduleResolution: "nodenext"` cannot follow —
// a bare type re-export would silently degrade the surface to `any` under
// skipLibCheck, and an import would make every entry whose types reach
// this module — the MAIN client entry included, via the server-function
// seam's `JSONCodecOptions` — unimportable from a strict Node16 CJS
// consumer). The declarations mirror seroval ~1.5 exactly; the `~` pin is
// what makes mirroring safe. Plugin AUTHORING (`createPlugin`,
// `OpaqueReference`) lives on the full serialization entry.

/**
 * Seroval's node shape — the intermediate representation `serializeJSON`
 * emits and `createJSONDeserializer` consumes. Safe to `JSON.stringify`.
 * Declared by hand like the plugin types below (same rationale): the
 * observable envelope — a numeric type tag, an optional reference id —
 * with the rest owned by the codec. Real seroval nodes satisfy it; treat
 * it as an opaque token.
 *
 * Integration-facing; may change (see the entry banner).
 */
export interface SerovalNode {
  /** Node type tag (seroval-internal enum). */
  t: number;
  /** Reference id, when the node participates in cross-referencing. */
  i?: number | undefined;
  [key: string]: unknown;
}

/** Per-plugin bookkeeping seroval hands each plugin callback. */
export interface PluginData {
  id: number;
}

/**
 * The shape of a plugin's parsed payload: a map of `SerovalNode`s produced
 * by the parse contexts, consumed by `serialize`/`deserialize`.
 */
export type PluginInfo = { [key: string]: SerovalNode };

/** Parse context for `parse.sync`: turns child values into nodes. */
export interface SyncParsePluginContext {
  parse<T>(current: T): SerovalNode;
}

/** Parse context for `parse.async`: like sync, but child parses await. */
export interface AsyncParsePluginContext {
  parse<T>(current: T): Promise<SerovalNode>;
}

/**
 * Parse context for `parse.stream`: sync parsing plus the streaming
 * lifecycle (pending-state tracking, late node emission, cleanup).
 */
export interface StreamParsePluginContext {
  parse<T>(current: T): SerovalNode;
  parseWithError<T>(current: T): SerovalNode | undefined;
  isAlive(): boolean;
  pushPendingState(): void;
  popPendingState(): void;
  onParse(node: SerovalNode): void;
  onError(error: unknown): void;
  addCleanup(callback: () => void): void;
}

/** Serialize context: renders child nodes to JS source. */
export interface SerializePluginContext {
  serialize(node: SerovalNode): string;
}

/** Deserialize context: revives child nodes to runtime values. */
export interface DeserializePluginContext {
  deserialize<T>(node: SerovalNode): T;
}

/**
 * A Seroval plugin usable with the web serializers — teaches the codec how
 * to encode/decode a custom value type (`Value` is the value it matches,
 * `Info` its parsed payload). Supply matching plugins on both peers of a
 * transport. Bare `SerializerPlugin` (both parameters defaulted to `any`)
 * is the list-element type every `plugins` option accepts.
 *
 * Integration-facing; may change (see the entry banner).
 */
export interface SerializerPlugin<Value = any, Info extends PluginInfo = any> {
  /** A unique string identifying the plugin — namespace it (`"app/Thing"`). */
  tag: string;
  /** Dependency plugins, resolved ahead of this one. */
  extends?: SerializerPlugin[];
  /** Whether `value` is this plugin's to encode. */
  test(value: unknown): boolean;
  /** Parsing modes — provide the ones the transports you target use. */
  parse: {
    sync?: (value: Value, ctx: SyncParsePluginContext, data: PluginData) => Info;
    async?: (value: Value, ctx: AsyncParsePluginContext, data: PluginData) => Promise<Info>;
    stream?: (value: Value, ctx: StreamParsePluginContext, data: PluginData) => Info;
  };
  /** Renders the parsed payload as JS source (script-injection form). */
  serialize(node: Info, ctx: SerializePluginContext, data: PluginData): string;
  /** Revives the parsed payload back into the runtime value. */
  deserialize(node: Info, ctx: DeserializePluginContext, data: PluginData): Value;
}

/**
 * Baseline plugin set for serializing web-platform values (AbortSignal,
 * Event, FormData, Headers, ReadableStream, Request, Response, URL, ...).
 * Applied by every serializer in this module; custom plugins compose ahead
 * of it via `resolveSerializerPlugins`.
 *
 * Integration-facing; may change (see the entry banner).
 */
export const DEFAULT_WEB_PLUGINS: readonly SerializerPlugin[];

/**
 * Composes custom plugins with `DEFAULT_WEB_PLUGINS`. Custom plugins come
 * first so they can shadow a default for values both would match. Returns a
 * fresh array; the defaults are never mutated. Useful when handing a full
 * plugin list to another serialization layer.
 *
 * Integration-facing; may change (see the entry banner).
 */
export function resolveSerializerPlugins(customPlugins?: SerializerPlugin[]): SerializerPlugin[];

/**
 * Options shared by both halves of the JSON codec. All of them must match
 * on the serializing and deserializing peer or payloads will not
 * round-trip — for server functions, set them once through the
 * client/server `codec` config option.
 *
 * Integration-facing; may change (see the entry banner).
 */
export interface JSONCodecOptions {
  /** Extra plugins, composed ahead of `DEFAULT_WEB_PLUGINS`. Must match on both peers. */
  plugins?: SerializerPlugin[];
  /**
   * Seroval feature bitflags to exclude. Defaults to disabling `RegExp`
   * (payloads may come from an untrusted peer). Must match on both peers.
   * Outside development, the encoding side additionally strips
   * `Error.prototype.stack` on top of any override — serialized stacks leak
   * server paths to the client. Decoding stays permissive, so payloads from
   * a development peer still round-trip.
   */
  disabledFeatures?: number;
  /** Maximum parse/deserialize depth. Defaults to 64. Must match on both peers. */
  depthLimit?: number;
}

/**
 * Creates the decoding counterpart of `serializeJSON`. Cross-references
 * between chunks resolve through state shared across calls, so all chunks
 * from one stream must go through the same deserializer instance. The first
 * chunk's return value is the decoded source value; feeding later chunks
 * settles the async values referenced inside it.
 *
 * Integration-facing; may change (see the entry banner).
 */
export function createJSONDeserializer(options?: JSONCodecOptions): <T>(node: SerovalNode) => T;

/**
 * A resident, response-scoped decode table over the keyed JSON codec: apply
 * each frame `data` chunk with `apply`, resolve `{ $ref }` slot args with
 * `resolve`. The frames client host wires one per response
 * (`applyData: c => table.apply(c)`).
 *
 * Integration-facing; may change (see the entry banner). This serialization
 * entry is the single home of the data table — the frames client consumes
 * it internally rather than re-exporting it.
 */
export interface JSONDataTable {
  apply(chunk: { key?: string; node?: unknown; initial?: boolean }): void;
  resolve<T = unknown>(ref: { $ref: string }): T;
}
export function createJSONDataTable(options?: JSONCodecOptions): JSONDataTable;
