---
"@solidjs/signals": patch
---

An async memo created inside a fresh Loading boundary over a held value no longer lands its first answer before the hold commits (D-12, U-1). The boundary still catches it and shows its fallback, and the hold still does not wait for it: its answer is staged with the hold and appears no earlier than the hold's commit. A boundary re-armed by `on` keeps owning what it collects outright.
