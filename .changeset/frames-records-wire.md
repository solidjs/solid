---
"@solidjs/web": patch
---

Frames: the frame stream now carries versioned batches of keyed records (`{ id, version, r }`), the same writes the client's resident store applies, instead of eleven typed chunks the client translated into records. The server writes records natively: `renderServerComponent`, `renderToFrameStream` and the response helpers pipe these wire messages, so there is one format from the producer to the store. Records written in the same synchronous flush leave as one message per frame (a segment's assets, content and reveal travel together; a sweep stays one batch), with nothing held across a flush. Only `start`, `data` and the single-flight `outcome` keep a `type`, and the document face's live channel carries the same batches. The eager frames client loses its translation step (about 0.2 KB brotli off every server-components page). Experimental wire format: a client and server must come from the same release.
