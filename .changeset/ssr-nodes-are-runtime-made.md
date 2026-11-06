---
"@solidjs/web": patch
"solid-js": patch
---

Server rendering only treats nodes the runtime made as finished markup. `ssr()`, `ssrElement()` and the frames sink now build their nodes from internal classes that share a `Symbol.for("solid.ssrNode")` brand, and every insert position checks that brand instead of the object's shape. A plain object with a `t` key (or `t`, `h` and `p`), such as one parsed from JSON, is data: it renders nothing and gets the dev warning UNRECOGNIZED_INSERT_VALUE, like any other plain object. The async-memo landing check (ASYNC_MEMO_ELEMENT) uses the same brand, so such data now serializes like other data instead of being refused. Server only; no client bytes.
