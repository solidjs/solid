---
"@solidjs/web": patch
---

A hydrating client that boots mid-stream shows a `<Loading>`'s streamed content once when the boundary's fallback was a bare string (#4374). The hole holding the fallback kept it as a raw string, which tracks no node, so the hole never noticed that the fragment had swapped in and reconciled against a fallback it no longer had: a text node of the server's content stayed beside the client's copy (a nested `<Errored>`'s fallback drawn twice, text after an element repeated), or was replaced instead of adopted. While hydrating, a hole holding a raw string now re-claims its region, as it does when the nodes it tracks are gone.
