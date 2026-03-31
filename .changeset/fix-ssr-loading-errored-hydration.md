---
"solid-js": patch
---

Fix streamed SSR `Loading` and `Errored` hydration so async memo rejections render the expected fallback and recover correctly after reset.
