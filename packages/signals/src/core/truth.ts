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

/** A guess its lane has not revealed yet (F-6). The one value a node has
 * beside its two slots; it moves to `_value` at the reveal (lanes.ts
 * `reveal`). */
export const covers: WeakMap<Signal<any>, unknown> = /* @__PURE__ */ new WeakMap();
/** A lane node's latest value. A guess: the one waiting for its reveal,
 * else the one on screen. A derivation: its staging under the lane, else
 * what the screen shows; NOT_PENDING for a node with neither (D-22). */
export function latestOf(el: Signal<any> | Computed<any>): unknown {
  if (el._config & CONFIG_GUESS) return covers.has(el) ? covers.get(el) : el._value;
  return el._pendingValue !== NOT_PENDING
    ? el._pendingValue
    : (el as Computed<any>)._statusFlags & STATUS_UNINITIALIZED
      ? NOT_PENDING
      : el._value;
}
/** What a guess shows over: the screen's value until its reveal, the
 * hold's pending value after (F-11). */
export function covered(n: Signal<any> | Computed<any>): unknown {
  return n._x!._shown ? n._pendingValue : n._value;
}
/** What the guess's hold will commit: a truth landed beneath it, else the
 * value it reverts to (F-11, D-34). */
export function underOf(n: Signal<any> | Computed<any>): unknown {
  return n._pendingValue !== NOT_PENDING ? n._pendingValue : covered(n);
}
/** A truth has landed beneath a guess since it was made (D-34): its pending
 * value is that truth, not the value it reverts to. */
export function landed(n: Signal<any> | Computed<any>): boolean {
  return n._pendingValue !== NOT_PENDING && !n._x!._revert;
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
    return landed(n) && n._equals && n._equals(latestOf(n), n._pendingValue);
  if (n._config & CONFIG_OVERRIDE) {
    for (let d = (n as Computed<any>)._deps; d; d = d._nextDep) if (!truth(d._dep)) return;
    return 1;
  }
  return n._pendingValue === NOT_PENDING ? 1 : undefined;
}
