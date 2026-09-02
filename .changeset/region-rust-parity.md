---
"@solidjs/compiler": patch
"@solidjs/babel-plugin-jsx": patch
---

Rust region parity: the native compiler emits `_$region(subject, tracked, body, deep?)` matching the Babel plugin byte-for-byte (normalized) — chain-grammar eligibility, tracked residuals with `_u$` rewriting of direct depth-1 subject reads, the deep flag for chains below the subject's own keys, and constancy declines. Subject constancy is PROGRAM-WIDE name-conservative on both sides (the Oxc binding table records assignment targets scope-insensitively; the Babel side now applies the same contract for parity). Babel snapshot fixtures (`__dom_regions_fixtures__`) are the absolute emission anchor; the parity harness's `dom-regions` mode, the option matrix, and region probes pin the native compiler against them.
