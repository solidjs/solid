---
"@solidjs/signals": patch
---

`merge()` and `omit()` proxies keep their per-instance state on the proxy target under symbol keys and share one handler each, instead of allocating a target with three closures (`get`/`has`/`keys`) per instance and forwarding every trap through them. Creating a props proxy is now a proxy plus a one- or two-slot object, and reads go straight from the trap to the sources. The state keys are never reported or answered through the proxy, and a string `defineProperty` on the proxy can no longer clobber its internals. Port of solidjs/solid#3391 to the 2.0 primitives.
