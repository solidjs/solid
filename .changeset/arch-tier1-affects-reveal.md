---
"@solidjs/signals": patch
---

Two architecture consolidations from the growth audit's Tier-1 spikes, each retiring a mechanism family rather than shrinking one.

`affects()` marks move off the async status rails onto a dedicated verdict channel. A mark is now only a refcount on the marked node(s); derived coverage is pull-computed at verdict time by a dependency-graph walk, and Loading interaction survives as a boundary-only visual notification. Because marks never touch `_statusFlags`/`_error`/`_pendingSources`/`_asyncReporters`, the five carve-out families that previously un-taught the async rails everything a mark does — value-transparency, transaction-inertness, error-inferiority, settle-release, quiet-reask immunity — are deleted as unrepresentable rather than maintained. The per-read affects collection and per-recompute mark bookkeeping also leave the core read/recompute hot paths. Marks stay invisible to all completion and settlement accounting by construction (a mark can never block or end its own transaction), ambient marks are verdict-only and release at flush end, and mark state serializes only inside a resumable transaction.

`stashedOptimisticReads` is deleted. It forced a committed-view effect re-run when a transaction backgrounded — masking an active override from stale tracked reads (against A17) and un-rendering co-written optimistic flags mid-window (against the affordance idiom) — while engaging zero times across the whole suite. The queue stash and `_gatedSubs` replay are retained (they cover transaction-held reveal and silent-revert re-ask, which are irreducibly distinct); a spec comment records why they cannot merge.

Full bundle −775 min / −304 gzip bytes; core floor −388 / −169. All prior tests pass unchanged plus new contract pins: the backgrounded-transaction reveal shape (S3), the interleaved-ambient-flush queue-stash guard (S4, a pre-existing coverage hole), and a deterministic recompute-count isolation guard for the propagation/Sierpinski surgical-update property. No public API change.
