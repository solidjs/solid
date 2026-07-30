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
  Hydration
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

// The frame sink's optional context barrier for a server component's own
// render ("user context does not cross a server component root"). The sink
// guards the call — `runInServerComponentScope ? runInServerComponentScope(render) : render()`
// — so cores without a barrier export undefined and rendering proceeds
// plain. Solid opts out for now: server components render on the server
// where context comes from the request-scoped tree the integration builds
// per render, so the divergence the barrier prevents (a t=0 inline read
// resolving an app-level provider that a standalone refetch render would
// miss) is left to land with its own tests rather than stubbed in blind.
export const runInServerComponentScope = undefined;
