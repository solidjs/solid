---
"@solidjs/web": patch
"@solidjs/babel-plugin": patch
---

`@solidjs/web`'s client entry is now built per module (`preserveModules`): `dist/web.js` keeps its name and export set, and the runtime's modules sit beside it under `dist/web/` (likewise `dist/web.dev/` and `dist/web.observe/` for the other tiers). The attribute runtime (`assign`, `spread`, the per-prop writers), the children runtime (`insert`) and the attribute tables are their own source modules, so an application bundler places each by its importers: on a server-component page whose only importer of `assign` is the lazy frames bind tier, the attribute runtime now travels in that chunk instead of the eager entry. No runtime behaviour change; the public export set of every entry is unchanged. `@solidjs/babel-plugin` reads the shared attribute tables from their new module (no change to its output).
