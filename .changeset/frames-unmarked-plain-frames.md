---
"@solidjs/web": patch
---

fix(frames): a frame rendered off the live address marks only the holes that can change within its response (the document face's gate), so synchronous holes ship without `lh` markers, `data-lha` addresses or hole digests; the live address keeps every marker for its reconnect have-list
