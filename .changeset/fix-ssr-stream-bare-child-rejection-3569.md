---
"solid-js": patch
"@solidjs/web": patch
---

Fix `renderToStream` hanging or throwing `TypeError: Cannot read properties of undefined (reading 'emit')` when an async read that rejects is the direct child of `<Loading>` (#3569).

- `solid-js`: a bare child's throw (`<Loading>{data()}</Loading>`, or a component whose return is the read) now routes through the boundary's error handler exactly like a template hole's does — the fragment rejects and the client re-renders the subtree (`handling: "client"`), instead of escalating to a request failure pre-flush.
- `@solidjs/web`: a render failure (`failRender`) now completes the consumer — the awaited promise resolves with the HTML produced so far, `pipe()` ends its sink, `pipeTo()`/`readable` close the writable — and the serializer's completion no longer assembles a shell on the disposed render.
