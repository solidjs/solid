---
"@solidjs/web": patch
---

`AssetManifest` admits a manifest that sets `_base` (#4502). It was `Record<string, Entry> & { _base?: string }`, and since `_base` also falls under the string index signature it had to be an entry too, so a manifest literal with `_base: "/"` did not type-check. The index signature now carries entries, metadata strings (`_base`, and any an integration stamps, such as the vite plugin's `_entry`) and `undefined`, so a read by key is an entry once narrowed (`typeof entry === "object"`). The server renderer narrows the same way: a metadata key enumerated while registering entry assets, or asked for by `resolveAssets`, is skipped instead of throwing.
