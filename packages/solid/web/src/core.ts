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
function memo<T>(fn: () => T, equals: boolean) {
  return createMemo(fn, undefined, !equals ? { equals } : undefined);
}

export {
  getOwner,
  createComponent,
  createRoot as root,
  createRenderEffect as effect,
  memo,
  sharedConfig,
  awaitSuspense as asyncWrap
};
