---
"@solidjs/signals": patch
---

A memo that threw and then recovers under an open action now keeps its error on screen until the action commits. Before, a reader served the committed value, such as `<Errored>` content beside a `latest()` read (`"X" + latest(s) + m()`), read `undefined` in place of the error and showed `X1undefined` while the action was still open. The recovery's staging now keeps the error as the shown error until it commits (D-39, D-41). Frame and verdict readers are served that error, as an untracked read already was, and they re-derive when the action lands.
