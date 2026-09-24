---
"@solidjs/signals": patch
"solid-js": patch
---

The `solid-js/refresh` HMR memo is now framework plumbing to the observe tiers: an internal `_plumbing` memo option (`CONFIG_PLUMBING`) leaves it unnamed, out of every owner path, and unrecorded by the attribution engine — no creation or re-run record of its own — while the component body it runs stays fully observed. Replaces the empty-name workaround from #3629, which still produced a blank-named `create` record per component mount.
