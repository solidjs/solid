---
"@solidjs/web": patch
---

The DOM list reconciler does less work for common small edits. A node moved from one end of a list to the other takes one DOM move, a list whose nodes did not change returns before reading the parent, and the window map is an index stamp on the new nodes instead of a `Map`. On the Octane board js-framework's reorder operations take about 20% less time and a text hole beside sibling nodes updates about 13% faster. Bundles with the web runtime are 33 bytes smaller minified.
