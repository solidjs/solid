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
  runInServerComponentScope,
  // Reactive-scope creation stamp: the live-hole engine diffs it around a
  // hole evaluation to detect render-once work (owner allocations — memos,
  // boundaries, providers) and latch instead of binding. Stubbed to 0 on the
  // client entry, where the engine never runs.
  creationStamp,
  // Barrier membership read: the document face arms one live-hole engine
  // for the whole render, and this gates minting to holes inside a server
  // component's scope. Stubbed to false on the client entry.
  inServerComponentScope
} from "solid-js";

const transparentOptions = { transparent: true, sync: true };
const syncOptions = { sync: true };
// `scope: true` (set by insert for compiler-tagged hole accessors) makes the
// render effect non-transparent so the hole gets its own id scope, mirroring
// the server's ssrScope owner.
export const effect = (fn, effectFn, options?) =>
  createRenderEffect(
    fn,
    effectFn,
    options ? { sync: true, ...options, transparent: !options.scope } : transparentOptions
  );

// NOT transparent, despite the temptation (#3033): the compiler emits
// `_$memo` in two roles, and one is id-load-bearing. Besides pure condition
// memos (`() => !!cond`), the ssr generate wraps whole hole bodies in
// `_$memo` — the compute CREATES the branch's templates (`ssrHydrationKey()`
// mints inside it), so the memo's id slot is the retry-stable scope a
// deferred hole re-runs under. Making it transparent leaks the branch keys
// onto the parent's live counter and breaks async-hole parity (pinned by the
// async-cond-before-for harness scenario).
export const memo = fn => createMemo(() => fn(), syncOptions);

// Runs `fn` under an owner whose hydration-id chain is rooted at `id`.
// Both builds compose child keys from the owner chain (getNextChildId), so
// the same call on the server (document render) and the client (adopting
// slot render) yields identical `_hk` keys — which is what lets frame slot
// claims match by key regardless of tree position.
export const runWithHydrationScope = (id, fn) => runWithOwner(createOwner({ id }), fn);

// DR-2 value tier, document face: an async slot arg's INLINE read (the fill
// rendering server-side into the document at t=0) must suspend like any
// server async read instead of handing the fill the raw promise. A full
// (async-aware) memo IS that contract: the read throws `NotReadyError` until
// the promise settles, then reads as the settled value — the engine's hole
// machinery catches and re-pulls, so the covering boundary holds exactly as
// it does for any pending server read. `serialize: false` keeps the memo out
// of the hydration payload: the arg already ships once, through the slot
// record (single-copy). The frame sink pre-taps async iterables down to a
// promise of their first yield (markup is the V1 snapshot), so this only
// ever sees thenables.
export const ssrAsyncValue = value => createMemo(() => value, { serialize: false });

// Client CSS reveal gate (dom-expressions docs/client-css-reveal-gating.md):
// reading an unsettled asset promise throws `NotReadyError` so tracked
// contexts (transitions, boundary reveals) hold and retry when it settles;
// no-op once settled. The runtime only calls this while the asset registry
// reports the promise pending, so a settled promise never re-enters the
// async machinery. One async node per promise, shared across readers and
// dropped with the promise (WeakMap). The node is created OUTSIDE the
// calling compute (`runWithOwner(null)`): waitAsset is called from compute
// phases, and a node owned by the computing owner would be disposed by the
// very retry it triggers. Detached creation also keeps it hydration-id
// neutral — it must never consume a child id from the calling owner chain.
const assetGates = new WeakMap();
export const waitAsset = promise => {
  let gate = assetGates.get(promise);
  if (!gate) {
    runWithOwner(null, () => {
      // NOT sync: the node must be async-aware (the promise is the value
      // being awaited; sync nodes reject thenable returns).
      gate = createMemo(() => promise);
    });
    assetGates.set(promise, gate);
  }
  gate();
};
