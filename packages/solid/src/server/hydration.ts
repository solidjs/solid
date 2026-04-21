import {
  createOwner,
  getOwner,
  runWithOwner,
  createLoadingBoundary as coreLoadingBoundary,
  NotReadyError,
  ErrorContext,
  getContext,
  setContext,
  runWithBoundaryErrorContext
} from "./signals.js";
import { sharedConfig, NoHydrateContext } from "./shared.js";
import type { SSRTemplateObject, HydrationContext } from "./shared.js";
import type { Context } from "./signals.js";
import type { JSX } from "../jsx.js";

export { sharedConfig, NoHydrateContext } from "./shared.js";
export type { HydrationContext, SSRTemplateObject } from "./shared.js";

// --- Reveal SSR coordination ---

export type ServerRevealGroup = {
  id: string;
  /**
   * Register a child fragment (Loading) or composite child (inner Reveal).
   * Returns `collapseFallback` (hide fallback visually, used for collapsed-sequential
   * tail) and `held` (stash `revealFragments` swaps until the parent releases us).
   * `held` only applies when the caller is a nested Reveal — Loadings ignore it.
   */
  register(
    key: string,
    options?: { onActivate?: () => void }
  ): { collapseFallback: boolean; held: boolean };
  /** Called by a child when its subtree is fully resolved. */
  onResolved(key: string): void;
  /**
   * Called by a nested Reveal when it becomes "minimally resolved" under its own
   * order (together: fully resolved; sequential: first registered fragment resolved;
   * natural: any fragment resolved). Loadings don't fire this — their `onResolved`
   * implies minimal readiness at the same time.
   */
  onMinimallyResolved?(key: string): void;
};

export const RevealGroupContext: Context<ServerRevealGroup | null> = {
  id: Symbol("RevealGroupContext"),
  defaultValue: null
};

/**
 * Handles errors during SSR rendering.
 * Returns the promise source for NotReadyError (for async handling),
 * or delegates to the ErrorContext handler.
 */
export function ssrHandleError(err: any) {
  if (err instanceof NotReadyError) {
    return (err as any).source as Promise<any>;
  }
  const handler = getContext(ErrorContext);
  if (handler) {
    handler(err);
    return;
  }
  throw err;
}

/**
 * Tracks all resources inside a component and renders a fallback until they are all resolved
 *
 * On the server, this is SSR-aware: it handles async mode (streaming) by registering
 * fragments and resolving asynchronously, and sync mode by serializing fallback markers.
 *
 * @description https://docs.solidjs.com/reference/components/suspense
 */
export function createLoadingBoundary(
  fn: () => any,
  fallback: () => any,
  options?: { on?: () => any }
): () => unknown {
  const currentCtx = sharedConfig.context;
  if (!currentCtx) {
    return coreLoadingBoundary(fn, fallback);
  }
  const ctx = currentCtx;
  const parent = getOwner();
  const parentHandler = parent && runWithOwner(parent, () => getContext(ErrorContext));
  const revealGroup = parent && runWithOwner(parent, () => getContext(RevealGroupContext));
  const o = createOwner();
  const id = o.id!;
  (o as any).id = id + "00"; // fake depth to match client's createLoadingBoundary nesting

  let done: ((value?: string, error?: any) => boolean) | undefined;
  let handledRenderError: any;
  let retryPromise: Promise<any> | undefined;
  let serializeBuffer: [string, any, boolean?][] = [];
  const bufferedCtx = Object.create(ctx) as typeof ctx;
  bufferedCtx.serialize = (id: string, value: any, deferStream?: boolean) => {
    serializeBuffer.push([id, value, deferStream]);
  };
  bufferedCtx._currentBoundaryId = id;

  function flushSerializeBuffer() {
    for (const args of serializeBuffer) ctx.serialize(args[0], args[1], args[2]);
    serializeBuffer = [];
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

  function finalizeError(err: any) {
    if (handledRenderError === err) {
      handledRenderError = undefined;
      return;
    }
    if (done?.(undefined, err)) return;
    if (!parentHandler) throw err;
    try {
      runWithOwner(parent!, () => parentHandler(err));
    } catch (caught) {
      if (caught !== err) throw caught;
    }
  }

  function runDiscovery(): SSRTemplateObject | undefined {
    o.dispose(false);
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

  let ret = runDiscovery();
  if (!retryPromise && !ret?.p?.length) {
    commitBoundaryState();
    return () => ret;
  }

  const regResult = revealGroup ? revealGroup.register(id) : null;
  const collapseFallback = regResult?.collapseFallback ?? false;

  if (collapseFallback && !ctx.async) {
    commitBoundaryState();
    ctx.serialize(id, "$$f");
    return () => undefined;
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
        while (ret!.p.length) {
          await Promise.all(ret!.p).catch(() => {});
          ret = runLoadingPhase(() => ctx.ssr(ret!.t, ...ret!.h)) as any;
        }
        flushSerializeBuffer();
        done!(ret!.t[0]);
        if (revealGroup) revealGroup.onResolved(id);
      } catch (err) {
        finalizeError(err);
      }
    })();
    return () => fallbackResult;
  }

  commitBoundaryState();
  ctx.serialize(id, "$$f");
  return () => fallbackResult;
}

/**
 * Disables hydration for its children during SSR.
 * Elements inside will not receive hydration keys (`_hk`) and signals will not be serialized.
 * Use `Hydration` to re-enable hydration within a `NoHydration` zone.
 */
export function NoHydration(props: { children: JSX.Element }): JSX.Element {
  const o = createOwner();
  return runWithOwner(o, () => {
    setContext(NoHydrateContext, true);
    return props.children;
  }) as unknown as JSX.Element;
}

/**
 * Re-enables hydration within a `NoHydration` zone, establishing a new ID namespace.
 * Pass an `id` prop matching the client's `hydrate({ renderId })` to align hydration keys.
 * Has no effect when not inside a `NoHydration` zone (passthrough).
 */
export function Hydration(props: { id?: string; children: JSX.Element }): JSX.Element {
  if (!getContext(NoHydrateContext)) return props.children as unknown as JSX.Element;
  const o = createOwner({ id: props.id ?? "" });
  return runWithOwner(o, () => {
    setContext(NoHydrateContext, false);
    return props.children;
  }) as unknown as JSX.Element;
}
