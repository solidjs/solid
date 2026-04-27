---
"solid-js": patch
---

Tighten npm `description` fields across the published packages so they identify each package's role unambiguously in npm search results and AI-indexed package metadata.

- `solid-js` — was generic ("A declarative JavaScript library for building user interfaces."); now names the actual differentiators (real DOM, signal-based updates, no virtual DOM).
- `@solidjs/web` — names the concrete entry points (rendering, hydration, SSR, Portal, Dynamic).
- `@solidjs/signals` — names the actual primitives (signals, memos, effects, stores, async-aware computations) instead of "reactive core implementation".
- `@solidjs/h` — drops the self-deprecating "less-optimal" wording; states the use case (no compiled JSX).
- `solid-html` — leads with the user-visible benefit (no build step).
- `babel-preset-solid` — mentions what makes it Solid-specific (fine-grained DOM ops vs. generic JSX).

`solid-element` and `@solidjs/universal` descriptions left unchanged.
