import {
  createOwner,
  getNextChildId,
  runWithOwner,
  createLoadingBoundary,
  NotReadyError,
  ErrorContext,
  getContext,
  setContext
} from "./signals.js";
import { sharedConfig, NoHydrateContext } from "./shared.js";
import type { SSRTemplateObject } from "./shared.js";
import type { JSX } from "../jsx.js";

export { sharedConfig, NoHydrateContext } from "./shared.js";
export type { HydrationContext, SSRTemplateObject } from "./shared.js";

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
export function Loading(props: {
  fallback?: JSX.Element;
  on?: any;
  children: JSX.Element;
}): JSX.Element {
  const ctx = sharedConfig.context;
  if (!ctx) {
    return createLoadingBoundary(
      () => props.children,
      () => props.fallback
    ) as unknown as JSX.Element;
  }

  const o = createOwner();
  const id = o.id!;
  (o as any).id = id + "00"; // fake depth to match client's createLoadingBoundary nesting

  let runPromise: Promise<any> | undefined;
  let serializeBuffer: [string, any, boolean?][] = [];
  const origSerialize = ctx.serialize;

  function runInitially(): SSRTemplateObject {
    // Dispose children from previous attempt — signals now resets _childCount on dispose
    // so IDs are stable across re-render attempts.
    o.dispose(false);
    // Buffer serialization so only the final attempt's writes are committed.
    // Previous buffers are discarded implicitly when runInitially re-runs.
    serializeBuffer = [];
    ctx!.serialize = (id: string, p: any, deferStream?: boolean) => {
      serializeBuffer.push([id, p, deferStream]);
    };
    const prevBoundary = ctx!._currentBoundaryId;
    ctx!._currentBoundaryId = id;
    const result = runWithOwner(o, () => {
      try {
        return ctx!.resolve(props.children);
      } catch (err) {
        runPromise = ssrHandleError(err);
      }
    }) as any;
    ctx!._currentBoundaryId = prevBoundary;
    ctx!.serialize = origSerialize;
    return result;
  }

  let ret = runInitially();
  // never suspended — flush buffer and return directly
  if (!(runPromise || ret?.p?.length)) {
    for (const args of serializeBuffer) origSerialize(args[0], args[1], args[2]);
    serializeBuffer = [];
    const modules = ctx.getBoundaryModules?.(id);
    if (modules) ctx.serialize(id + "_assets", modules);
    return ret as unknown as JSX.Element;
  }

  const fallbackOwner = createOwner({ id });
  getNextChildId(fallbackOwner); // move counter forward

  if (ctx.async) {
    const done = ctx.registerFragment(id);
    (async () => {
      try {
        while (runPromise) {
          o.dispose(false);
          await runPromise;
          runPromise = undefined;
          ret = runInitially();
        }
        for (const args of serializeBuffer) origSerialize(args[0], args[1], args[2]);
        serializeBuffer = [];
        while (ret.p.length) {
          await Promise.all(ret.p);
          ret = runWithOwner(o, () => ctx.ssr(ret.t, ...ret.h)) as any;
        }
        done!(ret.t[0]);
      } catch (err) {
        done!(undefined, err);
      }
    })();

    return runWithOwner(fallbackOwner, () =>
      ctx.ssr(
        [`<template id="pl-${id}"></template>`, `<!--pl-${id}-->`],
        ctx.escape(props.fallback)
      )
    ) as unknown as JSX.Element;
  }

  // Non-async fallback: flush buffered serializations
  for (const args of serializeBuffer) origSerialize(args[0], args[1], args[2]);
  serializeBuffer = [];
  const modules = ctx.getBoundaryModules?.(id);
  if (modules) ctx.serialize(id + "_assets", modules);
  ctx.serialize(id, "$$f");
  return runWithOwner(fallbackOwner, () => props.fallback) as unknown as JSX.Element;
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
