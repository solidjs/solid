---
"@solidjs/web": patch
---

Clarify invoke's wrapper contract: declaration wrappers (GET, live) forward the invocation channel mechanically (1:1 call mapping); wrappers that share calls (deduping caches, multicast channels) opt in deliberately or decline, and invoke's error now directs callers to the underlying reference or the wrapper's own idioms.
