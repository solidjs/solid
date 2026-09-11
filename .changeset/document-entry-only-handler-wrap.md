---
"@solidjs/web": patch
---

Document the per-handler `wrapInvocation` option as entry-only (#3240). Ruled: entry-only semantics are kept — the option wraps exactly the invocation the request addressed, and nested direct server-function calls made by the dispatched body are not re-wrapped by it; hop-by-hop policy belongs to the configured (ambient) hook, which wraps every direct call. TSDoc only, no runtime behavior change; the boundary is now pinned by a regression test.
