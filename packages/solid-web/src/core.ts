//@ts-nocheck
import { createMemo, createOwner, createRenderEffect, runWithOwner } from "solid-js";
export {
  getOwner,
  runWithOwner,
  createComponent,
  createRoot as root,
  sharedConfig,
  untrack,
  merge as mergeProps,
  flatten,
  ssrHandleError,
  ssrScope,
  // Hydration-zone components: the frame sink renders server-owned content
  // under NoHydration (no `_hk` keys, no async-value hydration records — the
  // HTML is the data) and re-enters via Hydration for client positions.
  NoHydration,
  Hydration,
  // Context barrier for server-component render roots: user context does not
  // cross (a refetch renders standalone, so t=0 must agree), while boundary
  // plumbing (Loading/Errored/reveal coordination) still does.
  runInServerComponentScope
} from "solid-js";

const transparentOptions = { transparent: true, sync: true };
const syncOptions = { sync: true };
// `scope: true` (set by insert for compiler-tagged hole accessors) makes the
// render effect non-transparent so the hole gets its own id scope, mirroring
// the server's ssrScope owner.
export const effect = (fn, effectFn, options) =>
  createRenderEffect(
    fn,
    effectFn,
    options ? { sync: true, ...options, transparent: !options.scope } : transparentOptions
  );

export const memo = fn => createMemo(() => fn(), syncOptions);

// Runs `fn` under an owner whose hydration-id chain is rooted at `id`.
// Both builds compose child keys from the owner chain (getNextChildId), so
// the same call on the server (document render) and the client (adopting
// slot render) yields identical `_hk` keys — which is what lets frame slot
// claims match by key regardless of tree position.
export const runWithHydrationScope = (id, fn) => runWithOwner(createOwner({ id }), fn);
