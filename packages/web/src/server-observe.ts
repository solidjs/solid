// The server runtime's observe surface: `OBSERVE.server` (see `ServerObserve`
// in @solidjs/signals). `solid-js`'s server entry owns the OBJECTS — generic
// containers created once per process under a registered `globalThis`
// symbol, so a consumer can subscribe before this runtime has loaded and
// from a second bundled copy of it — and this module owns the FACTS and the
// TYPES: it emits invocations into the listener set and augments the
// interface with the channel's shape, so neither signals nor solid-js learn
// the server runtime's records.
//
// Everything here folds out of the prod server artifacts behind the
// `"_SOLID_OBSERVE_"` literal (replaced per build, like the `_SOLID_DEV_`
// gates in server.ts): prod never reads `OBSERVE`, which is `undefined`
// there anyway.
//
// State is read off the shared object under solid-js's registered symbol,
// never kept in this module: the server runtime is bundled once per entry —
// dist/server.*, server-functions/dist/server.*, frames/dist/server.* each
// carry their own copy of src/server.ts and of this file — and a subscriber
// must be reached by an invocation observed in any of them.
import { OBSERVE } from "solid-js";
import type { RequestEvent } from "./server.js";

/**
 * One server function execution, delivered on `OBSERVE.server.invocations`
 * once it settled. Serializable — the live handles (`event`, `args`, the
 * thrown error) travel beside it in `InvocationLive`, not on it.
 */
export interface InvocationEvent {
  /** The function id — the name a span or a log line carries. */
  id: string;
  /** `true` for an in-process call during SSR, `false` for HTTP dispatch. */
  direct: boolean;
  /** `performance.now()` when the execution started. */
  at: number;
  /**
   * Start → settle of the execution, in milliseconds. The execution is the
   * `wrapInvocation`-wrapped run: what the request spent on the call,
   * policy included (auth guards, per-function middleware). A generator or
   * stream body settles at handoff — see `deferred`.
   */
  durationMs: number;
  outcome: "ok" | "error";
  /**
   * The settled value is a body the caller drives — a generator, a
   * `ReadableStream` — so `durationMs` covers the call that produced it,
   * not its consumption.
   */
  deferred?: true;
}

/**
 * The live half of an invocation, for in-process consumers. Not part of the
 * record: `args` and `result` are application data (name/PII policy belongs
 * to the consumer), `error` is the value AS THROWN — before the HTTP
 * handler's production sanitization replaces it on the wire — and `event`
 * is the request event the call ran under (the per-call derived event for
 * direct calls).
 */
export interface InvocationLive {
  event: RequestEvent;
  /** HTTP dispatch only; absent for direct calls. */
  request?: Request;
  args: unknown[];
  /** The settled value, when `outcome` is `"ok"`. */
  result?: unknown;
  /** The thrown value, when `outcome` is `"error"`. */
  error?: unknown;
}

export type InvocationListener = (event: InvocationEvent, live: InvocationLive) => void;

/**
 * The server-function invocation channel — `OBSERVE.server.invocations`.
 * An observer's seam, as opposed to `wrapInvocation`, the app's single
 * policy hook: any number of listeners, none of them able to replace the
 * result or alter the call. Listeners run synchronously at settle; one
 * that throws is reported and the call is unaffected.
 */
export interface InvocationChannel {
  subscribe(type: "invocation", listener: InvocationListener): () => void;
}

// Augmented through `solid-js` — the peer every consumer of this package
// resolves — rather than `@solidjs/signals`, which is a transitive
// dependency a strict package layout does not expose from here. The
// interface is declared in signals and re-exported by solid-js; the merge
// follows the alias to the declaration (pinned by the type tests).
declare module "solid-js" {
  interface ServerObserve {
    /** Server-function executions — see `InvocationChannel`. */
    invocations: InvocationChannel;
  }
}

/** What the runtime passes an observation from either dispatch leg. */
export interface InvocationContext {
  id: string;
  direct: boolean;
  event: RequestEvent;
  request?: Request;
  args: unknown[];
}

// Replaced per build; a module const (not an inline literal) so the typed
// gates below read as booleans (cookies.ts uses the same shape).
const IS_OBSERVE = "_SOLID_OBSERVE_" as unknown as boolean;

// The state key on the channel object: a Map from record type to its listener
// set. The channel is `solid-js`'s (`serverSlots` in its server entry —
// created per process under a registered symbol, so a subscription made
// before this module loaded, or from another copy of it, is found here).
// Re-created by name — the contract is the registered string, not an import.
const LISTENERS = Symbol.for("solid-js/observe/server/listeners");

type ChannelState = InvocationChannel & { [LISTENERS]: Map<string, Set<InvocationListener>> };

function invocationListeners(): Set<InvocationListener> | undefined {
  if (!IS_OBSERVE || OBSERVE === undefined) return undefined;
  const channel = OBSERVE.server.invocations as ChannelState | undefined;
  return channel && channel[LISTENERS].get("invocation");
}

// `instanceof` is realm-local; the intrinsic brand accepts a genuine Promise
// from another realm without adopting arbitrary thenables — the same rule
// the server-functions runtime settles results by.
function settledPromise(value: unknown): Promise<unknown> | undefined {
  if (value instanceof Promise) return value;
  try {
    if (Object.prototype.toString.call(value) === "[object Promise]")
      return Promise.prototype.then.call(value, (v: unknown) => v) as Promise<unknown>;
  } catch {}
  return undefined;
}

// A body the CALLER drives, per the runtime's own deferred-result rules
// (`bindDeferredBody`): the call handed it back, its work happens later.
function isDeferredBody(value: unknown): boolean {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return false;
  if (typeof ReadableStream !== "undefined" && value instanceof ReadableStream) return true;
  const v = value as any;
  if (typeof v[Symbol.asyncIterator] === "function") return true;
  return (
    typeof v[Symbol.iterator] === "function" &&
    !Array.isArray(value) &&
    !(value instanceof Map) &&
    !(value instanceof Set) &&
    !ArrayBuffer.isView(value)
  );
}

function deliver(
  listeners: Set<InvocationListener>,
  context: InvocationContext,
  at: number,
  outcome: "ok" | "error",
  value: unknown
): void {
  const record: InvocationEvent = {
    id: context.id,
    direct: context.direct,
    at,
    durationMs: performance.now() - at,
    outcome
  };
  const live: InvocationLive = { event: context.event, args: context.args };
  if (context.request !== undefined) live.request = context.request;
  if (outcome === "ok") {
    live.result = value;
    if (isDeferredBody(value)) record.deferred = true;
  } else live.error = value;
  // Snapshot: a listener unsubscribing (itself or another) mid-delivery
  // must not skip or double-call anyone this round.
  for (const listener of [...listeners]) {
    try {
      listener(record, live);
    } catch (error) {
      console.error(error);
    }
  }
}

/**
 * Runs `execute` — the wrapped server-function execution — and reports it
 * on the invocation channel once it settles: synchronously for a sync
 * return or throw, at resolution/rejection for a promise. Returns
 * `execute`'s value (a promise is re-wrapped, still a native Promise);
 * throws what it throws. With no listener, or outside observe builds, it
 * is `execute()` and nothing else.
 */
export function observeInvocation<T>(context: InvocationContext, execute: () => T): T {
  const listeners = invocationListeners();
  if (listeners === undefined || listeners.size === 0) return execute();
  const at = performance.now();
  let result: T;
  try {
    result = execute();
  } catch (error) {
    deliver(listeners, context, at, "error", error);
    throw error;
  }
  const promised = settledPromise(result);
  if (promised !== undefined) {
    return promised.then(
      value => {
        deliver(listeners, context, at, "ok", value);
        return value;
      },
      error => {
        deliver(listeners, context, at, "error", error);
        throw error;
      }
    ) as T;
  }
  deliver(listeners, context, at, "ok", result);
  return result;
}
