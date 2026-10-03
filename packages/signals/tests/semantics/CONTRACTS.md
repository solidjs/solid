# Contract rationale and reference

Current commands and reduction behavior are in [README.md](README.md).
The executable catalog is `rules.ts`; [EVIDENCE.md](EVIDENCE.md) distinguishes
calibrated detection, proposed contracts and remaining scope limits. Historical
measurements below describe their recorded revisions, not current throughput.

## Language and execution

- The ordinary cohort has one numeric source; the multi cohort has two.
  Both have one visibility signal, 1–5 generated pure memos and 1–3 readers;
  version 2 replay permits up to four sources and larger bounded graphs. Memos form a DAG with stable
  IDs, arbitrary sharing, affine computations, and sync, fulfilled-promise,
  manually resolved promise, or `async`/`await` delivery.
- Readers publish tuples through the two halves of `createRenderEffect`. They
  can conditionally read their inputs or each sit inside a real Loading boundary,
  either retaining content or resetting on source changes. Roots can be disposed.
  The mounts cohort creates and cleans up owned reader roots through a parent
  render effect. Memos remain outside that subtree. Prepared child values become
  visible only when the parent publishes attachment; desired mount state is
  tracked independently so a missed mount cannot erase the final obligation.
- The boundaries cohort gives each reader its own retaining or resetting Loading
  boundary. Multiple regions may share requests, but fallback permission stays
  local to the reader that actually displays it. The nested cohort adds a
  static region tree with inner boundaries and unbounded children. A child can
  prepare content while covered; it only becomes visible when its enclosing
  region publishes content. Reset boundaries use the first source as their key.
  Nested regions currently exclude observation toggles, dynamic mounts, pending
  readers, optimistic actions and branch-selecting memos.
- The readiness cohort renders `isPending(() => refs.map(read))` without an extra
  data observer. Explicit event-block clicks read that expression only when its
  published verdict is false. Context-free pending probes are separate operations.
  Generation combines these with conditional readers, owned mounting, and optional
  publication anchors. The derived-readiness cohort passes the verdict through
  1–3 synchronous numeric memos; small integer arithmetic exercises propagation
  without wrapping graph values in objects. The optimistic-readiness cohort adds
  guarded clicks and those derivations to one-parent overrides. Their own slot
  is verdict-inert while the action is held (A24). Pending readers over latest
  action inputs and async derivations of the verdict itself remain unsupported.
- The optimistic cohort has one real action, one optimistic scalar, 1–4 controlled
  yield gates, and a final authoritative write. Readers are initialized,
  unconditional and have no boundary. Action gates and memo requests have
  separate ledgers. Multi-parent actions are unsupported.
- The reads cohort adds explicit ordinary/latest reads inside event blocks.
  Latest equivalence warms companions before the same schedule without adding a
  reader. Warming that starts extra async work or suspends is inapplicable to the
  allocation-only law. The latest cohort uses a real action writing authority
  while memos/readers consume a separate latest channel from that signal or a
  shared identity memo. Downstream work can be async. `viaMemo` changes the
  upstream owner; all reads still share that owner's companion.
- The branches cohort adds two-source branch-selecting memos. Async request keys
  include the selector and selected inputs; required work follows that chosen
  path. The branch-boundaries cohort combines this with flat Loading regions.
  Requested and published paths are recorded separately; a published path is
  unknown when source anchors cannot witness it. This combination currently
  excludes dynamic mounts, nested boundaries and optimistic inputs.
- Source and visibility effects are explicit publication anchors in
  ordinary graphs. Version 2 can remove source anchors with `anchors` and the
  visibility anchor with `anchorShow: false`; the observation, latest and branches
  cohorts exercise these. Rules never read hidden runtime accessors to inspect
  state. Without an anchor, intermediate derivation checks require an actual
  tuple witness; final desired-value checks still apply. Only `frame.inputs`
  entries corresponding to configured anchors are published observations; legacy
  `input`/`show` fields are not witnesses when their anchors are disabled.
- A turn is an uninterrupted synchronous block. Queued microtasks, promise
  continuations, and async continuations use native JavaScript scheduling.
  Callback delivery through a host task uses `MessageChannel`; a subsequent
  real host task establishes that finite native microtask chains drained.
  `flush` is an explicit generated operation, not silently inserted after each
  stimulus. Initialization and disposal do explicitly flush.
- Tracked one-shot task callbacks model additional external inputs and can be
  canceled. Their delivery order is explicit in the scenario. This is not a
  general virtual `setTimeout` implementation: no deadlines, equal-deadline
  timer races, intervals, elapsed-time code, or arbitrary application timers are
  generated. All async work in the language goes through the ledger.

`fast-check` supplies seeded structural generation. The interpreter, work
accounting, rules, and domain-aware shrinking remain small project-owned code.
There is no generic model-command executor that awaits each synchronous step.

## Laws

The executable rule catalog is in `rules.ts`, with the pure specification in
`scenario.ts`. It refers to values, observation and publication, not flags,
reporter sets, lane IDs or internal graph layout.

| Rule | Assertion and limits                                                                                                                                                                                                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1   | A delivered tuple is internally coherent wherever it contains a derivation’s complete source set. Stable derivations agree with their own published sources; unrelated sources need not publish together.                                                                                                                        |
| S2   | Published visibility agrees with hidden/ready content, allowing an actual published fallback.                                                                                                                                                                                                                                    |
| S3   | Once all generated writes' scoped `onSettled` callbacks have run, their inputs must have published at the completed flush. A raw internal transition-settled hook is only diagnostic.                                                                                                                                            |
| S4   | After a correct final view, separately resolving residual work cannot change that view without new external input.                                                                                                                                                                                                               |
| S5   | A disposed reader generation receives no further publication callback, including after remount.                                                                                                                                                                                                                                  |
| L1   | All finite work, including residual requests, settling reaches the final pure view. A later repair cannot erase an earlier consistency violation.                                                                                                                                                                                |
| P1   | After a host drain, ordinary writes publish once no visible reader requires unresolved work. Scoped to flat pure DAGs with complete anchors and settled observation controls; no actions, branches or readiness readers. Published fallback does not hold source publication.                                                    |
| W1   | Completion beyond modeled requirements remains a timing finding. Default `review` leaves unknown timing open; P1 independently rejects provable delays. Historical disposal permission is opt-in. `required-only` and `retain-disposed` remain alternative W1 investigation policies, not switches disabling P1.                 |
| O1   | Ready continuous optimistic data can publish while its one parent action remains open. O1 excludes gates, mounts, boundaries and readiness readers, and does not demand completion of ordinary controls. Experimental expectation.                                                                                               |
| O2   | Authoritative correction does not require obsolete optimistic requests to complete. Experimental expectation, distinct from eventual final correctness.                                                                                                                                                                          |
| R1   | Ordinary imperative reads match an existing publication witness. For memo reads this requires a direct ready reader; an unobserved async memo is not assumed current merely because its source published.                                                                                                                        |
| R2   | A rendered ready control can read its guarded expression without suspending; where source anchors exist, its read agrees with them. This does not assert that every stale-but-readable value must have a true verdict.                                                                                                           |
| R4   | After a flush, a continuously observed ordinary expression with a distinct desired answer and complete source anchors must report pending while that answer is held (SPEC A24). Equal-answer motion, partial witnesses, boundaries, changing observation and actions are excluded.                                               |
| R3   | Explicit context-free isPending probes do not throw NotReadyError, per SPEC A16. No false-implies-readable assertion applies to these probes.                                                                                                                                                                                    |
| E5   | One held optimistic proposal and the same ordinary write have the same stutter-normalized data trace in a settled pure graph with unconditional readers and no boundary. The parent stays open until cleanup; reversion is outside this comparison.                                                                              |
| E4   | Early latest creation without extra work or observation leaves later publication and imperative-read traces unchanged.                                                                                                                                                                                                           |
| E3   | For generated pure graphs with settled initial state, continuously observed readers, one write, no readiness verdict readers, and no fallback, sync, fulfilled-promise and delayed delivery have the same data-publication trace after consecutive duplicates are removed. Every intermediate frame also runs the safety checks. |

Async requests are recorded **before Solid receives their promises**, including
the memo ID, captured inputs, occurrence, and physical completion. Required
answers are derived from the scenario's pure graph and desired inputs, independent
of Solid's reported pending records. A hook marks which promises Solid registered
for diagnostics; that registration cannot make the oracle consider work ready.

Requirements belong to individual readers. Current obligations are derived from
all declared refs and desired inputs, independently of whether Solid actually
ran the reader. A separate history records exact waiting requests on requested
paths after the reader attempted that prefix. Published fallback may retain
those witnessed requests; another flight at the same memo, or a newly spawned
descendant, gets no inherited permission. Once current content publishes, the
old waiting interval closes. Nested requirements name the enclosing fallback.

This history is a sufficient scoped witness, not a complete reconstruction of
Solid's subscriptions. Unwitnessed old work stays in the residual phase; if it
is needed to finish, that is an open W1 timing finding by default. It cannot
suppress final correctness or publication checks. Partial source observation
never becomes a made-up published branch. Final footprint diagnostics use stable
replay IDs; internal selections use byte arrays and small source masks.

The completion suffix stops external input, drains queued task callbacks, settles
required current/fallback-covered work, then resolves residual work one request
at a time. Ordinary unobserved cache changes are allowed. A later setter in a
queued callback is an external stimulus, not an orphaned memo completion.

A recovered waiting finding outside the accepted exception has status `policy`, not a hang. A narrowly
allowed finding remains in the artifact even when status is `pass`. `inapplicable`
means a paired law's preconditions do not hold. None of these outcomes suppresses
applicable final-state or safety checks. Corpus labels likewise never disable laws.

`onSettled` is a post-commit callback: it can start a new pending update but cannot
extend the committed one. S3 includes observed optimistic correction in the parent
update under the proposed correction contract. That stronger expectation is marked separately
from a confirmed upstream contract; the current checkout may fail it.

Readiness has an explicit upstream exception: SPEC A16 requires context-free
isPending probes to remain nonthrowing, including false for initial uninitialized
data. A19 classifies that as loading, with no observable value to be non-final.
Inside a surrounding reactive context, initial NotReady propagates to boundaries;
untrack() by itself does not remove that context (#2928). Preserve this distinction
in the readiness laws; false is not a universal context-free readability
assertion. `pending-contract.test.ts` records the accepted behavior.

## Reduction and calibration

Reduction removes schedule chunks, operations, readers, unused nodes, and
unnecessary arithmetic. It preserves topological references and exact request
identities. Once a generated resolve selects a request, replay saves its captured
inputs and occurrence; deleting an earlier write cannot silently redirect it to
another request. Non-applicable generated resolutions become explicit no-ops.
Candidates must expose an admitted semantic failure, within `--budget` attempts
(default 150), and the resulting minimum is replayed again. Focused mode additionally
requires the original rule and symptom. This is a local
reduction, not a claim of a globally minimal program.

The reducer also tries coordinated changes learned from retained failures:
initial hide-to-hidden-state, joint arithmetic/dependency simplification, removing
multiple offsets together, and moving synchronous arithmetic across memo edges.
It can remove a mounting mechanism, read a synchronous sum's inputs directly,
or join adjacent event bodies without dropping their operations. These edits can
change ownership, entanglement and batching. They require replay, rather than
being declared semantic equivalences; keep original witnesses when grouping them.

Single-use bypasses can replace one reader or memo input with an upstream input
while retaining the intermediate computation for other consumers. Surviving
requests stay exact. Setter ordering also tries visibility and mounting setters
on different targets within one callback, always descending in the canonical
ordering. It never swaps setters across reads, flushes, callbacks or host turns.

Late observation reductions can replace a mounting control with a visibility
gate only when the global visibility signal has no anchor, readers or setters.
A flat fixed reader can project its source fields into publication anchors,
retaining its derived fields in order, if no operation addresses that reader.
These changes require replay because they alter observation machinery. Original
cases remain in the corpus even when the reduced scenario exposes a different bug.

Captured request inputs normally remain unchanged. Identity-value renaming uses
a bijection; folding a synchronous `a*x+b` input also offers an exact safe-integer
inverse for the affected request keys. Both retain the request owner and occurrence,
including paired keys. Invalid or inexact inverses reject that candidate; neither
rule falls back to selecting another pending request. Empty latest warmup lists
normalize to omission; nonempty warmups remain meaningful.

Further bounded candidates lower a simple optimistic action into ordinary writes,
replace a no-op proposal plus immediate completion with a live proposal, and move
an uncanceled visibility microtask into its own host turn. A synchronous arithmetic
cone feeding an async memo can collapse to an async identity when its exact request
tuples translate unambiguously, retaining their occurrence numbers. These are
intentional program changes, not equivalences. Cheap pruning resumes after each
accepted edit; the same seen set and budget cover the whole search.

Coordinated branch candidates fold a conditional into a consuming memo and shorten
both arms together, immediately pruning disconnected nodes. Delivery candidates
try a uniform async mechanism or change one memo while bypassing another. They
can also replace an explicit flush with a host-turn boundary in the same trial.
Thus two edits can expose a failure even when either edit alone would pass.
This is a fixed menu of two-edit templates, not an unbounded lookahead search.

Manual gates or extra await boundaries are offered only together with removing a
memo or explicit flush. This avoids repeatedly switching between equally complex
async forms. Surviving manual request keys remain exact; resolutions of removed
async mechanisms become noops. Strict replay rejects requests the new graph no
longer reaches. No invalid run is accepted as a substitute failure.

Observation collapse replaces non-render reader scaffolding with one fixed data
reader and removes its obsolete mount/dispose/click commands together. Direct
multi-proposal action scripts can lower to ordinary writes through their explicit
proposal/authority sequence. These deliberately change observation, batching and
lifetime, and require replay under the rewritten program's laws.

Source-merging candidates also try a small offset adjustment in the same trial.
This can retain an old/new answer equality that either edit alone would lose.
Callback candidates can append an uncanceled queued payload to the end of its
containing callback. Initial visibility can absorb the first direct visibility
setter even when that callback contains other work. None assumes that the rewritten
schedule is equivalent; each is replayed as a new program.

Delivery/declaration candidates change one memo's async delivery and swap adjacent
valid declarations together. They descend in canonical order, or remove an arithmetic
cone at the same time. A per-run ordering limit retains prior progress across other
families' delivery changes; a smaller graph starts a fresh ordering search. When
these moves succeeded and budget remains, a final pass disables them and retries
ordinary simplifications with a fresh seen set. This prevents an already-tried
simplification from leaving the output in an unnecessarily elaborate async form.
The finishing pass shares the attempt budget, counters and optional passing control.
Paired shrinking uses the same bounded finishing behavior.

Minimized artifacts record `originalSignature`, `shrinkMode` and the final result's
actual diagnostic. Replay checks the final diagnostic, not the original. The
operational loop is to understand and fix one clear repro, then replay originals
and run fresh fuzzing against the fix. Shared reduced examples do not prove shared
root causes or justify dropping the originals.

`shrink(..., { stats })` optionally collects attempts, accepted edits and candidate
replay milliseconds by reduction family. Control checks remain separately counted
in `controlAttempts`. With no stats object, shrinking makes no profiling clock
reads. An explicit `order` can test a deterministic family ordering; it does not
learn priorities across cases. Judge orders by resulting repro size, deduplication
and total replay cost, not acceptance rate alone: high acceptance can mean many
small edits that use up the budget before larger useful reductions.

Calibration intentionally changes a disposable worker bundle, never source files:

```sh
pnpm --filter @solidjs/signals fuzz --calibrate
pnpm --filter @solidjs/signals fuzz --calibrate --fault drop-wake --shrink
pnpm --filter @solidjs/signals fuzz --calibrate --fault stale-result --shrink
pnpm --filter @solidjs/signals fuzz --calibrate --fault lost-blocker --shrink
pnpm --filter @solidjs/signals fuzz --calibrate --fault false-ready --shrink
pnpm --filter @solidjs/signals fuzz --calibrate --fault false-verdict --shrink
```

These remove the scheduled flush, stale-flight identity guard, or pending reporter
registration, or replace isPending with a false verdict that never observes its
expression. The false-ready mutation calibrates guarded clicks and initial readiness;
it does not establish complete question-scoped pending coverage. A separate
false-verdict mutation runs the original isPending probe, preserving tracking
and initial suspension, but discards its result. R4 catches its false verdict
while an ordinary data observer holds the update. Exact mutation anchors must match once or the build
fails. Integration tests verify semantic detection, reduction, replay, and that
the reduced case passes against unmodified Solid. This tests detection of actual
runtime mistakes rather than merely feeding fabricated bad outputs to the checker.
Calibration exits successfully only when it detects a semantic failure and has no
runtime errors, invalid cases, or exhausted budgets. A worker crash is not evidence
that a calibration fault was detected.

Tests also exercise native nested microtasks, chained fulfilled promises during
initialization, fallback retention, obsolete completions, reverse-order replay,
completion-probe neutrality, fresh versus reused workers, and watchdog termination.

## Cost and next extensions

The default worker is reused after complete disposal/draining; failures retire it.
`--fresh` isolates every case as a control. The parent watchdog can terminate a
worker stuck in synchronous or microtask work. Graph/work/trace/round budgets cap
individual cases. Worker V8 heaps are capped at 128 MiB old generation and
32 MiB young generation; heap exhaustion is `limit`, not a semantic failure.
Worker stdout/stderr are retained as a bounded 4 KiB diagnostic tail. The CLI
also reports the largest after-cleanup heap sample, explicitly not a peak or RSS
measurement. A campaign is capped at 10,000 generated cases; use separate
seeds/processes for larger runs. Each worker owns a separate Solid module instance.

The hot checks prepare each scenario's graph once: stable replay IDs map to dense
numeric slots and source coverage uses four-bit integer masks. Evaluations and
path selections return independently owned arrays, with no shared scratch state
or invalidation caches. Requests are indexed by
node and matched by numeric tuple loops, never by JSON equality. Reader lookup
is prepared once, pending probes do not allocate discarded arrays, and inactive
readiness laws skip evaluation. Attribution hooks use a typed object instead of
a Proxy in the runtime's read/recompute path. The generated data remains small
integers; there is no bitwise coercion that would truncate a valid replay value.

Captured request inputs and publication snapshots remain independently owned:
reusing those mutable buffers would destroy evidence. JSON remains appropriate
for canonical artifact keys, persisted reports and cold paired-trace formatting.
Performance profiling and benchmarks are deferred; this
cleanup claims fewer unnecessary operations, not a measured speedup. Prefer
straightforward loops and predictable data shapes; pooling, buffer reuse and
additional caches need a measured hotspot to justify their complexity.

The CLI bundles once, interprets data for each case, and reports total campaign
time, operations, requests, and throughput. Timing includes generation, worker
startup, reports and requested shrinking, but excludes bundling. Equivalence's
`total` counts graph comparisons; `executions` counts its two or three runs per graph.
These are diagnostic measurements, not a production benchmark. Production pays
zero new bookkeeping: all changes are test files and development tooling. The
runner enables existing `__DEV__`, `__OBSERVE__`, and `__TEST__` checks.

The [next implementation plan](../../../../documentation/plans/semantic-fuzzing-next.md)
records the staged scope. Implemented: scoped waiting policies, corpus and paired
reduction, multiple sources, one action with optimistic proposals, explicit reads,
latest warming and tracked derivations, ordinary/optimistic paired equivalence,
owned reader mounting, optional publication anchors, branch-selecting memos,
independent/nested boundary regions, scoped request/branch history across fallback,
readiness through synchronous numeric memos, one-parent optimistic readiness,
and A24 held-answer verdict checks. Unsupported combinations are listed above;
async derivations of readiness, latest-input readiness, and full question-scoped
pending semantics need further contract slices. Automatic TypeScript repro generation is skipped
for now; reporting repros are adapted manually from the artifacts. Custom equality, `prev`, errors, stores, streaming,
`loadingValue`, and generalized time remain deferred.

Campaign results are tied to their recorded source and worker hashes. The original
baseline for this expansion was `005a623864ffd7cc3c76628369588ddcc4df26a5`;
those findings are not claims about current next or Ryan's current PR heads.

On 2026-09-12, the working branch was rebased onto next at
`344ed054a932c7508efe57908eb175ed67d54940`. The `stale-reader` and `stuck-hidden`
corpus scenarios now pass under every waiting policy; their regression tests
expect correct publication. That rebase did not change the semantic laws. Revision 13 preserves exact request
occurrences through completion and snapshots work before cleanup.

## Rule revision 13: decided semantics and provisional read scope

Revision 13 treated the narrow #3347 disposal permission as accepted by default.
Revision 14 below replaces that default with an explicit compatibility allowance.
Other revision 13 contracts remain as described here.

O1 now checks only the optimistic source anchor and continuous unconditional data
readers. It does not run the global final-state checker during an open action:
ordinary source, visibility and mount updates need not adopt optimistic timing.
Dynamic readers remain checked by S1/S2 and final completion; extending their
optimistic progress contract requires separately specified preconditions.

R1 scopes by declared data flow, not merely the spelling of a read operation.
A plain getter or memo may forward the designated latest source (-2); its samples
remain recorded for replay and E4, but R1 does not choose staged versus published
outside reads. The existing source masks conservatively include both branch arms.
Independent ordinary sources in the same scenario retain R1 checks. No read-path
or graph work was added to Solid; this is pure per-scenario metadata.

A15 independent-reveal controls and multi-action provenance generation are still
follow-up work. O2 and S3 have not been broadened or reclassified by this revision.

## Self-tests and candidate corpus

The default Vitest suite checks the harness, accepted runtime controls, and
injected mistakes. It must not require an unfixed Solid bug to remain present.
Candidate scenarios live in `corpus.ts`; `--corpus` evaluates them against the
current checkout and can report failures without making those failures a
requirement of the self-tests. A later runtime fix can turn a candidate into a
passing regression without changing its rule.

`ruleContracts` records the scope and authority of each rule. O1/O2/E5 and the
optimistic extension of S3 are experimental proposals, not asserted upstream
agreement. Campaign failures need triage before becoming correctness tests or
CI gates; the self-test command is separate from those exploratory campaigns.

Summary counts `failureSymptomGroups` and `findingSymptomGroups` measure grouping,
`retainedCases` counts compact replay records, and `workerErrors` records failures
outside an active case. JSONL replay entries carry the comparison, fault and
waiting policy required to reproduce their interpretation.

## Rule revision 14: ideal progress and explicit exceptions

Rebased onto PR #3392 at `bc54629bf58f55f47e0f4ae369919d643e85594a`, including
#3381 (`55847dd7`, `a82d2e3c`), on top of next `344ed054`. #3337 is a separate
unmerged stack and is not included. This records the tested foundation, not a
moving runtime pin.

P1 is a sufficient progress proof, not a copy of the scheduler's blocker test.
After a host drain, inspect declared readers, their published visibility, and the
independent request ledger. Settled hidden/absent readers and published fallback
cannot hold ordinary source publication. Any remaining visible reader with a
missing or unresolved desired answer prevents the proof. All source anchors must
be present. Actions, branch selection, readiness readers and nested regions are
outside this slice; unsettled visibility/mount controls also prevent the proof.
We do not infer which separate transactions entangle or demand earliest per-source
publication while another live reader still has work.

This check happens while fallback requests are deliberately unresolved. The old
completion check settled those requests first, so it could not expose unnecessary
source blocking behind a fallback. Boundary content must still finish afterwards;
P1 does not abandon its completion obligations.

Evaluate the ideal law first, then classify a violation against named exceptions
in `policy.ts`. No exception is enabled by default. The historical optional
`legacy-disposal-wait` permission requires a v1 single-write graph, unconditional
readers without boundaries or visibility writes, and a pending observation
followed by explicit disposal for **every exact remaining request** in that write.
It cannot cover hiding a conditional reader, a fallback reset, a later write or
new unwitnessed descendants. It cannot waive S1–S5, L1, or another rule. Missing
final publication replaces an earlier progress failure as the primary finding.

```sh
# Ideal progress contract (default)
pnpm --filter @solidjs/signals fuzz --seed 3289 --cases 1000
# Historical comparison; ideal violations still appear in artifacts/counts
pnpm --filter @solidjs/signals fuzz --allow legacy-disposal-wait --seed 3289 --cases 1000
# Replay a waived finding against the ideal contract
pnpm --filter @solidjs/signals fuzz --replay findings.jsonl --index 17 --allow none
```

`result.progress` retains the failed ideal check, immutable outstanding-request
witnesses and any matching allowance ID. Replay restores the recorded allowances
unless explicitly overridden. Shrinking a waived case preserves its exception
identity. `progressFindings` counts cases with ideal violations and `waivedProgress`
counts matches by allowance. These remain retained even when the run passes, so
compatibility does not erase evidence. Recovered timing beyond P1's proven scope
remains an open W1 finding, not an invented obligation or a hang.

Calibration faults `lost-disposal-wake` and `lost-fallback-wake` remove only the
relevant wakeup in a disposable worker bundle. Each is caught by P1, reduced and
replayed against unmodified Solid. An integration test also checks opt-in waiver,
JSONL retention/replay, strict replay, and rejection of the same waiver for
fallback waiting. Correct early disposal/release and a second live reader serve
as positive controls. The harness no longer requires the old disposal delay to
remain a runtime behavior.

The progress checker adds work only at host-drain checkpoints, using the existing
bounded graph/ledger. It adds no runtime node fields, subscription traversal,
virtual scheduler, per-case compilation or pooled buffers. Its limited sufficient
condition deliberately leaves room to expand contracts without reconstructing
Solid's implementation in the oracle.

## Rule revision 16: ordinary update groups, action scripts and batching uncertainty

The stronger experimental G1/G2 model is implemented in `groups.ts`. It derives
batch identity from executed setters within a callback and explicit flushes,
not runtime transition IDs. No extra microtask markers are scheduled. Identified `actions` can contain up to five
synchronous segments separated by controlled yield gates; at most two scripts
are declared. `start-action` and `resume-action` name the script with `action`.
Old optimistic scripts and replay formats remain supported.

G1 checks atomic publication of proven groups and prohibits authoritative changes
while a group has action holds. Same-source overlapping writes merge their groups;
completed publication retires their identity. A resumed action retains its group.
G2 checks readiness per group, allowing unrelated groups to remain pending.
Potential joins through memo ancestry extend the deadline only, not the required
atomicity. Shared effects never introduce a join in the model. Reader demand
masks are compiled separately per ref and propagated through memo edges, so a
changed shared derivation still waits for necessary foreign async ancestors.

The scope is initialized ordinary flat graphs with complete source anchors and
fixed data readers. Changing observation, boundaries, branches, readiness, latest
reads and optimistic lifetimes keep their existing rules but currently skip G1/G2.
Group checks can be disabled through the internal `groupChecks: false` runner
option for noninterference tests; campaign defaults enable applicable checks.
Summary fields `groupScopes`, `groupChecks`, `groupHeld`, `batchingHeld`,
`batchingCases` and `possibleGroupJoins`
make scope and conservative withholding visible. Counts are checks, not distinct
semantic cases. Failure artifacts include group history and action progress.

```sh
pnpm --filter @solidjs/signals fuzz --cohort update-groups --seed 3289 --cases 1000
pnpm --filter @solidjs/signals fuzz --calibrate --fault entangle-effect --shrink
pnpm --filter @solidjs/signals fuzz --calibrate --fault drop-action-hold --shrink
```

Calibration inserts an unwanted effect join (with commit replay so detection is
about the delay), or removes the action completion hold. Controls cover batching,
FIFO microtasks, shared effects, same-source reuse and multiple action lifetimes.
Focused shrinking preserves G2's independent/possible-entanglement/possible-batching/
single-group relation. Discovery may select a different admitted violation; both
modes can simplify action segments. Candidate runtime delays remain in corpus,
never as tests that require them to persist.

**Batching permission (2026-09-14):** writes in one synchronous callback form a
proven batch unless an explicit flush separates them. Separate callbacks within
one host task and its microtask drain may entangle, but need not. The generator's
queued callbacks and resumed action steps close proven batches; actual host-task
boundaries and explicit flush separators close the proximity window. Internal
flushes do not themselves end this permission window.

A generated memo landing can bring its still-live source group into proximity
with another group active in that window. The hook supplies the generated memo's
source mask, never a Solid transition ID or an assertion that it is ready. The
permission is attached to the particular live groups, retained while they are
unfinished, and never inherited by later generations merely reusing a source.
Possible edges are closed transitively with possible derivation joins, so a
permitted join may encounter another update's genuine blockers. No edge adds a
mandatory publication constraint. Even permitted groups must publish once their
conservative blockers are gone; safety and final completion remain unchanged.

`batchingHeld` counts checks that would have reported G2 without the temporal
permission. `batchingCases` counts executions using that permission. For those
executions, `batching.jsonl` preserves canonical schedules, group history and
metadata for replay. These are accepted uncertain timings, not failures or
confirmed runtime entanglements. A passing run without any such checks pays no
artifact-writing cost. Both independent and joint publication have oracle tests;
separated-task independence and fault calibration ensure this permission does
not disable progress checking generally.

The unused fulfilled memo that absorbs a neighboring write is now covered by
this permission. Existing shared-effect delays across separate host turns remain
G2 candidates. Optimistic group integration and changing-observer group deadlines
are explicitly outside this checkpoint. Output attachment/cleanup modeling is the
next independent extension; see the implementation plan.

### Attached output and cleanup (rule revision 17)

```sh
pnpm --filter @solidjs/signals fuzz --cohort attachment --seed 3404 --cases 1000 --shrink
```

A reader can declare `render: { on, target, scheduled }`. Its parent render-effect
compute reads `on`, creates a fresh detached container, and creates a nested effect
that reads the reader's usual `refs`. The parent's scheduled apply attaches the
container. With `target: "portal"`, the nested effect instead attaches its payload
to an independently visible destination; this requires `scheduled: true`.
Local effects may run inline while preparing their fresh detached container.

`output.ts` models only host creation, writes, attachment and removal. Numeric
handles and linked child lists give one record per created host node, without
per-frame subtree cloning, reactive graph traversal or pooling. The 4096-node cap reports
a harness limit, not a semantic failure. A root's actual reachability determines
visibility; ownership disposal does not automatically hide its output. Effect
cleanup explicitly detaches the affected node, so a cleanup that removes visible
content before replacement is observable.

**A1** requires exactly one contribution in an initialized region until replacement
or explicit disposal. It also detects duplicate contributions and output left
behind after removal. The existing S1 rule checks the attached values against the
published source anchors. These checks run after complete flushes/drains, allowing
detached preparation and intermediate removal/attachment inside a flush. An
uninitialized region may still be empty; final completion remains checked by L1.
`output.test.ts` calibrates premature attachment, early visible removal and
extra contributions, alongside safe detached work and a real default-effect
preparation/scheduled-parent control.

This slice supports ordinary single-source DAGs and fixed output regions. `on`
must be an ancestor of the payload, keeping parent work in the existing request
ledger. Actions, optimism, dynamic branches, nested boundaries and paired
comparisons are not composed with this renderer yet. G1/G2/P1 remain out of scope;
existing consistency and final-completion laws still apply. Detached portal
visibility is covered by host controls, but the generator currently uses visible
portal destinations. Output node counts, private writes and checks are retained
in results and campaign summaries.

The #3404 integration case accepts either a valid runtime or an A1 finding and
checks replay/shrinking when failing. It does not require the runtime to preserve
the bug. On next 14ded248, 507/1000 generated schedules found a visible-output gap;
all 1000 passed on #3405 323f9ad, including exact replay of all 507 failing schedules.
