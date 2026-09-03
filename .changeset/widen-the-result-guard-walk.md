---
"@solidjs/web": patch
---

Let the result guard see the slots a value actually holds. Reachability on the result path was decided against a narrower idea of "holds" than the codec and the consumer use — plain prototype only, enumerable keys only — so a failure channel parked just outside it was sanitized by nobody while the identical channel one step inside was fully guarded. A rejecting promise under an `Object.assign(new Error(...), …)` carrier shipped its raw message and own properties to the client under a `200`; one on a non-enumerable own data property was never owned and ended the process behind a delivered response, and a stream there was never torn down. The walk now reaches both without invoking hidden accessors, which is the hazard the narrowing was introduced to remove.
