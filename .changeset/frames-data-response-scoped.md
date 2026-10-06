---
"@solidjs/web": patch
---

frames: a `data` chunk is under the store's version guard like every other chunk — a superseded response's late data lands nowhere, never in the table that is now the current response's (contract C5 a, b, e).
