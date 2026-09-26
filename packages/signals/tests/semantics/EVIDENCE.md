# Evidence and limits

Cleanup audit, 2026-09-14. Reduction changes do not change law revision 17 or
Solid's runtime. The checked-in catalog in `rules.ts` carries each law's scope,
authority, checkpoints and control references into artifacts. This document
records evidence quality, not another executable rule language.

## Semantic law audit

| Laws | Observable claim and applicability | Passing / deliberately broken evidence | Remaining limit |
| --- | --- | --- | --- |
| A1 | Attached initialized output stays present until replacement/removal. Detached preparation is private. | `output.test.ts`: private writes pass; premature attachment, cleanup and duplicate contribution fail. `attachment.test.ts` exercises the interpreter shape motivated by #3404. | In-memory host model, not a browser DOM or arbitrary portal topology. The fake-host negative controls test the oracle, not mutations of every Solid attachment optimization. |
| S1, S2 | Pure visible data and observation controls agree with witnessed published sources. | `runner.test.ts`, `mounts.test.ts`, `output.test.ts`; `lost-blocker` mutation and stale/obsolete controls. | Missing source observations are not invented. Explicit fallback/covered regions are allowed. |
| S3 | Scoped completion implies publication at the next completed flush. | `settled-writes.test.ts`, `optimistic.test.ts`; callback-started work is a new update. | Including corrective optimistic work remains an experimental contract; no dedicated runtime mutation isolates every optimistic completion path. |
| S4, S5 | Obsolete work does not corrupt settled output; disposed generations receive no later callbacks. | `runner.test.ts`, `mounts.test.ts`, `completion.test.ts`; `stale-result` mutation. | Stateful previous values, stores and streams are not modeled. |
| L1 | Once all finite generated work settles, the final pure view appears. | `completion.test.ts`; `drop-wake` mutation. | Finite generated promises only; a watchdog is inconclusive, never a liveness proof. |
| P1, W1 | Proven ordinary release should occur; uncertain wait timing stays a policy question. | `progress.test.ts`, `completion.test.ts`; `lost-disposal-wake` / `lost-fallback-wake` mutations. Passing held-work and fallback controls; exact historical disposal allowance cannot waive unrelated or final failures. | Sufficient conditions, not complete liveness. No actions/branches/readiness in P1. #3375/#3372 inform controls, not the definition of the ideal law. |
| G1, G2 | Known ordinary groups publish atomically, action holds prevent early commit, unrelated completed groups may progress. | `groups.test.ts`, `group-controls.test.ts`; `entangle-effect` / `drop-action-hold` mutations. | Flat initialized ordinary DAGs with complete anchors. Adjacent microtasks permit entanglement; same event/microtask writes require batching. Possible memo joins conservatively extend deadlines. |
| R2, R3, R4 | A published ready control can be used; context-free pending probes do not throw; a held new answer has tracked pending state. | `readiness.test.ts`, `pending-contract.test.ts`; `false-ready` / `false-verdict` mutations. | R2 uses an explicit modeled click; R3 follows A16, R4 follows A24. No blanket context-free false-implies-readable rule, no user errors generated. |
| R1, E4 | Ordinary outside reads match witnessed publication; allocation-only warming should not change observations. | `reads.test.ts`: passing scalar reads, latest exclusions, exact paired request choices and controlled differing paired results. | Reads through latest remain outside R1; E4 excludes warmups adding async work. No independent runtime mutation dedicated to every E4 violation. |
| E3 | A pure single write's data trace agrees across sync/promise/await, modulo waiting. | `equivalence.test.ts`, `paired-reduce.test.ts`; passing variants and synthetic differing traces. | No action lifetimes, readiness, fallback resets or intervening writes. Pair controls establish oracle/adapter behavior, not broad scheduler equivalence. |
| O1, O2, E5 | Scoped optimistic progress, prompt corrective work, and held single-proposal ordinary equivalence. | `optimistic.test.ts`, `optimistic-scope.test.ts`, `optimistic-equivalence.test.ts`, conditional-scope controls. | Experimental user-directed contracts. One parent, narrow observation/authoritative-write scope; less independent mutation coverage than ordinary laws. Upstream agreement is not assumed. |

All nine seeded runtime faults remain separate from real findings. Detection proves
that a checker can notice the fault within its test scope. Passing upstream alone
does not prove the oracle complete, and a deliberately corrupted frame tests the
oracle, not the full interpreter. These distinctions are why no law was weakened
or deleted during reduction cleanup.

## Reduction quality and cost

The manifest pins worker SHA-256
`f688dcadb8319ed9db1a9f95bc0520b1d65121154f8810f0f9de5f10da1227ec`, containing
historical runtime `9fa294fb58e6e0ff8003efdd6fcf9a5e6dba3ef3` and oracle revision
17. The comparison tool verifies the exact worker hash and independently replays
each final witness. The executable fixture file retains all 97 inputs and 1,720
memberships. Eight manually identified targets are an improvement floor, not a
claim of eight bugs or a completeness benchmark.

Measured with 500 search executions allowed per input:

| Comparison | Search executions | Exact repro keys | Known simpler routes |
| --- | ---: | ---: | ---: |
| Old reducer, 97 larger originals | 6,701 | 64 | 3/8 |
| Shared engine + sweep scheduling, before new cuts | 5,379 | 64 | 3/8 |
| Cleanup including bounded cuts, 97 larger originals | 6,765 | 59 | 8/8 |
| Old reducer, 97 already-small inputs | 5,377 | 64 | 3/8 |
| Sweep scheduling alone, already-small inputs | 3,967 | 64 | 3/8 |
| Cleanup including bounded cuts, already-small inputs | 5,173 | 59 | 8/8 |

Each full run additionally used 98 initial and 98 final verification executions.
Earlier experimental logs charged the two initial paired runs to search; the table
corrects that classification. Execution counts are the primary cost evidence.
Single-run wall times, especially overlapping exploratory runs, are not a reliable
throughput speedup claim. The added cuts spend most of the scheduler savings on
five known simplifications, rather than making the whole reducer 26% faster.

### Family inventory and ablations

| Families | Purpose / cost | Evidence and disposition |
| --- | --- | --- |
| normalize | Stable names/defaults and exact request translation; cheap | `normalize.test.ts`, `quality.test.ts`; retain as representation/correctness infrastructure. Not independently credited with a bug merge. |
| pruning, anchors, sources, turns, steps, readers, nodes | Remove unused structure and schedule; cheap | `shrink.test.ts`, `reduce.test.ts`, `corpus-reduce.test.ts`; strict reference/request and disposal controls. Retain core deletion vocabulary. |
| optimistic, actions, lifecycle, initialVisibility | Remove unnecessary lifetime/visibility scaffolding | `coordinated-reduce.test.ts`, `paired-reduce.test.ts`. Removing initialVisibility costs C42 an extra operation (78 calls saved across 97 inputs). Retain small rewrite. |
| focused, structural, edges, cones, observation, observationCollapse | Collapse concrete graph/observer units | `focused-reduce.test.ts`, `edge-reduce.test.ts`, `observation-reduce.test.ts`; replay tested, no assumed graph equivalence. Retain; per-family marginal utility is not proven for every overlapping helper. |
| arithmetic, branches, schedule, deliverySchedule, ordering | Simplify expressions and explicit ordering | `algebra-reduce.test.ts`, `reduce.test.ts`, `coordinated-reduce.test.ts`; exact owner/occurrence checks. Resume-action/visibility permutations recover C85. Retain, no arbitrary retargeting. |
| callbackEnd | Remove needless callback scheduling | C61 route is lost when disabled; `paired-reduce.test.ts` negative order controls. Retain. |
| mergeArithmetic | Source substitution plus arithmetic compensation; expensive | C32 route is lost when disabled. Retain in expensive tier. |
| deliveryOrdering | Coupled declaration/delivery normalization; expensive | Full-corpus removal saves 1,797 calls but loses C42's declaration cut, plus some canonical convergence. Retain in expensive tier; not claimed cheap. |
| cuts | Concrete node/async removal with related visible read, offset or delivery | Disabling loses C16, C34, C96 routes. Retain only removal-first bounded combinations; no general pairs/triples search. |
| deliveryEscape | Promise→controlled delivery followed by cheap cleanup | Disabling loses C88. `search.test.ts` rejects a pivot without a substantive final cut; shares execution and candidate bounds. Retain as a bounded transaction. |

The targeted ablations use nine quality cases; the deliveryOrdering and
initialVisibility checks also cover all 97 larger originals. They establish useful
specific witnesses, not general effectiveness on arbitrary future graphs. No
family is justified merely by its number of accepted edits. Helpers without
independent marginal evidence are explicitly labeled above rather than given
fabricated wins.

### Decisions against added machinery

- Native fast-check generation-context shrinking was compared against the external
  reducer at 150 executions on ordinary/branch seeds 91500–91504. Nine seeds found semantic failures: external shrinking produced smaller size vectors in all nine, using 796 calls versus 1,150 native calls; the hybrid was never better than external. Keep the external
  reducer: native choice shrinking retains too much graph/lifetime machinery on
  this generator. `quality-experiments.mjs --experiment native` reproduces the gate;
  it does not await individual graph operations or change event semantics.
- CDD was evaluated on the same turn-deletion units, followed by the same cleanup:
  83 semantic inputs, identical final size vectors, 5,606 executions versus 5,566
  for halving. Keep halving. This tests our short schedules, not a general claim
  against CDD. The implementation follows [Algorithm 2](https://arxiv.org/html/2408.04735v4),
  with p0=.25 and bounded execution.
- Imposing the proposed global complexity order on every edit saved calls but lost
  exact convergence on C76, C85 and C96 (61 rather than 59 keys). Keep the existing
  ordering guard pending a better-supported replacement. Substantive size descent
  is enforced for delivery escapes; a global monotonicity guarantee is not claimed.
- No cross-case result cache, pooling, beam search, solver, graph-rewrite DSL or new
  runtime dependency. Original request identities and final uncached verification
  matter more than cosmetic convergence.

The small queue ranks later inputs by machinery and permits limited shape variety;
its choice is never recorded as a root-cause grouping. Original JSONL retention and
selected-input→exact-output mappings remain the way to revisit work after a fix.

## Campaign/report validation

The final suite passes 327 tests across 46 files, including all nine runtime fault
calibrations and unmodified-runtime controls. Type checking passes. Six fixed
holdout campaigns ran 900 cases against the checked-out source: 791 pass, 106
semantic candidates, three policy findings; no invalid, error or limit outcomes.
All 11 selected reductions independently replayed (744 search and 11 final
verification executions). These are untriaged candidate findings, not 106 new bugs.

A separate eight-candidate selection comparison improved the S1 report from C07
(size vector 4/5/2/3) to C24 (3/4/2/1), while retaining eight distinct symptoms.
It cost 161 calls versus 142 for first-arrival selection: a clarity improvement,
not a demonstrated search speedup. The queue reserves breadth before a second
shape when full. Original memberships are retained regardless of queue admission.

Compact measured results are in [quality/results.json](quality/results.json).
Large full outputs and the pre-cleanup reducer snapshot were retained separately
under `/home/gabriel/code/solid-effect-publication-evidence/semantic-fuzzing/cleanup-2026-09-14`.
The historical worker is an external benchmark artifact, not vendored Solid code;
`--check` requires its recorded hash. Portable CI controls test current source and
synthetic violations and do not require that artifact or an old bug to persist.
