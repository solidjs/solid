---
"@solidjs/web": patch
---

Reactive style bindings (`style()` and `setStyleProperty()`) no longer overwrite server-rendered inline styles during the initial hydration pass, consistent with class and attribute bindings (#3180). The first subsequent reactive update applies the client value.
