---
"solid-js": patch
---

Fix `<For keyed={false}>` (and `mapArray` with `keyed: false`) lagging by one update when its source is a store and a store property is mutated in-place. The mapArray internal owner now points its `_parentComputed` at the mapArray computed, so untracked store-proxy reads inside `updateKeyedMap` resolve to the pending value being written in the same flush rather than the stale committed value. Fixes #2687.
