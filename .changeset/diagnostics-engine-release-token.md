---
"@solidjs/diagnostics": patch
---

`captureDiagnostics` and the browser bridge hold the shared attribution engine through the release `attribution.enable()` now returns, and release only their own hold at the end of a capture — a profiler track or an APM adapter enabled beside the capture is left in place (previously `disable()` tore the engine down for every consumer).
