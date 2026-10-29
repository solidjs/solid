---
"solid-js": patch
---

Update DOM Expressions to 0.40.13. The universal renderer's spread now clears properties whose keys are removed, calling `setProperty(node, name, undefined, prev)`, and SVG `<radialGradient>` accepts `fr`.
