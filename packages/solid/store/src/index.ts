export { $RAW, createStore, unwrap } from "./store.js";
export type {
  ArrayFilterFn,
  DeepMutable,
  DeepReadonly,
  NotWrappable,
  Part,
  SetStoreFunction,
  SolidStore,
  Store,
  StoreBundle,
  StoreNode,
  StorePathRange,
  StoreSetter
} from "./store.js";
export * from "./mutable.js";
export * from "./modifiers.js";

// dev
import { $NODE, isWrappable, DevHooks, IS_DEV } from "./store.js";
export const DEV = IS_DEV ? ({ $NODE, isWrappable, hooks: DevHooks } as const) : undefined;
