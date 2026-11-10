---
"@solidjs/signals": patch
---

The lane engine is split along the guess boundary: `lanes.ts` keeps the sub-hold core every lane needs (the lane record, link / blocked / reveal / landing, the lane read and a lane pass's tail — what `isPending()` and `latest()` install for their verdict lanes), and the new `guesses.ts` carries what only a written guess reaches (`createOptimistic` / `createOptimisticStore`: `optimisticWrite`, the seam's `applyGuesses`, `take`, `supersede`, `laneCorrections`, `laneOutcome`, a write landing on a guess, a revert landing's give-back), installed behind hooks when imported. Pay-for-use (#2883): an app using `isPending`/`latest` without optimism no longer ships the guess layer (−531 B brotli on `+ isPending/latest`, −454 to −533 B on the live pages); an app with both pays the indirection (+15 B brotli). No rule or screen changes.
