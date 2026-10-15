---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Emit element claims after the element's initial attributes are applied (#3923), at parity across both compilers.

A fully static `a[href]` / `form[action]` is claimed at the end of its creation statements (after static writes and refs). An element with dynamic bindings captures its owner at creation (`var _o$ = _$getOwner()`) and is claimed as the last statement of its binding effect's callback — `_$claimElement(_el$, _o$)` — in both the single-binding and the multi-binding shapes, so the claim observes the applied values on the first run whether that run is synchronous or lands from a held flush. An element carrying a spread emits no compiled claim: the `spread` runtime claims it after the first application.
