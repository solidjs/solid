---
"@solidjs/web": patch
---

SSR serialization of a cyclic store no longer breaks the identity of an object that store also shares with another async source (#4846). `rewriteTree`'s cycle fallback still clones when the visitor replaces nodes, but when it replaces nothing the author value is kept, so the serializer can dedupe the shared reference across hydration records.
