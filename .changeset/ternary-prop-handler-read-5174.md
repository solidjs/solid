---
"@solidjs/web": patch
"@solidjs/universal": patch
---

A prop whose expression is a ternary over an async source (`n={ans() == null ? -1 : ans().length}`) now reads the value on screen from an event handler while the source re-asks, instead of throwing `NotReadyError`. Called with no owner (an event handler, an effect callback), the compiled `memo` helper returns its function instead of creating a memo, so an effect callback that reads such a prop no longer reports `PRIMITIVE_IN_EFFECT_CALLBACK` in dev. A template created with no owner therefore has no condition memo: its conditional rebuilds the branch each time the condition's sources change, not only when the condition flips.
