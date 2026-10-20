---
"@solidjs/web": patch
---

Add `wrapServerFunctionsFetch(wrap)` to the server-functions client: an integration layers a send over the transport (answering some requests itself, passing the rest to `next`) without replacing the app's `configureServerFunctionsClient({ fetch })` or being replaced by it, whichever runs first. Exported type `ServerFunctionsSend`.
