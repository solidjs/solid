import { ROOT_ERROR_HOOK } from "./scheduler.js";
import type { Owner } from "./types.js";

/**
 * The client error hook — the prod-tier seam through which an app or an
 * error monitor hears the one failure nothing else can see: an error
 * boundary (`createErrorBoundary`, `<Errored>`) collected it and is rendering
 * its fallback. The browser's global handlers hear what reaches
 * `window.onerror`; a rendered fallback never does. An UNCAUGHT error is not
 * this hook's: the halt (`REACTIVITY_HALTED`) hands its cause to the
 * platform's `reportError`, the channel every monitor already listens on —
 * one event, not two.
 *
 * Called once per error object: a boundary's `reset()` recomputing the same
 * failing node re-collects the same error and does not report it again.
 * Two tiers: ambient (`configureClientErrors`) and per root
 * (`render`/`hydrate`'s `onError` in `@solidjs/web`), the nearest root's
 * winning. Fires in every tier; no return — the client has no wire to map
 * for. `ownerPath` carries the component labels where the runtime keeps
 * owner names (the observe and dev artifacts).
 *
 * Pay-for-use: this module is retained by `createErrorBoundary` (which
 * reports here) or the app's own `configureClientErrors` import. A root's
 * hook is parked ON the root owner under a registered symbol
 * (`ROOT_ERROR_HOOK`, defined in the scheduler), so `render` writes it
 * without importing anything: an app that configures no hook and renders no
 * boundary carries none of this.
 */
export interface ClientErrorContext {
  /**
   * Where the error was THROWN: labels root-first up the owner chain of the
   * computation that threw — component labels and named primitives — when
   * the runtime keeps owner names (the observe and dev artifacts). The
   * boundary's own chain when the thrower is unknown (a value thrown
   * outside any computation).
   */
  ownerPath?: string[];
  /**
   * Where the error was MET: the same labels up the chain of the `<Errored>`
   * that rendered its fallback for it — what the user saw, as against
   * `ownerPath`, which is what broke.
   */
  boundaryPath?: string[];
}
export type ClientErrorHook = (error: unknown, context: ClientErrorContext) => void;

export interface ClientErrorsConfig {
  /** The hook, or `undefined` to clear it. */
  onError?: ClientErrorHook;
}

let ambientHook: ClientErrorHook | undefined;
const reported = new WeakSet<object>();

/**
 * Registers the ambient client error hook — the one call a browser `init()`
 * makes to see every failure a boundary renders a fallback for, in
 * production. (Uncaught errors reach `reportError` / `window.onerror`.)
 *
 * ```ts
 * configureClientErrors({
 *   onError: (error, { ownerPath }) =>
 *     Sentry.captureException(error, {
 *       mechanism: { type: "solid.error_boundary", handled: true }
 *     })
 * });
 * ```
 */
export function configureClientErrors(config: ClientErrorsConfig): void {
  if (config && config.onError !== undefined && typeof config.onError !== "function") {
    throw new TypeError(`Invalid onError: expected a function, received ${typeof config.onError}.`);
  }
  ambientHook = config ? config.onError : undefined;
}

/** The nearest root's hook above `owner` (parked under `ROOT_ERROR_HOOK`), else the ambient one. */
function hookFor(owner: Owner | null | undefined): ClientErrorHook | undefined {
  for (let o = owner; o; o = o._parent) {
    const hook = (o as any)[ROOT_ERROR_HOOK];
    if (hook !== undefined) return hook;
  }
  return ambientHook;
}

/** Component labels up the owner chain, root first — `_name` where the runtime keeps it. */
function labels(owner: Owner | null | undefined): string[] | undefined {
  const path: string[] = [];
  for (let o = owner; o; o = o._parent) {
    const name = (o as any)._name;
    if (typeof name === "string" && name.length) path.push(name);
  }
  return path.length ? path.reverse() : undefined;
}

/**
 * Tells the client error hook about `error`, caught by the boundary whose
 * owner is `owner`, thrown by `thrower` (the computation the engine's status
 * wrapper named; unknown for a value that never crossed one) — once per
 * error object. A throwing hook is reported on the console and otherwise
 * ignored — a monitor must never take the app down.
 * @internal
 */
export function reportClientError(
  error: unknown,
  owner: Owner | null | undefined,
  thrower?: Owner | null
): void {
  const isObject = error !== null && (typeof error === "object" || typeof error === "function");
  if (isObject) {
    if (reported.has(error as object)) return;
    reported.add(error as object);
  }
  const hook = hookFor(owner);
  if (hook === undefined) return;
  const context: ClientErrorContext = {};
  const boundary = labels(owner);
  const path = labels(thrower) ?? boundary;
  if (path !== undefined) context.ownerPath = path;
  if (boundary !== undefined) context.boundaryPath = boundary;
  try {
    hook(error, context);
  } catch (hookError) {
    console.error(hookError);
  }
}
