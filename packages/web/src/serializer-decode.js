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
import { ContainerTracePlugin, setContainerTraceStreamMint } from "./frame-container-plugin.js";

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
]);

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
export function resolveCodecOptions({ plugins, disabledFeatures, depthLimit } = {}) {
  return {
    plugins: resolveSerializerPlugins(plugins),
    disabledFeatures:
      disabledFeatures === undefined ? JSON_CODEC_DISABLED_FEATURES : disabledFeatures,
    depthLimit: depthLimit === undefined ? JSON_CODEC_DEPTH_LIMIT : depthLimit
  };
}

/**
 * Creates the decoding counterpart of `serializeJSON`. The returned function
 * deserializes one SerovalNode chunk at a time; cross-references between
 * chunks resolve through a map shared across calls, so all chunks from one
 * stream must go through the same deserializer instance.
 */
export function createJSONDeserializer(options) {
  const refs = new Map();
  const resolved = resolveCodecOptions(options);
  function deserializeJSONChunk(node) {
    return fromCrossJSON(node, { refs, ...resolved });
  }
  /**
   * Fails every value still waiting on chunks that will never arrive. The
   * shared refs map holds seroval's in-progress state between chunks: open
   * streams (`__SEROVAL_STREAM__`) and pending-promise resolvers (`{p, s, f}`
   * — the promise under one id, its resolver under the special-reference id
   * next to it). Both settle idempotently — throwing into a completed stream
   * and rejecting a resolved promise are no-ops — so the sweep is safe to
   * run on normal end-of-stream too. The defusing handler on `p` keeps a
   * rejection nobody awaited (a pending promise the app never touched) from
   * surfacing as an unhandled rejection.
   */
  deserializeJSONChunk.abort = function abort(error) {
    for (const value of refs.values()) {
      if (value === null || typeof value !== "object") continue;
      if (value.__SEROVAL_STREAM__) {
        value.throw(error);
      } else if (
        typeof value.s === "function" &&
        typeof value.f === "function" &&
        value.p instanceof Promise
      ) {
        value.p.then(undefined, () => {});
        value.f(error);
      }
    }
  };
  return deserializeJSONChunk;
}

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
