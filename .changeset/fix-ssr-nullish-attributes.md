---
"@solidjs/babel-plugin": patch
"@solidjs/compiler": patch
---

Fix compiled SSR output that renders `style=""` or `class=""` for `null` and `undefined`. Babel and the native compiler now omit these attributes on elements without a spread.
