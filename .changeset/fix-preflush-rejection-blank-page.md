---
"solid-js": patch
---

Fix blank page when an async read rejects before the SSR shell flushes under
`Errored > Loading` (#2997). The fragment channel now owns the error once the
boundary has registered: `<key>_fr` rejects and the client re-renders the
subtree as fresh DOM (adopting the serialized rejection), letting the
client-side Errored catch it — matching post-flush semantics. Previously the
server also invoked the enclosing Errored's handler at async time; its
rendered fallback had no consumer, and the error record it serialized at the
boundary id made the hydrating client try to claim fallback DOM that was
never emitted, derailing hydration into a permanently blank region. Also
defuses the two client-side unhandled-rejection leaks in this flow (the
serialized rejected flight consumed via its stamp, and the trace-run promise
in `subFetch`).
