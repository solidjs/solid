---
"@solidjs/signals": patch
---

Round-10.12 observability fixes (dev-only): structural queue items carry their channel backref so wide-dispatch memos key on stable identity (sliced snapshot lists warned every flush); structural row-ops/slot dispatches record synthetic attribution events (name, causes, count, timing); coalesced bubble origins are name-deduped; a parent self-emission within one pending window carries earlier child causes forward (consumed stamps, marked at delivery, carry nothing); and demoted children contribute name-only origins instead of stale pre-demotion stamps.
