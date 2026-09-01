---
"@solidjs/web": patch
---

Channels behind a plain-object getter or used as a Map key are now guarded (#3176). The failure-guard walk previously skipped both while the codec pumped them anyway, so a rejecting promise behind either rode the wire with its raw message, streams reached that way were never torn down at disconnect, and the getter shape could take the whole process down as an unhandled rejection (the fast-JSON probe minted an extra, unobserved promise per read). Getters are now invoked exactly once and materialized as data properties, Map keys are walked like values, the JSON-safe probe reads through descriptors so it never invokes an accessor, and a throwing getter fails the call as a sanitized 500 instead of an encode-time in-band failure.
