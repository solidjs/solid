// @ts-nocheck
// @ts-expect-error seroval's published types omit these ESM named exports
import { createStream, Feature, fromCrossJSON } from "seroval";
import {
  AbortSignalPlugin,
  CustomEventPlugin,
  DOMExceptionPlugin,
  EventPlugin,
  FormDataPlugin,
  HeadersPlugin,
  ReadableStreamPlugin,
  RequestPlugin,
  ResponsePlugin,
  URLPlugin,
  URLSearchParamsPlugin
} from "seroval-plugins/web";
import {
  ContainerTracePlugin,
  setContainerTraceStreamMint
} from "../../frames/src/frame-container-plugin.js";

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
  /**
   * Whether serialized `Error`s carry their `.stack` — server file paths,
   * internal function names, the shape of the deployment — to the peer.
   * Defaults to `NODE_ENV === "development"`, but that signal describes the
   * PROCESS, not the artifact: a production build running with
   * `NODE_ENV=development` (a base image, a stray dotenv) ships stacks to
   * the wire — including for errors marked safe with `markSafeError`, whose
   * stacks traverse application code (#3152). Set `false` to pin production
   * disclosure regardless of the ambient variable. Encode-side only; the
   * decode side is always permissive, so it need not match peers.
   */
  serializeErrorStacks?: boolean;
}

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

// Container traces cross as RAW seroval streams so their buffered snapshot
// replays synchronously on the decode side (see the mint's doc in the
// plugin module). The mint lives HERE because every face that parses a
// trace resolves its plugin set through this module, and this module
// already carries seroval — the plugin module itself must stay seroval-free
// (it rides the eager frames-client graph; seroval has no `sideEffects`
// flag for a bundler to shake it out).
setContainerTraceStreamMint(iterable => {
  const stream = createStream();
  (async () => {
    try {
      for await (const value of iterable) stream.next(value);
      stream.return(undefined);
    } catch (error) {
      stream.throw(error);
    }
  })();
  return stream;
});

// The DECODE half of the serialization surface, split out so lazy client
// consumers (the frames data tables, `deserializeStream`) load only what
// reading a payload needs: `fromCrossJSON` and the plugin set — none of the
// encode machinery (the eval-style hydration `Serializer`,
// `toCrossJSONStream`) that only servers and the opt-in rich-args upload
// path use. seroval ships without `sideEffects: false`, so the split has to
// happen at the MODULE level: a dynamic import loads its module whole, and
// one entry carrying both halves costs every decoder the encoder too
// (~13 kB gz instead of ~6.5). serializer.js re-exports everything here, so
// the full `@solidjs/web/serialization` entry is unchanged for authoring
// and integrations.

/**
 * Baseline plugin set for serializing web-platform values. Shared by the
 * hydration serializer and any consumer building its own serializer (e.g.
 * server function transports). Plugin objects carry both their serialize
 * and deserialize halves, so the set lives on the decode side and the
 * encode module composes over it.
 */
export const DEFAULT_WEB_PLUGINS = Object.freeze([
  AbortSignalPlugin,
  // BlobPlugin,
  CustomEventPlugin,
  DOMExceptionPlugin,
  EventPlugin,
  // FilePlugin,
  FormDataPlugin,
  HeadersPlugin,
  ReadableStreamPlugin,
  RequestPlugin,
  ResponsePlugin,
  URLSearchParamsPlugin,
  URLPlugin,
  // The container tier's trace plugin (DR-2 case 3) is protocol, not an
  // integration choice: every face that could meet a traced container —
  // the hydration serializer, the frames codec, flight payloads, the
  // decode tables — resolves its plugin set through here, so carrying it
  // in the default set is what makes containers "nothing to wire". Inert
  // without a peer: it matches only sink-made envelopes (server) and
  // materializes only once the reactive core installs its hook (client).
  ContainerTracePlugin
]); /**
 * Composes custom plugins with `DEFAULT_WEB_PLUGINS`. Custom plugins come
 * first so they can shadow a default for values both would match. Returns a
 * fresh array; the defaults are never mutated. Useful when handing a full
 * plugin list to another serialization layer.
 *
 * Integration-facing; may change (see the entry banner).
 */
export function resolveSerializerPlugins(customPlugins?: SerializerPlugin[]): SerializerPlugin[];

/**
 * Composes user plugins with the default web set. Custom plugins come first
 * so they can shadow a default for values both would match.
 */
export function resolveSerializerPlugins(customPlugins) {
  return customPlugins ? [...customPlugins, ...DEFAULT_WEB_PLUGINS] : [...DEFAULT_WEB_PLUGINS];
}

// Codec payloads may come from an untrusted peer, so the defaults protect
// the decoding side: RegExp is disabled (ReDoS via deserialized patterns)
// and parse depth is capped well below Seroval's own limit.
const JSON_CODEC_DISABLED_FEATURES = Feature.RegExp;
const JSON_CODEC_DEPTH_LIMIT = 64;

// Single source of truth for codec defaults — encode and decode must agree
// on plugins and feature policy or payloads won't roundtrip. The encode
// half (serializer.js) imports this so one entry defines the contract.
export function resolveCodecOptions({
  plugins,
  disabledFeatures,
  depthLimit,
  serializeErrorStacks
}: JSONCodecOptions = {}) {
  return {
    plugins: resolveSerializerPlugins(plugins),
    disabledFeatures:
      disabledFeatures === undefined ? JSON_CODEC_DISABLED_FEATURES : disabledFeatures,
    depthLimit: depthLimit === undefined ? JSON_CODEC_DEPTH_LIMIT : depthLimit,
    serializeErrorStacks
  };
} /**
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
 * Creates the decoding counterpart of `serializeJSON`. The returned function
 * deserializes one SerovalNode chunk at a time; cross-references between
 * chunks resolve through a map shared across calls, so all chunks from one
 * stream must go through the same deserializer instance.
 */
/**
 * Whether a ref in a deserializer's shared map is a value only a LATER chunk
 * can settle. That map holds seroval's in-progress state between chunks: an
 * open stream under `__SEROVAL_STREAM__`, and a pending promise as the
 * `{p, s, f}` resolver triple (the promise under one id, its resolver under
 * the special-reference id next to it). One predicate for both readers of
 * that state — the sweep that settles them and the check that asks whether
 * any exist — so "still waiting" is one definition, not two.
 */
function awaitsLaterChunk(value) {
  if (value === null || typeof value !== "object") return false;
  return (
    !!value.__SEROVAL_STREAM__ ||
    (typeof value.s === "function" && typeof value.f === "function" && value.p instanceof Promise)
  );
}

export function createJSONDeserializer(options) {
  const refs = new Map();
  const resolved = resolveCodecOptions(options);
  // How many `refs` entries `ownDecodedPromises` has already claimed.
  // seroval never reassigns a ref id (a second write throws "Conflicted ref
  // id"), so the map only ever grows and iterates in insertion order:
  // skipping the entries already claimed makes the sweep amortized O(1) per
  // decoded node rather than O(refs) on every chunk of a long stream.
  let owned = 0;
  /**
   * Takes ownership of every promise this decoder has just minted.
   *
   * A decoded payload is a PEER's bytes, and a promise it decodes to is a
   * rejection nobody is holding: the value goes on to be a server function
   * argument, or a slot in a decoded result, and ordinary code does not
   * await a slot it never expected to be a promise. Under Node's default
   * policy that ends the process — so the decoder keeps a fallback owner on
   * what it mints, exactly as the encode side does for the promises IT
   * mints (`guardFailures`, server.js: "Keep a fallback owner on the
   * promise WE minted"). This changes nothing for a real consumer: `p`
   * still rejects for whoever awaits it; only the "nobody at all" case is
   * covered.
   *
   * It runs at the MINT, not at `abort`, because seroval has two promise
   * spellings and only one of them is still pending when a stream ends. The
   * constructor pair (`{p, s, f}` under the special-reference id, the bare
   * promise under its own) settles from a later chunk, so `abort` can still
   * reach it. The ATOMIC promise node (seroval type 12) settles
   * SYNCHRONOUSLY inside the `fromCrossJSON` call that reads it — by the
   * time any later hook runs, the microtask queue has drained and Node has
   * already reported the rejection. Both spellings put the bare promise in
   * `refs`, so claiming promises here covers the pair as well and there is
   * one guard rather than one per spelling.
   */
  function ownDecodedPromises() {
    if (refs.size === owned) return;
    let index = 0;
    for (const value of refs.values()) {
      if (index++ < owned) continue;
      if (value instanceof Promise) value.then(undefined, () => {});
    }
    owned = refs.size;
  }
  function deserializeJSONChunk(node) {
    try {
      return fromCrossJSON(node, { refs, ...resolved });
    } finally {
      // `finally`: a chunk that throws part-way through (a malformed node, a
      // depth-limit refusal) has already minted whatever it minted.
      ownDecodedPromises();
    }
  }
  /**
   * Fails every value still waiting on chunks that will never arrive. Both
   * kinds settle idempotently — throwing into a completed stream and
   * rejecting a resolved promise are no-ops — so the sweep is safe to run on
   * normal end-of-stream too. Settling is all this does: the rejection it
   * induces already has a fallback owner, put there by
   * `ownDecodedPromises` when the chunk that minted the promise was read.
   */
  deserializeJSONChunk.abort = function abort(error) {
    for (const value of refs.values()) {
      if (!awaitsLaterChunk(value)) continue;
      if (value.__SEROVAL_STREAM__) {
        value.throw(error);
      } else {
        value.f(error);
      }
    }
  };
  /**
   * Whether anything decoded so far can still be changed by a later chunk —
   * the question a reader asks before it stops reading. Answered from the
   * same refs the sweep above settles, so the two can never disagree about
   * what "still waiting" means.
   *
   * Conservative by construction: a resolver stays in the map after it
   * settles, so a stream or promise that is already done still answers
   * true. That is the safe direction. Saying "nothing is waiting" is a
   * licence to stop reading, and stopping early would strand a value that
   * was still on its way; saying it late only means the reader waits for
   * the peer's own end of body, which is what every reader did before.
   */
  deserializeJSONChunk.pending = function pending() {
    for (const value of refs.values()) {
      if (awaitsLaterChunk(value)) return true;
    }
    return false;
  };
  return deserializeJSONChunk;
}
export function createJSONDataTable(options?: JSONCodecOptions): JSONDataTable;

/**
 * Keyed decode table for `createJSONSerializer` output. Feed every data
 * record to `apply`: initial nodes land in the table under their key; later
 * nodes patch pending values (promise/stream resolutions) through the shared
 * deserializer refs. `resolve` reads a `{ $ref }` back out — the record ids
 * double as the reference namespace.
 */
export function createJSONDataTable(options) {
  const deserialize = createJSONDeserializer(options);
  const table = new Map();
  return {
    apply(record) {
      const value = deserialize(record.node);
      if (record.initial) table.set(record.key, value);
    },
    get(key) {
      return table.get(key);
    },
    resolve(ref) {
      return table.get(ref.$ref);
    }
  };
}
