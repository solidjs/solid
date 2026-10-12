---
"@solidjs/web": patch
---

A server component's markup hole that contains an element with a dynamic attribute is no longer sent twice. The first render writes a `data-lha` address on such an element and the sweep's re-evaluation does not, so the unchanged hole compared as changed and its markup shipped again as a `hole` record on the document's live channel. The baseline now ignores those addresses, as it already ignored the `lh` comment markers. The markup that ships is unchanged.
