---
"@solidjs/web": patch
---

Fresh server-component mounts now shell-gate: the mount's covering `<Loading>` stays open until the frame's first content applies, instead of resolving over an empty `<dx-frame>` at response-header time (the empty-frame flash — the lifecycle matrix's shell-gate gap). The frame notifies before it syncs slots, so a t=0 fill's pending async read registers while the boundary queue is still open and the fallback holds seamlessly from fetch through settlement. Only call-driven mounts gate (the transport begins the address's stream before the binding resolves); placeholder mounts with no call in flight — the exhausted late-boundary waiter, client-only boots — still render their empty frame immediately, ready for a future call's stream.

A frame `error` record also releases the gate, which requires the runtime's error-apply notification (on dom-expressions next, unpublished); until the runtime dependency bumps past it, a failed stream holds the fallback.
