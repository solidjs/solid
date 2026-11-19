---
"solid-js": patch
---

Agent guidance (CHEATSHEET, `solid-2.0` and `reactivity-diagnostics` skills, `diagnostics.json`): `STRICT_READ_UNTRACKED` is fixed by moving the read to where the value is used, never by wrapping it in `untrack`. The diagnostics skill now maps each use (rendered, derived, async input, hook argument, local-state seed, side effect, event, built-once object) to its repair.
