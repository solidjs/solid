//@ts-nocheck
import { createMemo, createRenderEffect } from "solid-js";
import { createMemo as coreMemo } from "@solidjs/signals";
export {
  getOwner,
  runWithOwner,
  createComponent,
  createRoot as root,
  sharedConfig,
  untrack,
  merge as mergeProps,
  flatten,
  ssrHandleError,
  ssrRunInScope
} from "solid-js";

export const effect = (fn, effectFn, initial) =>
  createRenderEffect(fn, effectFn, initial, { transparent: true });

export const memo = (fn, transparent) =>
  transparent
    ? fn.$r
      ? fn
      : coreMemo(() => fn(), undefined, { transparent: true })
    : createMemo(() => fn());
