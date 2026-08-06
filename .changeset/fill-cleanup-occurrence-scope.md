---
"@solidjs/web": patch
---

Stream-mounted slot fills now dispose at occurrence unmount (the lifecycle matrix's cleanup gap). A fill invoked from a stream microtask used to render under the boundary's owner, so its `onCleanup` and effects survived a later response dropping the occurrence and only died at boundary dispose — a leak for keyed churn in long sessions. Those fills now render under a per-occurrence owner tied to the frame's occurrence-level cleanup: a response that drops the occurrence (or a morph that destroys its range) disposes the fill's reactive scope right there, and a re-invocation supersedes the previous scope before rendering.

Live-render invocations — a reveal boundary's content render, the t=0 adoption sync — deliberately keep their ambient owner. The covering render already owns their lifetime, and tying them to frame cleanups is actively wrong: the frame's zombie heuristic reads "mounted nodes without a parent" as a destroyed mount, but a pending fill's nodes are legitimately detached while its covering boundary shows the fallback — disposing there would kill the live pending effect and reveal the segment over a hole.
