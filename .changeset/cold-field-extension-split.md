---
"@solidjs/signals": patch
---

Split cold node machinery (async, transition, optimistic, verdict slots) into a lazily-allocated extension object. Every signal/memo/effect literal stays small and monomorphic: memo nodes shrink from 553B to 429B (-22%), creation is ~15% faster, and create/update-heavy workloads improve 10-19% in the reactivity benchmark. Nodes that never touch async, transitions, or optimism never allocate the extension.
