---
"@solidjs/signals": patch
---

Fix `reconcile` invoking a function-valued leaf instead of replacing it, once that leaf has a subscriber. `setSignal(node, v)` treats a function argument as an updater and calls it — correct for `setStore(draft => ...)`, wrong for a leaf replacement. Plain store writes already guard against this by wrapping a function-valued prop before calling `setSignal`; `reconcile`'s leaf-replace branches (`applyStateFast`, `applyStateSlow`, `wrapValue`, `shallowDiffNodes`) did not, so reconciling a store leaf holding a function ran that function as a side effect and committed its return value instead of the function itself.
