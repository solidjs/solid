---
"@solidjs/signals": patch
---

An effect that owes a run is queued as its node, and the queue runner hands it to `runEffect`. Before, every effect's first update allocated a bound runner and stored it on the node as a property added after creation, and every `createEffect` allocated a second one for its first run. No behavior change; bundles that create effects are 1 to 51 B smaller minified.
