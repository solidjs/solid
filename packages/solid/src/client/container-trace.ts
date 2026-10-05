/**
 * `solid-js/internal/container-trace` — the client half of the container tier
 * at the slot border (DR-2 case 3): a server projection crosses a
 * serialization boundary as its TRACE and materializes back into a live local
 * projection. NOT public API (the `solid-js/internal` namespace): consumed by
 * `@solidjs/web/frames`, which loads this entry lazily — behind the first
 * frame whose slot args carry a trace — so the store engine (`createProjection`
 * and everything `@solidjs/signals/store` drags in, ~8 KB brotli) stays out of
 * a server-component page that never meets one.
 *
 * Its own dist entry, not a member of `solid-js`: that build is one flat
 * module, so any binding in it that references the engine welds the engine to
 * the eager chunk the moment anything imports the binding — a lazy
 * `import("solid-js/internal")` would split off a facade and leave the engine
 * where it was. This module reaches `createProjection` through
 * `@solidjs/signals` (per-module files the app bundler can assign to this
 * chunk) and takes the hydration dispatch and the patch protocol from
 * `solid-js` by name, so it behaves exactly as the wrapper did at every call
 * site while retaining nothing of the engine on the eager side.
 */
import {
  createProjection as coreProjection,
  createRoot as coreRoot,
  createSignal as coreSignal,
  getOwner,
  NotReadyError,
  runWithOwner,
  type Store
} from "@solidjs/signals";
// Read back from the main entry (external: the app's one instance, whose
// `enableHydration()` filled the adapter slot `withStoreHydration` reads).
// Property reads, not named imports, so a server-tier resolution of this
// entry (which has none of these) stays inert until something calls it.
import * as core from "solid-js";

// The seams, typed here because the main entry marks them `@internal`
// and strips them from its declarations — `sharedConfig` is public, listed
// for the same member-read discipline (the same arrangement as
// src/internal.ts). Each is a member read ON THE NAMESPACE BINDING at the
// call — never `const x = core` — so the bundler rewrites them to named
// imports of the one `solid-js` instance; a namespace that escapes into a
// variable retains every export of the flat main module (measured: +32 KB
// minified on the page, the store wrappers' engine edge included).
interface Seams {
  withStoreHydration<T>(
    coreFn: (fn: any, seed: any, options?: any) => T,
    fn: any,
    seed: any,
    options?: any
  ): T;
  applyPatches(target: any, patches: any[]): void;
  forwardIteratorReturn(it: any, value?: any): any;
  sharedConfig: { onHydrationEnd?: (callback: () => void) => void };
}
const applyPatches = (target: any, patches: any[]) =>
  (core as unknown as Seams).applyPatches(target, patches);
const forwardIteratorReturn = (it: any, value?: any) =>
  (core as unknown as Seams).forwardIteratorReturn(it, value);

/** The projection constructor with solid's hydration dispatch — what `createProjection` from `solid-js` does, minus the wrapper's own engine edge. */
const createProjection = (fn: (draft: any) => any, seed: any): Store<any> =>
  (core as unknown as Seams).withStoreHydration(coreProjection as any, fn, seed);

/**
 * A root with NO parent. Materialization runs at arg-read, under whatever
 * owner is reading — during hydration an id-carrying one — and a root
 * created there inherits the next child id, shifting every key the reader
 * mints after it. A resident materializer at t=0 thus consumed one root id
 * per trace while a late one (no ambient owner) consumed none, and the
 * sibling after the frame hydrated under different keys in the two runs.
 * The store is shared and memoized per trace; it belongs to no reader's
 * id space.
 */
const detachedRoot = <T>(init: () => T): T => runWithOwner(null, () => coreRoot(init))!;

/** Run `callback` once hydration has completed — now (a microtask) when none is in progress. */
function afterHydration(callback: () => void) {
  const onHydrationEnd = (core as unknown as Seams).sharedConfig.onHydrationEnd;
  onHydrationEnd ? onHydrationEnd(callback) : queueMicrotask(callback);
}

/**
 * Materialize a container TRACE — snapshot then patch batches, the
 * continuation protocol a server projection serializes as when it crosses a
 * boundary (hydration resume in solid-js; the slot border via the serializer's
 * container plugin) — into a live local projection. The result reads like
 * the server value did: not-ready until the snapshot lands, then a
 * read-only store the batches keep updating, done when the trace ends.
 *
 * Created under a detached root (see `detachedRoot`): revival can run inside
 * a render effect's owner, and the store is memoized per trace (see the
 * plugin's WeakMap) — a store owned by its first reader would be disposed by
 * that reader's re-render while other readers still hold it, and one rooted
 * under it would take a hydration id from it. Consumption is pull-driven and
 * the trace is response-bounded, so the projection settles on its own; GC
 * collects the pair with the trace.
 *
 * First READ during a claim (the document's hydration pass, or a frame
 * fill's scoped late claim), a replayed backlog beyond the snapshot is
 * PARKED until hydration ends (`onHydrationEnd`; the next microtask when the
 * document's pass is already over). The snapshot is the state the server's
 * markup shows; the claim renders the fill against that markup and trusts
 * it — a text hole is never rewritten during a claim — so a store already
 * past the markup left the DOM diverged from it for good (the trace had
 * nothing further to emit). Applied after the claim, the backlog re-runs
 * the fill's reads outside hydration and the DOM catches up: the same
 * parking solid's store-shaped async-iterable hydration applies to a
 * buffered backlog. First read outside a claim (a fresh mount), nothing is
 * parked;
 * live emissions are unaffected either way (they land after the claim by
 * construction). A failure applies in order, after what was queued before
 * it, so it, too, waits on a parked backlog.
 *
 * Consumed by the serialization layer (`@solidjs/web/frames`). Declared, not
 * stripped: this entry's whole surface is the seam, and the subpath's
 * namespace is what makes it non-public.
 */
export function materializeContainerTrace(
  marker: {
    $tr: AsyncIterable<any> | { __SEROVAL_STREAM__: true };
    $ta?: number;
  },
  claiming?: boolean
): Store<any> {
  const src = marker.$tr as any;
  // Raw seroval stream (the wire shape since the stream-mint protocol):
  // `.on()` replays buffered emissions SYNCHRONOUSLY, so a snapshot the
  // document already delivered is applied before the first read — the store
  // reads as READY during hydration's synchronous claim walk, matching the
  // page's settled markup. The async-iterable branch below (pre-stream
  // payloads) can only surface its buffer through microtasks, which made a
  // settled-inline boundary suspend at the walk and hydrate a phantom
  // fallback over settled markup (the chat welcome/status meter miss).
  if (src != null && src.__SEROVAL_STREAM__ === true) {
    const queue: any[] = [];
    let failed: { error: any } | undefined;
    let cursor = 0;
    let first = true;
    // How far into the queue a compute may apply: everything, except a
    // claim's replayed backlog beyond the snapshot, parked until hydration
    // ends (see above).
    let limit = Infinity;
    // Everything lives under the root (see the block comment below):
    // materialization runs at arg-read inside a reader's render scope, and
    // a version signal owned by that reader would be disposed by its
    // re-render while the memoized store lives on.
    return detachedRoot(() => {
      const [version, setVersion] = coreSignal(0);
      // Subscribe before creating the projection: the buffered replay runs
      // synchronously inside on(), filling the queue the first compute
      // drains. Replayed values must NOT bump the version — the replay can
      // run inside an owned render scope where reactive writes are illegal,
      // and the projection doesn't exist yet to need waking. Only live
      // emissions (stream callbacks on later tasks) bump.
      let live = false;
      const bump = () => live && setVersion(n => n + 1);
      src.on({
        next(value: any) {
          queue.push(value);
          bump();
        },
        // The trace ended: the last applied state latches (same contract as
        // the iterable path's `done`).
        return() {},
        throw(error: any) {
          failed = { error };
          bump();
        }
      });
      live = true;
      if (claiming && queue.length > 1) {
        limit = 1;
        afterHydration(() => {
          limit = Infinity;
          bump();
        });
      }
      return createProjection(
        (draft: any) => {
          version();
          while (cursor < queue.length && cursor < limit) {
            const value = queue[cursor++];
            if (first) {
              first = false;
              // Full authoritative snapshot into a fresh {}/[] seed — pure
              // writes, no draft reads (see the iterable branch below).
              if (Array.isArray(value)) {
                for (let i = 0; i < value.length; i++) draft[i] = value[i];
                draft.length = value.length;
              } else {
                Object.assign(draft, value);
              }
            } else {
              applyPatches(draft, value);
            }
          }
          // In order: after everything queued before it has applied.
          if (failed && cursor === queue.length) throw failed.error;
          // Nothing buffered yet (revival raced ahead of the record's data
          // script): pending until the snapshot lands, marked on the
          // projection's own node — the version bump reruns this compute.
          if (first) throw new NotReadyError(getOwner());
        },
        (marker.$ta ? [] : {}) as any
      );
    })!;
  }
  // A root, not a bare null owner: the projection's async machinery routes
  // its pending/error states through the owner's queue, and with no owner
  // at all the internal NotReadyError (the "pending until snapshot" mark)
  // surfaces as an unhandled error in dev. The root is never disposed —
  // the projection settles itself when the trace ends and is collected
  // with the store.
  return detachedRoot(() =>
    createProjection(
      (draft: any) => ({
        [Symbol.asyncIterator]() {
          const srcIt = src[Symbol.asyncIterator]();
          let first = true;
          return {
            next: () =>
              Promise.resolve(srcIt.next()).then((res: any) => {
                if (res.done) return { done: true as const, value: undefined };
                if (first) {
                  first = false;
                  // The first yield is the full authoritative snapshot. The
                  // seed is a fresh empty {}/[] minted here, so this is pure
                  // writes — no reads of the draft, which is still PENDING
                  // (reading a pending proxy throws NotReadyError, which
                  // would reject this step and error the projection).
                  if (Array.isArray(res.value)) {
                    for (let i = 0; i < res.value.length; i++) draft[i] = res.value[i];
                    draft.length = res.value.length;
                  } else {
                    Object.assign(draft, res.value);
                  }
                } else {
                  applyPatches(draft, res.value);
                }
                return { done: false as const, value: undefined };
              }),
            return: (value?: any) => forwardIteratorReturn(srcIt, value)
          };
        }
      }),
      (marker.$ta ? [] : {}) as any
    )
  )!;
}
