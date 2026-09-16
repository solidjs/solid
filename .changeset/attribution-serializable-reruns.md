---
"@solidjs/signals": patch
"@solidjs/diagnostics": patch
---

Attribution re-run records are serializable as emitted, and the observe tier's idle cost is a cap.

- `RerunEvent` no longer carries the live `node`. It names its scope by `nodeId` — the engine's per-node id, stable across the scope's runs in the process and distinct between scopes (so runs of unnamed effects still fold to one scope after the record has left the process). In-process consumers that want the node ask `OBSERVE.subjectOf(event)`, which now answers for re-run records as it did for diagnostic events, for as long as the caller holds the record object. `attribution.why(target)` and `subscriptions(target)` are unchanged.
- `@solidjs/diagnostics` artifact format v7: re-runs are stored verbatim (`RerunRecord` is now an alias of `RerunEvent`), and the artifact gains `timeOrigin` — the capturing process's `performance.timeOrigin` — so every relative `at` in it (re-runs, holds, records, diagnostic `data`) is convertible to absolute time after the fact, and a server capture lines up with the browser session it served. The JSONL meta line carries it too; the browser bridge payload includes it.
- New tripwire in the signals suite: the built observe artifact runs a graph-heavy workload within 1.25× of the built prod artifact with no hooks installed (measured 1.03–1.09). The idle wiring cost was informational before; it is capped now.
