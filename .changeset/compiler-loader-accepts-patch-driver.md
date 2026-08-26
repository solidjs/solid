---
"@solidjs/compiler": patch
---

The native compiler's JS loader accepts the `patchDriver` option: the Rust core supports it (dormant by default), but `validateOptions`' whitelist was never extended, so an explicit opt-in through `@solidjs/vite-plugin` threw "unknown option".
