---
"@solidjs/signals": patch
---

A keyed `reconcile` keeps a row's store proxy when the row is matched by key, even if nothing has subscribed to any of its fields. Before, such a row got a new proxy at every reconcile, so a `<For>` over the list disposed and remade the row and lost its local state. Updates to the kept proxy follow normal store flush and transition timing.
