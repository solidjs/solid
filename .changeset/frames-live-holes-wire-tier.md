---
"@solidjs/web": patch
---

Frames: the live-hole and attribute-hole appliers move out of the eager frames client into the lazy `wire` tier (about 280 B brotli off every server-components page). The server announces `wire` whenever a response or document carries a live hole, so the tier loads alongside the first hole update; a hole record that arrives before the tier is resident waits and is applied when it installs. Row ops are still sent only on live responses.
