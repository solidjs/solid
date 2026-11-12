---
"@solidjs/signals": patch
"solid-js": patch
---

Dev now warns `OPTIMISTIC_WRITE_WHILE_LOADING` when an optimistic setter runs while its source, which has answered before, is loading a new question. The setter composes on the previous answer, and the new answer replaces the guess (#4795).
