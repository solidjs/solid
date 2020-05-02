import {
  createRoot,
  createEffect,
  createMemo,
  equalFn,
  runtimeConfig,
  sample,
  getContextOwner
} from "../index.js";

// reactive injection for dom-expressions
export default {
  config: runtimeConfig,
  currentContext: getContextOwner,
  root: createRoot,
  ignore: sample,
  effect: createEffect,
  memo: (fn: () => any, equal: boolean) => {
    if (!equal) return createMemo(fn);
    return createMemo(fn, undefined, equalFn);
  }
};
