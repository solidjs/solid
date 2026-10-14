---
"@solidjs/diagnostics": patch
---

The browser bridge keeps shared references in the payload it transfers. `toSerializable` treated every object it had already written as a cycle and dropped it, so a `LONG_HOLD` diagnostic, whose `data` carries the hold's own `blockers` and `acknowledgements` arrays, left the hold record in `attribution.holds` without them, and `expectNoSilentHolds` threw a `TypeError` on any browser capture that recorded a long hold. The serializer now tracks only the ancestors of the value being written: an object reached twice is written twice, and only an object that contains itself is dropped.
