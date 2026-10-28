---
"solid-js": patch
---

Hydration no longer crashes when a streamed `<Loading>` fragment rejects after the client started hydrating and the region it stood in holds only text: an error an `<Errored>` outside it catches, or text content the client renders fresh. The swap took the claimed fallback's text node, and clearing the rejected fragment emptied the region, so the next text write found no node (`Cannot set properties of null (setting 'data')`, then `REACTIVITY_HALTED`). A region left empty by the clear now gets its text node back, so the page shows the outcome without asking again (#4372).
