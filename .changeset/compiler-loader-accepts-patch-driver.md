---
"@solidjs/compiler": patch
---

The native compiler's JS loader accepts the `patchDriver` option and normalizes the boolean opt-in: the Rust core supports the option (dormant by default), but `validateOptions`' whitelist rejected it, and the napi wrapper mapping collapses `true` into `Wrapper::Default` — which `patch_driver` uniquely treats as disabled. The loader now whitelists the option and maps `true` to the default `"patchDriver"` import name so an explicit opt-in through `@solidjs/vite-plugin` reaches the native core.
