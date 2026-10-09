# Semantic fuzzer cleanup: evidence before more search

Implementation record and plan, 2026-09-14. This supersedes the implementation
queue in `semantic-fuzzing-reduction-audit.md`; that document remains a historical
experiment log. The user has authorized planning and reconsidering the design,
including reduction rules and semantic assertions. This document does not change
runtime behavior or executable contracts.

**Objective.** Produce clear, small, replayable examples with bounded triage and
execution cost. A useful improvement removes distracting behavior, reaches a
known simpler witness, catches a real contract violation, or saves work without
losing those abilities. More accepted rewrites, a shorter JSON string, and fewer
reports by themselves are not evidence of success.

**Implementation outcome (2026-09-14).** The initial cleanup is implemented and
validated. See the repository-owned [evidence audit](../../packages/signals/tests/semantics/EVIDENCE.md)
and [usage guide](../../packages/signals/tests/semantics/README.md).

- Shared ordinary/paired traversal, actual execution accounting, persistent pass
  sweeps and bounded expensive cleanup are active. Original/final paired runs are
  separate costs; final verification remains mandatory.
- The 97-input fixture retains 1,720 memberships. All eight known simplifications
  now replay at 6,765 search calls versus the previous 6,701. The resulting 59
  exact repro keys are not presented as 59 unique issues.
- Ablations justify the retained special cuts. Not every cheap overlapping helper
  has independently proven marginal benefit; the evidence inventory says so.
- The proposed universal monotonic rank was **not adopted**: it lost canonical
  convergence. Existing ordering protections remain. Substantive size descent
  applies to the delivery escape transaction, with shared bounds.
- CDD and native fast-check shrinking were measured and **not adopted** in the
  default pipeline. The optional experiments remain reproducible commands.
- A bounded report queue considers later simpler examples; it prioritizes distinct
  symptoms before using spare slots for a second shape. It retains originals and
  records exact selected-input mappings. No cross-case result cache was added.
- No semantic contract was weakened or runtime behavior changed. The audit labels
  proposed optimistic laws and incomplete independent mutation coverage explicitly.
- Validation: typecheck; 327 tests including nine fault calibrations; 900 fixed
  holdout cases with no harness errors/limits and all selected witnesses replayed.

The following sections retain the rationale and conditional gates. They are not
an instruction to implement rejected experiments or broaden semantic scope. Any
future rule should earn its place through a useful witness or a measured cost
reduction. A claim of broad convergence needs fresh examples, not more tuning of
these 97 inputs.

**A. Establish an executable quality baseline first.**

Use three complementary sets, with exact runtime and oracle identities:

- A compact quality suite built from manually verified reduction routes. Include
  the earlier source/arithmetic, callback, delivery/order and visibility wins, plus
  C85 -> C67, C16 -> C17, C34 -> C80, C88 -> C10 and C96 -> C74. Keep the original
  input, a known simpler output, its semantic disposition, and a replay command.
  A different, equally useful valid failing output is acceptable in discovery
  mode; exact spelling is only required by canonicalization-specific tests.
- The saved 97 audited inputs and their current 64 distinct outputs, retaining all
  1,720 original memberships. Compare both reduction from the larger inputs and
  further reduction of the already-small outputs. Separate the 51 standalone
  semantic representatives, one paired comparison and 12 policy representatives.
- A fixed, separate set of generated seeds spanning ordinary graphs, branches,
  observation, actions/optimism, readiness and attachment, plus the existing fault
  calibrations and positive controls. Do not use only the branch cohort or tune
  transformations against every evaluation seed. Include some larger supported
  scenarios to expose repeated-prefix costs hidden by tiny final examples.

Make a small repository-owned comparison command and fixture manifest, rather
than relying on one-off scripts under a personal evidence directory. Store compact
scenarios and provenance in the repository; bulky traces/results remain optional
artifacts. Historical integration tests must run against a reproducibly built
historical source target or controlled fault fixture. Never require a repaired
current Solid to preserve an old bug, and never replace an unavailable historical
execution with a fabricated claim of runtime verification.

Record candidate generation, static-invalid rejection, runtime-invalid rejection,
cache hits, actual worker executions, comparison/control executions, accepted
edits, material complexity changes, budget exhaustion and independent final
replay. Keep timing collection outside the hot interpreter and optional in normal
campaigns. Compare equal worker-execution budgets; record candidate budgets
separately, since one paired candidate may run two or three workers' executions.

Quality has two axes: the substantive contents of the final repro and the work
needed to obtain it. Track memo/source/reader counts, async mechanisms, action
segments, event/callback/flush operations, branch structure and reads. Keep exact
repro-key convergence as a useful secondary measurement, not a unique-bug count.

Ablation must establish marginal usefulness: disable a family and check whether
another family reaches the same result anyway. Add-back checks are useful when
families overlap. Compare final outputs, not merely the number of accepted edits.
Use repeated sequential runs and medians for performance decisions; the previous
partially overlapping exploration timings are not a throughput benchmark.

**B. Make one small reduction engine serve ordinary and paired cases.**

Today `shrink.ts` and `equivalence.ts` duplicate restart loops, seen sets, ordering
limits and final cleanup. Consolidate traversal, budget charging and scheduling.
Keep ordinary and paired execution/acceptance as explicit adapters, not a general
plugin framework. Preserve the public ordinary/focused/control behavior and the
paired-to-standalone handoff, including clearing comparison metadata only when a
valid individual execution is actually the new witness.

Move admission logic to one place: an admitted semantic failure can replace
another in discovery mode; an invalid case, unsupported scope, waived finding,
policy-only outcome, harness error or resource limit cannot. Focused reduction
and policy/error reduction retain their existing narrower predicates. Never
interpret a matching diagnostic alone as proof of the same bug.

Put execution accounting at the shared run boundary. Charge actual runs for
variants, passing controls and accepted-result verification. Keep a candidate
limit too, so cheap invalid candidates cannot consume unbounded host CPU. Preserve
the last independently valid result when a budget runs out. Reserve/document a
final replay allowance and report its cost; do not silently exceed the search
budget or skip verification. Initial replay, search and final verification should
be separately visible in results. Clarify any CLI budget-unit change explicitly.

Start with per-search canonical candidate caching. Use compact immutable outcome
records; do not share mutable runner traces between candidates. Measure overlap
across inputs before adding a bounded campaign cache. Any such cache must include
runtime/build identity, oracle revision and run options, allowances, comparison
mode and exact scenario/variant keys. Controls have their own execution keys.
Final replay bypasses cache. Do not cache worker errors or limits as stable facts.

Keep native tasks, microtasks, synchronous event blocks and worker containment
unchanged. This refactor must not insert an await between setters or change the
existing failure-driven worker retirement policy.

Acceptance gate: existing replay, isolation, focused/control, pair and budget tests
pass; calibration detection remains intact; the shared engine reaches baseline
quality before replacing either old loop.

**C. Fix pass scheduling before broadening the search.**

Adapt Hypothesis's pass discipline: continue productive work within a pass rather
than restarting all earlier passes after every accepted edit. Revisit earlier
passes after a sweep makes progress. A deletion cursor stays at the position of
the next surviving item. Graph rewrites must rebuild affected candidate targets
or use stable IDs; never keep iterating an obsolete graph snapshot. Add explicit
controls for deletion-shift skips and cross-pass changes that make an earlier
candidate useful again.

Run cheap structural deletion and normalization first. Enable expensive rewrites
after that reaches a fixed point; keep their budget small and visible. A successful
expensive rewrite gets ordinary cleanup without launching independent full
shrinks from every neighboring program. Do not introduce beam search, a generic
passing-state frontier, random restarts or a solver.

Use a single documented progress order rather than incidental JSON property order
plus family-specific exceptions. An initial candidate is a lexicographic ordering
of declaration count, async/action/callback mechanisms, executable operation count,
expression/reference complexity, and a stable normalized encoding. Validate this
ordering on the quality suite: it must prefer the useful cuts already observed,
including removal of an async boundary despite an additional source read. Adjust
that proposal if it contradicts those examples; JSON byte count is a tie-breaker,
not the objective.

Ordinary accepted rewrites must descend in this order. Equal-size normalization
uses an explicit stable ordering of compatible operations/references. A bounded
escape rewrite is judged together with its cleanup: only retain it if the final
program descends relative to the entry point. Preserve the prior best throughout.
This should make `OrderingLimit` and recursive finishing-pass workarounds
unnecessary, but remove them only after termination and quality tests demonstrate
that their protections have been replaced.

For chunk deletion, compare the current halving approach against a small
Counter-Based Delta Debugging implementation over the same valid deletion units.
Use it only if execution counts improve without unacceptable quality loss. It
will not solve graph equivalence or magically merge different minima.

Acceptance gate: no loss of the verified small witnesses; reduced repeated-prefix
work in synthetic quality controls and real inputs; no cycling; measured costs
within the same execution budgets. If scheduling changes save no meaningful work,
retain the simpler design rather than claiming an architectural win.

**D. Replace overlapping special cases with a small normalization vocabulary.**

Use the API-sequence normalization work in *One Test to Rule Them All* as the
starting point. Our graph and event language needs an adaptation, not a wholesale
copy of a source-text reducer.

There are two different operations to keep explicit:

- Representation normalization: stable names, field/default representation and
  request-owner renaming that do not change the represented execution. Preserve
  declaration/read order and distinguished source roles. Do not normalize away
  an observer, action boundary or scheduling operation.
- Replay-tested normalization: consistent value/reference substitutions, merging
  compatible ordinary sources, replacing a memo with an upstream expression,
  collapsing an owner/reader with its dependent operations, and ordering compatible
  declarations or event steps. These change the program and need the oracle.

Expose a few cohesive candidate passes over graph, observation/lifetime and event
structure. Share the low-level reference and operation rewriting helpers instead
of duplicating them. This is not a new graph-rewrite DSL. Keep flat numeric scenario
records and copy only the edited arrays/records in normal transformations.

Generalize useful edits where evidence warrants it:

- Apply a compatible substitution consistently across its references/uses, not
  only one scalar field. Keep zero/equality relationships meaningful when the
  edit claims to be a value renaming. Other arithmetic edits remain new programs.
- Delete whole structural units with their obsolete bookkeeping operations before
  validation, rather than making the runtime reject predictable dangling handles.
  Removing a shared memo does not implicitly authorize removing its other readers.
- Try legal action progress/visibility permutations within a callback; the current
  swap filter excludes `resume-action` entirely. Start/resume prerequisites must
  remain valid. No cross-task/flush change is treated as harmless sorting.
- Allow a concrete memo/async-boundary cut to be paired with a bounded related
  read, arithmetic or delivery change. The completed candidate is replayed; its
  intermediate edits need not fail. Restrict this to replay-proven kinds of cuts
  and relevant source paths, not all pairs/triples of transformations.
- Treat delivery modes as alternative schedules, not universally ordered levels
  of simplicity. A controlled delivery may permit removal of action/scheduling
  scaffolding. Offer this only as a bounded escape with a real final reduction.

Keep strict request replay. Deleting an async owner can remove its own resolutions;
retained owners keep their exact captured question/occurrence unless an explicitly
validated translation applies. Generic newest/oldest retargeting produced no useful
cuts in the latest experiment and is not part of this cleanup.

For each current family, create a concise inventory row with purpose, cost class,
positive quality fixture, negative validity/control fixture, corpus contribution,
and disposition: retain, subsume, experimental-only, or delete. Cheap foundational
rewrites need not each eliminate a duplicate to justify their existence. Expensive
special cases need an independently reproduced material win that cheaper rules
cannot obtain, and an acceptable incremental cost. A rule's helpful name or a
unit test proving it emits a candidate is insufficient.

Initial evidence-based disposition:

| Current area | Starting decision |
| --- | --- |
| Core deletions, pruning, owner/reference repair | Retain; consolidate duplicate implementations. |
| Alpha-normalization and exact request translation | Retain correctness protections; measure simplification separately. |
| Callback-end and initial visibility rewrites | Fold into event/lifecycle normalization if their quality fixtures survive. |
| Source merge plus offset | Fold into consistent graph/value rewrites; retain the known C32 -> C17 route. |
| Delivery/declaration paired search | Expensive tier; preserve C76/C21 quality, remove the bespoke search loop if the common engine can achieve it. |
| Observation and conditional collapse | Consolidate structural edits; retain only evidence-backed extra combinations. |
| Unrestricted ordering/full-shrink pivots | Do not adopt broadly: one exact merge in 1,968 replay calls. Fix the missing action-order case directly. |
| Request retargeting | Do not adopt: 631 calls and no useful cuts in eight eligible examples. |
| Broad setting pivots with a full shrink each | Do not adopt as implemented: 31,641 calls for two exact merges. |
| Three alternate full pass orders | Do not adopt: 19,999 calls over 83 earlier semantic inputs, no better final output under the recorded comparison. |
| Removal-first compound candidates | Evaluate in the bounded expensive tier: 1,557 calls found two exact merges; expanding to async-boundary removal found a third at higher cost. |

These are initial decisions, not completed ablations. The existing corpus is small
and heavily reused; holdout evidence is required before calling a family generally
effective. Keep proven witnesses when deleting their old implementations.

**E. Evaluate generator-integrated shrinking as a bounded alternative.**

We currently call `fc.sample` and then reduce the resulting scenario independently.
Before developing a new choice-sequence engine, build a small fast-check baseline
that retains generation/shrink context and runs the existing interpreter/oracle.
Use fresh ordinary and branch cohorts first. Compare native shrinking alone and
native shrinking followed by our cheap normalizer at equal execution budgets.

The generator must produce supported graphs and valid references as choices
shrink. Merely wrapping existing JSON in an arbitrary does not achieve this.
Preserve both the generated input/context and the runtime's exact canonical replay;
the latter must not mutate the former. Measure rejection/misalignment, final
scenario quality and reproduction reliability, not only shrink iteration count.

Do not route individual synchronous setters through `asyncModelRun` or a scheduler
wrapper that awaits each operation. Our event blocks must remain uninterrupted;
Solid's native scheduling is part of the test. The official command shrinker is a
useful model for execution-aware shrinking, not a replacement event loop.

Decision gate: adopt integration only for scopes where the experiment gives a
clear benefit with a small implementation. It need not replace external reduction
of archived/manual JSON or paired cases. If the adaptation is large or results are
worse, keep fast-check for generation and document the measured reason. Do not
migrate all cohorts or add another runtime/language before this gate.

**F. Audit semantic assertions separately from reduction heuristics.**

For each executable law, record its behavioral statement, applicability predicate,
observable witness, contract basis (user ruling, specification/test, or explicit
hypothesis), positive control, deliberately broken control, and known issue/fix
replays where available. Reuse the existing rule catalog and tests; add only missing
information, not a second abstract rule language.

Classify evidence precisely:

- A seeded fault establishes that the checker can detect that violation within
  its scope, not that a generated upstream failure is necessarily correct.
- A repaired runtime passing the original repro and a clean control strengthens
  the diagnosis, but upstream behavior does not define the ideal contract.
- A law that currently finds no bugs is not useless if it protects a meaningful
  guarantee and has calibrated detection.
- Safety, final completion, progress, policy review and inapplicability stay distinct.
  A sufficient progress condition must not be reported as a complete liveness model.

Check that scope changes under shrinking cannot manufacture a violation, silently
apply a waiver, or treat missing witnesses as published state. Preserve source
observers as actual modeled observers, scoped fallback permission, native event
batching, and separation of parent action work from generated optimistic work.
Revisit any inconsistent law or unnecessary restriction with a small failing and
passing example. Contract changes require an explicit explanation/ruling and a
rule-revision bump; never weaken a law to improve the deduplication numbers.

Audit the interpreter/model boundary without rewriting the 1,500-line runner just
for aesthetics. Extract code only where there is a clear responsibility with its
own tests or harmful duplication. No new DOM dependency, stores, stateful `prev`,
streaming or generalized timer model in this cleanup.

**G. Make campaign output support the one-issue-at-a-time workflow.**

Today the CLI retains every finding but only shrinks the first example of each
symptom, up to 20 signatures. Keep retention; remove the assumption that this first
example is the best witness. Different bugs can share a symptom, and a later
example may be dramatically easier to understand.

Use a small, deterministic, budgeted queue of reduction candidates. Prefer cheaper
raw scenarios and permit limited structural diversity within a symptom. Treat that
selection as a scheduling heuristic, never as proof of shared root cause. A bounded
comparison should establish whether this produces better first reports than the
current first-arrival rule; do not simply shrink every generated failure.

Save exact reduced repro keys and map original memberships to them. Show the user
one or a few clear candidates, while keeping the rest replayable. State whether an
example is a semantic candidate, a policy question, paired-only, or budget-limited.
Do not label structural clusters as unique issues or discard originals because a
reduction reached a different bug. After a fix, replay originals and run fresh
cases; unsupported or still-unreduced findings remain in the queue.

Keep generation, reduction and reporting time separate in campaign summaries.
Retain the smallest observed valid witness even if a later search uses up its
budget. No automatic TypeScript reproduction generation in this plan.

**H. Implementation sequence and completion criteria.**

1. Add the quality manifest/comparison command and audit the current families and
   contract coverage. Capture the current branch/build and frozen historical target
   separately. Start missing positive/negative controls before moving code.
2. Consolidate search execution, accounting and adapters without changing search
   policy. Verify ordinary, paired, control and isolation behavior.
3. Implement persistent pass sweeps, common progress ordering and cheap/expensive
   tiers. Run the quality suite and equal-budget corpus comparison.
4. Consolidate normalization and remove redundant/unsupported expensive rules one
   family at a time. Add the small replay-proven generalizations. Run ablations;
   keep only measured improvements or essential low-cost correctness machinery.
5. Run the fast-check integration and CDD experiments as explicit decision gates,
   not mandatory migrations. Record useful negative results too.
6. Improve bounded candidate selection/reporting and complete the contract audit.
   Document unresolved rulings with minimal examples, not invented semantics.
7. Run the full semantic tests and type check, all calibrations, exact replay of
   retained representatives and the fixed holdout campaigns. Check current upstream
   separately if desired; never mix a runtime rebase into a reducer comparison.

Success means a smaller, more cohesive implementation with measured reduction
quality/cost, clear law evidence and honest artifacts. Require no unexplained loss
of manually verified simplifications or calibration coverage, no artifact/replay
regressions, bounded search, and no material generation-only slowdown. Evaluate
performance changes against measurement noise; do not promise an arbitrary speedup
or that 64 programs must become five bugs. Expensive additions that do not earn
their cost stay outside the default pipeline.

Update the README into a concise usage/architecture guide and link the evidence
catalog rather than appending each historical patch. Keep one current plan; older
reduction and extension documents should point here and remain historical references.
Do not add pooling, a generic rewrite framework, a beam-search frontier, automatic
GitHub reporting or a new dependency solely to organize this cleanup.

**Research basis.**

- [Groce et al., One Test to Rule Them All, ISSTA 2017](https://agroce.github.io/issta17.pdf):
  API-sequence normalization/generalization, replay-tested consistent substitutions
  and operation ordering; normalization can improve already delta-minimized tests.
  Its empirical convergence is motivation, not a promised result for our DAGs.
- [Hypothesis internals](https://github.com/HypothesisWorks/hypothesis/blob/master/guides/internals.rst):
  continue within passes, postpone expensive passes, cache decisions and use
  execution-guided repair. Greedy reduction itself is not the architectural defect.
- [MacIver and Donaldson, ECOOP 2020](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ECOOP.2020.13):
  shrinking generator choices helps retain validity; adopting this requires keeping
  generation context and a shrink-friendly generator.
- [Perses, ICSE 2018](https://web.cs.ucdavis.edu/~su/publications/perses.pdf):
  use structure to avoid invalid candidates; syntax alone cannot enforce our
  request, observation and action semantics.
- [Counter-Based Delta Debugging](https://arxiv.org/html/2408.04735v4):
  simple accounting can avoid inefficient repeated queries; evaluate over our
  deletion units rather than assuming published benchmark gains transfer.
- [fast-check arbitraries](https://fast-check.dev/docs/core-blocks/arbitraries/) and
  [model-based command shrinking](https://fast-check.dev/docs/advanced/model-based-testing/):
  an available baseline; command execution tracking does not justify changing our
  event-loop scheduling.

Local experiment evidence:
`/home/gabriel/code/solid-effect-publication-evidence/semantic-fuzzing/search-barriers-2026-09-14/README.md`
and neighboring `paired-reduction-2026-09-14`, `coordinated-reduction-2026-09-14`,
`discovery-reduction-2026-09-14`, and `all-97-audit-2026-09-14` artifacts.
