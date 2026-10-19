---
"@solidjs/signals": patch
---

A memo that recovers before its held error commits shows the recovered value (#4145). D-41 stages an error found while a sibling holds the frame, marking the staging with `CONFIG_STAGED_ERROR`. A later successful pass in the same hold replaced the staged error with its value but left the flag set, so the reveal threw the successful value as an error and halted the reactive system. The pass that stages a value now clears the flag.
