---
"@solidjs/web": patch
---

A server component that throws during its synchronous render is no longer cacheable. `respond(View, { headers })` puts those headers on the frame response, and the response is a 200 whose body carries the error, so an author's `cache-control: public, max-age` stored the failure. When the render fails before the head is built, the frame response sends `Cache-Control: no-store` and drops the CDN-targeted fields that would override it at a CDN (`CDN-Cache-Control`, `<CDN>-CDN-Cache-Control`, `Surrogate-Control`). The status stays 200 and the body still carries the error record. A render that succeeds keeps the author's headers, and so does a returned `{ error }` value: the author chose that value and the headers that travel with it. A failure that lands after a suspended shell has already left can no longer change the head.

`@solidjs/web/frames/server` no longer exports `renderServerComponent`, `renderToFrameStream`, `serverComponentResponse` or `createFrameSink`. They were internal building blocks: a server component reaches the client by being returned from a server function (directly or wrapped in `respond()`), and the transform hooks (`frameTransformResult`, `frameTransformFlightResult`, `frameTransformDirectResult`) render and frame it. The entry is experimental, and the hooks and document-shell exports are unchanged.
