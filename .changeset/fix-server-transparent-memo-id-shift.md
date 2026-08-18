---
"solid-js": patch
---

Server `createMemo` now honors the internal `transparent` (and explicit `id`) options when creating its owner, matching the client's id inheritance. Previously a transparent memo consumed a child-id slot on the server but not on the client, shifting every subsequent sibling hydration id — unclaimed DOM and dead bindings after the component (#3012).
