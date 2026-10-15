---
"@solidjs/web": patch
---

Render input `defaultValue`/`defaultChecked` and option `defaultSelected` supplied through SSR spreads as `value`, `checked` and `selected`. Within prop sources, a default takes precedence over the bound value in the initial HTML. Named attributes compiled after the spread retain precedence.
