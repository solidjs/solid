---
"@solidjs/web": patch
---

Give invoked slot render props live, signal-backed props: the frames binding registers the runtime's `ctx.onUpdate` so a server morph that changes an occurrence's args updates the mounted component's props reactively instead of re-creating it — client state (expansion, focus) follows the entity across morphs and effects over changed args (e.g. a title flash) fire, matching compiled component semantics.
