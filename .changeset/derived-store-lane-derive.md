---
"@solidjs/signals": patch
---

`createStore(fn)` over a `latest()`-reading memo shows an action's value as the memo does: a derive pass that is a lane's work writes its leaves as that lane's derivation instead of staging them with the action.
