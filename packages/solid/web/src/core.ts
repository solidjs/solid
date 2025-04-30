//@ts-nocheck
import { createMemo } from "solid-js";
export {
  getOwner,
  createComponent,
  createRoot as root,
  createRenderEffect as effect,
  sharedConfig,
  untrack,
  mergeProps
} from "solid-js";

export const memo = fn => createMemo(() => fn());
