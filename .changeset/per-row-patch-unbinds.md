---
"@solidjs/web": patch
---

Patch-mode lists retain per-row unbind handles: a record the app keeps beyond its row's life no longer holds a live patch registration updating detached DOM — registrations are severed on row removal, contract-leave handoffs, and list disposal. Dev builds also warn when a stamped row's build attaches computations or cleanups to the shared list owner (owned work in handler/attribute value position is unsupported in patch-mode rows).
