---
"@solidjs/signals": patch
---

Fix a Loading boundary whose `on` key consults `isPending()` through a memo freezing the page (#3528). The key is evaluated from `notify`, inside the pending memo's own pass; reading the pending `isPending` memo there recorded an untracked-pending re-run dependency on that memo, making the async memo depend on a memo that depends on it — every pending mark re-derived it and it never converged. The `on` accessor is now evaluated as a spectator (`spectate`): untracked, and never recorded as a dependency of whichever node's pass it happens to run in.
