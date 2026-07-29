---
"@solidjs/web": patch
---

Update `@dom-expressions/runtime` to 0.50.0-next.33. The server function handler now pre-digests the single-flight outcome before invoking `collectFlightData` — `targetUrl` (the URL the client will show after the mutation, origin-checked), `revalidateKeys` (the outcome's `X-Revalidate` keys, split), and `foldedHeaders` (request headers with the mutation's `Set-Cookie` effects applied) arrive on the outcome, so integrations only supply the data strategy. Raw body-carrying `Response` values skip collection entirely. Adds `decodeResponsePayload` beside `decodeResponse` for splitting the single-flight envelope on manually opted-in calls.
