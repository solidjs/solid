---
"@solidjs/web": patch
---

SSR `<select value>` resolution now handles empty-string bound values (#3013 follow-up). Empty attribute values serialize as bare attributes (`<select value>`, `<option value>`), which the flush-time pass didn't recognize — a bound `''` never marked the `value=""` placeholder option `selected`, so the pre-hydration page showed the first option while app state said `''`. The pass now reads the bare form as the empty string on both the select and its options, matching React's SSR output for the single-select placeholder pattern.
