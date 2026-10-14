/**
 * The store-family hydration adapters — `createStore(fn)`,
 * `createProjection`, `createOptimisticStore(fn)` under hydration: the
 * serialized snapshot adopted as the seed, a store-shaped async iterable
 * replayed with its patch backlog parked past the claim pass, the hybrid
 * handoff (#3498). Reached two ways, and that is why this is its own module:
 *
 * - `enableHydration()` installs `hydrateStoreLike` into the generic store
 *   slot the wrappers in hydration.ts read, so a page whose root pass creates
 *   a derived store hydrates it (the slot and the wrapper are both in the
 *   flat `solid.js`; a page with no eager store wrapper shakes the install
 *   and this module with it, as the no-stores app shows).
 * - `solid-js/internal/container-trace` — the frames traces tier, a LAZY
 *   chunk — needs the same adapter for a materialized server projection, and
 *   bundles ITS OWN COPY of this module (rollup.config.js: this file is
 *   bundled into `dist/container-trace.js`, with the `./hydration.js` import
 *   below resolved to the external `solid-js`). Reading the eager slot from
 *   the lazy chunk instead (`core.withStoreHydration`, the shape before this
 *   split) pinned every adapter into the entry chunk of a server-component
 *   page that never creates a client store — 2.5 KB minified / 0.65 KB brotli
 *   — because an app bundler assigns a module to the entry whenever an eager
 *   module imports it, dead write or not (hydration-split-measured.md §3.1).
 *
 * The second instance is inert by construction: nothing here declares
 * module-level state. Every piece of shared state — `sharedConfig`, the
 * hydration-end callbacks (`onHydrationEnd`), the latch set behind
 * `readSerializedOrCompute`, the `UNASKED` sentinel, the trace run
 * (`subFetch`) — is reached through `h`, the one `solid-js` instance.
 * Member reads on the namespace binding, never a destructure (the discipline
 * container-trace.ts documents): the bundler rewrites them to named imports
 * of that instance, and a server-tier resolution of the trace entry, whose
 * `solid-js` has none of these, stays inert until something calls it.
 */
import {
  getOwner,
  peekNextChildId,
  setSnapshotCapture,
  createSignal as coreSignal
} from "@solidjs/signals";
import * as h from "./hydration.js";

function createShadowDraft(realDraft: any, shallow?: boolean) {
  // A shallow store's leaves are raw by contract: copy the root only (#3498).
  const shadow = shallow
    ? Array.isArray(realDraft)
      ? realDraft.slice()
      : { ...realDraft }
    : JSON.parse(JSON.stringify(realDraft));
  let useShadow = true;
  return {
    proxy: new Proxy(shadow, {
      get(_, prop) {
        return useShadow ? shadow[prop] : realDraft[prop];
      },
      set(_, prop, value) {
        if (useShadow) {
          shadow[prop] = value;
          return true;
        }
        return Reflect.set(realDraft, prop, value);
      },
      deleteProperty(_, prop) {
        if (useShadow) {
          delete shadow[prop];
          return true;
        }
        return Reflect.deleteProperty(realDraft, prop);
      },
      has(_, prop) {
        return prop in (useShadow ? shadow : realDraft);
      },
      ownKeys() {
        return Reflect.ownKeys(useShadow ? shadow : realDraft);
      },
      getOwnPropertyDescriptor(_, prop) {
        return Object.getOwnPropertyDescriptor(useShadow ? shadow : realDraft, prop);
      }
    }),
    activate() {
      useShadow = false;
    }
  };
}

/**
 * The promise-shaped handoff run, quiet the same way: the adopted answer as
 * a sync step 0, the promise's result as step 1 (committed when it lands, as
 * before — a rejection settles through the engine's error path unchanged),
 * then done.
 */
function quietAnswer(thenable: any) {
  let step = 0;
  return {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (step === 0) {
            step = 1;
            return h.syncThenable({ done: false, value: undefined });
          }
          if (step === 1) {
            step = 2;
            return thenable.then((v: any) => ({ done: false, value: v }));
          }
          return Promise.resolve({ done: true, value: undefined });
        }
      };
    }
  };
}

function hydrateStoreFromAsyncIterable(
  coreFn: Function,
  fn: any,
  initialValue: any,
  options: any
): any {
  const parent = getOwner()!;
  const expectedId = peekNextChildId(parent);
  if (!h.sharedConfig.has!(expectedId)) return null;
  const loaded = h.sharedConfig.load!(expectedId);
  if (!h.isAsyncIterable(loaded)) return null;

  const srcIt = loaded[Symbol.asyncIterator]();
  const loading = h.hasLoadingWindow(options);
  let isFirst = true;
  let buffered: any = null;
  let terminal = false;
  const fail = (e: any) => {
    terminal = true;
    throw e;
  };
  return coreFn(
    (draft: any) => {
      // A run after the serialized stream reached its terminal state (done
      // or error) is a real invalidation — a dependency change or refresh()
      // — and the stream answers the OLD question (and is already consumed).
      // Re-running the adoption body would orphan another subFetch generator
      // and hand back the dead replay, freezing the store at its SSR value
      // forever; hand over to the live fn instead (#3060). Runs BEFORE the
      // terminal are NotReady retries of the same flight — the derive
      // re-runs each time a pending pull lands — and must keep adopting the
      // shared replay (going live there re-fetches data the document is
      // still delivering).
      if (terminal) return fn(draft);
      // Run the user fn up to its first await on the client so any reactive
      // dependencies read before the first suspension are tracked. Writes go
      // to a shadow of the draft and are discarded — the server iterator is
      // authoritative and drives the real draft via the iterable below.
      const { proxy } = createShadowDraft(draft, options?.shallow);
      h.subFetch(fn, proxy);
      const process = (res: any) => {
        if (res.done) {
          terminal = true;
          return { done: true, value: undefined };
        }
        if (isFirst) {
          isFirst = false;
          // The initial full value IS the snapshot state the SSR DOM reflects.
          // Disable snapshot capture while applying it so prepareStoreWrite doesn't
          // record the pre-write (empty) base as the snapshot — otherwise reads
          // during hydration (e.g. Repeat reading length) see the stale pre-value
          // and fail to match the server-rendered DOM.
          setSnapshotCapture(false);
          try {
            if (Array.isArray(res.value)) {
              for (let i = 0; i < res.value.length; i++) draft[i] = res.value[i];
              draft.length = res.value.length;
            } else {
              // Replace, not merge: the snapshot is the full authoritative
              // state, so seed keys absent from it were removed on the server
              // and must not survive on the client either (#2948).
              for (const key of Object.keys(draft)) {
                if (!(key in res.value)) delete draft[key];
              }
              Object.assign(draft, res.value);
            }
          } finally {
            setSnapshotCapture(true);
          }
        } else {
          h.applyPatches(draft, res.value);
        }
        return { done: false, value: undefined };
      };
      return {
        [Symbol.asyncIterator]() {
          return {
            next() {
              if (isFirst) {
                const r = srcIt.next();
                if (r && typeof r.then === "function")
                  return {
                    then(fn: any, rej: any) {
                      r.then(
                        (v: any) => {
                          // process() can throw (a store-trap NotReadyError,
                          // a reconcile failure). A throw inside this
                          // onFulfilled would reject a derived promise
                          // nobody observes — silently killing the drain and
                          // wedging the projection forever. Route it to the
                          // flight's rejection instead.
                          let out;
                          try {
                            out = process(v);
                          } catch (e) {
                            terminal = true;
                            rej(e);
                            return;
                          }
                          fn(out);
                        },
                        (e: any) => {
                          terminal = true;
                          rej(e);
                        }
                      );
                    }
                  };
                if (loading) {
                  // Seed window (seedLoadingValue): the SSR DOM reflects the
                  // SEED (commit #0), not the first-yield snapshot — the sync
                  // application below exists precisely because for windowless
                  // stores the snapshot IS what the DOM shows. Here applying
                  // it mid-claim would hydrate real-data structure against
                  // seed markup, so the snapshot parks until hydration
                  // completes, exactly like the patch backlog.
                  return new Promise(resolvePull => {
                    h.onHydrationEnd(() => resolvePull(process(r)));
                  });
                }
                return h.syncThenable(process(r));
              }
              if (buffered) {
                const b = buffered;
                buffered = null;
                return b.then(process, fail);
              }
              let r = srcIt.next();
              if (r && typeof r.then === "function") {
                return r.then(process, fail);
              }
              // A synchronously-available result is buffered backlog — the
              // stream ran ahead of hydration (delayed client script). It
              // must NOT apply while hydration is still claiming server DOM:
              // this pull runs inside the claim pass that first reads the
              // store (Repeat reading `length` drives it), or — for a late
              // streamed boundary — on a microtask racing that boundary's
              // resume. Projection draft writes stage in the override layer
              // until the firewall commits, so write-time snapshot capture
              // records the still-uncommitted SEED as the pre-write base
              // (not the first-yield state the SSR DOM shows), and any claim
              // pass after the batch hydrates against pre-stream state —
              // orphaning every server-rendered row. Park the batch until
              // hydration completes (a plain microtask when it already has):
              // snapshots are cleared by then, exactly where a live stream's
              // yields land. Conflated single-update semantics are kept —
              // every sync-available patch list still applies in one pull,
              // in order.
              return new Promise(resolvePull => {
                h.onHydrationEnd(() => {
                  let result = process(r);
                  while (!r.done) {
                    const peek = srcIt.next();
                    if (peek && typeof peek.then === "function") {
                      buffered = peek;
                      break;
                    }
                    r = peek;
                    if (!r.done) result = process(r);
                  }
                  resolvePull(result);
                });
              });
            },
            return(value?: any) {
              buffered = null;
              return h.forwardIteratorReturn(srcIt, value);
            }
          };
        }
      };
    },
    initialValue,
    options
  );
}

function wrapStoreFn(fn: any, options?: any) {
  return (draft: any) => h.readSerializedOrCompute(() => fn(draft), draft, options);
}

function hydrateStoreLikeFn(
  coreFn: Function,
  fn: any,
  initialValue: any,
  options: any,
  ssrSource: string | undefined
): any {
  if (ssrSource === "client") {
    return h.withHydrationGate(hydrated =>
      coreFn(
        (draft: any) => {
          // Keep client-only stores unasked through hydration. With
          // seedLoadingValue the seed is commit #0 and remains readable;
          // otherwise the store suspends until its first client result.
          if (!hydrated()) return h.UNASKED;
          return fn(draft);
        },
        initialValue,
        options
      )
    );
  }
  if (ssrSource === "hybrid") {
    // Hybrid handoff (#3498). Server is truth: the store adopts the
    // serialized answer, and the client source takes over from it in ONE
    // handoff run whose first yield is discarded as the duplicate of what
    // the server serialized. These rules order that handoff:
    //
    // 1. It waits for the first server answer to LAND. Synchronous when the
    //    serialized value is already settled (the flip below, as before);
    //    when it is still pending — a loadingValue placeholder whose real
    //    answer arrives later over the stream, or a settled ref the loading
    //    window defers past the claim walk — the flip rides the landing
    //    itself (adoptedAnswerStream). That answer is late, not stale:
    //    flipping earlier let the takeover supersede the flight and lose it.
    //    Never hydration end, and nothing here holds hydration open.
    // 2. Only the handoff run is a duplicate. `live` marks authority
    //    transferred; every later run (dependency change, refresh()) runs fn
    //    on the real draft and commits its first yield normally.
    // 3. A rejected server answer is the adopted answer. It transfers
    //    authority without a handoff run, so the error stays visible until a
    //    non-handoff run replaces it.
    // 4. A dependency change before the answer lands supersedes it. Like any
    //    new pending change, it cancels the incoming server answer: the store
    //    goes live on that run — genuinely new work, not a handoff, so its
    //    first yield commits — and the abandoned flight's landing or
    //    rejection is dropped by the engine (PJ-R26) and flips nothing.
    // 5. The handoff opens no pending window (#3574). The contract is ONE stream
    //    — the server consumes exactly one yield, the client continues the
    //    iteration (adoptedAnswerStream): the adopted answer is step 0, the
    //    client's first yield its duplicate (rule 2), and a stream is not pending
    //    between yields (handleAsync's sync-first-yield rule). The engine read
    //    pending only because the continuation arrived as a fresh recompute whose
    //    first step looked like a first flight; wrapFirstYield and quietAnswer
    //    give the run the contract's shape, so the store reads settled until the
    //    client source produces something new. Maintainer ruling: isPending does
    //    not read true over the initial load; the handoff is its tail.
    //
    // 6. The handoff is for STREAMS. It only ARMS when the adoption pass saw
    //    an async-iterable source: a sync or promise-shaped source has no
    //    iteration for the client to continue, so a handoff run would only
    //    re-run (refetch) what the server serialized and clobber the adopted
    //    answer. For those shapes "hybrid" is identical to "server" — the
    //    adopted answer is final until a dependency changes or refresh() —
    //    exactly as hydrateSignalLike already treated them. Maintainer
    //    ruling: hybrid is only for streams realistically. The shape is
    //    the trace's finding, not the option's: the source decides.
    //
    // The signal-shaped hybrid handoff (hydrateSignalLike: createMemo,
    // function-form createSignal, createOptimistic over an async generator)
    // follows the same rules 1–6 on the same helpers — adoptedAnswerStream
    // for the landing, wrapFirstYield for the quiet run — with the node's
    // `prev` as the adopted answer in place of the draft.
    const id = peekNextChildId(getOwner()!);
    // Nothing serialized: no answer to wait for and nothing for a first
    // yield to duplicate — the client is authoritative from its first run.
    if (!h.sharedConfig.has!(id)) return coreFn(fn, initialValue, options);
    const initP = h.sharedConfig.load!(id);
    // undefined until the trace has completed once: a sync NotReady from the
    // trace (the source read a pending sibling before returning) leaves the
    // shape unknown, and the retry decides (rule 6).
    let takeover: boolean | undefined;
    const detect = (draft: any) => {
      const r = fn(draft);
      takeover = h.isAsyncIterable(r);
      return r;
    };
    const [hydrated, setHydrated] = coreSignal(false, { ownedWrite: true });
    let live = false;
    // A late flip — a queued microtask, or a landing the engine kept for a
    // flight this store has since abandoned — must not run a live store again.
    const flip = () => {
      if (!live) setHydrated(true);
    };
    let adopted = false;
    let creating = true;
    let landedOnCreate = false;
    const result = coreFn(
      (draft: any) => {
        if (live) return fn(draft);
        // Rule 6: a non-iterable source, decided by the trace. No handoff —
        // from here the store IS a "server" store (wrapStoreFn's body): every
        // later run (dependency change, refresh()) re-adopts the serialized
        // answer while hydration is open and runs fn live once it is done.
        if (takeover === false) return h.readSerializedOrCompute(() => fn(draft), draft, options);
        if (hydrated()) {
          // The handoff run (rule 5: quiet through its duplicate).
          live = true;
          const { proxy, activate } = createShadowDraft(draft, options?.shallow);
          const r = fn(proxy);
          if (h.isAsyncIterable(r)) return h.wrapFirstYield(r, activate);
          if (r != null && typeof r.then === "function") return quietAnswer(r);
          return r;
        }
        if (adopted) {
          // Rule 4. The gate is down, so this is not the handoff; an adoption
          // already returned, so it is not a NotReady retry of the trace
          // either — a dependency changed. The recompute already released
          // the adopted flight (recompute nulls `_inFlight` and fires the
          // flight teardown), so the server's late landing is dropped and
          // its second pull — the flip — never comes.
          live = true;
          return fn(draft);
        }
        // Adoption; the trace inside detects the source's shape. Re-entered
        // only by a NotReady retry of the trace (the pending sibling settled;
        // nothing was adopted yet, so adopt now).
        h.subFetch(detect, draft);
        let answer: any;
        try {
          answer = h.readHydratedValue(initP, () => {}, options);
        } catch (e) {
          // The trace above completed, so this is the settled rejection —
          // the adopted answer (rule 3): authority transfers without a
          // handoff run. A non-iterable source has no handoff to skip; it
          // re-adopts (and re-throws) like "server" until a real run. (A
          // NotReady from the trace is a retry of this same adoption and
          // never reaches here.)
          if (takeover) live = true;
          throw e;
        }
        // Rule 6: a non-iterable source's adoption is the answer — nothing
        // flips, and later runs take the `takeover === false` branch above.
        if (!takeover) return answer;
        adopted = true;
        if (answer != null && typeof answer.then === "function")
          return h.adoptedAnswerStream(answer, flip, () => (live = true));
        // Settled, landing synchronously in this run. The creation run flips
        // right after construction (below, outside the compute — as the gate
        // always has); a retry run is inside a flush, where the flip must
        // not be a self-write, so it follows on a microtask.
        if (creating) landedOnCreate = true;
        else queueMicrotask(flip);
        return answer;
      },
      initialValue,
      options
    );
    creating = false;
    // The creation flip: the handoff for a synchronously landed answer. An
    // untraced source (NotReady) has no shape yet, and a non-iterable source
    // has nothing to hand off (rule 6). (Nor is a flip a free re-adopt for
    // it: the gate write is held by the snapshot scope and replays at its
    // release, AFTER `done` flips in the plain hydrate() path, so the
    // recompute would run fn live — the very refetch rule 6 rules out.)
    if (landedOnCreate) flip();
    return result;
  }
  const aiResult = hydrateStoreFromAsyncIterable(coreFn, fn, initialValue, options);
  if (aiResult !== null) return aiResult;
  return coreFn(wrapStoreFn(fn, options), initialValue, options);
}

/**
 * The store-shaped counterpart to hydrateSignalLike: one body for
 * store/optimistic-store/projection, with the core implementation passed in
 * by the caller — the wrappers in hydration.ts through the `_hydrateStoreLike`
 * slot `enableHydration()` fills with this, the container-trace materializer
 * directly (its own copy, see the module comment). The buffered backlog
 * parking in hydrateStoreFromAsyncIterable (and the `onHydrationEnd` it
 * defers through, the shared instance's) is unchanged — only how the code is
 * reached moved.
 *
 * @internal
 */
export function hydrateStoreLike(coreFn: Function, fn: any, initialValue: any, options?: any) {
  // No id counter to peek from: not hydrating positionally (#3609).
  if (h.noHydrationId()) return coreFn(fn, initialValue, options);
  h.markTopLevelSnapshotScope();
  return hydrateStoreLikeFn(coreFn, fn, initialValue, options, options?.ssrSource);
}
