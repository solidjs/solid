---
"@solidjs/signals": patch
"solid-js": patch
---

Dev diagnostic `CAUGHT_REACTIVE_READ` (D-42 / S-47): warns once per computation when a reactive read's throw — `NotReadyError` or the source's error — was caught inside the computation's body and the pass completed with a value. An `async` computation is judged when its flight settles (a rejection is the throw continuing; a landed value is the catch). The runtime's own catches (boundaries, `isPending`, `watch`, comparator/cleanup/effect-callback routing, solid-js's hydration trace) never warn. Dev-only; no production bytes.
