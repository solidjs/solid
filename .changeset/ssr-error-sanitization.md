---
"solid-js": patch
"@solidjs/web": patch
"@solidjs/signals": patch
---

SSR render failures reach the client sanitized (#3468): the wire policy the server-function handler has applied since #3113/#3116 now covers every SSR road a failure takes — the error an `<Errored>` serializes for hydration, a rejected async source serialized into the stream, a `<Loading>` fragment's `_fr` rejection, a frame stream's error chunks (the fragment's, a live hole's, the root's). Outside the dev build a plain thrown value is replaced with a generic `Error` (`"Internal Server Error"`); `message`, `cause` and own properties stay on the server. A `"use server"` function called in-process during SSR never touches the RPC wire, so before this the production page load shipped what that wire withholds.

- **`solid-js`** (server): `<Errored>` sanitizes _before_ rendering its fallback and serializes the same replacement, so fallback markup and the hydration record agree. A fallback printing `err().message` shows the generic message in production, as for a server-function failure. `markSafeError` (`Symbol.for("solid.SafeError")`) passes through with own properties; an Error reached as a _value_ is data and passes as written (#3113's ruling). One replacement per original, however many roads it takes. New finding `SSR_ERROR_SANITIZED` (`info`, observe + dev; `data.error` the original), beside `SSR_RENDER_ERROR_CONTAINED` which carries the failure itself. `ssrSanitizeError` is exposed to the runtimes through `solid-js/internal`. Server findings now carry their `ownerPath` in the **observe** artifact too — the core's walk reads `_parent` under its own build's property mangling and found nothing on a server owner there, so the server entry locates its findings itself.
- **`@solidjs/web`** (server): the hydration serialize funnel guards every channel it writes (a promise's rejection, an async iterable's thrown step); a fragment's terminal error reaches the `_fr` rejection and a transport sink's error chunk sanitized while the abandonment ledger keeps the original; the frame sink's root error chunk and the live-hole/live-attribute error chunks carry the replacement's message.
- **`@solidjs/signals`**: the `SSR_ERROR_SANITIZED` code.

The dev/prod line is the build variant: the `development` server artifacts keep full fidelity; production and observe sanitize.
