---
"solid-js": patch
"@solidjs/web": patch
---

Require `seroval` and `seroval-plugins` `~1.6.7` (minor-locked, as before). Seroval 1.6 ships bundled declarations with no extensionless relative imports, so the `@solidjs/web` `server-functions`, `serialization` and `frames` type surfaces now type-check under `module: NodeNext` from a CommonJS project without `skipLibCheck` — the packaged-types check covers every public `@solidjs/web` specifier.
