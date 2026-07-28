---
"@solidjs/signals": patch
---

Stop `reconcile` from merging an array into an object slot (and vice versa) inside arrays

The object diff has always refused to recurse into a pair whose kinds disagree — `Array.isArray(previous) !== Array.isArray(next)` replaces the slot instead of merging. The array paths reach the same recursion through `keyedMatch` and positional pairing, and neither applied that rule: two keyless wrappables "match" because `keyFn` returns `undefined` for both, regardless of whether they are arrays or objects.

The result was a slot whose proxy is permanently the wrong kind. `Array.isArray` on a store proxy inspects the proxy's target, which is fixed at wrap time, so after

```js
const [state, setState] = createStore({ list: [{ x: 1 }] });
setState(reconcile({ list: [[10, 20]] }, "id"));
```

`state.list[0]` reports `Array.isArray === false` and enumerates as `{ "0": 10, "1": 20 }` — spread, `.map`, `<For each>` and `JSON.stringify` all see an object. The reverse direction (array slot receiving an object) is worse: the array-shaped target reads `length` off the incoming object and the store presents an empty array, silently dropping the data.

Four call sites shared the gap — the keyed prefix loop and the positional loop in both `applyStateFast` and `applyStateSlow`, plus `applyArrayItem` (which covers the keyed diff's trailing and moved slots). They now share a `recursablePair()` helper that folds the existing raw-value (`markRaw`) check together with the container-kind check, so a kind change replaces the slot by reference — exactly what the object diff and `descendInto` already do.
