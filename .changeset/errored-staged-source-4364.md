---
"@solidjs/signals": patch
---

An uninitialized async memo whose re-run throws from a dependency now reaches the wrapping `<Errored>` (#4364). The dependency's error was staged for the commit (D-41), but a reader threw it at once: a render effect reading a memo born staged, or the memo itself through `latest()`. The error reached the boundary naming that source, and the boundary's next pass took the source as settled because its error was only staged. It dropped the source and showed the content, so `Loading` revealed an empty hole that never recovered. An error staged on its source now keeps the boundary waiting until the commit publishes it.
