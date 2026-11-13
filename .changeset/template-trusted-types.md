---
"@solidjs/web": patch
"@solidjs/html": patch
---

Add `setTrustedTypesPolicy(policy)`, so compiled JSX renders on pages that enforce `require-trusted-types-for 'script'`. The app passes a Trusted Types policy it created, and `template()` assigns the `TrustedHTML` that policy returns for its markup. The frames client's streamed HTML and the `html` tagged template's text decoding go through the same policy. On the server it is a no-op, so an isomorphic entry can call it. Nothing changes for apps that do not call it.
