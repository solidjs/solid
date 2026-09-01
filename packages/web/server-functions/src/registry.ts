// @ts-nocheck
export type {
  InvokeOptions,
  ServerFunction,
  ServerFunctionInvoker,
  ServerFunctionMetadata,
  ServerFunctionRPC
} from "./shared.js";
import type { InvokeOptions } from "./shared.js";
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

// The invocation channel. References (and declaration wrappers — GET, live)
// carry their per-call invoker under a registered symbol, and `invoke`
// dispatches to it. Core's wrappers forward it mechanically because they
// keep the call mapping 1:1 — one caller, one wire. Wrappers that SHARE
// calls (deduping caches, multicast channels) face a real decision first —
// a caller's signal cannot own a wire other callers are reading — so
// forwarding there is opt-in: adapt (caller-detach is the safe shape) or
// decline, in which case `invoke` answers with a directed error. Consumers
// that own per-call policy (data layers) sit BELOW such wrappers anyway:
// they hold the reference and invoke it directly with their own signal.
export const SERVER_FUNCTION_INVOKE = Symbol.for("solid.ServerFunctionInvoke");

// Refused options answer with a redirect, not a bare no: every concern that
// is not invocation-scoped (does not vary between calls of the same
// function) has a named home, and the error message points at it.
const INVOKE_OPTION_REDIRECTS = {
  headers:
    "Session-dynamic headers belong to the prepareRequest hook, declaration metadata to " +
    "withMeta(fn, meta), and data belongs in the arguments, where it is serialized, typed, " +
    "and part of the cache key.",
  method: "The method is declaration-scoped: declare the function with GET(fn).",
  body: "The arguments are the body: pass them in the args array.",
  timeout:
    "Compose timeouts through `signal` with AbortSignal.timeout(ms) (and AbortSignal.any to " +
    "combine it with a caller signal)."
};

/**
 * Applies a server function once with per-call, invocation-scoped options —
 * `Function.prototype.call` for server functions, the options bag in the
 * `thisArg` slot (declaration wrappers like `GET` and `withMeta` are `bind`:
 * they return a new reference with context baked in; `invoke` applies one
 * call and leaves no residue on the reference).
 *
 * ```ts
 * import { invoke } from "@solidjs/web/server-functions";
 *
 * const user = await invoke(getUser, { signal: controller.signal }, id);
 * ```
 *
 * Options are strictly invocation-scoped — things that vary between calls
 * of the SAME function and cannot be declared or configured: `signal`
 * (the call's lifecycle; aborting rejects the call and cancels the
 * request), `keepalive` (calls made while the page unloads), `priority`
 * (fetch priority hint). Anything with a longer lifetime is refused with a
 * pointer to its home: session-dynamic transport policy → `prepareRequest`;
 * declaration-static shape → `GET`/`withMeta`; call policy (retries,
 * dedupe, deadlines) → the data layer that owns the call, wired through
 * `signal`.
 *
 * Dispatches through the reference's invocation channel
 * (`SERVER_FUNCTION_INVOKE`). Core's declaration wrappers forward it —
 * `GET` invokes over its query encoding, `live` ends its iteration on
 * abort. Wrappers that share calls (caches, channels) may adapt or decline
 * it; a data layer needs neither — it holds the reference below such
 * wrappers and invokes it directly with its own signal. On the server the
 * call runs in-process: `signal`
 * rejects the caller (the work, like a server behind HTTP, runs on unless
 * the function observes a signal itself) and the transport hints are
 * no-ops, since they describe a wire that does not exist.
 */
export function invoke<A extends readonly any[], R>(
  fn: (...args: A) => R,
  options: InvokeOptions,
  ...args: A
): R;

/**
 * Applies a server function once with per-call, invocation-scoped options
 * (`signal`, `keepalive`, `priority`), dispatching through the reference's
 * invocation channel. Anything with a longer lifetime is refused with a
 * pointer to its home.
 */
export function invoke(fn, options, ...args) {
  const channel = typeof fn === "function" && fn[SERVER_FUNCTION_INVOKE];
  if (!channel) {
    throw new Error(
      isServerFunction(fn)
        ? "invoke: this wrapper does not forward the invocation channel " +
            "(SERVER_FUNCTION_INVOKE). Wrappers that share calls (caches, channels) opt in " +
            "deliberately — a caller's signal cannot own a wire other callers share. Invoke " +
            "the underlying reference directly, or use the wrapper's own per-call idioms."
        : "invoke expects a server function reference (or a wrapper that forwards its " +
            "invocation channel). Per-call options apply at the transport; for a data " +
            "layer's calls, use its per-call options instead."
    );
  }
  // The options bag is positional (the `thisArg` slot) so the call's own
  // arguments spread naturally — reject non-bags loudly rather than let a
  // forgotten bag swallow the first argument.
  if (options === null || typeof options !== "object") {
    throw new Error(
      "invoke's second argument is the invocation options bag: invoke(fn, { signal }, ...args)"
    );
  }
  const picked = {};
  for (const key in options) {
    if (key !== "signal" && key !== "keepalive" && key !== "priority") {
      throw new Error(
        `\`${key}\` is not an invocation option. ` +
          (INVOKE_OPTION_REDIRECTS[key] ||
            "Options here are strictly invocation-scoped (they vary between calls of the " +
              "same function): signal, keepalive, priority.")
      );
    }
  }
  if (options.signal !== undefined) picked.signal = options.signal;
  if (options.keepalive !== undefined) picked.keepalive = options.keepalive;
  if (options.priority !== undefined) picked.priority = options.priority;
  return channel(args, picked);
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
