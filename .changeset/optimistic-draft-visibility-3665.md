---
"@solidjs/signals": patch
---

Fix optimistic-store drafts losing the row a previous setter added in the same action (#3665)

- rc.9 regression: the get trap's draft arm for an absent own key was gated on the reader rule (`visibleOverride`), so a second setter in the same synchronous action body read `undefined` where the first setter had pushed a row — `length` and `in` saw it, the value read did not, and a `findIndex` lookup missed. The draft is the writer's channel and composes on the tick's own unflushed writes (`hasActiveOverride`), as the has trap, `visibleKeys` and `optimisticView` already did.
- The descriptor trap gains the same draft arm: `ownKeys` listed an added key while `getOwnPropertyDescriptor` reported it absent, so every enumerator — `Object.keys`, spread, `Object.entries`, `JSON.stringify` — dropped the row inside a later setter (pre-dates rc.9). `deep()`/`snapshot()` inside a setter compose on the draft's view the same way.
