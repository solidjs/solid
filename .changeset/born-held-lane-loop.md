---
"@solidjs/signals": patch
---

A render effect that reads a memo born into a held change and, in the same pass, a fresh `isPending` no longer re-runs forever while the change is held (#3969). Under the dev server every component runs inside such a memo (hot reload), so a refetch that swapped a `<Show>` to a fallback containing `<Spinner on={isPending(x)} />` tripped the "Potential Infinite Loop Detected" guard. A read of a node born held no longer counts as a staged read: there is no committed value to re-derive on.
