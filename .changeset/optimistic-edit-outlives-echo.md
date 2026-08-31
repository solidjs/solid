---
"@solidjs/signals": patch
---

Optimistic edits now outlive their own echo: a continuation landing that carries a row whose key matches a still-open transaction's replayed add no longer satisfies the edit early. The echoed row keeps the landed slot, and the edit's value masks it until the transaction settles — converting the edit's structural optimism into a plain value override with the standard settle-scoped lifetime. Fixes the optimistic `pending` presentation dying at confirmation instead of at action completion (#3123 follow-up).
