---
"@solidjs/web": patch
---

Apply document-face `slot` ops from the `sc:live` channel (DR-2 case 1 at t=0): a re-emitted occurrence record updates the adopted occurrence's live props in place. Slot ops are store-keyed rather than geometry-routed — two boundaries can share an occurrence name — so they carry the producing frame's id and only the owning boundary applies them.
