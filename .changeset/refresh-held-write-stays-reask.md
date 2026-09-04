---
"@solidjs/signals": patch
---

`refresh()` after a held manual write stays a quiet re-ask. When an action
wrote to a derived store and later called `refresh(store)`, the lift of the
manual-write mask (#3026) dropped the re-ask classification, so the refetch
was treated as a brand-new question and pended every leaf — every sibling
row lit up `isPending`, and a row-scoped `affects()` could not narrow it.
The lift now keeps the classification: same-question motion stays silent,
and only the written slot and any declared `affects()` mark read pending
until the truth lands. Same-tick precedence (#2692) is unchanged.
