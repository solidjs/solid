---
"solid-js": patch
---

Support async callbacks in createMemo and createProjection on the server by retrying when a NotReadyError-rejected promise is detected, instead of treating it as a terminal error
