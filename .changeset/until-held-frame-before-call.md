---
"@solidjs/signals": patch
---

`until()` (and `resolve()`, awaitable `refresh()`) no longer deadlocks an action when the confirming frame was staged before the call (#3482). Since #3451 a reader created mainline under a hold is born held: it skips its first run and is replayed at the commit. For a promise-delivery effect the commit is the action's settle — the very thing its promise holds open — so an `until()` reached after the server had already broadcast the confirming frame timed out (or hung without a timeout). A `CONFIG_DIRECT_COMMIT` reader is the tunnel through a hold by contract and applies on its own microtask; `enterStagedRead` now exempts it from entering and from being born held, the same exemption verdict pulls have. The predicate sees the held frame, the action settles, and the commit reveals frame and overlay revert together. Regression from `d80cd1f6`; `2.0.0-rc.8` is unaffected.
