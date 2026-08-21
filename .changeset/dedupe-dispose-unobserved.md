---
"@solidjs/signals": patch
---

Deduplicate dispose() into unobserved(): after #3024 the two teardown bodies were byte-identical (heap removal, dep unlinking, child disposal) — dispose now strips CONFIG_AUTO_DISPOSE and delegates. No behavior change; recovers the simple-app size floor (10.01 → 9.99 kB brotli).
