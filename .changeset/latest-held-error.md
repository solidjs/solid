---
"@solidjs/signals": patch
---

Reveal and recover reactive error outcomes consistently, including ordinary outside reads through held rejection and recovery, `latest()` derivations, projection readers, snapshots and promise-delivery helpers. Published errors remain the answer through pending retry; a revealed failure ends the initial loadingValue window while preserving successful memo prev history. Share effect callback execution and projection failure notification. Release unobserved lazy readers after async comparator failures, and allow successful direct writes to replace writable derivations' errors. Diagnostic formatting failures no longer replace the original thrown value.
