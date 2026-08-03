---
"solid-js": patch
"@solidjs/web": patch
---

Server-component boundaries that settle after the shell flush now mount (#2964). A boundary waiting on a pending streamed fragment registers as its claimant (`_$HY.fk`), so the fragment swap proceeds — or is held and replayed at registration — even after global hydration completes, instead of being discarded. The frames claim scope now also engages when a slot's server content is a pending fragment placeholder with no hydratable elements (a plain-text `Loading` fallback), so the deferred fragment resumes with hydration rather than falling through to a fresh client mount.
