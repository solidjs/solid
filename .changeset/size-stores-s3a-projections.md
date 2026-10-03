---
"@solidjs/signals": patch
---

Stores on L2, S3a: `createProjection`, `createStore(fn, seed)` and `reconcile` return. The firewall is projection-only and lives in the store: every read through a projection pulls the derive first (core `read()` of it — untracked when settled, so nothing subscribes to the derive; tracked while a flight is up, so readers observe it as a memo's would); pending propagates to leaf readers by core's own dependent rule and settles at the landing; a derive's continuation writes join its hold; the creation run commits directly; adoption is eager with the container node keeping the committed frame. Core: the self-registered-flight probe in `recompute` is restored (projection-only, carved by mistake); an untracked verdict read of an uninitialized pending node links its reader as `read()` does. Derived-store manual writes follow A34 rule B (re-pinned).
