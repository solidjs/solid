---
"@solidjs/signals": patch
---

Store rewrite: full plain-store parity. The rewrite now passes the entire
suite (91/91 files) serving plain deep stores and reconcile package-wide:
transition holds (write-time notification via per-key nodes, per-leaf
isPending), affects() coverage over rewrite targets, legacy interop via
structural field aliasing (v/n/h/d/s + $PROXY), markRaw/shallow interop,
dev diagnostics (registerGraph, onStoreNodeUpdate, strictRead warnings), and
owned-subtree snapshot copies (non-enumerable symbols excluded, cycle
identity preserved — fixes FINDING-3's cycle duplication).
