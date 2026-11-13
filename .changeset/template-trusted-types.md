---
"@solidjs/web": patch
"@solidjs/html": patch
---

Add `setTrustedTypesPolicy(policy)`, so Solid renders on pages that enforce `require-trusted-types-for 'script'`. The app passes a Trusted Types policy it created, and the runtime assigns the `TrustedHTML` that policy returns, for compiled template markup, for the server HTML the frames client parses, and for the `html` tagged template's text decoding. On the server it is a no-op, so an isomorphic entry can call it. Nothing changes for apps that do not call it.
