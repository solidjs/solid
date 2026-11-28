---
"@solidjs/signals": patch
---

Avoid retrying an errored computation while checking dependencies for a newly mounted reader. Failed optimistic sources retain their error until an existing reader re-reads them or an explicit refresh requests recovery.
