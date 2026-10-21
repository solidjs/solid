---
"solid-js": patch
---

Docs: effects never compare compute values. The effect half (and the previous cleanup) runs every time the compute half re-runs, even when compute returned an equal value. To skip work on an unchanged value, read a `createMemo` (optionally with `equals`) in the compute. Noted in the `solid-2.0` skill and the cheatsheet (#4184).
