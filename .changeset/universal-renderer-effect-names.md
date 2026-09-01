---
"@solidjs/universal": patch
---

Expose diagnostic names for renderer-owned effects (#3063). The public `Renderer` interface now accepts a trailing `RendererEffectOptions` (`{ name?: string }`) on `effect`, `insert`, and `spread` — `spread` forwards one shared name to its child insertion and internal ref/props effects — so dev attribution can correlate signal write → application computation → renderer effect → output mutation end-to-end. Renderer-created effects without a caller-supplied name get stable dev-only fallbacks ("renderer insert", "renderer spread props/ref/children", "renderer render", "renderer patch"); production builds tree-shake all of it via the `_SOLID_DEV_` constant.
