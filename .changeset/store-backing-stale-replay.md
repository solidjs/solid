---
"@solidjs/signals": patch
---

A render effect's untracked read of a store key held by a foreign action — a key with no node, or a `reconcile` adoption held by the action — is now recorded for replay at the action's commit, as the signal path always was. Previously the store's backing-level selection served the committed value but skipped the registration, so the effect stayed on the pre-action value after the action settled. One registration (`recordStaleReplay`) is shared by the node path and the store's backing paths.
