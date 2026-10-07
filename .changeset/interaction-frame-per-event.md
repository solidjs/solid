---
"@solidjs/signals": patch
"@solidjs/web": patch
---

Observe: one interaction frame per event, not per listener. `InteractionRef` takes an optional `event`; frames with the same `event` re-enter one interaction record, which stays joinable for the event's dispatch and is recorded at the next task. The web runtime keys its frames by the DOM event, and `@solidjs/web` exports `dispatchAsInteraction(e, fn)` so a listener outside the runtime (a router's `document` click handler) joins the frame of the same event — `fn()` in production builds. One anchor click is now one interaction record carrying both the `onClick` work and the navigation (#3754).
