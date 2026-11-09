---
"@solidjs/web": patch
---

A live server component's attribute whose value is still pending at the top of the render (no `<Loading>` around it) no longer writes the live-hole comment markers inside the tag or the attribute value (`<div<!--lh:1--> style="…"<!--lh:/1-->>`), which broke the element. The element keeps its attribute address, and the binding registers once the tag's pending values resolve, so later values update the attribute as an `attr` op.
