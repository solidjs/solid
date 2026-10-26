---
"@solidjs/signals": patch
---

`refresh()`, `until()` and `resolve()` deliver authoritatively, not at the
holding transition's completion (#4263). When an in-flight action's
transaction holds the landing a waiter reads — e.g. after an optimistic
write, a dependency change re-ran the memo and its landing was staged under
the action — the promise now resolves with that landing as soon as it has
settled, whether it was created inside the action (including an `await`
continuation with no bare `yield`, which used to deadlock: #3482 as filed,
#4263) or outside it. The screen still reveals the landing with the action's
commit. A waiter over a plain pending frame (no action open) still delivers
at its commit.
