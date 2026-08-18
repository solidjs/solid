---
"@solidjs/signals": minor
---

Store rewrite: shallow derived and optimistic forms serve from the rewrite
(fam.shallow → root slot semantics). The shallow serve rule is now exact
legacy parity (#2932): raw-marked data serves verbatim, store-proxy slot
values get boundary wrappers in the shallow store's own family so downstream
writes never land upstream. Every public store form now runs on the new
implementation.
