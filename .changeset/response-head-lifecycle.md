---
"@solidjs/web": patch
---

Re-export the HTTP response-head lifecycle and middleware composition from the runtime (lands with the next `@dom-expressions/runtime` bump): `createRequestEvent` builds the canonical stub-backed request event; `createSSRResponse` derives the outgoing `Response` from a render result — committing the stub at shell flush, turning a pre-flush `Location` into a real redirect (`getExpectedRedirectStatus`), and appending a nonce-aware script fallback for post-flush redirects; `composeMiddleware` composes web-standard `(request, next) => Response` middleware inside the request scope. `@solidjs/web/server-functions` gains the `wrapInvocation` seam: a per-invocation wrap around server function execution (HTTP dispatch and direct SSR calls) with the invocation identity established. Documented in RFC 10 and RFC 12.
