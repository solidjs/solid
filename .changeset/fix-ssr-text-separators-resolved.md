---
"@solidjs/web": patch
---

SSR emits the `<!--!$-->` text separator only between items that resolve to text. Adjacent memos and components that yield elements — every `Dynamic`, `Show`, or wrapper-library instance in a list — no longer carry a separator and a comment node each. Text that becomes adjacent through a nested array or a dropped nullish item is now separated, so it hydrates into distinct text nodes (#3383).
