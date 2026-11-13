---
"@solidjs/web": patch
---

Add `setTrustedTypesPolicy(policy)`, so Solid renders on pages that enforce `require-trusted-types-for 'script'`. The app passes a Trusted Types policy it created, and the runtime assigns the `TrustedHTML` that policy returns, both for compiled template markup and for the server HTML the frames client parses. Nothing changes for apps that do not call it.
