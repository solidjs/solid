---
"@solidjs/signals": patch
---

Reader seat S1 (M4 deletion): `reruns` no longer carries `REACTIVE_FRAME_READ` across a lane's re-run — the seat's MARK_ST side effect re-raises it on the re-read when the flight is still up (#4397 covered by the table).
