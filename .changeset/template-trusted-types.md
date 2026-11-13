---
"@solidjs/web": patch
---

Add `setTrustedTypesPolicy(policy)`, so compiled JSX renders on pages that enforce `require-trusted-types-for 'script'`. The app passes a Trusted Types policy it created, and `template()` assigns the `TrustedHTML` that policy returns for its markup. Nothing changes for apps that do not call it.
