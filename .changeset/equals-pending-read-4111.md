---
"@solidjs/signals": patch
---

A custom `equals` that reads an unresolved async source (a getter over a pending memo) no longer leaves the memo stuck on a `NotReadyError` nothing retries. A comparator that throws `NotReadyError` has not shown the values equal, so the value is published as a change; its readers dereference it in their own tracked context, suspend under their `<Loading>` boundary and recover when the async work lands (#4111). Other comparator throws are still errors of the node, and a signal setter's comparator throw now takes the same path (its error boundary contains it) instead of throwing at the caller.
