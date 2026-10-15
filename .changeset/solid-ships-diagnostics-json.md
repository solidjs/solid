---
"solid-js": patch
---

`solid-js` now ships `diagnostics.json` next to `CHEATSHEET.md`: the machine-readable catalog of every dev diagnostic code — `code`, `kind`, `severity`, `category`, `trigger`, `repair` (the first sentence of the code's section in the `reactivity-diagnostics` skill) and `guideUrl` (that section on GitHub). It is generated from the `DiagnosticCode` union, the RFC's quick-reference table and the skill by `pnpm diagnostics:json`, and a test fails when any of the three (or the committed file) names a different set of codes. The quick-reference table gains its missing `PRIMITIVE_IN_EFFECT_CALLBACK` row.
