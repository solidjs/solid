---
"@solidjs/signals": patch
"solid-js": patch
---

`Loading`'s `on` prop is a key — equivalent to a keyed `Show` wrapping the boundary, minus the remount. The key is now a tracked expression (its own computed, living outside the boundary like the `Show` condition would), and a change resets the boundary, landing wherever the key's change lands: `on={count()}` swaps to the fallback with the write's commit, `on={latest(count)}` ahead of it. Previously `on` was a `spectate` read compared per pending notification, so `on={latest(count)}` never revealed early.

Boundaries are exempt from A29 born-held: a `Loading` mounted while a transaction holds what it reads shows its fallback now (and reveals the staged content at the commit) instead of being born held with the transaction. Born held stays right for a plain memo or effect — published, its value would tear the frame — but a boundary that has not revealed is the exception by definition: its job is to catch what is not ready under it rather than let it hold. The hold stays with readers that have content to keep; a boundary already showing content still holds like any reader. This also closes the static-vs-function-child `<Show keyed>` inconsistency from the issue.

Two expectations changed: a memo + effect created inside boundary content over a held value no longer publishes the held value early (it is collected by the boundary and nothing publishes until the commit — `posture-store-parity` S2), and an `isPending`-driven `on` key reveals the fallback ahead of the commit like any verdict channel (`ispending-in-boundary-on-3528`). Fixes #3540.
