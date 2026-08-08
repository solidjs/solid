import {
  createOwner,
  disposeOwner,
  getOwner,
  runWithOwner,
  createLoadingBoundary as coreLoadingBoundary,
  NotReadyError,
  ErrorContext,
  getContext,
  setContext,
  runWithBoundaryErrorContext,
  RevealGroupContext
} from "./signals.js";
import { sharedConfig, NoHydrateContext } from "./shared.js";
import type { SSRTemplateObject, HydrationContext } from "./shared.js";
import type { Accessor } from "./signals.js";
import type { Element as SolidElement } from "../types.js";

export { sharedConfig, NoHydrateContext } from "./shared.js";
export type { HydrationContext, SSRTemplateObject } from "./shared.js";

/**
 * Handles errors during SSR rendering.
 * Returns the promise source for NotReadyError (for async handling),
 * or delegates to the ErrorContext handler.
 *
 * `probe: true` is the side-effect-free identification mode: it answers the
 * pending source for NotReady and `undefined` for anything else, never
 * routing or rethrowing. Used where the caller only wants to know whether a
 * throw was a pending read (e.g. the head registry's shell-hold path) while
 * keeping real errors on their existing handling path.
 */
export function ssrHandleError(err: any, probe?: boolean) {
  if (err instanceof NotReadyError) {
    return (err as any).source as Promise<any>;
  }
  if (probe) return;
  // Retry passes re-pull holes from flush microtasks with no ambient owner;
  // a bare getContext there throws NoOwnerError, masking the real error on
  // its way to the renderer's containment. No owner simply means no boundary
  // handler.
  const handler = getOwner() ? getContext(ErrorContext) : null;
  if (handler) {
    handler(err);
    return;
  }
  throw err;
}

export function createLoadingBoundary<T, U>(
  fn: () => T,
  fallback: () => U,
  options?: { on?: () => any }
): Accessor<T | U> {
  const currentCtx = sharedConfig.context;
  if (!currentCtx) {
    return coreLoadingBoundary(fn, fallback);
  }
  // Under an SSR context the accessor yields resolved template fragments, not
  // T/U — the declared signature is the isomorphic contract the renderer and
  // client share; the SSR plumbing below is cast to it.
  return ssrLoadingBoundary(currentCtx, fn, fallback) as unknown as Accessor<T | U>;
}

function ssrLoadingBoundary(
  currentCtx: HydrationContext,
  fn: () => any,
  fallback: () => any
): () => unknown {
  const ctx = currentCtx;
  const parent = getOwner();
  const parentHandler = parent && runWithOwner(parent, () => getContext(ErrorContext));
  const revealGroup = parent && runWithOwner(parent, () => getContext(RevealGroupContext));
  const o = createOwner();
  // Boundaries sever reveal-group coordination for their subtree (matching the
  // client): only direct Loading children of a Reveal join its group. A nested
  // Loading is covered by its own fallback inside the (possibly held) slot and
  // activates independently instead of delaying the ancestor group (#2871).
  setContext(RevealGroupContext, null, o);
  const id = o.id!;
  (o as any).id = id + "00"; // fake depth to match client's createLoadingBoundary nesting

  let done: ((value?: string, error?: any) => boolean) | undefined;
  let handledRenderError: any;
  let retryPromise: Promise<any> | undefined;
  let serializeBuffer: [string, any, boolean?][] = [];
  // Once this boundary has flushed, it never buffers again (resets only happen
  // during retry discovery, before the first flush). A chained async source can
  // resolve *after* the boundary commits — e.g. `b` depends on `a`, so `b`
  // serializes only once `a` settled and the boundary already flushed. Those
  // late serializations must write through to the parent ctx instead of landing
  // in a buffer that will never flush again (which would orphan the fragment).
  let flushed = false;
  const bufferedCtx = Object.create(ctx) as typeof ctx;
  bufferedCtx.serialize = (id: string, value: any, deferStream?: boolean) => {
    if (flushed) ctx.serialize(id, value, deferStream);
    else serializeBuffer.push([id, value, deferStream]);
  };
  // Asset attribution (`_currentBoundaryId`) is NOT set here. The property is
  // an accessor inherited from the root context over a single shared tracking
  // slot — assigning it through `bufferedCtx` would mutate that shared state
  // with no restore, leaking this boundary's id to later document-order
  // siblings (a root-level lazy() after this boundary would file its module
  // under this boundary's already-serialized asset map, #2860). Every render
  // phase already scopes the id correctly: `runLoadingPhase` passes it to
  // `runWithBoundaryErrorContext`, which sets and restores it around the run.

  function flushSerializeBuffer() {
    for (const args of serializeBuffer) ctx.serialize(args[0], args[1], args[2]);
    serializeBuffer = [];
    flushed = true;
  }

  function commitBoundaryState() {
    flushSerializeBuffer();
    const modules = ctx.getBoundaryModules?.(id);
    if (modules) ctx.serialize(id + "_assets", modules);
  }

  function runLoadingPhase<T>(render: () => T): T {
    handledRenderError = undefined;
    return runWithBoundaryErrorContext(
      o,
      render,
      (err: any, parentHandler) => {
        handledRenderError = err;
        if (done?.(undefined, err)) throw err;
        if (parentHandler) {
          parentHandler(err);
          return;
        }
        throw err;
      },
      bufferedCtx,
      id
    );
  }

  // Only ever called from the async resume loop below — there is nothing on
  // the stack to catch a throw from here. The initial (synchronous) discovery
  // pass propagates unhandled errors directly out of runLoadingPhase to the
  // renderToStream caller; by resume time that caller is gone, and a throw
  // would escape the un-awaited async function as an unhandled rejection and
  // take the host process down. `done(undefined, err)` handles the streamed
  // case (the fragment template swaps in and `<key>_fr` rejects, so the
  // client error path takes over) but answers false before the shell has
  // flushed — for that pre-shell case, and for a parent handler that itself
  // throws, route through the renderer's containment channel instead: the
  // request fails (onError + wind-down), the process survives.
  function finalizeError(err: any) {
    if (handledRenderError === err) {
      handledRenderError = undefined;
      return;
    }
    if (done?.(undefined, err)) return;
    if (!parentHandler) {
      ctx.failRender ? ctx.failRender(err) : console.error(err);
      return;
    }
    try {
      runWithOwner(parent!, () => parentHandler(err));
    } catch (caught) {
      if (caught !== err) {
        ctx.failRender ? ctx.failRender(caught) : console.error(caught);
      }
    }
  }

  function runDiscovery(): SSRTemplateObject | undefined {
    disposeOwner(o, false);
    serializeBuffer = [];
    retryPromise = undefined;
    return runLoadingPhase(() => {
      try {
        return ctx.resolve(fn());
      } catch (err) {
        if (err instanceof NotReadyError) {
          retryPromise = (err as any).source as Promise<any>;
          return undefined;
        }
        throw err;
      }
    }) as any;
  }

  // Boundary output accessors are live-hole opt-outs (`$lhSkip`): the
  // boundary owns its own update lifecycle (fragment write + reveal), so a
  // live binding over its output would at best sweep a constant forever and
  // at worst wrap the placeholder in markers that outlive the swap. Same
  // tag, same reason as slot getters — a position some other machinery owns.
  const skipLive = (f: () => unknown) => Object.assign(f, { $lhSkip: true });

  let ret = runDiscovery();
  if (!retryPromise && !ret?.p?.length) {
    commitBoundaryState();
    return skipLive(() => ret);
  }

  const regResult = revealGroup ? revealGroup.register(id) : null;
  const collapseFallback = regResult?.collapseFallback ?? false;

  if (collapseFallback && !ctx.async) {
    commitBoundaryState();
    ctx.serialize(id, "$$f");
    return skipLive(() => undefined);
  }

  const fallbackOwner = createOwner({ id });
  const fallbackResult = runWithOwner(fallbackOwner, () => {
    if (!ctx.async) return fallback();
    const tpl = collapseFallback
      ? [`<template id="pl-${id}">`, `</template><!--pl-${id}-->`]
      : [`<template id="pl-${id}"></template>`, `<!--pl-${id}-->`];
    return ctx.ssr(tpl, ctx.escape(fallback()));
  });

  if (ctx.async) {
    const regOpts = revealGroup ? { revealGroup: revealGroup.id } : undefined;
    done = ctx.registerFragment(id, regOpts);
    (async () => {
      try {
        while (retryPromise) {
          await retryPromise.catch(() => {});
          ret = runDiscovery();
        }
        commitBoundaryState();
        while (ret && ret.p && ret.p.length) {
          const pending = ret as { t: string[]; h: Function[]; p: Promise<any>[] };
          await Promise.all(pending.p).catch(() => {});
          ret = runLoadingPhase(() => ctx.ssr(pending.t, ...pending.h)) as any;
        }
        flushSerializeBuffer();
        done!(ret && Array.isArray(ret.t) ? ret.t[0] : ((ret && ret.t) as any));
      } catch (err) {
        finalizeError(err);
      } finally {
        // The slot settles either way: on error, `done(undefined, err)` wrote
        // the fragment template and rejects `key_fr`, so the client error path
        // takes over. Releasing after done() keeps activation behind the
        // template write. Skipping release on error parks a sequential
        // frontier on this boundary forever, so resolved later siblings never
        // get their activation script (#2776).
        if (revealGroup) revealGroup.onResolved(id);
      }
    })();
    return skipLive(() => fallbackResult);
  }

  commitBoundaryState();
  ctx.serialize(id, "$$f");
  return skipLive(() => fallbackResult);
}

export { ssrScope } from "./signals.js";

/**
 * Disables hydration for its children during SSR.
 * Elements inside will not receive hydration keys (`_hk`) and signals will not be serialized.
 * Use `Hydration` to re-enable hydration within a `NoHydration` zone.
 */
export function NoHydration(props: { children: SolidElement }): SolidElement {
  const o = createOwner();
  return runWithOwner(o, () => {
    setContext(NoHydrateContext, true);
    return props.children;
  }) as unknown as SolidElement;
}

/**
 * Re-enables hydration within a `NoHydration` zone, establishing a new ID namespace.
 * Pass an `id` prop matching the client's `hydrate({ renderId })` to align hydration keys.
 * Has no effect when not inside a `NoHydration` zone (passthrough).
 */
export function Hydration(props: { id?: string; children: SolidElement }): SolidElement {
  if (!getContext(NoHydrateContext)) return props.children as unknown as SolidElement;
  const o = createOwner({ id: props.id ?? "" });
  return runWithOwner(o, () => {
    setContext(NoHydrateContext, false);
    return props.children;
  }) as unknown as SolidElement;
}
