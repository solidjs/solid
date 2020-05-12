import {
  createRoot,
  createEffect,
  createMemo,
  equalFn,
  createComponent,
  getContextOwner
} from "../index.js";

// reactive injection for dom-expressions
function memo(fn: () => any, equal: boolean) {
  if(typeof fn !== "function") return fn;
  if (!equal) return createMemo(fn);
  return createMemo(fn, undefined, equalFn);
}

export { getContextOwner as currentContext, createComponent, createRoot as root, createEffect as effect, memo }
