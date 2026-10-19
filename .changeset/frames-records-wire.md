---
"@solidjs/web": patch
---

Frames: the frame stream now carries versioned batches of keyed records (`{ id, version, r }`), the same writes the client's resident store applies, instead of eleven typed chunks the client translated into records. Only `start`, `data` and the single-flight `outcome` keep a `type`; an `ops` sweep and a multi-key `reveal` are one batch each, and the document face's live channel carries the same batches. The eager frames client loses its translation step (about 0.2 KB brotli off every server-components page). Experimental wire format: a client and server must come from the same release.
