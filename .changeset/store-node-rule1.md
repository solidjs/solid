---
"@solidjs/signals": patch
---

Store node reads select committed-vs-staged by the core's `readerSeesCommitted` (one Rule 1 implementation for signals and store nodes). Fixes a render effect's untracked read of a store key held by a foreign action never replaying at that action's commit — the store's hand-restated stale-of-foreign clause served the committed value but skipped the replay registration the signal path performs, leaving the effect on the pre-action value permanently.
