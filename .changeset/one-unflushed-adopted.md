---
"@solidjs/signals": patch
---

One definition of "unflushed" for signals and store leaves. A staging adopted by a transaction before any flush carried it (`set(x, 1); action(...)` in one tick — same-tick adoption is by design) is still unflushed whatever its stamp: `latest(x)` answers the pre-write value and `isPending(x)` false inside the adopting action's body, as store leaves already did through their own selection while signals answered the staged value and `true`. `initTransition` marks such nodes at adoption (`CONFIG_ADOPTED_UNFLUSHED`); the carrying flush clears the mark and the hold takes over.
