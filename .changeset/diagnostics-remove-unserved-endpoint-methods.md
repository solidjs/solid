---
"@solidjs/diagnostics": patch
---

Diagnostics protocol: removed the `holds` and `feedback` entries from `DiagnosticsMethods` (and so from `DiagnosticsMethod`, `DiagnosticsRequest`, `DiagnosticsResponse`) in `@solidjs/diagnostics/protocol`. The `/__solid/diagnostics` dev-server endpoint never served them; it answers `begin`, `end`, `active`, `whyDidRun` and `costs`, and the holds and feedback tables arrive in the `end` payload (`attribution.holds`, `attribution.feedback`). The in-page bridge's `holds()`/`feedback()` queries are unchanged. The agent-loops skill's endpoint example no longer lists a `feedback` call.
