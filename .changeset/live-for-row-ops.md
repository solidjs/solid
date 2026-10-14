---
"solid-js": patch
"@solidjs/web": patch
---

Live holes: on a live response, a sweep that changed some rows of a `<For>` sends just those rows (replace, append, truncate by index), and the frames client morphs only their ranges. A client whose range doesn't show what the rows were taken against resumes its live connection, which sends the hole whole.
