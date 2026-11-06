// Truth reads (`until`, `refresh`; CONFIG_AUTHORITATIVE) over lane nodes,
// and the two views of a lane node every reader is served from. Side-effect
// free and apart from lanes.ts so a truth reader alone does not retain the
// lane engine: its reads reach these only through `laneRead`, which exists
// once something installs lanes (`createOptimistic`, verdicts).

import {
  CONFIG_AUTHORITATIVE,
  CONFIG_GUESS,
  CONFIG_OVERRIDE,
  CONFIG_SLOT_NODE,
  NOT_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { NotReadyError } from "./error.js";
import { enqueueSub } from "./heap.js";
import { GlobalQueue, txOf, type Transaction } from "./scheduler.js";
import type { Computed, Signal } from "./types.js";

/** A lane node's latest value. A guess: the guess — the lane's record of it
 * until the reveal (`under`), the screen's value after. A derivation: its
 * staging under the lane (a lane pass's answer, until the reveal), else
 * what the screen shows — NOT_PENDING for a node with neither (born in the
 * lane, uninitialized: its reads throw NotReady, A7; #4363). */
export function latestOf(el: Signal<any> | Computed<any>): unknown {
  if (el._config & CONFIG_GUESS) {
    const l = el._x!._transaction!;
    return l._shown ? el._value : l.under!.get(el);
  }
  return el._pendingValue !== NOT_PENDING
    ? el._pendingValue
    : (el as Computed<any>)._statusFlags & STATUS_UNINITIALIZED
      ? NOT_PENDING
      : el._value;
}
/** What the screen shows of a node: NOT_PENDING when nothing (uninitialized). */
export function screenOf(el: Signal<any> | Computed<any>): unknown {
  return (el as Computed<any>)._statusFlags & STATUS_UNINITIALIZED ? NOT_PENDING : el._value;
}
/** A chained link's committed value follows the inner store's (store.ts):
 * `_value`, while it is the screen's — a lane that has revealed the node
 * shows its own value there, and a revert asks the store (`_slotCovered`). */
export function follow(n: Signal<any>, v: unknown): void {
  if (!(n._config & CONFIG_OVERRIDE) || !n._x!._transaction!._shown) n._value = v;
}
/** The value a guess covered: the committed value until the lane reveals
 * the guess, the lane's record of it after (`under`) — a store slot's asked
 * of the store (a chained link follows the inner store's commits). */
export function covered(n: Signal<any> | Computed<any>): unknown {
  const l = n._x!._transaction!,
    u = l.under;
  const v = l._shown && u !== undefined && u.has(n) ? u.get(n) : n._value;
  return n._config & CONFIG_SLOT_NODE && GlobalQueue._slotCovered !== undefined
    ? GlobalQueue._slotCovered(n, v)
    : v;
}
/** The truth beneath a guess: a landing staged there — the parent's (lanes.ts
 * `landBeneath`), or the same tick's — else the value it covered. */
export function underOf(n: Signal<any> | Computed<any>): unknown {
  return n._pendingValue !== NOT_PENDING ? n._pendingValue : covered(n);
}
/** Truth readers (`until`, `refresh`; CONFIG_AUTHORITATIVE) — pay-for-use:
 * the first one installs these on GlobalQueue (signals.ts `watch`).
 *
 * A truth reader's read of a lane node: the lane's value when it is the
 * truth (#3943), else the truth beneath a guess. */
export function truthRead(el: Signal<any> | Computed<any>): unknown {
  if (truth(el)) return latestOf(el);
  if (!(el._config & CONFIG_GUESS)) throw new NotReadyError(null);
  return underOf(el);
}
/** A guess confirmed: its lane's truth readers re-read — of the lane's
 * derivations too, which may be the truth now (#3943). */
export function truthConfirmed(l: Transaction): void {
  for (let i = 0; i < l._nodes.length; i++)
    for (let s = l._nodes[i]._subs; s !== null; s = s._nextSub)
      if (s._sub._config & CONFIG_AUTHORITATIVE) enqueueSub(s._sub);
}
/** A lane node's value is the truth when every guess beneath it is
 * confirmed — its source landed a value equal to the guess beneath it — and
 * nothing beneath it is held in a transaction: same inputs, same value. */
function truth(n: Signal<any> | Computed<any>): unknown {
  if (n._config & CONFIG_GUESS)
    return n._pendingValue !== NOT_PENDING && n._equals && n._equals(latestOf(n), n._pendingValue);
  if (n._config & CONFIG_OVERRIDE) {
    for (let d = (n as Computed<any>)._deps; d; d = d._nextDep) if (!truth(d._dep)) return;
    return 1;
  }
  return n._pendingValue === NOT_PENDING ? 1 : undefined;
}
