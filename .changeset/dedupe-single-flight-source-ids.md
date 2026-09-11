---
"@solidjs/web": patch
---

Dedupe the requested single-flight source ids to a first-seen-order set at entry, so a repeated id runs its collector once and echoes once in the response header instead of multiplying work by the caller-controlled list length (#3251)
