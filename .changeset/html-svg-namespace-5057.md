---
"@solidjs/html": patch
---

fix(html): tags HTML and SVG share (`title`, `a`, `style`, `script`) take their static parent's namespace, so they are SVG inside `<svg>` and HTML again inside `<foreignObject>` (#5057)
