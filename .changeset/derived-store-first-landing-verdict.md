---
"@solidjs/signals": patch
"solid-js": patch
---

`isPending` of a derived store's key no longer reads `true` for one pass at the store's first landing. A first answer is loading, not pending, as it is for the memo the store copies. Before, a `<Show when={isPending(...)}>` over such a key could open for that pass and mount content that was never meant to show.
