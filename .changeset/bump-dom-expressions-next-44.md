---
"babel-preset-solid": patch
---

Bump @dom-expressions/babel-plugin-jsx to 0.50.0-next.44 — pairs the preset with the runtime's compiler-armed ssrSelectValues gate (compiled SSR output containing `<select value>` emits the arming marker; without it, select-value resolution is inert).
