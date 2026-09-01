---
"@solidjs/web": patch
---

`provideEvent`'s invocation contract is enforced at HTTP dispatch (#3172). A hook that invoked the callback twice double-committed a mutation under a 200, and one that never invoked it answered a void success without running the function. A second invocation is now refused before the function body runs again, and both violations fail the request with a sanitized 500 (the hook is named in development), re-checked after the hook returns so a swallowed refusal cannot answer 200.
