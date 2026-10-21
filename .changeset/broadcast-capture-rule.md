---
"@solidjs/compiler": patch
---

The directives pass rejects a `broadcast()` render that reads the server function's outer body. The render is shared by every caller with the same arguments, but the body runs per caller, so the first caller's value would show for everyone. The returned component, and any local function it renders, may read the function's parameters, its own locals and module scope.
