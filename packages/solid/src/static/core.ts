import {
  createRoot,
  createEffect,
  createMemo,
  getContextOwner
} from "./reactive";

import { createComponent } from "./rendering";

export { getContextOwner as currentContext, createComponent, createRoot as root, createEffect as effect, createMemo as memo }
