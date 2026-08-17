---
"@solidjs/web": patch
---

Document the supported document-shell hydration pattern on hydrate(): when the server renders a full document but the client hydrates only the app subtree, wrap the shell in NoHydration and re-enter with Hydration around the app so both sides share a hydration id namespace (#3000). The pattern is now pinned by server/client test pairs.
