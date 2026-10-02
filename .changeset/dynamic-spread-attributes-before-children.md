---
"@solidjs/web": patch
---

Fix a hydration key miss on a `dynamic()` / `<Dynamic>` element whose prop getter mints a hydration id (a conditional expression over a signal compiles to a condition memo) and whose children include an element (#3741). The client's runtime `spread` inserted `children` before running its attribute effect, while the server's `ssrElement` read attributes first, so the memo and the child element took each other's ids and the child was rebuilt instead of claimed. `spread` now applies attributes before inserting children — the order a compiled element already uses — and `ssrElement` reads a `children` prop after every attribute regardless of key order. Observable on the client: a `ref` on a `dynamic()` element now runs before its children are inserted, as it does on a compiled element.
