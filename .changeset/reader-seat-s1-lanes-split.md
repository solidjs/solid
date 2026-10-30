---
"@solidjs/signals": patch
---

Reader seat S1 M4: `lanes.ts` split into the sub-hold core (`lanes-core.ts`: the lane record, link/blocked/reveal/landing, the rows of a seated pass and of a lane's node, `verdictLane` with its reveal record) and the optimistic layer (`lanes.ts`: the guesses — `optimisticWrite`, `applyGuesses`, `supersede`, the corrections, `take`/revert), the latter reached from the core through `installOptimisticHooks` and carried only by a build that imports `createOptimistic`/`createOptimisticStore`. An `isPending`/`latest`-only build no longer retains the optimistic layer (`+ isPending/latest`: −1,661 B minified). No public API change.
