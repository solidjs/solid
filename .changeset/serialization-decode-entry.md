---
"@solidjs/web": patch
---

New `@solidjs/web/serialization/decode` entry: the codec's decode half on its own (the web plugin set, `createJSONDeserializer`, `createJSONDataTable`). The frames client and the server-function response path late-load this entry instead of the full serialization module, so the encode machinery ships to a browser only when rich arguments actually serialize — the lazy codec chunk drops from ~13 kB gz to ~6.5. The full `@solidjs/web/serialization` entry is unchanged (it re-exports the decode half).
