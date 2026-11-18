import {
  CONFIG_ASYNC,
  CONFIG_AUTO_DISPOSE,
  CONFIG_REDERIVE,
  CONFIG_GUESS,
  CONFIG_OVERRIDE,
  CONFIG_HELD,
  CONFIG_INPUTS_PUBLISHED,
  CONFIG_STAGED,
  CONFIG_STAGED_ERROR,
  CONFIG_SYNC,
  CONFIG_VERDICT,
  EFFECT_USER,
  NOT_PENDING,
  REACTIVE_DIRTY,
  REACTIVE_WINDOW,
  REACTIVE_DISPOSED,
  REACTIVE_IN_HEAP,
  REACTIVE_RECOMPUTING_DEPS,
  REACTIVE_REASK,
  REACTIVE_RELEASE_AFTER,
  REACTIVE_STAGED_READ,
  REACTIVE_ZOMBIE,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED,
  STATUS_NO_VALUE,
  NewSet
} from "./constants.js";
import { attrHooks } from "./attribution-hooks.js";
import {
  context,
  setSignal,
  untrack,
  ext,
  statusNotifierOf,
  landThroughSetSignal
} from "./core.js";
import { devTrackHeldPending } from "./invariants.js";
import {
  caughtReadFlightSettled,
  emitDiagnostic,
  reportDiagnostic,
  watchAsyncTail
} from "./dev.js";
import { NotReadyError, StatusError } from "./error.js";
import { trimStaleDeps, unobserved } from "./graph.js";
import { enqueueSub } from "./heap.js";
import { cleanup, disposeChildren } from "./owner.js";
import {
  clock,
  flush,
  globalQueue,
  joinFuture,
  MAINLINE_QUESTION,
  passLane,
  pendingNodes,
  question,
  queuePendingNode,
  schedule,
  txOf,
  reasks,
  unhold,
  freshHook,
  holdWorkHook,
  stageMarkHook,
  guessing,
  laneStageHook,
  storeParkHook
} from "./scheduler.js";
import type { Computed, Link, Owner } from "./types.js";

// One Set, created lazily, holds every pending source: a single slot
// promoted to a Set had dual state that stranded pending entries (#2893).
export function addPendingSource(el: Computed<any>, source: Computed<any>): boolean {
  if (el._x?._pendingSources?.has(source)) return false;
  (ext(el)._pendingSources ??= new NewSet()).add(source);
  return true;
}

export function removePendingSource(el: Computed<any>, source: Computed<any>): boolean {
  const sources = el._x?._pendingSources;
  if (!sources?.delete(source)) return false;
  if (!sources.size) el._x!._pendingSources = undefined;
  return true;
}

export function clearInFlight(el: Computed<any>): void {
  if (el._x !== null) el._x._inFlight = null;
}

function clearPendingSources(el: Computed<any>): void {
  // Node-owned and never shared: dropping the reference is the clear.
  if (el._x !== null) el._x._pendingSources = undefined;
}

// A rejection-pending clears only through the settle walk over the source's
// subscribers, so it can retry only when a live dep is the source or carries
// it. A disposed dep is unlinked and holds nothing (F-3, #5003). A source that
// has settled has no walk to come: linked directly, it holds nothing (F-2).
export function retryReaches(el: Computed<any>, source: any): boolean {
  for (let d = el._deps; d; d = d._nextDep) {
    const dep = d._dep as Computed<any>;
    if (
      !(dep._flags & REACTIVE_DISPOSED) &&
      (dep === source ? dep._statusFlags & STATUS_PENDING : dep._x?._pendingSources?.has(source))
    )
      return true;
  }
  return false;
}

/** Park a loading-window node on an unready source: registered for the
 * source's settle, with no visible pending and no propagation. */
export function parkLoadingWindow(el: Computed<any>, e: NotReadyError): void {
  ext(el)._blocked = true;
  if (e.source) addPendingSource(el, e.source as Computed<any>);
  // A settled error stays the answer: overwriting it here would leak a
  // NotReadyError from an invisible park (#2989).
  if (!(el._statusFlags & STATUS_ERROR)) setPendingError(el, e.source as Computed<any>, e);
}

export function setPendingError(el: Computed<any>, source?: Computed<any>, error?: any): void {
  if (!source) {
    if (el._x !== null) el._x._error = null;
    return;
  }
  const current = error instanceof NotReadyError && error.source === source ? error : el._x?._error;
  ext(el)._error =
    current instanceof NotReadyError && current.source === source
      ? current
      : new NotReadyError(source);
}

export function forEachDependent(
  el: Computed<any>,
  fn: (node: Computed<any>, link: Link) => void
): void {
  for (let s = el._subs; s !== null; s = s._nextSub) fn(s._sub, s);
}

/** Depth first. `fn` sees every arrival (`seen` on a diamond's second);
 * returning false leaves the node unmarked so a later branch may walk it. */
function walkDependents(
  el: Computed<any>,
  fn: (node: Computed<any>, seen: boolean) => unknown
): void {
  const visited = new NewSet<Computed<any>>();
  const visit = (node: Computed<any>) => {
    const seen = visited.has(node);
    if (fn(node, seen) !== false && !seen) {
      visited.add(node);
      forEachDependent(node, visit);
    }
  };
  forEachDependent(el, visit);
}

// A lazy node left with no subscribers while pending is kept alive by its
// flight, so whatever clears that pending must release it (#2934). A node
// already queued releases at its pass's tail, or it would miss the landing
// it was queued for (D-22, #4474).
export function releaseIfSettledUnobserved(node: Computed<any>): void {
  if (
    (node as any)._fn &&
    node._config & CONFIG_AUTO_DISPOSE &&
    !node._subs &&
    !(node._flags & REACTIVE_ZOMBIE) &&
    !(node._statusFlags & STATUS_PENDING)
  )
    node._flags & REACTIVE_IN_HEAP ? (node._flags |= REACTIVE_RELEASE_AFTER) : unobserved(node);
}

// After an error propagates, release stranded lazy nodes. Collect first so
// `unobserved()` never unlinks under the walk.
export function releaseSettledDependents(el: Computed<any>): void {
  let candidates: Computed<any>[] | undefined;
  walkDependents(el, (node, seen) => {
    if (!seen && !node._subs && node._config & CONFIG_AUTO_DISPOSE) (candidates ??= []).push(node);
  });
  if (candidates) for (const node of candidates) releaseIfSettledUnobserved(node);
}

/** An error a held node's pass found is an answer of that frame, staged like
 * a value and published at the commit (D-41). Not for a lane pass, nor a
 * node born held. Returns whether it was staged. */
export function stageError(el: Computed<any>, error: any, inPass?: boolean): boolean {
  // Staged even before the flush joins a hold: the seam decides, as for a
  // value (#4109, S-38). Not a projection's derive: its family never sees the
  // commit's publish (#4189).
  if (
    !(
      el._config & CONFIG_HELD ||
      (inPass && el._flags & REACTIVE_STAGED_READ && globalQueue._running && !(el as any)._fam)
    ) ||
    passLane
  )
    return false;
  // An error ends the wait (D-41); a shown error stays until the commit.
  clearPendingSources(el);
  if (el._x) el._x._blocked = false;
  if (!((el._statusFlags &= STATUS_ERROR | STATUS_UNINITIALIZED) & STATUS_ERROR))
    setPendingError(el);
  el._pendingValue = error instanceof StatusError ? error : new StatusError(el, error);
  el._config |= CONFIG_STAGED | CONFIG_STAGED_ERROR;
  // Readers derive from the staging; verdict readers the walk wakes need a flush (#4106).
  settlePendingSource(el);
  schedule();
  return true;
}

export function settleErroredDependents(el: Computed<any>, error: any): void {
  let scheduled = false;
  walkDependents(el, (node, seen) => {
    if (!seen && node._x?._error === error) {
      enqueueSub(node);
      scheduled = true;
    }
  });
  if (scheduled) schedule();
}

// Retire `source` from pending along the dependents of `el`. With a distinct
// `source`, `el` recovered without it, so dependents with another path to it
// stay pending.
export function settlePendingSource(el: Computed<any>, source: Computed<any> = el): void {
  // Dev invariant: a settle needs an answer. An uninitialized root with no
  // staged value and no error announces a settle that never happened, and its
  // readers would wake into nothing (#3648).
  if (__DEV__) {
    const sources = el._x?._pendingSources;
    if (
      el._statusFlags & STATUS_UNINITIALIZED &&
      el._pendingValue === NOT_PENDING &&
      !el._x?._error &&
      !(sources?.size && (sources.size > 1 || !sources.has(el)))
    ) {
      // Reported, not thrown: promise machinery has no caller to surface it (#3648).
      reportDiagnostic(
        emitDiagnostic(
          {
            code: "SETTLE_WALK_UNINITIALIZED_SOURCE",
            kind: "lifecycle",
            severity: "error",
            message:
              "[SETTLE_WALK_UNINITIALIZED_SOURCE] settlePendingSource was called on a source that " +
              "never produced a value. Settling parked readers requires truth to reveal — an " +
              "uninitialized source waking its dependents serves them its initial face instead of " +
              "settled data.",
            ownerId: el.id,
            ownerName: (el as any)._name
          },
          el
        )
      );
    }
  }
  // A superseded re-park may keep an abandoned self entry; retire it with its copies.
  removePendingSource(el, source);
  let scheduled = false;
  let released: Computed<any>[] | undefined;
  walkDependents(el, (node, seen) => {
    if (
      seen ||
      // Another dependency may still carry the source. Not marked visited: that
      // dependency may be a later branch of this walk.
      (source !== el && retryReaches(node, source)) ||
      !removePendingSource(node, source)
    )
      // A verdict reader holds no pending of its own: the source settling is its
      // verdict changing, so it re-runs (F-9). A derivation of a staged error
      // carries it (D-41).
      return (
        holdWorkHook &&
          (node._config & CONFIG_VERDICT ? enqueueSub(node) : stageMarkHook!(node, el)),
        false
      );
    node._time = clock;
    const remaining = node._x?._pendingSources?.values().next().value;
    // An errored loading-window park keeps its error through the settle (#2989).
    const errored = node._statusFlags & STATUS_ERROR;
    if (remaining) {
      if (!errored) setPendingError(node, remaining);
    } else {
      node._statusFlags &= ~STATUS_PENDING;
      if (!errored) setPendingError(node);
      // A held reader's re-pass over the landing is its hold's work (D-1); never a
      // lane's (#4440). A source still in flight has not landed: a reader that
      // stopped carrying it joins nothing (F-2).
      if (node._config & CONFIG_HELD && !(source._statusFlags & STATUS_PENDING))
        joinFuture(txOf(node));
      if (node._x?._blocked) {
        enqueueSub(node);
        scheduled = true;
      }
      // A derived store's readers wait on the derive itself, so they settle with it (F-9).
      else if (storeParkHook) (node as any)._fam?.st();
      if (node._x !== null) node._x._blocked = false;
      // Settled with no subscribers: released after the walk (#2934).
      if (!node._subs && node._config & CONFIG_AUTO_DISPOSE) (released ??= []).push(node);
      // A chain's single arrival marks what a diamond's second does: graph shape
      // is not observable (D-41, #4562).
      stageMarkHook?.(node, el);
    }
  });

  // Queued nodes release at their pass's tail (#4474).
  if (released) for (const node of released) releaseIfSettledUnobserved(node);

  if (scheduled) schedule();
}

export function isThenable<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

export function releaseFlightTeardown(el: Computed<any>): void {
  const teardown = el._x?._flightTeardown;
  if (teardown != null) {
    el._x!._flightTeardown = null;
    teardown();
  }
}

/** Internal: run `fn` when the current pass's flight is superseded, with the
 * iterator close, rather than when the replacing pass commits. A no-op
 * outside a computed's own pass. */
export function onSupersede(fn: () => void): void {
  const el = context as Computed<any> | null;
  if (el === null || el._fn === undefined || !(el._flags & REACTIVE_RECOMPUTING_DEPS)) return;
  const fresh = el._x === null;
  const x = ext(el);
  // Allocating `_x` mid-run turns `_inFlight` from undefined to null, which
  // `recompute` would read as a flight this body registered.
  if (fresh) x._inFlight = undefined as any;
  const prev = x._flightTeardown;
  x._flightTeardown =
    prev === null
      ? fn
      : () => {
          try {
            prev();
          } finally {
            fn();
          }
        };
}

/** A flight's landing through a setter (bound by store/projection.ts). A throw
 * from `commit` is the flight's error (`fail`, false returned). */
export function landBySetter<T>(
  el: Computed<T>,
  value: T,
  commit: (value: T) => void,
  wasUninitialized: number,
  fail: (error: unknown) => void
): boolean {
  // Observe: what a setter landing moves on the node, to say whether it committed.
  const observed = __OBSERVE__ && attrHooks !== null;
  const before = observed ? el._value : undefined;
  const beforeTime = observed ? el._time : 0;
  try {
    commit(value);
  } catch (error) {
    fail(error);
    return false;
  }
  // Unheld, a store derive's landing clears the shown error and published-inputs
  // mark now (#4269); held, at the commit.
  if (!(el._config & CONFIG_HELD)) {
    el._x!._shownError = null;
    el._config &= ~CONFIG_INPUTS_PUBLISHED;
  }
  if (wasUninitialized) landStatus(el, true);
  // Observe: a setter landing bypasses `setSignal`, so the flight closes here
  // (#3947). Outside the try (attribution-hooks.ts).
  if (observed)
    attrHooks!.asyncLanded(
      el,
      value,
      el._value !== before || el._time !== beforeTime || el._pendingValue === value
    );
  return true;
}
export function handleAsync<T>(
  el: Computed<T>,
  result: T | PromiseLike<T> | AsyncIterable<T>,
  // A store derive's landing (`landBySetter`); a callback, so a build
  // without stores retains none of the arm (bundle size).
  setter?: (value: T, wasUninitialized: number, fail: (error: unknown) => void) => boolean,
  // `pending`: a NotReady rejection, not an error. A projection tells its leaves' readers.
  onError?: (error: unknown, pending: boolean) => void
): T {
  let iterator: any = false;
  let thenable = false;
  if (typeof result === "object" && result !== null) {
    untrack(() => {
      iterator = (result as any)[Symbol.asyncIterator];
      thenable = !iterator && isThenable(result as T | PromiseLike<T>);
    });
  }

  if (!thenable && !iterator) {
    if (el._x !== null) {
      el._x._inFlight = null;
      if (holdWorkHook) el._config &= ~CONFIG_ASYNC;
    }
    el._loading = false;
    return result as T;
  }

  // Dev: a `sync: true` node that returns async is diagnosed; prod skips this call.
  if (__DEV__ && el._config & CONFIG_SYNC) {
    const message =
      `[SYNC_NODE_RECEIVED_ASYNC] A computed/effect created with \`sync: true\` returned ` +
      `${thenable ? "a Promise" : "an AsyncIterable"}. The value would be stored as-is and ` +
      `never awaited in production; remove \`sync: true\` to use async-aware behavior, or ` +
      `unwrap the value before returning.`;
    emitDiagnostic({
      code: "SYNC_NODE_RECEIVED_ASYNC",
      kind: "lifecycle",
      severity: "error",
      message,
      ownerId: el.id,
      ownerName: (el as any)._name
    });
    throw new Error(message);
  }

  // Iterator teardown already ran in `recompute`'s supersede release (#3122).
  // A registration path outside `recompute` must release it here.
  ext(el)._inFlight = result as PromiseLike<T> | AsyncIterable<T>;
  // Upkept only with the verdict engine (`holdWorkHook`); see `holdWork` (D-25).
  if (holdWorkHook) el._config |= CONFIG_ASYNC;
  // Provenance (D-34): the question this flight answers.
  el._x!._q = question || MAINLINE_QUESTION;
  // The asking pass read every input, so earlier propagated pending does not
  // describe this answer; left, it would hold the node past it (#3373).
  el._x!._pendingSources = undefined;
  // Observe: announced once per flight shape, while the causing pass is on the
  // stack. Not inside a try (attribution-hooks.ts).
  if (__OBSERVE__ && attrHooks !== null) attrHooks.flightStart(el, result as object);
  let syncValue: T;

  const handleError = (error: any) => {
    if (el._x?._inFlight !== result) return;
    // Dev: a rejection continues the read's throw; it is not a catch (D-42).
    if (__DEV__) caughtReadFlightSettled(el, result as object, false);
    let stillPending = error instanceof NotReadyError;
    // Dev: no edge means a first read after `await`, which can never settle and
    // would wedge the boundary (#2987). Checked before the loading-window park.
    if (__DEV__ && stillPending && !retryReaches(el, (error as NotReadyError).source)) {
      stillPending = false;
      error = new Error(
        "Read of an unresolved async source after an `await`. Reads inside async " +
          "computations only register as dependencies before the first `await`; a source " +
          "first read after it cannot retry when it settles. Read it before the first " +
          "`await` (or restructure so the value is an input)."
      );
    }
    if (stillPending && el._loading) {
      // Loading window: keep serving commit #0; release the flight so the error
      // retry can ask again.
      clearInFlight(el);
      parkLoadingWindow(el, error);
      el._time = clock;
      return;
    }
    // A held node's error is staged (D-41), a derived store's derive's too (#4489).
    if (stillPending || !stageError(el, error)) {
      notifyStatus(el, stillPending ? STATUS_PENDING : STATUS_ERROR, error);
      // Published now, the error replaces the shown frame as a value's commit would.
      if (!stillPending) disposeChildren(el, false, true);
    }
    // A NotReady rejection lands into another pending source: hand over the self entry.
    if (stillPending) settlePendingSource(el);
    el._time = clock;
    // Release lazy dependents the error settled (#2934).
    if (!stillPending) releaseSettledDependents(el);
    onError?.(error, stillPending);
  };

  const asyncWrite = (value: T, then?: () => void) => {
    if (el._x?._inFlight !== result) return;
    // Dev: a value after a throw into this pass means the body caught it (D-42).
    if (__DEV__) caughtReadFlightSettled(el, result as object, true);
    // A newer write re-runs the node. A first answer is still a produced value:
    // it lands before the re-ask (D-22, F-9). Only the verdict engine can tell.
    if (el._flags & REACTIVE_DIRTY && !(holdWorkHook && el._statusFlags & STATUS_UNINITIALIZED))
      return;
    // A write's flush is queued: it carries this landing (#4495).
    const carried = holdWorkHook && pendingNodes.some(n => n._pendingValue !== NOT_PENDING);
    const wasUninitialized = el._statusFlags & STATUS_UNINITIALIZED;
    landStatus(el);
    const observed = __OBSERVE__ && attrHooks !== null;
    if (setter) {
      // False: the derive's commit threw, taken as the flight's error.
      if (!setter(value, wasUninitialized, handleError)) return;
    } else if (observed) {
      const changed = landThroughSetSignal(el, value);
      attrHooks!.asyncLanded(el, value, changed);
    } else {
      // A held node stages the answer into its hold (`setSignal`).
      setSignal(el, () => value);
    }
    // The loading window closes when the answer is observable: at the commit if
    // staged, so no one-frame pulse leaks (#2990).
    if (el._pendingValue === NOT_PENDING) {
      el._loading = false;
      // Trim the old dependency tail once published; a staging trims at its commit (#3410).
      trimStaleDeps(el);
    }
    settlePendingSource(el);
    schedule();
    // A write's flush already queued carries this landing with the others ahead
    // of it (F-10, D-22). Flushing now would re-ask before their reactions ran (#4495).
    if (then || !carried) flush();
    then?.();
  };

  // A pending node's flight counts as an observer, so settling runs the
  // last-one-out check. Returns whether it released, so a stream stops (#2935).
  const settleAutodispose = (): boolean => {
    if (el._config & CONFIG_AUTO_DISPOSE && !el._subs && !(el._statusFlags & STATUS_PENDING)) {
      unobserved(el as Computed<unknown>);
      return true;
    }
    return false;
  };

  // Consume an AsyncIterable as this flight's values. Live (called inside the
  // read): a sync first yield is stashed for the caller. Deferred (a thenable
  // resolved to an iterable later): every step writes through `asyncWrite`
  // and close registers on `owner`. Returns whether a sync answer landed.
  const consumeIterator = (source: AsyncIterable<T>, owner?: Owner): boolean => {
    const it = source[Symbol.asyncIterator]();
    let hadValue = false;
    let completed = false;
    let initialRead = !owner;

    const close = () => {
      if (completed) return;
      completed = true;
      try {
        const returned = it.return?.();
        if (isThenable(returned)) returned.then(undefined, () => {});
      } catch {}
    };
    cleanup(close, owner);
    // Supersede stops the stream at once (#3122). Assigned, not chained, for bytes:
    // it replaces an earlier `onSupersede` teardown, which falls back to owner cleanup.
    ext(el)._flightTeardown = close;

    // Release before each pull, or an unobserved stream pumps forever (#2935).
    // A protocol throw settles as this flight's error, not a rejection (#4112).
    const iterateOrRelease = () => {
      try {
        if (!settleAutodispose()) iterate();
      } catch (e) {
        handleError(e);
      }
    };

    const iterate = (): boolean => {
      let syncResult: IteratorResult<T>,
        syncError: unknown,
        resolved = false,
        rejected = false,
        isSync = true;
      // Like `for await`, accept a bare IteratorResult as a settled step.
      const step = it.next();
      const settled: PromiseLike<IteratorResult<T>> = isThenable(step)
        ? step
        : { then: onSettle => void onSettle!(step) as any };
      settled.then(
        r => {
          // Only the initial drain has a caller for the stash; later sync steps write
          // through, or the value is dropped.
          if (isSync && initialRead) {
            syncResult = r;
            resolved = true;
            if (r.done) completed = true;
          } else if (el._x?._inFlight !== result) {
            return;
          } else if (!r.done) {
            hadValue = true;
            asyncWrite(r.value, iterateOrRelease);
          } else {
            completed = true;
            if (hadValue) {
              schedule();
              flush();
            } else {
              asyncWrite(undefined as T);
            }
            settleAutodispose();
          }
        },
        e => {
          if (isSync && initialRead) {
            syncError = e;
            rejected = true;
          } else if (el._x?._inFlight === result) {
            completed = true;
            handleError(e);
            settleAutodispose();
          }
        }
      );
      isSync = false;
      if (rejected) {
        completed = true;
        handleError(syncError);
        if (initialRead) throw syncError;
        return true;
      }
      if (resolved && !syncResult!.done) {
        syncValue = syncResult!.value;
        hadValue = true;
        return iterate();
      }
      return resolved && syncResult!.done;
    };

    const immediatelyDone = iterate();
    // Later calls run from `asyncWrite`, where a rethrow would be unhandled.
    initialRead = false;
    return hadValue || immediatelyDone;
  };

  // Whether a live drain landed synchronously; null when none ran.
  let liveLanded: boolean | null = null;

  // A thenable that resolves to an AsyncIterable is consumed as the stream.
  // One level: A+ `then` already collapses nested thenables.
  const flattenIfIterable = (value: any, owner?: Owner): boolean => {
    let innerIterator: any = false;
    if (typeof value === "object" && value !== null) {
      untrack(() => {
        innerIterator = value[Symbol.asyncIterator];
      });
    }
    if (!innerIterator) return false;
    syncValue = undefined as T;
    const landed = consumeIterator(value as AsyncIterable<T>, owner);
    if (!owner) liveLanded = landed;
    return true;
  };

  if (thenable) {
    let resolved = false,
      rejected = false,
      syncError: any,
      isSync = true;
    (__DEV__ ? watchAsyncTail(el, result as PromiseLike<T>) : (result as PromiseLike<T>)).then(
      v => {
        if (isSync) {
          syncValue = v;
          resolved = true;
        } else {
          // The first yield clears pending as a resolution would. A disposed node never
          // starts a pump. The ambient owner is gone, so close registers on `el`; a
          // protocol throw settles as this flight's error (#4112).
          try {
            if (
              el._x?._inFlight === result &&
              !(el._flags & REACTIVE_DISPOSED) &&
              flattenIfIterable(v, el)
            )
              return;
            asyncWrite(v);
          } catch (e) {
            handleError(e);
          }
          settleAutodispose();
        }
      },
      e => {
        if (isSync) {
          syncError = e;
          rejected = true;
        } else {
          handleError(e);
          settleAutodispose();
        }
      }
    );
    isSync = false;
    if (rejected) {
      // Settle as a rejection does, then unwind so the read is not `undefined`.
      handleError(syncError);
      throw syncError;
    } else if (!resolved) {
      // Not landed: the tail suspends, or a loading window serves commit #0.
      liveLanded = false;
    } else if (!flattenIfIterable(syncValue!)) {
      el._loading = false;
    }
  }

  if (iterator) flattenIfIterable(result);

  if (liveLanded !== null) {
    if (!liveLanded) {
      if (el._loading) return el._value;
      throw new NotReadyError(context!);
    }
    el._loading = false;
  }

  // Dev: a sync answer landed a value (D-42).
  if (__DEV__) caughtReadFlightSettled(el, result as object, true);
  return syncValue!;
}

export function clearStatus(el: Computed<any>, clearUninitialized: boolean = false): void {
  if (el._x?._pendingSources) clearPendingSources(el);
  if (el._x?._blocked) el._x._blocked = false;
  el._statusFlags = clearUninitialized ? 0 : el._statusFlags & STATUS_UNINITIALIZED;
  if (el._x?._error) setPendingError(el);
  const notify = statusNotifierOf(el);
  if (notify) notify.call(el);
}

/** A landing answers the node's own question: it retires the self entry, not
 * pending its sources propagated. With another source still pending the
 * node stays pending on it (#3373, #3376). `_blocked` clears, so an input
 * settling unchanged does not ask again; `_error` moves off self. */
function landStatus(el: Computed<any>, clearUninitialized: boolean = false): void {
  const sources = el._x?._pendingSources;
  if (sources && (sources.delete(el), sources.size)) {
    el._x!._blocked = false;
    if (clearUninitialized) el._statusFlags = STATUS_PENDING;
    setPendingError(el, sources.values().next().value);
  } else clearStatus(el, clearUninitialized);
}

export function notifyStatus(el: Computed<any>, status: number, error?: any): void {
  if (
    status === STATUS_ERROR &&
    !(error instanceof StatusError) &&
    !(error instanceof NotReadyError)
  )
    error = new StatusError(el, error);

  const pendingSource = status === STATUS_PENDING && error instanceof NotReadyError && error.source;

  if (pendingSource) {
    // A re-ask of a shown error keeps it on display (D-41).
    if (el._statusFlags & STATUS_ERROR) el._x!._shownError = el._x!._error;
    addPendingSource(el, pendingSource);
  } else clearPendingSources(el);
  // An error answering a node with no value keeps it uninitialized; a re-ask
  // is uninitialized again; a write gives it a value.
  el._statusFlags =
    status |
    (status === STATUS_ERROR
      ? el._statusFlags & (STATUS_UNINITIALIZED | STATUS_NO_VALUE)
        ? STATUS_NO_VALUE
        : 0
      : status === STATUS_PENDING && el._statusFlags & STATUS_NO_VALUE
        ? STATUS_UNINITIALIZED
        : el._statusFlags & STATUS_UNINITIALIZED);
  // Readers park on the propagated source.
  if (pendingSource) setPendingError(el, pendingSource, error);
  else ext(el)._error = error;

  // A guess is verdict-inert: its own flight is the hold's to wait on, not its
  // readers' (F-9, F-11). An input changed outside the guess's hold asks a
  // new question, held with that hold (D-34, #4336); a `refresh()` does not.
  if (guessing && status === STATUS_PENDING && el._config & CONFIG_GUESS) {
    if (passLane === null) joinFuture(el._flags & REACTIVE_REASK ? null : txOf(el)._parent);
    return;
  }

  const elNotify = statusNotifierOf(el);
  if (elNotify) {
    elNotify.call(el);
    return;
  }
  propagateStatus(el, status, error);
}

/** The dependents' half of `notifyStatus`. Also used alone for a store
 * family's leaves, which are not the derive's dependents. */
export function propagateStatus(el: Computed<any>, status: number, error: any): void {
  const pendingSource = status === STATUS_PENDING && error instanceof NotReadyError && error.source;
  forEachDependent(el, (sub, link) => {
    sub._time = clock;
    // Re-derive instead of marking when:
    // - a pending mark arrives on a kept-tail link: it is a question for the next
    //   pass, not this one (#3494);
    // - the subscriber is a verdict reader or a boundary's output: its pass
    //   decides what the change means (D-23, D-25);
    // - it carries a staged error: the source asks again (#4109).
    // Not an async memo D-25 makes the hold's work: it waits like any
    // derivation and asks once, at the landing (F-9, #4397).
    if (
      sub._config & CONFIG_REDERIVE ||
      (holdWorkHook &&
        (sub._config & CONFIG_VERDICT || (pendingSource && sub._config & CONFIG_STAGED_ERROR)) &&
        !(pendingSource && holdWorkHook(sub, el))) ||
      (status === STATUS_PENDING && link._gen !== sub._depGen)
    ) {
      // A re-derived subscriber no longer waits on a settled source: retire the
      // entry there and on its dependents, or the subscriber stays pending on a
      // source that never settles again.
      if (status !== STATUS_PENDING && removePendingSource(sub, el)) settlePendingSource(sub, el);
      enqueueSub(sub);
      schedule();
      return;
    }
    // Already pending on this source: nothing re-notifies, but the re-asking
    // write is held with the flight the observer waits on (D-9).
    if (pendingSource && sub._x?._pendingSources?.has(pendingSource)) {
      if (
        passLane === null &&
        (sub._config & (CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_HELD &&
        globalQueue._running &&
        !freshHook?.(sub, pendingSource._time === clock)
      )
        joinFuture(txOf(sub));
      return;
    }
    if (
      pendingSource ||
      (status !== STATUS_PENDING && (sub._x?._error !== error || sub._x?._pendingSources))
    ) {
      // Queued for the commit sweep, with the lane when the pass is lane work.
      if (laneStageHook && passLane !== null) laneStageHook(sub, passLane, true, el);
      else {
        queuePendingNode(sub);
        // Pending enters a held memo's hold without re-running it, so the write that
        // started the flight is held with it (D-9). A render effect's membership is
        // its pass's.
        if (
          status === STATUS_PENDING &&
          (sub._config & (CONFIG_HELD | CONFIG_OVERRIDE)) === CONFIG_HELD &&
          !(sub as any)._type
        )
          if (guessing && sub._statusFlags & STATUS_PENDING && reasks(sub))
            // A hold waiting only on re-asks holds nothing new (D-34, F-9): the memo
            // leaves it and publishes with the write's frame. Only guesses can keep such a
            // hold open (#4828).
            unhold(sub);
          else joinFuture(txOf(sub));
      }
      notifyStatus(sub, status, error);
      // A derived store's derive is marked, not re-run: its family walks the leaves.
      (sub as any)._fam?.st(status, error);
    }
  });
}
