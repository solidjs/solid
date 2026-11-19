---
"solid-js": patch
---

Add `setTrustedTypesPolicy(policy)` to `solid-js/web` (dom-expressions 0.40.15), so compiled templates work on pages that enforce `require-trusted-types-for 'script'`. The app passes a Trusted Types policy it created, and `template()` assigns the `TrustedHTML` that policy returns. On the server it is a no-op. Nothing changes for apps that do not call it.
