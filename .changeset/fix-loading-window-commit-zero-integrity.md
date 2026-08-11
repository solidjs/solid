---
"@solidjs/signals": patch
"solid-js": patch
---

Loading-window integrity fixes (#2988, #2989, #2990): seed-window projections run their derive against a detached shadow of the seed so mid-flight draft writes can never tear through commit #0 (each commit point reconciles a detached snapshot; the server freezes the seed before the derive runs to match); a parked retry on an errored loading-value node no longer replaces the settled error with a NotReadyError; and the window now closes when the first answer becomes observable — direct commits close it immediately, transition-held landings keep it open until the hold commits — so no one-frame isPending pulse can leak to live observers at the landing.
