---
"@solidjs/web": patch
---

Document the `createEvent(request)` contract: the request is a standards-shaped `Request` and nothing more. Body-size enforcement may hand a rebuilt `Request`, so host-specific fields on the inbound object are not carried; hosts surface platform handles on the event from their own request.
