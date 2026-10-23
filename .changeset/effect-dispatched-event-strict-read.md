---
"@solidjs/signals": patch
"solid-js": patch
---

Dev: an event handler fired synchronously from an effect callback (by `el.focus()`, `el.click()`, `dialog.showModal()`) no longer inherits the effect's strict-read window or effect-callback phase, so reading a prop in it no longer logs `STRICT_READ_UNTRACKED`, and creating a root in it no longer throws `PRIMITIVE_IN_EFFECT_CALLBACK`. Development builds only; production output is unchanged.
