---
"@solidjs/signals": patch
---

Fix derived optimistic stores permanently corrupting committed state when the source's draft writes ran while a caller's optimistic override was active (#3108). The source is the truth author: its draft reads — sync body and post-`await`/`yield` continuations alike — now serve the authoritative view instead of composing the caller's tentative overlay. Before, a generator continuation's `store.push` read `length` through an action's optimistic row and landed truth at the wrong index, committing `[null, row]`. Values, array length, membership, keys, and descriptors all leave the authoritative view together, gated on the same authoritative-write posture `ensurePB` already used to seed authoritative drafts from committed truth. User setter drafts are unchanged and keep composing on the optimistic view (#2951). Not an `until()` bug, despite the report's shape — the corruption reproduced with a plain yielded promise.
