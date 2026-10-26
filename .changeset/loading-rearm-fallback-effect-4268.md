---
"@solidjs/signals": patch
---

A re-armed `Loading` boundary (`on`) whose fallback reads pending data through a render effect — any compiled JSX fallback, such as `<p>Meta {meta()}</p>` — no longer holds the new content's reveal when the content lands first: a fallback the screen never showed is disposed as soon as the content replaces it, so the content shows as soon as it lands and the fallback is never seen, as it already did when the fallback read the data directly (#4268).
