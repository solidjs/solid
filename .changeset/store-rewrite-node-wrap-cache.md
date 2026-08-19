---
"@solidjs/signals": patch
---

Store rewrite: per-node wrap cache on the read path. Raw-as-truth stores raw
values in nodes, so every tracked object read paid a WeakMap lookup to
re-wrap the child — measured as a ~10% dbmon tick regression vs the legacy
implementation, whose nodes stored pre-wrapped values. Nodes now cache the
last served proxy and the raw it wrapped; one pointer compare replaces the
WeakMap hit and the wrappability check. A replaced child fails the compare
and re-wraps, so no invalidation hooks are needed.
