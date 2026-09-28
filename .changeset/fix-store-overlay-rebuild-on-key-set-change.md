---
"@solidjs/signals": patch
---

Wide store folds that delete keys (or add many) no longer mutate the committed backing in place. A backing that served as a prototype overlay is a V8 prototype object, and below V8's descriptor limit every in-place add or delete on it costs O(keys) — a 400-key keyed record churning 100 keys per commit paid 4.7 ms per step. The commit now rebuilds the backing for such folds and swaps it in like a clone-path draft (0.22 ms per step); pure rewrites keep the in-place overlay flatten, and containers past the descriptor limit stay in place where V8 already makes the ops O(1). (#3689)
