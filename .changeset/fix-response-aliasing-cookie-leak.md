---
"@solidjs/web": patch
---

Never mutate an application-held Response: the server-function handler takes ownership of the dispatched Response with a copy before any transport stamp lands, and `commitEventResponse` folds cookies/gap-fill headers onto a rebuilt Response instead of writing in place — a module-level cached Response no longer accumulates every caller's Set-Cookie (one user's session cookie served to the next) (#3155)
