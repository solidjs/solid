# Core semantic fuzzing

Build a reusable tool for finding contradictions in reactive publication across
graph shapes and schedules. The deliverable is the generator, independent rules,
replay and reduction machinery, not a fixed list of discovered bugs.

Implementation and commands: [semantics README](../../packages/signals/tests/semantics/README.md).
Executable contract catalog: [rules.ts](../../packages/signals/tests/semantics/rules.ts).

## Architecture

A versioned JSON scenario describes a bounded pure scalar DAG, readers and
external events. Stable node IDs and request occurrence keys survive replay and
reduction. `fast-check` supplies seeded structural generation; a project-owned
interpreter invokes the real signals primitives directly. No per-case source
compilation, DOM, solver or replacement event loop is required.

A separate numeric model evaluates expected answers and dependencies. It does
not copy Solid's scheduler or consult its pending lists to decide which work is
required. Publication anchors are explicit observers; absent anchors cannot be
used as evidence of published state. Intermediate checks use witnessed values,
while final checks also detect missing publication.

Native promises, microtasks and await continuations keep their JavaScript
ordering. MessageChannel tasks deliver synchronous event blocks and establish
microtask drain barriers. Generated promises and action gates are controlled by
separate ledgers. Task callbacks are explicit external input, not residual memo
work. General application timers and wall-clock deadlines are outside the model.

The completion suffix delivers remaining external input, settles exact current
and witnessed fallback requirements, then releases residual requests individually.
An earlier request with identical inputs is still a different occurrence.
After host drains, an independent sufficient progress check also runs before
fallback or residual requests finish. Ideal violations are evaluated first;
optional named allowances classify exact evidence without erasing it. Exceptions
cannot excuse corrupted or missing final data. Once a correct final view is reached,
residual completion cannot change it without new input.

Workers isolate nontermination and out-of-band exceptions. Watchdogs and heap
limits are inconclusive outcomes rather than semantic failures. Lifecycle error
handlers remain installed between cases. Failed cases retain their pre-cleanup
ledger; physical teardown still releases outstanding gates. A worker failing
while idle is attributed to its previous input and stops the campaign.

## Contracts and calibration

Rules have explicit preconditions and authority. Confirmed contracts and proposed
optimistic semantics remain distinguishable in artifacts and documentation.
A counterexample is a candidate violation of a scoped law, not automatically a
confirmed upstream bug. In particular, do not silently settle the open contract
for imperative latest reads or broaden accepted disposal waiting by inference.

Self-tests prove validation, scheduling, model checks, identity, reduction,
reporting and containment. Disposable runtime mutations calibrate detection;
reduced cases must pass against unmodified source. Tests must not require real
upstream bugs to remain present. Candidate corpus replay is a separate command;
fixed, accepted cases can become ordinary correctness regressions.

Paired runs compare synchronous and asynchronous delivery, early/latest companion
creation, and a held optimistic proposal versus an ordinary write. Each relation
has narrower preconditions than the full scenario language. Both runs retain
independent safety checks; paired reduction preserves which side failed and the
exact request choices on each side.

## Retention, reduction and cost

Every finding retains its canonical schedule in a compact JSONL record. Symptom
grouping limits full traces and shrinking, not candidate retention. Group counts
are not estimates of unique root causes. Source/build hashes, rule revision and
execution policy identify the target; seeds alone are not replay authority.

Reduction tries valid local structural simplifications under a finite attempt
budget. Exact scheduled request identities cannot silently retarget after an
earlier operation is removed. The result is replayed, but is not claimed to be a
global minimum or proof of a shared root cause with its larger input.

Use small numeric values, dense slots, short loops and bounded graphs. Allocate
independent snapshots where retaining evidence requires ownership. Avoid pooling,
shared mutable buffers or added caches without profiling. Build each worker once
per campaign; all added instrumentation and allocation live in test tooling.
