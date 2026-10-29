---
"@solidjs/signals": patch
---

A memo that threw and then recovers under an open action now keeps its error on screen until the action commits. Before, a reader served the committed value, such as `<Errored>` content beside a `latest()` read (`"X" + latest(s) + m()`), read `undefined` in place of the error and showed `X1undefined` while the action was still open. The recovery's staging now keeps the error as the shown error until it commits (D-39, D-41). Frame and verdict readers are served that error, as an untracked read already was, and they re-derive when the action lands.

The same holds for a memo the content created on its first pass and kept in a closure (`(cached ||= createMemo(...))()`). That memo is disposed with the pass that created it. The error boundary now waits on the reader when the source that threw is disposed. Before, it waited on the dead memo, which settled at once and looped the flush.
