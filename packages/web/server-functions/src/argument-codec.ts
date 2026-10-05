// @ts-nocheck
// The codec for server-function ARGUMENTS — the one client → server leg.
//
// The web plugin set is shared by every face of the codec, and on the
// server → client leg (results, hydration, flight data) `Response` and
// `Request` are ordinary values to hand a page. On the way in they are not:
// they are transport objects, and the handler gives a returned `Response`
// the HTTP answer it describes. An argument is client input, so it never
// decodes into one — wherever it sits, nested values and the contents of
// promises and streams included.
//
// The server decodes arguments with the configured plugin list (app plugins
// first, then the defaults — the ordinary composition) with both plugins
// filtered out, so the codec meets their tags as unknown and fails the
// decode. The list is resolved once per plugin configuration and handed to
// the decoder whole, keeping its size at or under the default set's: the
// codec re-resolves its plugin list on every chunk, so a longer list is a
// per-chunk cost on every streamed argument.
//
// The rich-args encoder refuses the same two types, so a client handing
// one to a server function fails at the call site instead of at a 400.

const RESPONSE_TAG = "seroval-plugins/web/Response";
const REQUEST_TAG = "seroval-plugins/web/Request";
const REFUSED_TAGS = [RESPONSE_TAG, REQUEST_TAG];
const RESOLVED_PLUGINS = Symbol.for("solid.codec.resolvedPlugins");

// Brands the refusal so dispatch's malformed-arguments 400 can name it in development.
const REFUSED_ARGUMENT = Symbol("solid.serverFunction.refusedArgument");

/** The refusal: thrown by the encoder, and answered as a 400 by dispatch. */
export function refusedArgumentError(name = "Response or Request") {
  const error = new TypeError(
    `Server function arguments cannot carry Response or Request values (got a ${name}). ` +
      "Pass the data it holds — its body, headers or url — instead."
  );
  error[REFUSED_ARGUMENT] = true;
  return error;
}

/** The refusal behind `error`, if any: the codec reports a plugin's throw as the `cause` of its own error. */
export function refusedArgument(error) {
  for (let depth = 0; depth < 4 && error !== null && typeof error === "object"; depth++) {
    if (error[REFUSED_ARGUMENT] === true) return error;
    error = error.cause;
  }
}

// ---- Decode (server) ----

const refused = plugin => REFUSED_TAGS.includes(plugin.tag);
const reachesRefused = plugin =>
  refused(plugin) || (!!plugin.extends && plugin.extends.some(reachesRefused));

// The codec's own resolution order — each plugin, then what it extends,
// first occurrence wins — minus the refused tags. A kept plugin whose
// `extends` reaches a refused one is copied without its `extends` (its other
// dependencies are already in the list), or the codec would resolve the
// refused plugin back in through it.
function filterPlugins(plugins, out, seen) {
  for (const plugin of plugins) {
    if (seen.has(plugin)) continue;
    seen.add(plugin);
    if (refused(plugin)) continue;
    const severs = !!plugin.extends && plugin.extends.some(reachesRefused);
    out.push(severs ? { ...plugin, extends: undefined } : plugin);
    if (plugin.extends) filterPlugins(plugin.extends, out, seen);
  }
  return out;
}

let defaultArgumentPlugins;
const customArgumentPlugins = new WeakMap();

/**
 * The codec options server-function arguments decode with: `codec` with its
 * complete plugin list resolved and the refused types filtered out.
 * `defaults` is the codec's default plugin set (from the lazily loaded
 * decode module).
 */
export function argumentDecodeCodec(codec, defaults) {
  const custom = codec && codec.plugins;
  let plugins = custom ? customArgumentPlugins.get(custom) : defaultArgumentPlugins;
  if (!plugins) {
    plugins = filterPlugins(custom ? [...custom, ...defaults] : defaults, [], new Set());
    if (custom) customArgumentPlugins.set(custom, plugins);
    else defaultArgumentPlugins = plugins;
  }
  return { ...codec, [RESOLVED_PLUGINS]: plugins };
}

/**
 * Whether a framed argument payload names a refused type. Read only on a
 * decode that already failed: a payload naming one can never decode (its
 * tag has no plugin), so this tells the refusal apart from every other
 * malformed payload. A plugin node spells its tag as `"c":"<tag>"`; inside a
 * JSON string the quotes would be escaped, so payload data cannot spell it.
 */
export function namesRefusedType(payload) {
  for (const tag of REFUSED_TAGS) if (payload.includes(`"c":"${tag}"`)) return true;
  return false;
}

// ---- Encode (rich-args client) ----

function encodeRefusal(name) {
  const refuse = () => {
    throw refusedArgumentError(name);
  };
  return {
    tag: `seroval-plugins/web/${name}`,
    test: value => typeof globalThis[name] === "function" && value instanceof globalThis[name],
    parse: { sync: refuse, async: refuse, stream: refuse },
    serialize: refuse,
    deserialize: refuse
  };
}

let encodeRefusals;

/** The configured codec options with encode-side refusals ahead of every plugin. */
export function argumentEncodeCodec(codec) {
  if (!encodeRefusals) encodeRefusals = [encodeRefusal("Response"), encodeRefusal("Request")];
  const refusals = encodeRefusals;
  return {
    ...codec,
    plugins: codec && codec.plugins ? [...refusals, ...codec.plugins] : refusals
  };
}
