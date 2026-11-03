---
"@solidjs/signals": patch
---

Fix an infinite flush loop when a memo over an optimistic store list (an "N left" count, a filter) read through a lane re-based over a parked refresh (#4643). Lane work re-based over a hold's answer no longer joins the flush into that hold, so a plain write beside it (a filter change) shows once instead of showing, retracting and showing again, and a guess beside the held answer no longer reveals it early. A push after a removal guess no longer leaves an `undefined` row in the list.
