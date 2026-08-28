---
"@solidjs/web": patch
---

Document two boundaries of the client `fetch` option's contract: a retrying wrapper may re-send a request that got no response but must never replay one whose response ended (mid-body death may have executed a mutation; live-source reconnection is the runtime's job), and the call-to-request mapping is delivery detail, not contract.
