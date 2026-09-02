---
"@solidjs/babel-plugin-jsx": patch
"@solidjs/signals": patch
"@solidjs/web": patch
---

Region emitter v1 (off by default, `regions: true` to opt in): template scopes whose dynamic bindings are depth-1 member reads of one constant store subject compile to a single `_$region(subject, tracked, body)` call — eligible bindings read the commit-time raw with scalar baselines, unmanifestable expressions (dynamic keys, foreign reads) join the compute as tracked residuals fused into the same node. The `region()` runtime combinator (signals, re-exported by web) owns admission, accessor demotion, and the classic fallback, which reruns the same body with the proxy as the raw argument.
