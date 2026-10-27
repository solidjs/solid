---
"solid-js": patch
"@solidjs/web": patch
---

A client hydrating mid-stream no longer asks again for an async read whose server answer was an error, nor flashes back to the `<Loading>` fallback after the failure showed (#4287, #4306). The content of a hydrated failure (a hydrated `<Errored>`'s content run, or a rejected fragment's fresh render over the `<Errored>` fallback the server drew) reads a shell memo a cycle after its error landed, and a later tracked read retries an errored async node; the serialized-value latch took that rerun for a client write and computed. Inside such a content run the rerun now re-serves the server's answer and arms nothing. A rejected fragment with no outcome streams an empty template (it was a lone space), so the nodes its swap lists are the server's outcome alone.
