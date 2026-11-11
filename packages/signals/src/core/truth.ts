// Truth reads (`until`, `refresh`; CONFIG_AUTHORITATIVE) over lane nodes,
// and the two views of a lane node every reader is served from. Side-effect
// free and apart from lanes.ts so a truth reader alone does not retain the
// lane engine: its reads reach these only through `laneRead`, which exists
// once something installs lanes (`createOptimistic`, verdicts).

import {
  CONFIG_AUTHORITATIVE,
  CONFIG_GUESS,
  CONFIG_OVERRIDE,
  NOT_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { NotReadyError } from "./error.js";
import { enqueueSub } from "./heap.js";
import { GlobalQueue, type Transaction } from "./scheduler.js";
import type { Computed, Signal } from "./types.js";

/** A lane's record of a node beside the node's two slots: its guess until
 * the lane reveals it (its staging is a truth's), and after the reveal the
 * value the screen showed before (a guess reverts to it at the lane's end;
 * once shown (CONFIG_SHOWN). Dropped when the node leaves its lane. */
export const covers: WeakMap<Signal<any>, unknown> = /* @__PURE__ */ new WeakMap();
/** A lane node's latest value. A guess: the guess — the lane's record of it
 * until the reveal (`under`), the screen's value after. A derivation: its
 * staging under the lane (a lane pass's answer, until the reveal), else
 * what the screen shows — NOT_PENDING for a node with neither (born in the
 * lane, uninitialized: its reads throw NotReady, A7; #4363). */
export function latestOf(el: Signal<any> | Computed<any>): unknown {
  if (el._config & CONFIG_GUESS) return el._x!._shown ? el._value : covers.get(el);
  return el._pendingValue !== NOT_PENDING
    ? el._pendingValue
    : (el as Computed<any>)._statusFlags & STATUS_UNINITIALIZED
      ? NOT_PENDING
      : el._value;
}
/** The value a guess covered: the committed value until the lane reveals
 * the guess, the lane's record of it after (`under`) */
export function covered(n: Signal<any> | Computed<any>): unknown {
  return n._x!._shown ? covers.get(n) : n._value;
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
