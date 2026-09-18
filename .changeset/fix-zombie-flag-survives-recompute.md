---
"@solidjs/signals": patch
---

A zombie that recomputes stays a zombie (#3543). `recompute` and `updateIfNecessary` rewrote `_flags` wholesale and dropped `REACTIVE_ZOMBIE`, the flag that says a node sits on its owner's deferred-disposal chain. While any transaction was parked, the scheduler reruns zombies for mainline writes (#3463), so an owner that recreates a child each pass — a compiled `<Show when={a() && b()}>` condition — had its previous child rerun de-flagged; at the owner's commit `disposeChildren` then spliced that child out of the _live_ chain instead of the pending one, orphaning the current child. The orphan stayed subscribed and recomputing forever: one leaked node per update, until `HUGE_FAN_OUT`. The flag now survives every per-pass wipe.

A consequence pinned in `lane-outside-view.test.ts`: a zombie whose removal is staged by a transaction no longer holds that transaction's commit after it reruns — its say was always meant to be moot for the verdict that disposes it, and the extra hold was this bug.
