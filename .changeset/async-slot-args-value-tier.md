---
"@solidjs/web": patch
---

DR-2 value tier, client half: async values passed whole as slot args (promises, async iterables) suspend at the consumption read. The slot-props proxy routes an async-valued prop through a lazily created async memo under the occurrence's owner, so the read follows the normal async path — it suspends into the covering loading boundary and settles when the server's data chunk lands. Applies on both the live-props and static-args paths.

Fresh server-component mounts now shell-gate: the mount's covering `<Loading>` stays open until the frame's first content applies, instead of resolving over an empty `<dx-frame>` at response-header time. That both removes the empty flash and gives DR-2's shell case its covering boundary — the frame notifies before it syncs slots, so a t=0 fill's pending async arg read registers while the boundary queue is still open and the fallback holds seamlessly from fetch through arg settlement. Only call-driven mounts gate (the transport begins the address's stream before the binding resolves); placeholder mounts with no call in flight — the exhausted late-boundary waiter, client-only boots — still render their empty frame immediately, ready for a future call's stream. A frame `error` record also releases the gate (requires the runtime's error-apply notification; until then a failed stream holds the fallback).
