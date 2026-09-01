---
"@solidjs/signals": patch
---

Fix a tracked `latest(() => isPending(...))` probe created during an active new-question flight reporting `false` for that whole flight (#3166). A latest() shadow created lazily mid-flight is born uninitialized, so the probe's uninitialized suspend-throw dropped it from the verdict collection — swallowed by latest()'s committed-value fallback, the probe cached the wrong verdict until the next flight. The suspend now defers to the parent source's initialization state: an initialized parent means latest() has a value to serve, so the shadow is collected and the probe reports the in-flight truth regardless of creation time.
