---
"@solidjs/signals": patch
---

Consolidate value-selection predicates: `readerSeesCommitted` (the full committed-vs-staged arm read()'s slow tail used to inline) and `visibleOverride` / `hasActiveOverride` (one definition each, previously duplicated between the core, lanes, verdict channels and the store) — a zero-semantic-change refactor toward one implementation per rule (DESIGN-CONSOLIDATION, move 3b).
