---
"@solidjs/web": patch
---

`ssrElement` serializes the common element shapes without the general resolver's allocations

- Children that are one string, a number, nothing, or one finished node now join the open and close tags in place. The general path — `resolveSSRNode` into a fresh `{ t, h, p }` result (an object and three arrays), then `ssr()` over a template array — is taken only for arrays and pending nodes, which need it. Output is unchanged; on a text-content-heavy page this was the single largest cost of a spread element.
- The array-sources form over plain objects, and an omit over a merge, walk the array they were handed: the resolved `sources`/`kinds` lists (and the `fill(SOURCE_OMIT)` list) are built only when entries differ in kind. A plain source in `pushEntry` is classified with one `$PROXY in` check instead of two.

On yak's element-dense SSR cases (`dyn-translate`, `dyn-fair`, `dyn-inline`) this is +15–21% throughput and −27% bytes allocated per instance, closing the gap to the hand-written writer from 1.76× to 1.46×; `multifile-composition`/`tabs` +3–6%.
