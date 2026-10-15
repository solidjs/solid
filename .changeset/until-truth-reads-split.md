---
"@solidjs/signals": patch
---

`until()` and `refresh()` no longer retain the optimistic lane engine in apps that don't use optimism (−4.8 KB minified). An `until()` predicate reading a memo derived from an unconfirmed optimistic guess now waits for the guess to be confirmed or corrected, instead of seeing the value from before the guess.
