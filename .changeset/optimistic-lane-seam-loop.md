---
"@solidjs/signals": patch
---

Fix an infinite flush loop when a memo over an optimistic store list (an "N left" count, a filter) read through a lane linked to one re-based over a parked refresh (#4643).
