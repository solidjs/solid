---
"solid-js": patch
---

A `<Loading>` whose fragment was cut off by a truncated stream renders fresh on the client and adopts the records the server sent. The records the stream never settled were still in the registry at that point, so the fresh render adopted their promises, which never settle: the boundary stayed on its fallback and its reads never ran. Truncation now removes those records before any boundary resumes. Reads the server never answered compute on the client, and the values and errors it sent before the cut are still adopted.
