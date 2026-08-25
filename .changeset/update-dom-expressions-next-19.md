---
"solid-js": patch
"@solidjs/web": patch
"@solidjs/h": patch
"@solidjs/html": patch
"@solidjs/universal": patch
---

Update dom-expressions to 0.50.0-next.19. Pulls in resolver manifests: the
`manifest` option of `renderToString`/`renderToStream` now also accepts
`{ resolve(key), resolveSync?(key) }` (or a bare function) as an alternative
to a static manifest object, so dev servers can answer asset lookups from
their live module graph. `resolve` may return a promise and may resolve CSS
entries to inline-style descriptors (`{ id, content, attrs }`) for HMR
adoption; `resolveSync` is exposed on the render context as
`resolveAssetsSync` for sync consumers like `lazy()`'s `moduleUrl` getter.
Also picks up an internal perf refactor of root-level insert cleanup
(foreign-sibling detection via O(1) pointer checks).
