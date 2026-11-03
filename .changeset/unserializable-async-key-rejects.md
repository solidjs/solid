---
"@solidjs/web": patch
---

`renderToStream`: an async value that resolves to something the serializer cannot handle after the first flush (midstream) now rejects its key on the client instead of leaving it pending forever (#4647) — and with it every promise or async iterable inside the value that already went out (a nested promise, an async iterable's later items), and every other key on the same value. The failure is still reported as `{ kind: "render", handling: "serialize" }` and the render completes; the payload settles the key's promise with an error that says it is a serialization failure and names the key (the failure's own text stays on the server). The hydrating read throws into the nearest `<Errored>`, whose fallback replaces the server-rendered content until `reset()` or an input change reruns the computation as a client fetch. With no `<Errored>` above, it is uncaught like any rejected key. Before the first flush the render fails instead (see the other changeset).
