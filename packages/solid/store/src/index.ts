export { createStore, unwrap, $RAW } from "./store.js";
export type {
  Store,
  SetStoreFunction,
  NotWrappable,
  SolidStore,
  StoreNode,
  StoreSetter,
  StorePathRange,
  ArrayFilterFn,
  Part,
  DeepReadonly,
  DeepMutable
} from "./store.js";
export * from "./mutable.js";
export * from "./modifiers.js";

// dev
import { $NAME, $NODE, isWrappable } from "./store.js";
export const DEV = "_SOLID_DEV_" ? ({ $NAME, $NODE, isWrappable } as const) : undefined;
