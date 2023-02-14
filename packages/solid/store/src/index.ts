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
  StoreNode,
  StorePathRange,
  StoreSetter
} from "./store.js";
export * from "./mutable.js";
export * from "./modifiers.js";

// dev
import { $NODE, isWrappable, DevHooks } from "./store.js";
let DEV:
  | {
      $NODE: typeof $NODE;
      isWrappable: typeof isWrappable;
      hooks: typeof DevHooks;
    }
  | undefined;
if ("_SOLID_DEV_") DEV = { $NODE, isWrappable, hooks: DevHooks };
export { DEV };
