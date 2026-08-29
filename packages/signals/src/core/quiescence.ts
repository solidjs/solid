/**
 * Quiescence waiters — the machinery behind `refresh()` returning a promise.
 *
 * A waiter resolves with the target's NEXT QUIESCENT STATE: the node has no
 * re-ask queued (dirty/heap flags clear) and no open pending window. This is
 * deliberately level-triggered, not flight-correlated — if a second refresh
 * supersedes the first mid-flight, every waiter resolves with whatever
 * finally lands (a flight that never settles on its own "doesn't mean
 * anything"; the superseding answer contains or replaces it).
 *
 * Why not an effect/subscriber: a re-ask that lands an EQUAL value is
 * completely silent to the graph (no notification, no `_time` bump — the
 * equality check runs after clearStatus), and a bare refresh is verdict-quiet
 * (isPending stays false), so there is nothing reactive to observe. The only
 * reliable witnesses are the settle seams themselves: `clearStatus` (every
 * landing, equal or not, staged or committed) and `notifyStatus` (errors) —
 * both already dispatch through `GlobalQueue._updatePendingSignal`, so
 * waiters ride the existing slot: the installer wraps whatever is installed
 * (the verdict layer assigns at module eval, strictly before any runtime
 * refresh call) and inspects on a microtask, after the seam's caller has
 * finished writing the value.
 *
 * Inspection on a microtask also makes delivery transaction-safe, matching
 * resolve()/until() (#2930): a landing staged into a held transaction (a
 * refresh the action itself issued) resolves waiters with the STAGED value —
 * refusing it would deadlock `yield refresh(...)` on data the open
 * transaction is holding.
 *
 * Pay-for-use: this module is only reachable through `refresh()`, so apps
 * that never call it shake the whole thing out. The core floor pays one
 * config-bit term in clearStatus's dispatch gate.
 */
import {
  CONFIG_QUIESCENCE_OBSERVED,
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  REACTIVE_DISPOSED,
  REACTIVE_IN_HEAP,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { unwrapStatusError } from "./error.js";
import { GlobalQueue } from "./scheduler.js";
import type { Computed } from "./types.js";

interface QuiescenceWaiter {
  resolve: (value: any) => void;
  reject: (error: any) => void;
  read: (node: Computed<any>) => any;
}

let waiters: Map<Computed<any>, QuiescenceWaiter[]> | null = null;
const scheduled = new Set<Computed<any>>();

function installQuiescence(): void {
  const prev = GlobalQueue._updatePendingSignal;
  GlobalQueue._updatePendingSignal = (node: any) => {
    prev !== null && prev(node);
    if (node._config & CONFIG_QUIESCENCE_OBSERVED && waiters!.has(node)) scheduleInspect(node);
  };
}

function scheduleInspect(node: Computed<any>): void {
  if (scheduled.has(node)) return;
  scheduled.add(node);
  queueMicrotask(() => {
    scheduled.delete(node);
    inspect(node);
  });
}

function inspect(node: Computed<any>): void {
  const list = waiters!.get(node);
  if (list === undefined) return;
  // A disposed node can never re-ask or settle again: whatever it holds IS
  // its final quiescent state — deliver it rather than stranding the hold.
  if (!(node._flags & REACTIVE_DISPOSED)) {
    // A queued re-ask (the refresh's own mark, or any newer invalidation)
    // means the current state is not the answer — wait for its settle seam.
    if (node._flags & (REACTIVE_DIRTY | REACTIVE_CHECK | REACTIVE_IN_HEAP)) return;
    const status = node._statusFlags;
    if (status & STATUS_ERROR) {
      waiters!.delete(node);
      const error = unwrapStatusError(node._x?._error);
      for (const w of list) w.reject(error);
      return;
    }
    if (status & (STATUS_PENDING | STATUS_UNINITIALIZED)) return;
  }
  waiters!.delete(node);
  for (const w of list) w.resolve(w.read(node));
}

/**
 * Register a waiter for `node`'s next quiescent state. `read` extracts the
 * delivered value at settle time (staged-or-committed for accessors, the
 * proxy itself for stores). Callers must register AFTER queueing their own
 * re-ask marks — the initial inspection is a level check, and a
 * currently-quiescent node resolves immediately (early-return refresh paths:
 * manual-write-wins, disposed targets).
 */
export function awaitQuiescence<T>(
  node: Computed<any>,
  read: (node: Computed<any>) => T
): Promise<T> {
  if (waiters === null) {
    waiters = new Map();
    installQuiescence();
  }
  return new Promise<T>((resolve, reject) => {
    let list = waiters!.get(node);
    if (list === undefined) waiters!.set(node, (list = []));
    list.push({ resolve, reject, read });
    node._config |= CONFIG_QUIESCENCE_OBSERVED;
    scheduleInspect(node);
  });
}
