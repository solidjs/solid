---
"@solidjs/signals": patch
---

A re-armed `Loading` boundary (`on`) whose fallback reads pending data through a render effect — any compiled JSX fallback, such as `<p>Meta {meta()}</p>` — no longer holds the new content's reveal when the content lands first: a reader in a fallback that is no longer the display is off screen and holds nothing, so the content shows as soon as it lands and the fallback is never seen, as it already did when the fallback read the data directly (#4268).
