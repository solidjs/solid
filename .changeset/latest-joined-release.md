---
"@solidjs/signals": patch
---

The transaction a `latest()` read of an unheld refetch opens is no longer kept alive after it lands: the mark that it was opened by `latest` lives on the transaction itself instead of in a module-level reference.
