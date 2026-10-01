---
"@solidjs/signals": patch
"solid-js": patch
---

Derived writes apply first, then derivations re-run. A manual write to a writable derived value (`createSignal(fn)`, `createStore(fn)`) lands at once; when one of its sources changes — in the same update or later, inside or outside an action, across async holds — the function re-runs and receives the write as `prev` (or as the draft for `createStore(fn)`), and decides what to keep. A write on its own never re-runs the function.

This reverses beta.11's same-tick precedence (#2692), where a write beat a source change in the same flush: a function that ignores `prev` now discards a write made in the same update as a source change, and a same-value write no longer holds against it. To keep a local value across source changes, carry it in the data as a flag the function honors. It also fixes #3733 (a write inside an action blocked later source changes for the whole hold, a regression since #2692) and supersedes the frame-scoped mask from #3740, whose changeset this replaces.
