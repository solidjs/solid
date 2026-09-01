---
"@solidjs/signals": patch
---

The owned-scope write guard's thrown message now names the owning scope (previously only the diagnostics channel carried it); CHEATSHEET no longer claims `untrack` exempts owned-scope writes — the guard is owner-based and untrack only stops tracking (#3157)
