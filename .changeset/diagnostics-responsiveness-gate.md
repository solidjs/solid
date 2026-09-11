---
"@solidjs/diagnostics": patch
"solid-js": patch
---

Diagnostics: the responsiveness gate — holds and feedback in the artifact, `expectNoSilentHolds`, and Loop 4.

The artifact (format v2) now carries `attribution.holds` — every transition hold the scenario caused, with the held writes, the blockers, the wait measured from the interaction, and which affordances acknowledged it — and `attribution.feedback`, the ranked `sources`/`interactions` tables folded from them. JSONL egress emits `hold` and `feedback` records; the browser bridge and the `/__solid/diagnostics` protocol gain `holds()` and `feedback()` live queries.

New gates: `expectNoSilentHolds(artifact, { maxSilentMs })` fails on any hold the screen never acknowledged (no `isPending()`/`latest()` reader, no optimistic value, no `affects()` mark, nothing painted) with the interaction, held write, blocker, and duration as evidence; `expectHoldBudget(artifact, ms, { source })` bounds hold latency regardless of acknowledgment. `ScenarioBudget` gains `maxSilentHoldMs` and `maxHoldMs`; Vitest gains `toHaveNoSilentHolds()` and `toStayWithinHoldBudget(ms)`. The agent-loops skill gains "Loop 4 — Responsiveness": read `feedback.sources` first, repair by shape (`isPending` → `latest` → `createOptimistic`), and the explicit anti-repair — never make the gate pass by moving the write off the async path. Types `HoldEvent`, `ChangeOrigin`, `AttributionFeedback`, `FeedbackSource`, `FeedbackInteraction` are exported.
