---
"@solidjs/web": patch
---

The server `ssrElement` joins a compiled dynamic child in place. The compiler emits a spread element's dynamic child as `() => scope(() => expr)`, and `ssrScope` returns a function in both modes, so after `ssrElement`'s one call the child was still a function and every such element fell to `resolveSSRNode` plus `ssr()`'s hole loop. Outside a live-hole render, `ssrElement` now calls the scope's evaluator once more, as `resolveSSRNode` would, and joins a string or number result directly. Other values resolve nested as before, and a suspension becomes the same async hole through a shared `pushSSRAsyncHole`. Server output is byte-identical. On a prod build, `spread-static-tail` renders 7–14% faster (500 rows).
