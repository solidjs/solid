---
"@solidjs/web": patch
---

`ssrElement` no longer emits `style=""` / `class=""` for nullish values; they are omitted like every other attribute, matching the client. Skipped props also leave no stray whitespace in the opening tag (#3382).
