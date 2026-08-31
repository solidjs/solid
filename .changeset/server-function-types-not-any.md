---
"@solidjs/web": patch
---

Fix server function references typing as `any`: the emitted `server-functions` declarations referenced `ServerFunction`/`ServerFunctionMetadata` without importing them (the `export type` blocks only re-export the names), so under `skipLibCheck` every `GET`/`live`/`createServerReference` return type silently collapsed to `any` for consumers.
