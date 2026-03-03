# Solid 2.0 RFCs

Temporary beta documentation for Solid 2.0. Treat **`MIGRATION.md`** as the primary entrypoint for beta testers; the RFCs below are deeper, topic-focused docs that may be folded into the main documentation over time.

**Overview:** [Solid 2.0 Proposed API Changes (HackMD)](https://hackmd.io/@0u1u3zEAQAO0iYWVAStEvw/SyXYy2swbg)

**Start here (beta tester guide):** [MIGRATION.md](MIGRATION.md)

The RFCs below are **deep dives** on specific topic areas. Over time, it’s expected that the most important bits will be folded into the main docs; these are intentionally detailed and “proposal-shaped”.

---

## RFC index (7)

| # | RFC | One-line summary |
|---|-----|------------------|
| 01 | [Reactivity, batching, and effects](01-reactivity-batching-effects.md) | pureWrite, strict top-level reads, flush, split effects, onSettled |
| 02 | [Signals, derived primitives, ownership, and context](02-signals-derived-ownership.md) | Derived signal/store, createRoot dispose-by-parent, Context as Provider |
| 03 | [Control flow](03-control-flow.md) | For/Repeat, Show/Switch, Loading, Errored |
| 04 | [Stores](04-stores.md) | draft-first setters, merge/omit, projections (createProjection/createStore(fn)), deep |
| 05 | [Async data](05-async-data.md) | Async in computations, isPending, latest, transitions |
| 06 | [Actions and optimistic](06-actions-optimistic.md) | action (generator), createOptimistic / createOptimisticStore |
| 07 | [DOM](07-dom.md) | HTML standards, class, booleans |
