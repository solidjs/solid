---
"@solidjs/web": patch
---

Thread the document wire id down as the adopted frame's claim scope. The identity split binds the frame to the call ADDRESS (function id + args hash), but the document producer stamps `_hk` hydration keys and region fids under the bare wire id — so every adopted claim on an args-bearing call (e.g. a note list keyed by search text) derived a `:hash`-suffixed prefix, missed the registry, and re-rendered fresh clones whose inserts moved the server-rendered `{$frame}` regions into a discarded detached tree: streamed content flashed and went blank. `claimScope` is the runtime's existing seam for exactly this (nested region frames already thread the root's scope down); adoptBoundary now passes the wire id through it.
