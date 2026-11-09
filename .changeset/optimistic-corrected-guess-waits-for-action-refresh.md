---
"@solidjs/signals": patch
---

An optimistic guess corrected by an outside re-ask now stays the value for effects and untracked reads until its action's own refresh lands (#4690). When a `refresh()` from outside the action landed under a pending guess (`createOptimistic`, or a `createOptimisticStore` keyed, unkeyed or object-shaped), the action's hold stopped waiting on the guessed source's next flight. Where nothing rendered the source, the hold landed with the action's write, and effects and untracked reads showed the old truth until the action's `refresh()` answered, while rendered readers (a render effect, a text node under `<Loading>`, an effect beside one) kept the guess. Rendered output never flickered; effect-only readers disagreed with it. A shown guess that was corrected now keeps its hold open while its own source is in flight, as an uncorrected guess does.
