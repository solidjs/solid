---
"@solidjs/signals": patch
---

An optimistic store's guess no longer answers a new question for a reader in another action's lane (#4929, F-6). After an archive action cleared the selection, selecting another card while a toggle's guess on the checklist store was still out remounted `<Loading on={selected()}>` with the store's "nothing selected" value (`0/0 done`) instead of its fallback: the region's readers read the archive's guessed cards store, so they ran in the archive's lane, and a lane reader was served the toggle's guess world. Such a reader now waits for the new question's answer, as a mainline reader of a target with no guess does.
