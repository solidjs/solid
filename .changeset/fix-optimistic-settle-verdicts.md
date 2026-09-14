---
"@solidjs/signals": patch
---

Optimistic settle verdicts (#3409, #3411).

- `isPending(() => [a(), b()])` over two async siblings of an optimistic value reports pending as soon as either read is (#3409). `assignOrMergeLane` now follows a merged lane to its root and runs the parent/child check on it; the old "merged lane is stale, take the source lane" shortcut moved the combined probe's effect onto the held parent lane, where its verdict waited on the async it reports.
- An unowned `onSettled` callback (event handler, action body) reads a settled world (#3411). The settle only enqueues the reverted subscribers for the next pass, so a callback fired in the commit pass saw the optimistic source reverted beside a sync memo of it still holding the optimistic value. The fire now waits for the heap to drain.
