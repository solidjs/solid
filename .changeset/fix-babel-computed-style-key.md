---
"@solidjs/babel-plugin": patch
---

Splitting a `style` or `class` object in the compiled DOM output now removes each extracted property by identity. A computed `style` key that follows a dynamic property, such as `style={{ color: c(), [prop()]: v(), background: b() }}`, is no longer dropped, and a static `class` object such as `class={{ a: true, b: false, c: false, d: false }}` no longer leaves `[object Object]` in the class attribute.
