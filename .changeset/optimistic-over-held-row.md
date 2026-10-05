---
"@solidjs/signals": patch
---

Fix an optimistic store over a derived store hiding its update after an action's local write to the same row: the row a held write staged is no longer guessed over the container's slot (#3796).
