---
"@solidjs/web": patch
---

`renderToStream`: a value that fails to serialize no longer leaves the other pre-shell hydration values pending on the client (#4242). Pending promises registered before the shell (async sources and Loading boundaries' `<key>_fr` completion flags) were handed to seroval as one object write. Since seroval 1.7, a value that fails to serialize ends the write it belongs to, so one failure stopped every value in that write. An async memo that resolves to an element, such as a nested `<Loading>`, left both boundaries unresolved and hydration never finished. The stubs are still held until the shell and handed over at the same point, in the same order, but each is now its own keyed write, so a failure only affects its own key, as on rc.17.
