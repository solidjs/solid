---
"@solidjs/web": patch
---

`renderToStream`: an async value that resolves to something the serializer cannot handle now rejects its key on the client instead of leaving it pending forever (#4647). The failure is still reported as `{ kind: "render", handling: "serialize" }` and the render still completes; the payload now settles the key's promise with an error that says it is a serialization failure and names the key (the failure's own text stays on the server). The hydrating read throws into the nearest `<Errored>`, whose fallback replaces the server-rendered content until `reset()` or an input change reruns the computation as a client fetch. With no `<Errored>` above, it is uncaught like any rejected key.
