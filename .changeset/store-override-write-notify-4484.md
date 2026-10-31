---
"@solidjs/signals": patch
---

A derived store's writes after an `await` no longer leak into the next user setter (#4484). A write-override write (the derive's continuation) notifies its target at once but left it listed for notification, so the next outermost store setter — on any store — notified the derive's staged landing as its own write; on an optimistic family that made the landing a guess over a pending one, and a pending removal guess showed its row again when another action guessed on a different store. An outermost setter now starts with no stale targets (F-11, D-33).
