---
"@solidjs/web": patch
---

Canonicalize resource identity qualifiers instead of comparing raw prop values, so two declarations of one request dedupe to one `<link>` on both sides of hydration.

`false` now means absent, matching both attribute writers: `crossorigin={cond && "anonymous"}` no longer emits a second, byte-identical link when the condition is false.

`crossorigin` is compared by its CORS state rather than its spelling. It is a CORS settings attribute with three states — absent is No CORS, `use-credentials` (ASCII case-insensitive) is Use Credentials, and every other present value including `""`, a bare attribute and an invalid one is Anonymous — so the same font is no longer preloaded once per spelling, and the client adopts the server's link instead of mounting a second one for a request the browser already has.

Qualifier values are length-prefixed, so a value containing the identity delimiters can no longer collide with a different qualifier set and silently suppress another resource (`type: "a:media=b"` and `type: "a", media: "b"` were one identity).

Client-side adoption of a mount-once head resource now matches a server-emitted element on the full request identity rather than the href alone: two preloads sharing an href still differ if their destination, CORS mode, type, media or source set differ. The document client, the standalone frame client and the server all apply the same rules.
