---
"@solidjs/signals": patch
---

A branch a held write mounts reads the value that mounted it on every pass. A binding in the new branch of a non-keyed `<Show>` that ran again before the landing — because it probes `isPending` on data the same write started loading, or because a live write reached it — was served the committed screen, where the condition is still `null`, and threw into `<Errored>` (where an unchanged landing then left the error up). Members of the frame a held pass built are now flagged at the park seam and read their transaction's world whichever flush runs them; a verdict reader among them waits on the transaction's flight with its frame instead of being served the committed value (#4010).
