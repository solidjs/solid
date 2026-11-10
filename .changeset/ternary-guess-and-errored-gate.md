---
"@solidjs/signals": patch
---

Fix two cases where a conditional written as a ternary behaved differently from `<Show>`. At a component root, `<>{c() ? a : b}</>` now opens its branch at once under an action's optimistic guess, as `<Show>` does (#3835). An `isPending` ternary in an `<Errored>` fallback no longer keeps the first error's text after a reset when the source fails again.
