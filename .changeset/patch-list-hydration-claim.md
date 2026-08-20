---
"@solidjs/web": minor
---

Patch-mode list hydration: claim + register only. The list driver claims each
server row positionally through the row's own `_hk` key (a row-scoped
explicit-id owner makes the compiled template's getNextElement resolve it),
and patchDriver skips the initial force-apply while hydrating — server HTML
stays the truth until the first transition. All driver-side `each` reads and
the probe are id-isolated (throwaway/private explicit-id owners), so lazily
minted prop-getter memos can no longer shift the ambient hydration id chain
on either the engage or decline path.
