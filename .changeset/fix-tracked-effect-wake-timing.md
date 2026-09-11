---
"@solidjs/signals": patch
---

Fix `createTrackedEffect` missing a signal written during a render-effect callback (#3291). Tracked effects read with committed visibility, but their wake was pushed straight into the user queue at notify time, so a write staged during a flush's render phase re-ran the effect in the same pass — before the value committed — and nothing re-notified it afterwards. Wakes (and the first run) now ride the heap like every other subscriber, so the run always lands after the commit; the tracked-effect special case in the scheduler is removed.
