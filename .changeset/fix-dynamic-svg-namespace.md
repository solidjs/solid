---
"@solidjs/web": patch
---

Create ambiguous SVG tags (`a`, `script`, `style`, `title`) in the SVG namespace when Dynamic renders them inside SVG content during client rendering (#3187). Dynamic intrinsic elements now materialize lazily inside the insert() that renders them, where the live insertion parent provides the namespace hint — matching how the parser resolves these tags in static templates and server-rendered markup (children of `foreignObject` stay HTML).
