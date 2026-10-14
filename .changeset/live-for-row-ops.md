---
"solid-js": patch
"@solidjs/web": patch
---

Live holes: a sweep that changed some rows of a `<For>` sends just those rows (replace, append, truncate by index), and the frames client morphs only their ranges. The hole's full html still rides along, so a client that can't apply the ops morphs the whole range as before.
