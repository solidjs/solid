---
"@solidjs/signals": patch
---

A verdict reader that reveals a flight nobody holds registers it with the frame (A15 first observer, #3458): `observeFlight` holds the flight's node in the frame's transaction, so the transaction waits for the landing instead of holding nothing, landing at its own seam and re-deriving the reader into the same observation every flush ("Potential Infinite Loop Detected") — an action whose body-end write re-asks an async memo as its verdict lane's work, revealed to a `latest()` reader the action adopted (fuzzer F12), or any memo re-asked unobserved and then revealed to a reader using `latest()`/`isPending()`.
