---
"@solidjs/web": patch
---

Fix post-`createEvent` refusals silently dropping the event's response stub (#3159). The scripted-form 400, malformed-arguments 400, and maxArguments 400 returned directly instead of through `commitEventResponse`, so a `Set-Cookie` an integration wrote in `createEvent` (a rotated session, a fresh CSRF token) never reached the browser on exactly the requests where something already went wrong. Every exit past `createEvent` now folds and commits the stub, which also arms the stub's late-write instrumentation on refusals.
