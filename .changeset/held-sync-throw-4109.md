---
"@solidjs/signals": patch
---

A synchronous memo that throws in a flush that later holds now waits for its frame like a value (D-41, #4109). The error was staged only when the flush had already joined a hold, so a pass that ran before its async sibling went pending published the error at once: an untracked read (a click handler) threw while the screen still showed the committed value.

A later pass of the same node replaces a staged error: a value, a pending flight or a new error supersedes it, so the value is no longer thrown as an error (#4145) and the superseded error is no longer published at the commit.
