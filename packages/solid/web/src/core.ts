//@ts-nocheck
import {
  createRoot,
  createRenderEffect,
  createMemo,
  createComponent,
  getOwner,
  sharedConfig,
  awaitSuspense
} from "solid-js";

// reactive injection for dom-expressions
function memo(fn: () => any, equal: boolean) { return createMemo(fn, undefined, equal); }

export { getOwner, createComponent, createRoot as root, createRenderEffect as effect, memo, sharedConfig, awaitSuspense as asyncWrap }
