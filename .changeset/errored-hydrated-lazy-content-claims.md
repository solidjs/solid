---
"solid-js": patch
---

A hydrated `<Errored>` showing the server's fallback no longer logs `Hydration key miss` (or builds detached elements) for content it creates lazily: children behind a context provider, a component returning a function, a `children()` accessor, or a nested `<Loading>`, `<Errored>`, `<Show>` or `<For>` resolved after the content's own run. Nothing under the boundary claims server DOM, so the fallback stays up until a content input changes or `reset()` (#4348). A nested `<Loading>` there no longer waits on a fragment the server dropped with the content.
