---
"@solidjs/signals": patch
---

Give the latest() shadow companion the `ownedWrite` flag its isPending companion already carries (#3378). A companion sync is internal plumbing that can run from inside a computation — a transition-held memo recompute pulled mid-tick by a reader creating or refreshing its latest() shadow — and the dev owned-scope write guard halted the app on the shadow write. Toggling a JSX branch that reads `latest(memo)` off while an action is pending and restoring it as the action resumes threw REACTIVE_WRITE_IN_OWNED_SCOPE.
