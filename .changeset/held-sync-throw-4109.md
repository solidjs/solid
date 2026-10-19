---
"@solidjs/signals": patch
---

A synchronous memo that throws in a flush that later holds now waits for its frame like a value (D-41, #4109). The error was staged only when the flush had already joined a hold, so a pass that ran before its async sibling went pending published the error at once: an untracked read (a click handler) threw while the screen still showed the committed value.
