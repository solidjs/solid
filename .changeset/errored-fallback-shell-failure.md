---
"solid-js": patch
---

An `<Errored>` whose fallback fails while rendering (a hole that rejects, or a synchronous throw) now passes that failure to the enclosing boundary on the server, in the shell as well as in a streamed fragment. An outer `<Errored>` draws its fallback in place of the region, and with none the request fails. Before, the region was sent blank, with the errors recorded and no markup for them.
