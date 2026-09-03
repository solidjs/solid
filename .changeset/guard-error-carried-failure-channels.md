---
"@solidjs/web": patch
---

Guard enumerable failure channels carried on Error results: the result-encoding guard walk now descends Error-prototyped carriers (which seroval encodes with their own properties) so a rejecting promise, erroring stream, or throwing iterable assigned onto a returned Error is sanitized and torn down like any other channel, while the carrier keeps its prototype, message, and own data (#3235).
