// Truth reads (`until`, `refresh`; CONFIG_AUTHORITATIVE) over lane nodes.
// Side-effect free and apart from lanes.ts so a truth reader alone does not
// retain the lane engine: its reads reach these only through `laneRead`,
// which exists once something installs lanes (`createOptimistic`, verdicts).

import { CONFIG_AUTHORITATIVE, CONFIG_GUESS, CONFIG_OVERRIDE, NOT_PENDING } from "./constants.js";
import { NotReadyError } from "./error.js";
import { enqueueSub } from "./heap.js";
import type { Transaction } from "./scheduler.js";
import type { Computed, Signal } from "./types.js";

/** A lane node's current value: its guess, or the latest it derived — the
 * staging a shown lane holds for its next reveal, else its slot; the
 * committed value while it has none (its first lane pass in flight). */
export function laneValueOf(el: Signal<any> | Computed<any>): unknown {
  if (!(el._config & CONFIG_GUESS) && el._pendingValue !== NOT_PENDING) return el._pendingValue;
  const v = el._x!._lane;
  return v !== NOT_PENDING ? v : el._value;
}
/** Truth readers (`until`, `refresh`; CONFIG_AUTHORITATIVE) — pay-for-use:
 * the first one installs these on GlobalQueue (signals.ts `watch`).
 *
 * A truth reader's read of a lane node: the lane's value when it is the
 * truth (#3943), else the truth staged beneath a guess, else the committed
 * value. */
export function truthRead(el: Signal<any> | Computed<any>): unknown {
  if (truth(el)) return laneValueOf(el);
  if (!(el._config & CONFIG_GUESS)) throw new NotReadyError(null);
  return el._pendingValue !== NOT_PENDING ? el._pendingValue : el._value;
}
/** A guess confirmed: its lane's truth readers re-read — of the lane's
 * derivations too, which may be the truth now (#3943). */
export function truthConfirmed(l: Transaction): void {
  for (let i = 0; i < l._nodes.length; i++)
    for (let s = l._nodes[i]._subs; s !== null; s = s._nextSub)
      if (s._sub._config & CONFIG_AUTHORITATIVE) enqueueSub(s._sub);
}
/** A lane node's value is the truth when every guess beneath it is
 * confirmed — its source staged a value equal to the guess — and nothing
 * beneath it is held in the parent: same inputs, same value. */
function truth(n: Signal<any> | Computed<any>): unknown {
  if (n._config & CONFIG_GUESS)
    return n._pendingValue !== NOT_PENDING && n._equals && n._equals(n._x!._lane, n._pendingValue);
  if (n._pendingValue !== NOT_PENDING) return;
  if (n._config & CONFIG_OVERRIDE)
    for (let d = (n as Computed<any>)._deps; d; d = d._nextDep) if (!truth(d._dep)) return;
  return 1;
}
