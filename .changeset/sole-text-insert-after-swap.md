---
"@solidjs/web": patch
---

Hydration no longer crashes when a streamed `<Loading>` fragment rejects with an error that an `<Errored>` outside it catches, once the client has started hydrating before the fragment arrives. The swap took the claimed fallback's text, and a sole text child's update wrote to a node that was no longer there (`Cannot set properties of null (setting 'data')`, then `REACTIVITY_HALTED`). With no node left, the new text is inserted like a first one, so the page shows the server's error without asking again (#4372).
