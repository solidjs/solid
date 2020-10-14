export {
  createRoot,
  createSignal,
  createComputed,
  createRenderEffect,
  createEffect,
  createDeferred,
  createSelector,
  createMemo,
  getListener,
  onCleanup,
  onError,
  untrack,
  batch,
  on,
  createContext,
  useContext,
  getContextOwner,
  equalFn,
  requestCallback,
  createState,
  unwrap,
  $RAW,
  reconcile,
  produce,
  mapArray
} from "./reactive";

export {
  assignProps,
  splitProps,
  createComponent,
  For,
  Index,
  Show,
  Switch,
  Match,
  ErrorBoundary,
  Suspense,
  SuspenseList,
  createResource,
  createResourceState,
  useTransition,
  lazy,
  spread
} from "./rendering";

export type { State, SetStateFunction } from "./reactive";
export type { Component, LoadStateFunction, Resource } from "./rendering";

export {
  escape,
  ssrStyle,
  ssrClassList,
  ssrSpread,
  getHydrationKey,
  generateHydrationScript,
  dynamicProperty
} from "./runtime";

export {
  ssr,
  renderToString,
  renderToNodeStream
} from "./ssr";

import { ssrSpread } from "./runtime";
import { splitProps } from "./rendering";
export function Dynamic<T>(props: T & { component?: Function | string; children?: any }) {
  const [p, others] = splitProps(props, ["component", "children"]);
  const comp = p.component,
    t = typeof comp;

  if (comp) {
    if (t === "function") return (comp as Function)(others);
    else if (t === "string") {
      return `<${comp} ${ssrSpread(others, false, true)}>${p.children || ""}</${comp}>`;
    }
  }
}
