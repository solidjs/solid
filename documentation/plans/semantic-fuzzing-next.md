# Semantic fuzzer scope and extensions

The [architecture](semantic-fuzzing.md) and [README](../../packages/signals/tests/semantics/README.md)
describe the implementation. The runner always uses the checked-out source;
corpus discovery revisions are historical provenance, not runtime pins.

## Implemented scope

- Bounded pure scalar DAGs with synchronous, promise, manual and await delivery.
- Native event blocks, microtasks, promise continuations and controlled host tasks.
- Multiple sources, optional publication anchors and branch-selecting memos.
- Changing observation, disposal, owned mounts and flat/nested Loading regions.
- Exact request identities, current obligations and scoped fallback history.
- One action lifetime with optimistic proposals or a shared latest channel.
- Tracked readiness, guarded event reads and synchronous verdict derivations.
- Scoped waiting policies, final consistency, completion and residual-work laws.
- After-drain ordinary progress checks and explicit evidence-scoped exceptions,
  retained through reporting, shrinking and replay.
- Paired delivery, latest warming and ordinary/optimistic comparisons.
- Canonical replay, bounded reduction, fault calibration and worker containment.
- Independent host attachment for fixed output regions, nested render-effect
  replacement, scheduled portal destinations and visible-cleanup continuity.

The interpreter rejects unsupported combinations. The README gives the detailed
preconditions of each cohort and equivalence relation.

## Extend only with an independent oracle

Prioritize a small contract slice with a clear positive control and a deliberately
broken control. State the invariant without relying on Solid's current ownership
or pending implementation, then add only the language features needed to reach
it. Check replay and reduction before expanding campaign size.

Useful follow-ups include independent-reveal controls, multiple action lifetimes,
async derivations of readiness and latest-input readiness. These require explicit
publication/lifetime contracts before generation. Custom equality, stateful `prev`,
user errors, stores, streaming and generalized timers are separate extensions.
Automatic TypeScript reproduction generation remains deferred; translate reduced
artifacts manually for reporting.

The current [cleanup plan](semantic-fuzzing-cleanup.md) covers reduction quality,
execution cost, contract evidence and reporting. The earlier
[reduction audit](semantic-fuzzing-reduction-audit.md) retains its measurements.
The working loop prioritizes one
actionable issue at a time. Discovery shrinking may expose a different semantic
bug as long as the resulting scenario, oracle scope and request selections are
valid. Preserve originals for replay after a fix, then fuzz again to find what
remains. Same-failure preservation is a focused option, not the default discovery
goal. This supersedes stricter failure-identity guidance below for discovery
reduction; it does not relax the semantic rules themselves.

Performance work should begin with measurements of complete campaigns and their
actual hot paths. Preserve predictable scalar representations and independently
owned evidence. Avoid speculative pooling or complex caching.

## Next implementation: completion of individual update groups

Status: ordinary group checkpoint implemented. Group history, identified
authoritative scripts, G1/G2, targeted generation, replay and runtime-fault
calibration are in place. Rule revision 16 requires batching within a synchronous
callback, but permits either independent or joint completion across adjacent
microtasks in one host-task drain. The old async-landing adoption question no
longer blocks this scope. Temporal permissions are evidence-bearing, affect
only progress deadlines and are retained separately from bug findings.

Changing-observer and optimistic **group** integration remain pending. Existing
observer/optimistic rules still run; the stronger per-group deadline is simply
out of scope. This is a usable checkpoint, not completion of every extension below.

Extend P1 beyond the current sufficient test
that no visible reader has unresolved demands. The objective is to assert that
one update must publish while another update or action still has legitimate work.

### A. Establish grouping controls before expanding generation

Write small, explicit controls for:

- Two ordinary source writes in one synchronous batch versus separate batches.
- Explicit flush between writes, and microtask writes queued before/after the
  scheduled flush. A host task is a delivery mechanism, not an assumed update ID.
- Independent async derivations read through separate effects or one shared
  effect, resolving in both orders.
- Overlapping writes to the same source and through a shared derivation.
- An action's writes before/after yields, two actions starting together or in
  separate batches, and ordinary writes alongside an action.

Read existing decision/test evidence but write down the intended contract
separately. Runtime behavior is not the oracle. Ambiguous controls get a reduced
example and a user ruling before becoming assertions. Start generated strict
grouping with synchronous batches and explicit flush/drain separators; incorporate
queued microtask patterns using the revision-16 temporal permission.

### B. Add a small independent update history

Use integer write/group/action IDs, existing source masks, and small group records.
Record intended write values, batching membership, action holds and successive
writes to each source. Preserve exact request occurrences in the existing ledger.
Record why groups are related, not Solid's internal transition identity.

Keep two kinds of relationship distinct:

- Proven grouping supports atomicity and no-early-publication checks.
- Possible grouping conservatively extends completion deadlines only. It cannot
  require joint publication or make early independent publication a failure.

Static memo source masks provide conservative potential joins between overlapping
unfinished updates. Shared effects do not join groups. Never infer actual temporal
entanglement solely because two sources occur somewhere in one memo's ancestry.
Retire write generations after the applicable publication obligation is met;
old shared derivations must not permanently couple later updates. Uncertain
retirement/ownership prevents the affected proof, not every rule in the scenario.

No runtime pending sets, transaction IDs or onSettled callbacks may establish that
an update is ready. Those remain diagnostic observations or checked outputs.

### C. Check ordinary groups independently

Begin with initialized flat pure DAGs, complete anchors and continuous data
readers. Use both separate and shared effects. Compute each group's candidate
publication from its intended writes and the published values of other groups;
do not require an unrelated group's latest requested data to be ready.

Derive blocking demands from the pure graph and exact physical request ledger.
After a host drain, a group whose conservative possible blockers are all finished
must publish. An independently open action or request elsewhere must not prevent
this assertion. Preserve existing safety checks at every publication.

Then apply the existing witnessed hiding/disposal/fallback rules to these groups.
Fallback can release source publication while retaining obligations for its own
content. Branches, readiness, unsettled mounts and nested boundaries initially
retain existing checks without the stronger per-group deadline.

### D. Represent authoritative actions explicitly

The current action grammar is specialized to one optimistic script. Add bounded
identified action scripts with ordinary writes and controlled yield gates,
initially at most two concurrent actions. Preserve old replay formats through a
normalization step or optional backwards-compatible fields.

An action continuation retains its action identity across host tasks. Distinct
actions are not automatically distinct update groups: same-batch starts or later
entanglement can join their authoritative work. All action holds in such a group
must end before it is ready. Finishing the action body is necessary, not sufficient;
observed downstream work may remain. A later unrelated callback does not inherit
an action merely because the action is still open. Nested actions are deferred.

### E. Connect optimistic lanes without inheriting parent holds

Represent the optimistic publication group separately from its parent lifetime.
Its own observed work determines when it can publish; an open parent action does
not hold it. Parent completion triggers correction without waiting for unfinished
optimistic work. Observed correction remains an obligation under the proposed
parent-completion contract, with its authority still marked experimental.

Reuse the current one-parent optimistic/latest grammar first. Add only combinations
whose correction and shared-derivation obligations are expressible independently;
do not infer parallel graph evaluation. If the single-graph interaction creates
an ambiguous obligation, pause on a concrete example rather than inventing a rule.

### F. Calibrate, preserve evidence and measure coverage

For each new law, add passing controls and a disposable runtime mutation that
violates it: premature action completion, lost ready-group wakeup or accidental
coupling through a shared effect. Require a semantic finding rather than a crash.
Verify same-batch/shared-derivation controls prevent false independence assertions.

Generate schedules that leave unrelated gates unresolved at the checkpoint, vary
graph shape and completion order, and replay minimized failures. Shrinking must
preserve the violated relation and any exception identity; removing a batching
boundary cannot silently turn an independence finding into a different issue.

Extend the existing ideal-rule/explicit-allowance mechanism. Preserve waived
evidence and scope in artifacts. Report checks made and skipped, including the
reason (possible entanglement, unsettled observation, unsupported lifetime), so
conservative modeling is visible coverage loss rather than a claimed proof.

Reuse precomputed masks and request indices, bound live groups/actions, and prefer
short loops over graph cloning or per-read bookkeeping. Use simple group merges
over the small active set; no speculative pooling or generic solver. Run targeted
self-tests, fault calibration, and bounded campaigns with measured throughput.

Completion criterion: the fuzzer distinguishes batching, authoritative action
holds, derivation entanglement and shared effects, and detects late publication
of an independently ready group while other finite work remains deliberately
unresolved. Existing whole-view completion and consistency laws remain active.

## Observable attachment and cleanup: first slice implemented

Model a small output tree independently of Solid's owner tree. Default render
effects may prepare detached nodes early; scheduled root/portal effects attach
them. Numeric node/slot handles represent creation, writes, attachment and
cleanup removal. Only actual reachability from visible roots determines output;
never hide a mutation merely because its reactive owner is uncommitted.

Check consistency after drains and at external observations, allowing intermediate
host mutations inside an uninterrupted flush. Generate valid construction
patterns: fresh detached preparation, scheduled external attachment, nested effect
replacement, retained/fallback content, and independent portal destinations.
First calibrate a safe detached preparation, premature attachment and #3404's
premature visible cleanup (including schedule: true). Existing tree.ts only models
logical nesting and cannot substitute for this independent attachment model.
The `attachment` cohort now exercises fixed single-source output regions with a
parent compute and nested effect. Local writes prepare fresh detached containers;
portal writes are scheduled against a separate visible root. Host nodes use
numeric handles and linked child lists; creation allocates one record, reads walk
only the output subtree without cloning or following Solid's dependency graph.
There is a 4096-node per-case limit, alongside existing worker/work/frame limits.

A1 requires an initialized region to retain exactly one contribution until its
replacement or explicit removal. Existing S1 checks the attached values against
published inputs. Root reachability is independent of reactive ownership, and
checks run at completed flushes/drains, allowing private preparation and
remove-then-attach within a flush. Unit controls inject premature attachment,
visible cleanup and duplicate contributions; detached cleanup and preparation
are positive controls. The #3404-shaped integration control can pass after a
runtime fix; the test does not require Solid to remain broken.

Revision 17 keeps per-group progress and paired equivalence out of this new
scope. Generated changing visibility, Loading/fallback replacement, multi-source
regions and detached portal targets are still follow-ups. The host model already
tests a detached portal destination becoming reachable, but that shape is not yet
part of random generation. Existing logical tree.ts remains separate.

Verification against `next` 14ded248 and #3405 323f9ad: seed 3404, 1000 attachment
cases found 507 visible-output gaps on next; all 1000 passed on the PR. Replaying
all 507 saved canonical failures preserved every schedule and passed on the PR.
No runtime source changes are included. The failed effect-reentry experiment was
discarded before starting this work.

## Ordinary-group checkpoint verification (2026-09-14)

- Full signals suite: 1,940 passed, one skipped; fuzzer typecheck passed.
- Runtime fault calibration remains covered by the passing suite, including
  unwanted effect entanglement and removed action holds.
- 1,000 update-group cases, seed 3289: 985 pass, 15 G2 candidates in one symptom
  category; no worker errors or limits. The candidates concern independent groups
  across separate host turns and are not validated as 15 distinct runtime bugs.
- Temporal permission extended 114 checks across 79 executions. Accepted timing
  schedules are retained in batching.jsonl; a recorded case replayed with identical
  canonical schedule and group history.
- Campaign artifacts and logs: ../solid-effect-publication-evidence/semantic-fuzzing/
  batching-checkpoint-2026-09-14 (sibling evidence workspace).

No Solid runtime source changes are part of this checkpoint.
