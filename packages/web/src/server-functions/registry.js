// The codec-free universal layer of the server function runtime: the
// declaration-metadata channel and the late-bound transport seam. Everything
// here is readable from an app's EAGER graph (re-exported through the core
// client/server entries) without pulling the transport or the codec along —
// this module must stay dependency-free: nothing in it may reach
// ../serializer.js (seroval + the web plugin set, ~9 KB gz) or the fetch
// transport. A router that merely needs to ASK "is this a server function,
// and how do I decode its responses?" imports from here; the answer for the
// second question is a slot the transport fills.

// The declaration-metadata channel. `GET(fn)` (and any future
// declaration-static capability) brands references with a metadata object
// under a registered symbol — surviving duplicated module instances, the
// same trick as the ResponseEnvelope brand — and routers/integrations read
// it back through the typed accessors instead of property sniffing.
export const SERVER_FUNCTION_METADATA = Symbol.for("solid.ServerFunctionMetadata");

/**
 * Reads a server function reference's declaration metadata (e.g.
 * `method: "GET"` for `GET(fn)` references). Returns undefined when `fn`
 * is not a server function reference; plain references carry an empty
 * metadata object.
 */
export function getServerFunctionMetadata(fn) {
  if (typeof fn !== "function") return undefined;
  return fn[SERVER_FUNCTION_METADATA] || undefined;
}

/**
 * Whether `fn` is a server function reference (a client proxy or a
 * server-side registered callable). Detection is by the registered-symbol
 * metadata brand, so it holds across duplicated module instances.
 */
export function isServerFunction(fn) {
  return typeof fn === "function" && !!fn[SERVER_FUNCTION_METADATA];
}

/**
 * Attaches user-declared transport metadata to a server function reference
 * (client proxy or server-registered callable) and returns the reference.
 * Writes ride the same channel `GET` uses: later writes shallow-merge over
 * earlier ones, and `getServerFunctionMetadata(fn)` reads the merged bag —
 * so `withMeta` composes with `GET` in either order.
 *
 * The pattern is declare-on-function, react-in-hook: metadata declared
 * here is what `prepareRequest` receives as `context.meta`, letting
 * session-dynamic transport policy key on declarations instead of
 * comparing function ids:
 *
 * ```ts
 * export const chargeCard = withMeta(async (amount: number) => {
 *   "use server";
 *   // ...
 * }, { requiresAuth: true });
 *
 * configureServerFunctionsClient({
 *   prepareRequest(init, { meta }) {
 *     if (meta?.requiresAuth) {
 *       return {
 *         ...init,
 *         headers: { ...init.headers, Authorization: `Bearer ${session.token()}` }
 *       };
 *     }
 *     return init;
 *   }
 * });
 * ```
 */
export function withMeta(fn, meta) {
  const metadata = getServerFunctionMetadata(fn);
  if (!metadata) {
    throw new Error("withMeta expects a server function reference");
  }
  Object.assign(metadata, meta);
  return fn;
}

// The live-source value brand. `live(fn)` declarations mark the async
// iterable a call produces — ON THE VALUE, not just the reference — so
// consumers meeting the result after it has traveled (through a promise
// resolution, a reactive computation, a face policy deciding how to render
// it) can still tell "this is a value-shaped stream with reconnect
// semantics" without holding the declaration. A registered symbol for the
// same reason as the metadata channel: duplicated module instances must
// agree by construction — and, like the metadata symbol, it is inert data:
// the branding and detection LOGIC lives with its users (the server
// dispatch path, face policies), never in this eager layer.
export const LIVE_SOURCE = Symbol.for("solid.LiveSource");

// ---- late-bound RPC seam ----
//
// The transport surface routers consume (`GET` re-declaration, response
// decoding) is registered here by the transport halves the moment a server
// function reference is CREATED — createServerReference/registerServerFunction
// calls, which only exist in a bundle when a `'use server'` function was
// actually compiled in. A router therefore never imports the transport
// statically: it reads this slot, and an app with no server functions reads
// undefined forever — no codec, no fetch client, no seroval in its eager
// graph. An app WITH server functions has the slot filled before any
// integration code can hold a reference (compiled output creates references
// at module scope, ahead of the user module that hands one to a router
// primitive), so integrations may assume a reference implies a registered
// RPC. Same null-slot economics as solid's enableHydration().
//
// The slot rides a registered symbol on globalThis — not module state —
// because this module lands in separately bundled copies (the core entry a
// router reads from, the server-functions entry the transport registers
// from), and all copies must agree by construction: the same reasoning as
// the element-claims registry and the RequestContext global.
const SERVER_FUNCTION_RPC = Symbol.for("solid.ServerFunctionRPC");

/**
 * Fills the RPC seam. Called by the transport halves (client fetch RPC,
 * server in-process dispatch) when the first server function reference is
 * created; first write wins — both halves register equivalent surfaces, and
 * a per-build half never coexists with the other build's.
 * @internal
 */
export function provideServerFunctionRPC(rpc) {
  globalThis[SERVER_FUNCTION_RPC] || (globalThis[SERVER_FUNCTION_RPC] = rpc);
}

/**
 * The registered RPC surface, or undefined when no server function exists
 * in this build's graph. Integration plumbing (routers): gate every use of
 * the transport/codec behind this read instead of importing it.
 * @internal
 */
export function getServerFunctionRPC() {
  return globalThis[SERVER_FUNCTION_RPC];
}
