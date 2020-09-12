import {
  createRoot,
  createRenderEffect,
  createMemo,
  getContextOwner
} from "./reactive";

import { createComponent } from "./rendering";

export { getContextOwner as currentContext, createComponent, createRoot as root, createRenderEffect as effect, createMemo as memo }
