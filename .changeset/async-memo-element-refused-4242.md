---
"solid-js": patch
"@solidjs/web": patch
"@solidjs/signals": patch
---

fix(web): refuse an async memo that resolves to an element (#4242)

On the server, an async memo (or async iterable source) whose value is rendered output — JSX, a component's result, a `<Loading>`/`<Errored>` boundary — can no longer reach the hydration serializer. A boundary's output failed in seroval, so its record never resolved and the hydrating client waited on the memo forever (streamed, the boundary reverted to its fallback); a template object crossed as data, duplicating the markup, and streamed the client could not insert it (`UNRECOGNIZED_INSERT_VALUE`). The memo now rejects where its value lands, with the new diagnostic `ASYNC_MEMO_ELEMENT` (recorded on the observe channel; the dev message says what to do instead, other tiers carry the code), and its boundary contains the error like any render error: the nearest `<Errored>` renders its fallback and the client hydrates it; with none, the `<Loading>` fragment rejects and the client renders the subtree. Return data from the async memo and render the JSX from it. Ordinary data is never refused (only plain objects in the SSR template shape, boundary outputs and fragment arrays holding them count as rendered output), and content that never hydrates (`<NoHydration>`) is untouched.

Also, a fragment failing while a boundary registered under an undefined key (one created inside an async memo's continuation) is pending no longer fails the whole request in `renderToStream`.
