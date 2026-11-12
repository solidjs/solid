---
"@solidjs/signals": patch
---

Two gate shapes S-58 says must match `<Show>` now do (#4405, #4708 follow-up).

- A zombie no longer retries an errored source on a later cycle's read. The old content of a remounted gate is a zombie until the hold lands. With one memo between an errored `latest()` reader and the branch, the zombie's retry threw a fresh error that re-derived the live gate, and the live gate's retry next round re-derived the zombie again: "Potential Infinite Loop Detected" in dev and a hang in prod. A zombie's fate is the seam's (L2), so it throws the error it has.
- A mount a probing pass opened (S-46) now also covers the passes its first pass creates. An `<Errored>` around the branch's content made the content's effect a plain leaf, so it attached with its hole empty during the flight (F-2) through a hand-written gate.
