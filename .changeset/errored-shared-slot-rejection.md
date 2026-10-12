---
"solid-js": patch
---

A rejection contained by `<Errored>` is no longer reported as unhandled when the boundary shares a `{props.children}` slot with an async sibling during SSR (#3973). While its holes were pending, the server boundary threw a combined promise that the slot retry could drop, so its rejection exited Node even though the fallback rendered. The combined promise is now marked handled where it is created; anything that awaits it still sees the rejection.
