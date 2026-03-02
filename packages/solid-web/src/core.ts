//@ts-nocheck
import { createMemo, createRenderEffect } from "solid-js";
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

export const memo = fn => createMemo(() => fn());
