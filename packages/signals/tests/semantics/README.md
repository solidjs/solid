# Solid 2 semantic fuzzer: an AI handoff

## For Ryan (and other humans)

This is an experimental debugging tool, not a proposed permanent testing framework.
You do not need to learn its commands or JSON format. Give your AI this README and
ask it to do the work. Useful requests include:

- **“Check my fix against the saved cases, then run fresh cases looking for related mistakes.”**
- **“Find the next distinct bug. Verify it on my current branch and give me one simple playground.”**
- **“Model this semantic guarantee across different graph shapes. Ask me about ambiguous cases.”**
- **“Investigate whether this finding is a real bug, a harness mistake, or a rule we should reconsider.”**
- **“Improve shrinking where it produces simpler repros or saves useful investigation time.”**

The objective is a small stream of actionable issues, not impressive failure counts.
Rules express intended behavior; existing implementation behavior is evidence, not
an automatic definition of correctness. Narrow exceptions are possible without
abandoning stronger checks elsewhere. The AI should explain semantic decisions
before changing them and preserve cases when a fix makes their reductions pass.

Everything below is context for the AI to continue this work without the original
conversation. The runtime can change, and this tool can change with it. Read the
code, use judgment, and create small local helpers when useful; do not turn this
handoff into a tooling project before using it.

## Start here, AI

This directory generates small numeric reactive graphs and schedules, executes
**real Solid signals primitives**, and checks observable semantic rules. It is an
interpreter, not a TypeScript source generator. `fast-check` provides seeded graph
generation; execution, the reference model, work accounting and shrinking are ours.

The ordinary campaign needs no browser, JSX compilation or jsdom. A lightweight
host-output model also covers private preparation versus visible attachment.
Separate manually written playgrounds establish that a candidate has real UI
consequences. Do not confuse interpreter failures with verified application bugs.

This handoff replaces reliance on the long development conversation and on personal
scripts. Prefer this README for the workflow, [CONTRACTS.md](CONTRACTS.md) for longer
rationale, [EVIDENCE.md](EVIDENCE.md) for calibration and reduction evidence, and
[the executable catalog](rules.ts) for the current scoped assertions. Documents
under `documentation/plans/semantic-fuzzing*.md` contain history, including rejected
experiments; they are not an instruction to implement every old proposal.

The branch was rebased onto `next` at `63560a11` on 2026-09-15. It adds test tooling,
not the abandoned optimistic-lane runtime prototype from the earlier investigation.
The executable rule revision is **17** at handoff. Check actual source/issue heads
before giving a new status report; historical results below are explicitly dated.

### A productive first session

1. Inspect the checkout and pending user changes. Establish the runtime revision.
2. Run the harness tests/typecheck and a small campaign with an explicit output directory.
3. Replay the relevant saved input, preserving its policy and comparison mode.
4. Examine the first wrong frame and its work ledger, not just the final signature.
5. Reduce, then translate a promising result to ordinary Solid code and verify it.
6. Check related open issues, recent fixes and the actual heads of relevant PRs.
7. Present one issue or one semantic question. Do not flood the maintainer with
   dozens of structural variants of a likely common problem.
8. After a fix, replay **originals as well as reductions**, then generate fresh cases.

When asked to improve the fuzzer, a useful result is better bug detection, a simpler
witness, a better-scoped rule, or less wasted execution. A lower group count alone
is not a success criterion. Do not silently weaken a rule to make a campaign green.

## Running it

Use the repository's Node/pnpm versions. The signals package requires Node
`>=22.12.0`; recent manual verification used Node 24.18.0. Install the checkout's
locked dependencies normally (`pnpm install --frozen-lockfile`). `fast-check@4.9.0`
is a signals development dependency, and esbuild is available from the workspace.

From the repository root:

```sh
pnpm --filter @solidjs/signals exec vitest run tests/semantics
pnpm --filter @solidjs/signals fuzz:types
pnpm --filter @solidjs/signals fuzz --help

# A useful ordinary starting run. Use a NEW output directory for each invocation.
pnpm --filter @solidjs/signals fuzz --seed 3289 --cases 1000 --shrink --out /tmp/solid-fuzz-run-1

# Replay one reduced artifact, independently of other worker executions.
pnpm --filter @solidjs/signals fuzz --replay /tmp/solid-fuzz-run-1/case-17-min.json --fresh --out /tmp/solid-fuzz-replay-1

# Index is the recorded campaign case index, not necessarily a JSONL line number.
pnpm --filter @solidjs/signals fuzz --replay /tmp/solid-fuzz-run-1/findings.jsonl --index 17 --out /tmp/solid-fuzz-replay-2

# Investigate one case more deeply, preserving its original failure fingerprint.
pnpm --filter @solidjs/signals fuzz --replay /tmp/solid-fuzz-run-1/case-17-min.json --shrink --shrink-mode focused --budget 500 --out /tmp/solid-fuzz-focused-1

# The small named regression corpus, NOT the 97-input reduction-quality fixture.
pnpm --filter @solidjs/signals fuzz --corpus --out /tmp/solid-fuzz-corpus-1
```

`case-17-min.json` is an example path: use an actual selected index from your run's
`reductions.json`. Not every retained finding gets a separate report or reduction.
`--cases` currently accepts at most 10,000 per invocation. Split longer campaigns
into separately recorded seeds/cohorts rather than removing containment limits.

Without `--out`, the CLI prints a newly created directory under the OS temporary
directory, named `solid-semantic-fuzz-<timestamp>-<seed>`. Outputs are not saved next
to the tests automatically. An explicit output directory makes follow-up easier.
Reusing a directory can overwrite evidence, including `findings.jsonl`.
On Windows, replace `/tmp/...` with an appropriate local path.

The CLI bundles the current source into a temporary worker, runs the campaign,
then removes its temporary build. **The worker used by an ordinary invocation is
not a persistent artifact.** If you need one for programmatic comparisons or the
quality tool, build it separately as described below.

### Reading exit codes and results

- Exit **0**: successful run under its selected mode. Fault calibration succeeds
  when the deliberately introduced fault was detected, not when all cases pass.
- Exit **1**: an ordinary campaign reported a non-pass. Inspect statuses; this does
  not by itself establish a Solid regression or a broken CLI.
- Exit **2**: setup/CLI failure, including incompatible calibration anchors.

Result categories matter:

| Result         | Interpretation                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pass`         | Applicable checks passed. An explicitly waived progress finding may still be recorded.                                 |
| `fail`         | A semantic assertion produced a candidate counterexample. Verify the oracle and scope.                                 |
| `policy`       | A waiting behavior exceeded modeled requirements but recovered; this is not a demonstrated permanent hang.             |
| `inapplicable` | An equivalence comparison's preconditions do not hold.                                                                 |
| `invalid`      | Bad scenario or an exact recorded request no longer exists in this execution. Not a fix or a bug.                      |
| `limit`        | Resource/watchdog budget exhausted; inconclusive. Could warrant investigation, but not automatic liveness attribution. |
| `error`        | Unexpected runtime/harness exception; preserve it and diagnose separately.                                             |

Worker failure while idle is attributed to the previous case and saved as
`worker-error.json`; it must not contaminate the next case. Failing workers are
retired. `--fresh` uses a new worker for every case; it is useful for checking a
suspected isolation problem but is slower than ordinary reuse.

### Where the evidence lives

| Artifact                                  | Use                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `summary.json`                            | Target/build/rule metadata, statuses, coverage, timing and execution counts.                                  |
| `findings.jsonl`                          | Compact retained findings, including cases outside the report/reduction queue.                                |
| `case-N.json` and associated report files | Detailed examples selected for reporting; inspect directory contents rather than assuming every index exists. |
| `case-N-min.json`                         | Independently verified reduced scenario, comparison information and reduction accounting.                     |
| `reductions.json`                         | Selected original indices, reduced keys and costs. Not a root-cause classification.                           |
| `worker-error.json`                       | Previous input when a worker fails after reporting a case.                                                    |

Artifacts record Git HEAD, source/worker hashes, rule revision, seed, generator
version, Node version, compile defines, calibration fault, policy, allowances and
comparison mode. The source hash covers the built sources, so HEAD alone is not
sufficient when the worktree is dirty. A replay against changed sources warns;
that drift is expected when checking a fix, but must be recorded in conclusions.

**Canonical JSON scenarios, not seeds, are replay authority.** Seeds regenerate
inputs only for the corresponding generator. Keep paired metadata: replaying a
paired artifact requires its recorded `--equivalence`, `--latest-equivalence` or
`--optimistic-equivalence` flag. Discovery shrinking may legitimately convert a
paired finding into a standalone failure and remove that metadata.

## What to generate

Start with a small run in a relevant cohort. Expand coverage after understanding
the current failures; a large overnight campaign often produces mostly duplicates.

| Cohort                                                   | Main purpose                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ordinary`, `multi`                                      | Pure sync/async DAGs, one or several ordinary sources.                          |
| `update-groups`                                          | Same-event writes, action lifetimes, overlap and independent update completion. |
| `observation`, `mounts`                                  | Changing readers, publication anchors, owned mounting and disposal.             |
| `branches`, `branch-boundaries`                          | Conditional dependencies and changes to their required work.                    |
| `boundaries`, `nested`                                   | Retaining/resetting Loading regions and local fallback permission.              |
| `attachment`                                             | Private output preparation versus attached/portal-visible output.               |
| `reads`                                                  | Imperative ordinary/latest/pending probes within event blocks.                  |
| `latest`                                                 | An action's staged source exposed through latest and downstream derivations.    |
| `optimistic`                                             | One-parent optimistic proposals and authoritative correction.                   |
| `readiness`, `derived-readiness`, `optimistic-readiness` | Tracked pending verdicts, guarded reads and derived verdict propagation.        |

```sh
pnpm --filter @solidjs/signals fuzz --cohort branches --seed 91501 --cases 150 --shrink --out /tmp/solid-fuzz-branches-1
pnpm --filter @solidjs/signals fuzz --cohort attachment --seed 91505 --cases 150 --out /tmp/solid-fuzz-attachment-1
pnpm --filter @solidjs/signals fuzz --equivalence --seed 3289 --cases 150 --shrink --out /tmp/solid-fuzz-delivery-1
pnpm --filter @solidjs/signals fuzz --latest-equivalence --cohort latest --seed 3289 --cases 150 --out /tmp/solid-fuzz-latest-1
pnpm --filter @solidjs/signals fuzz --optimistic-equivalence --seed 3289 --cases 150 --out /tmp/solid-fuzz-optimistic-1
```

The three equivalence modes compare restricted executions, not arbitrary programs:
sync versus async data delivery; early versus lazy latest creation without new
work/observation; and an optimistic proposal versus an ordinary update while its
parent remains held. Read the preconditions in `equivalence.ts`. An unsupported
comparison should be inapplicable, not forced into a false equivalence.

## The scenario language and its execution

Read [scenario.ts](scenario.ts) before editing a saved scenario. Version 2 supports
explicit source/anchor sets and more combinations; version 1 remains replayable.
The validator bounds graph size and rejects malformed references.

- Sources have stable negative IDs; `-1` is the ordinary source. `-2` can be an
  independent source, or the optimistic/latest channel when that model is enabled.
- Memos have nonnegative IDs and earlier dependencies. Their pure answer is a
  small integer affine computation over captured inputs. A branch selects which
  dependency list contributes; the selector participates in request identity.
- `sync` returns directly. `promise` returns an already-resolved promise.
  `manual` waits on a recorded resolver. `await` adds a native async continuation
  around a controlled answer. These distinctions affect scheduling.
- Readers declare refs and publish through real `createRenderEffect` callbacks.
  Optional gates, owner mounts, boundaries, pending probes and host-output regions
  alter observation. They are not decorative test options.
- `anchors` and `anchorShow` explicitly create publication observers. Removing one
  changes the program. A missing anchor does not authorize reading a hidden getter
  and pretending it is published state.
- A turn's `steps` are one uninterrupted synchronous event block. Separate turns
  have a native drain between them. Queued callbacks can use microtasks, promise
  continuations, async continuations or host tasks. Task operations and cancellation
  are recorded rather than inferred from elapsed wall time.
- `start-action`/`resume-action` advance actual action generators through controlled
  yield gates. Action-body gates and async memo requests have different ownership.

This is a small example, suitable for saving as JSON and passing to `--replay`:

```json
{
  "version": 2,
  "sources": [-1],
  "anchors": [-1],
  "show": true,
  "nodes": [{ "id": 0, "deps": [-1], "factor": 1, "offset": 0, "delivery": "manual" }],
  "readers": [{ "id": 0, "refs": [0], "gated": false, "boundary": "none" }],
  "turns": [
    { "steps": [{ "op": "write", "source": -1, "value": 1 }] },
    { "steps": [{ "op": "resolve", "node": 0, "which": "newest" }] }
  ]
}
```

It constructs roughly a signal, a delayed identity memo and a visible reader;
sets the source, lets Solid process that event, then resolves the latest request.
The runner also initializes and performs a completion suffix. Generated resolution
selection becomes an exact key in canonical artifacts, e.g. memo + captured inputs

- occurrence. Once strict replay records that key, do not silently substitute a
  new request merely because the graph changed. An invalid replay needs explanation.

### Native scheduling is part of the test

We do not replace JavaScript's promise/microtask scheduler. `HostTasks` uses
`MessageChannel` to deliver real host tasks and establish drain barriers. The
continuation of one resolved promise is not proof that all chained microtasks have
run. Conversely, calling `await` after every setter would split a user event and
invalidate the batching test.

Controlled promises make long logical waits cheap. A thousand generated cases do
not each sleep for the playground's one-second delays. The ledger records every
modeled request before Solid sees its promise, its captured answer and whether it
physically completed. Action gates and queued external callbacks are also recorded.
No asynchronous work in the language should escape that accounting.

The worker's wall-clock timeout (default 5 seconds per case) is containment for a
stuck synchronous loop, microtask loop or other failure to return. Graph/work/trace
budgets also bound cases. Neither kind of limit is an assertion that an application
request took too many milliseconds. General timer deadlines, equal-deadline races,
intervals and arbitrary application timer code are not modeled yet.

`flush` is an explicit operation the generator can request. Ordinary event steps do
not inject an implicit flush between writes; setup and teardown explicitly flush.
Do not confuse an immediate-after-flush sample with a sample after a native drain.
That distinction affected a real candidate during this handoff (C09 below).

### Completion, residual work, and “orphaned memos”

An async memo still running is not inherently a bug. It may be unobserved, or a
visible Loading fallback may correctly permit its parent update to publish.
The useful question is whether work required by a visible answer has become
unaccounted for, or whether obsolete completion can later corrupt the visible view.

The completion suffix stops external stimuli, drains generated callbacks, resolves
work required by current desired reader paths, then resolves residual requests
individually. It checks intermediate frames as well as final convergence. This
lets the fuzzer distinguish “still waiting unnecessarily” from “never reaches the
answer even when everything finishes” and “a late completion tears a settled view.”

Requirements are independently calculated from the declared graph, desired inputs
and reader state. A missed runtime read cannot erase the model's obligation to
show the requested content. Fallback permission belongs to the actual enclosing
boundary and witnessed waiting interval; it is not a global waiver for all async
work. Request registration hooks are diagnostics, not the authority for readiness.

The model is intentionally incomplete. Some overlap/branch/lifetime scenarios do
not provide enough independent evidence to require a particular earliest commit.
Keep that uncertainty local; final consistency and final completion can still be
checked. A later successful recovery must not erase an earlier torn frame.

## Semantic intent and current rules

The original optimistic-lane prototype was abandoned in favor of finding
counterexamples in upstream. Its broad direction remains useful: consistent
publication across ordinary and optimistic updates, actual observation determining
blocking, and parent work not waiting for obsolete optimistic work just to discard
it. Not every part of that ideal model is an accepted upstream contract or a
currently executable invariant.

Use `ruleContracts` in [rules.ts](rules.ts) for authority, scope and evidence. The
following is a map, not permission to apply each rule outside that scope:

| Rules      | Intended guarantee                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| S1, S2     | Published derivations agree with witnessed published inputs; visible/hidden content agrees with published controls.                    |
| A1         | An attached region keeps its output contribution until a replacement or explicit removal; detached preparation is not already visible. |
| S3         | Scoped write completion must not precede the publication it claims is complete.                                                        |
| S4, S5     | Residual work cannot corrupt a settled view; disposed reader generations cannot publish again.                                         |
| L1         | Finite generated work, including residual work, eventually reaches the final pure view.                                                |
| G1, G2     | Proven update groups publish atomically and conservative blockers bound independently provable progress.                               |
| P1, W1     | Require ordinary release where the model can prove it; keep uncertain timing separately reviewable.                                    |
| R1         | Ordinary imperative reads agree with an actual publication witness.                                                                    |
| R2, R3, R4 | Guarded ready reads, the context-free pending exception, and held-answer verdicts within their distinct scopes.                        |
| O1, O2     | Experimental optimistic publication and correction expectations under one parent.                                                      |
| E3, E4, E5 | Restricted data-delivery, lazy-latest and ordinary/optimistic equivalences.                                                            |

### Publication, batching and entanglement

Signals and derived values are stateful. Do not propose speculative reruns of the
whole graph as a harmless repair; `prev`, manually overridden derived state and
user callbacks can make reruns observable. Stateful `prev` is not currently modeled.

One update is a unit of atomic publication. Independent updates need not commit
together just because an effect reads both. Derivations can require entanglement
because Solid maintains a shared graph: they compute from the newest incoming
information, and overlapping work can prevent either update completing on its own.
Do not make every historical shared memo edge a permanent entanglement rule.

The current group model tracks definite relationships separately from possible
joins that only extend conservative completion deadlines. Same-source overlap,
action lifetime and writes in the same external event are important. Our working
batching compromise requires batching for writes in the same modeled synchronous
microtask/event block, permits it for adjacent microtasks ahead of a flush, and
does not arbitrarily require independent internal completions to merge. Broader
React comparisons motivated discussion but are not an oracle for Solid.

A running action is unfinished authoritative work: it may refresh more state later.
Its initial ordinary writes cannot reveal merely because current derivations are
ready. Optimistic publication has independent commit timing; the parent owns when
it is reverted. Deferred state has a different relationship and must not silently
inherit optimistic rules. The modeled optimistic scope remains one parent.

### Optimism, correction and latest

The desired direction is to attempt authoritative correction as soon as the
parent's own work permits it, without first waiting for an obsolete optimistic
request. The correction can itself discover observed async work and wait for it.
How new overrides interact with an already-progressing correction is not broadly
settled by this fuzzer; do not invent multi-parent/forked-graph semantics to extend
coverage. O1/O2 and parts of the stronger correction contract are explicitly marked
experimental in the evidence catalog.

All `latest` reads of the same upstream owner share its companion. Creating
separate upstream memos can create distinct owners. We did not attempt to change
that ownership choice. Lazy companion creation should not change observations in
the allocation-only situations covered by E4, but warming can itself start work;
such a case is not a free initialization-only equivalence.

The untracked latest contract was disputed during the prototype. A provisional
`readStaged` separation was explored there, but it is **not an API added by this
branch**. #3337 separately explores writes becoming visible at flush. Do not treat
context-free latest reads as ordinary committed-state reads just because that
would make a nicer model. R1 excludes getters/derivations that may read latest;
paired allocation-only E4 and tracked publication checks remain useful.

### Readiness is contextual

A tracked `isPending` reader matters to observation; it is not a passive diagnostic.
R2 checks explicit user-style reads when a rendered control says ready. R4 covers
an initialized, continuously observed ordinary answer held away from a distinct
desired answer with enough source witnesses. These are narrower than “false always
means any getter anywhere is ready and current.”

Context-free `isPending` has an intentional upstream exception: it is nonthrowing,
and initial uninitialized data can produce false (SPEC A16/A19 in the investigated
revision). `untrack` alone does not necessarily remove the surrounding reactive
context. Check `pending-contract.test.ts` before changing these distinctions.
Equal-answer motion is also not automatically a pending-verdict violation.

We repeatedly found that adding a diagnostic `isPending`, `latest` or data reader
changed the bug. Preserve the original reader set, and treat an added observer as
a separate control rather than invisible instrumentation.

### Private computation versus visible output

Render-effect compute work may run before attachment. Creating a detached DOM
subtree and preparing its text can be unobservable while the parent's commit is
held. Requiring every private write to be atomically ordered would report compiler
optimizations as bugs. Conversely, a portal/external target is already visible;
calling that work “mounting” does not make a leaked write private.

`output.ts` models host attachment independently of reactive ownership. The
attachment cohort constructs compiler-like parent/child shapes with local and
portal targets, including scheduled effects. A1/S1/S2 check visible contributions,
not every internal callback. Root disposal/mount generation identity also matters.
This is a limited abstract host, not a claim to model every DOM/hydration behavior.
#3404 helped calibrate it; that particular bug is not its definition of correctness.

### Narrow allowances and rule changes

Default waiting policy is `review`; no historical allowance is enabled by default.
`--waiting-policy required-only|retain-disposed` explores alternate waiting policies.
`--allow legacy-disposal-wait` is a narrow historical exception, not a switch to
turn off final-state or all progress checks. A waived finding is still retained.

If the maintainer decides a delayed release is acceptable, encode the smallest
applicability predicate justified by that ruling, with a matching permitted case
and a nearby case that must still fail. Keep the ideal expectation and rationale
visible. Do not downgrade a permanent hang to a policy question because a related
late-but-eventually-correct example was accepted.

Before altering semantics: show a concrete small scenario, identify which prior
rule/test would change, and ask if ambiguous. A counterexample showing that the
proposed model is contradictory is a valuable outcome. Changes to executable laws
or completion policy need a `ruleRevision` bump and corresponding evidence/tests.
Generator/reducer improvements should not quietly change the oracle.

## Testing a different branch or commit

There is deliberately no new multi-revision command in this handoff. The CLI tests
the source it imports from its checkout; it has **no `--ref` or `--runtime-dir` flag**.
Create a small helper if needed. Two approaches have been useful:

1. Put the fuzzer on a disposable checkout of the target. Copy/cherry-pick only the
   tooling, install its development dependency if absent, and run from that root.
   Preserve local work and verify that no runtime fix accidentally came along.
2. Keep the fuzzer fixed and bundle it against an isolated target source archive.
   We used this extensively to replay the same oracle against latest `next` and
   pending PRs without repeatedly rebasing the tool.

For the second approach, resolve the target to a full SHA and archive its
`packages/signals/src`. Use an esbuild resolver to redirect **every** signals source
import from the fuzzer to that archive, resolving relative paths before matching.
Keep imports within the target archive there. Fail the build if an old checkout's
signals source leaks in. Do not mix two Solid module instances or redirect only
`index.ts` while attribution imports still reach the old runtime. The current calibration matcher in `build-paths.mjs` expects `src/core/`.
Older flat layouts need an explicit adapter; do not assume a file-name match alone
proves the intended source was redirected or mutated.

Bundle `worker.ts` with the normal `__DEV__`, `__OBSERVE__`, `__TEST__` defines all
true. Bundle `Client` and any needed generation/reduction functions from the
unchanged harness. Record target SHA, actual imported source paths, worker hash,
rule revision and options in the helper's report. Standard CLI metadata's Git HEAD
belongs to the process checkout; do not present it as a redirected target's SHA.

The attribution hook API is a real compatibility dependency. Source layout or
hook changes can require a small adapter; that is a harness compatibility task,
not automatically a semantic failure. If a target cannot run, say so. Calibration
uses exact source-text anchors and should fail loudly when a targeted implementation
changed; never pretend an unapplied fault established checker sensitivity.

For a persistent worker against **this checkout**, for example:

```sh
mkdir -p /tmp/solid-fuzz-worker
pnpm --filter @solidjs/signals exec esbuild tests/semantics/worker.ts --bundle --platform=node --format=esm --target=node22 --define:__DEV__=true --define:__OBSERVE__=true --define:__TEST__=true --outfile=/tmp/solid-fuzz-worker/worker.mjs
node packages/signals/tests/semantics/quality.mjs --worker /tmp/solid-fuzz-worker/worker.mjs --inputs original --ids C19,C24,C34,C46,C53 --budget 150 --out /tmp/solid-fuzz-worker/quality.json
```

This plain worker build is not the CLI's calibration builder and its hash need not
match a historical worker. `quality.mjs` labels unmatched hashes as a custom target.
Use a new Client/worker instance to independently verify a final witness. Do not
carry a cached “pass” across target, rule, policy, compile-define or scenario changes.

When comparing PRs, check their **bases as well as heads**. A repro passing on an
older PR does not prove the PR fixes it. We encountered exactly this with #3442:
the reduced JSX passed on #3337 and on #3337's base, but failed on newer `next`.
That is evidence of a later difference, not attribution to the pending change.

## Saved cases and the current issue queue

The compact, repository-owned reduction fixture is [quality/corpus.json](quality/corpus.json).
It contains **97 audited inputs**, previous reductions, **1,720 memberships**, eight
known useful reduction routes and fixed holdout seeds. `corpus.ts` is a different,
small named regression set used by `--corpus`. Do not confuse the two.

To replay a quality fixture through the ordinary CLI, extract its scenario first:

```sh
node --input-type=module -e 'import fs from "node:fs"; const m=JSON.parse(fs.readFileSync("packages/signals/tests/semantics/quality/corpus.json","utf8")); const c=m.cases.find(c=>c.id==="C53"); fs.writeFileSync("/tmp/solid-fuzz-C53.json",JSON.stringify(c.input,null,2));'
pnpm --filter @solidjs/signals fuzz --replay /tmp/solid-fuzz-C53.json --fresh --out /tmp/solid-fuzz-C53-replay
```

Use `.reduced` for the previous minimum. For a fixture with `comparison`, preserve
the corresponding comparison mode; the raw extraction above is suitable for C53,
which is standalone. A raw scenario has no historical metadata: retain provenance
in your comparison report. The fixture's old signature is not a required failure
on a repaired current runtime.

### Recent manually verified examples (2026-09-15 snapshot)

The TSX files below are **standalone playground sources**, not automated test files
or generated interpreter output. Paste one into a Solid 2 playground or compile it
against the desired target. They deliberately include their own `render` call.
The manual translation can differ structurally from the fixture; each version was
verified independently. IDs link evidence, not exact program equivalence.

| Fixture         | Playground                                                    | Issue and disposition at handoff                                                                                                                         |
| --------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C46             | [Held conditional JSX](handoff/held-conditional-view.tsx)     | [#3438](https://github.com/solidjs/solid/issues/3438), fixed by merged [#3439](https://github.com/solidjs/solid/pull/3439). Keep as a passing control.   |
| C19 / C30 / C35 | [Combined pending probe](handoff/combined-pending.tsx)        | [#3442](https://github.com/solidjs/solid/issues/3442). [#3445](https://github.com/solidjs/solid/pull/3445) opened during handoff; not yet verified here. |
| C34 / C68       | [Memoized sum](handoff/stale-sum.tsx)                         | [#3443](https://github.com/solidjs/solid/issues/3443), open at snapshot.                                                                                 |
| C24             | [Latest inside held Show](handoff/latest-held-show.tsx)       | [#3444](https://github.com/solidjs/solid/issues/3444), still reproduced after #3439 merged.                                                              |
| C53             | [Cancelled async branch](handoff/cancelled-branch-hidden.tsx) | Draft candidate, not filed at handoff; related to [#3371](https://github.com/solidjs/solid/pull/3371).                                                   |
| C02 / C31 / C38 | Extract fixture                                               | Hidden last reader delays source release until its request finishes. Treat as a progress/ruling question, not proven permanent corruption.               |

Specific lessons from this batch:

- **C46:** `show() ? count() : "hidden"` froze while `count` published and `show`
  still displayed true. The memo-wrapped variant was already fixed by #3431;
  #3439 fixed the effect variant. A compiler may memoize only the condition,
  not the whole ternary. Inspect emitted code when this distinction matters.
- **C19:** adding a combined pending probe made sibling data publish partially.
  Removing the synchronous copy of the slow result, making fast synchronous,
  probing only one result, or removing the probe avoided it. Adding a raw-slow
  pending indicator changed the bug. The final JSX displays data directly;
  older variants used imperative reads and had different branch results.
- **C34:** two separate source writes, overlapping async identities and a shared
  sum could show A=1, B=0, Sum=0. Plain getter sum remained consistent; same-event
  writes avoided it. No readiness probes or optimistic state were needed.
- **C24:** one authoritative source can drive Show's condition while both children
  read its latest companion. Outside showed 1 while the still-visible inside
  paragraph stayed 0. A JSX ternary instead of Show worked. Do not merge this into
  C46 solely because both involve held removal; it survived C46's actual fix.
- **C53:** opening a gated reader, entering an async conditional branch, then
  returning to its previously established answer left the panel hidden after all
  requests completed. Removing `async` from the conditional, removing its branch,
  collapsing to one async memo, or changing the final answer to a new value avoided
  it. Replacing the gate with Show produced a blank value rather than literal
  `hidden`; that is another manifestation, not a semantic pass.
- **C09:** an immediate-after-`flush()` pending snapshot was false, but substituting
  a long request and sampling after a native drain produced true. Do not present
  this as a sustained false readiness indicator without resolving that distinction.

The earlier big replay used #3431 `dee461be` on `next` `25c5064b`: all 79,500 old
generated cases yielded 1,001 semantic failures and 312 policy findings, compared
with 1,627 and 93 in the historical run. Runtime and harness both differed from
the old campaign, so the difference alone is not a regression attribution.
Combining retained failures gave 1,035 exact inputs and 92 reduced repro keys;
47 passed separate #3337, 44 failed, one was invalid. These are **not 44 bugs**,
not current counts after later fixes, and not evidence of a combined PR merge.

Seven audited originals (C19, C30, C43, C45, C56, C73, C93) still failed on that
runtime even though their earlier minima passed. Conversely, C14's old minimum
failed while its original passed. This is why originals and reductions both stay.

The full 79,500-case run, bundled old generator/workers and bulky traces were local
investigation artifacts and are **not included**. Some historical documents name
personal paths to them; those are provenance, not prerequisites. Do not claim you
replayed that exact campaign unless those artifacts are actually available. The
97-input fixture and the five playgrounds above are the portable starting point.

Other retained leads include C10/C25/C42/C69/C74 (new or returning observers), C63
(conditional held-input recovery), and readiness variants C43/C82/C93. Compare them
with current fixes and the listed issues before filing; the remaining corpus was
not exhaustively mapped to independent root causes. The current human priority is
sharing this tool so it can be used while fixing issues, rather than filing every
remaining candidate first.

## Manual triage and playground reduction

Automatic output is a starting point. Identify the first violated observable claim
and ask whether the model has enough witnesses to justify it. Read `frames`,
`requirements`, `work`, `events`, requested/published paths and diagnostic fields.
Distinguish desired values, committed values and speculative computation. A final
matching answer does not absolve an earlier visible mismatch.

For a candidate worth reporting:

1. Replay its canonical input on the actual current target, preferably fresh.
2. Reduce with the default budget; increase locally only when a useful simplification
   seems close. If a rewrite changes which bug is found, retain both inputs.
3. Translate it to a tiny core reproduction with controlled resolvers. This checks
   behavior without the fuzzer's oracle, completion probes or attribution hooks.
4. Try removing sources, memo hops, observers, branches, boundaries, action steps,
   async delivery, and scheduling gaps. Change one causal feature at a time and
   keep controls. If a seemingly simpler translation fixes it, inspect why.
5. Write a small TSX playground with one button, inline component state and obvious
   top-to-bottom data flow. Prefer `async`/`await` where it preserves the behavior;
   actions require generator or async-generator functions in this API.
6. Verify the **exact final code**, ideally with compiled JSX and a real click.
   Check development and production when relevant. Do not claim browser testing
   when you used jsdom, or reuse a result from an earlier non-equivalent reduction.
7. Check issue history and PR heads. Draft a terse report with reproduction steps,
   observed/expected behavior, target SHA and meaningful controls. Leave posting
   to the user unless explicitly authorized.

Use delays around 500ms–1000ms for readable progression. Let initial values settle
rather than adding `if (value === 0)` timing shortcuts unless that condition is
actually the bug. A shared helper is fine:

```ts
const delay = <T = void>(ms: number, value?: T) => new Promise<T>(r => setTimeout(r, ms, value));
```

For a single delay, inline `await new Promise<void>(r => setTimeout(r, 500))` is fine.
Avoid generic run/mode controllers, IIFEs without a behavioral reason, imperative
`render` calls in click handlers and extra disabled-button state. A disabled button
is appropriate when the readiness contract itself is the subject. Prefer showing
comparisons together when useful, but avoid plumbing that obscures the graph.

Preserve important distinctions during reduction:

- A getter, memo, effect compute and effect run have different tracking/commit roles.
- Separate JSX expressions are separate readers; a template string combines reads.
- Show, inline ternary and manually nested render effects need not create the same
  ownership graph. Replacing one is an experimental control, not guaranteed cleanup.
- An async function can turn a synchronous NotReady throw into a rejected promise.
  `Promise.resolve(read())` evaluates `read` synchronously; `async () => read()` does
  not have identical suspension timing. Test the actual simplification.
- An extra displayed source/pending flag is an observer and can create a hold.
- Changing 0→1→0 to 0→1→2 removes equality recovery; do not do it for aesthetics.
- Two adjacent microtasks are not necessarily one event, and `await` is not `flush`.
- A late correct result is a progress question; a wrong stable view after all work
  settles is a correctness/liveness failure, not merely a missed optimization.

### How we verified JSX without relying on a browser tool

We used an isolated source archive with signals, solid and web source, including
web's server-functions support needed by its exports. Babel's Solid plugin plus
the TypeScript preset compiled the TSX; esbuild bundled the target's `solid-js`,
`@solidjs/signals` and `@solidjs/web` source aliases. jsdom supplied document/window,
DOM constructors and MutationObserver. A native button click started the example;
real timers separated observations of paragraph text.

For development/production, mirror the package's build replacements. In particular
web's string tokens **`"_SOLID_DEV_"` and `"_SOLID_OBSERVE_"`** must both be replaced,
in addition to signals' `__DEV__`, `__OBSERVE__`, `__TEST__` defines. We once forgot
the observe token in a production helper; event dispatch accessed nonexistent
attribution and the click never ran. That was a helper error, not a Solid finding.
Record errors and assert the expected intermediate/final states rather than only
printing snapshots. Root-mount diagnostics about no Loading can be expected in
these minimal examples; a runtime exception is a different matter.

These verification helpers are not a supported bundled framework. The AI can
recreate them when useful. Use the current JSX compiler/build setup and inspect
its output if ownership differs. Keep the core campaign free of DOM compilation.

## Improving rules, generation and shrinking

### Find the right layer first

| Files                                                                | Responsibility                                                                        |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `scenario.ts`, `model.ts`                                            | Replay language, pure numeric answers and references.                                 |
| `generate.ts`                                                        | Cohorts and supported structural/scheduling combinations.                             |
| `runner.ts`                                                          | Real graph construction, operation execution, publication/work ledger and completion. |
| `host.ts`, `client.ts`, `worker.ts`                                  | Native tasks, isolation, containment and transport.                                   |
| `rules.ts`, `groups.ts`, `progress.ts`, `footprints.ts`, `policy.ts` | Observable assertions, scoped requirements and explicit waiting policies.             |
| `output.ts`, `tree.ts`                                               | Visible attachment/region model and nested host output.                               |
| `admission.ts`, `search.ts`, `shrink.ts`, `equivalence.ts`           | Acceptance predicates, shared search and ordinary/paired adapters.                    |
| `candidates.ts`, `reduce.ts`, `order.ts`, `normalize.ts`             | Concrete graph/schedule rewrites and ordering.                                        |
| `selection.ts`, `complexity.ts`, `cli.ts`, `cli.mjs`                 | Report queue, costs, artifacts, build and execution entry points.                     |
| `quality.mjs`, `quality-experiments.mjs`, `quality/`                 | Retained reduction evidence and optional comparisons.                                 |

A finding may reveal a runner bug, a pure-model error, a law's excessive scope,
missing generation coverage, ineffective shrinking, or Solid behavior. Determine
which before patching. Do not make the pure model depend on Solid's internal lane
IDs or flags merely to match the current implementation. Internal hooks can help
explain a result without deciding whether it is legal.

For a new rule, write a behavioral statement, applicability predicate, observable
witness and authority/rationale. Add a passing near-neighbor and a deliberately
wrong case it detects. State unsupported combinations. For a new generator shape,
keep synchronous event execution uninterrupted, request identity exact, and every
new external operation/work source in the ledger. Stores, stateful `prev`, streams,
general timers, multi-parent optimistic lifetimes and full DOM semantics remain
future work requiring their own contracts.

### What the shrinker does and does not promise

All findings stay in the JSONL. The first 20 symptoms get detailed reports. With
`--shrink`, a bounded candidate queue selects up to eight cases, allowing up to two
structural shapes per symptom when space permits and preferring simpler candidates.
Distinct symptoms take priority over extra shapes. This bounds attention and cost;
it is not root-cause deduplication. Replay/calibration reduces explicit selections.

Default discovery mode accepts any independently demonstrated semantic failure,
including a different one uncovered while reducing. Focused mode preserves the
fingerprint. Invalid, inapplicable, waived, policy-only, error or limit outcomes
cannot replace a semantic failure. Policy/diagnostic inputs retain narrower
predicates. Paired discovery can hand off to an independently failing single side.

The shared search runs productive passes, then revisits earlier passes on another
sweep. Cheap deletion/normalization precedes bounded structural cuts and delivery
escapes. Every behavioral rewrite is replay-tested. Representation normalization
must not quietly reorder dependency reads, declarations or events that affect
semantics. “These graphs look alike” is not proof that creation order is irrelevant.

`--budget 150` counts actual search interpreter executions per chosen candidate.
A paired trial costs multiple executions; its controls count too. Initial replay
and mandatory fresh final verification are separate reported costs. Candidate
enumeration has its own bound. A budget-limited witness is not globally minimal.
The last independently valid result is retained when the budget runs out.

A fuzzer does not need to sort all failures into a perfect handful of root causes
before it is useful. Once you have one small actionable report, fixing it and
rerunning the originals/fresh generator often removes many variants more cheaply
than exhaustive clustering. Keep unresolved cases; don't discard them based on a
shared symptom or because they reduced to another known issue.

### Lessons from the reduction experiments

We spent substantial effort on apparent duplicate minima. Some work was useful;
a lot of increasingly elaborate escape searches had poor marginal returns. The
retained implementation has evidence, but is not a claim of optimal shrinking.

- Cheap deletion, pruning, consistent substitutions and exact request renaming are
  fundamental even when each doesn't eliminate a unique duplicate by itself.
- Structural cuts can remove machinery that isolated field deletion cannot: a
  source plus offsets, a mount plus dependent operations, a memo hop plus related
  reads. Admit the completed program through replay; do not demand intermediate
  partial rewrites preserve the failure.
- Keep expensive rewrites bounded and justify them with a useful witness that the
  cheaper passes fail to reach. A test that only proves a candidate was emitted
  does not establish value.
- Persistent sweeps reduced restart waste. A universal new monotonic rank was
  tested and rejected because it lost useful convergence; don't assume an old plan
  asking for it describes today's implementation.
- Generic request retargeting, broad passing-state/full-shrink pivots and repeated
  alternate full pass orders were expensive for little benefit. Don't reintroduce
  them based on names alone.
- CDD and native fast-check shrinking were evaluated, not adopted as defaults.
  Optional experiments remain available. This doesn't mean prior art is useless;
  it means this graph/request/observation language needs evidence for adaptation.
- Performance preference: small integers, predictable records, straightforward
  loops and few unnecessary copies. Avoid repeated filter/map/spread chains in hot
  paths. Do not add pooling, complex caches or a new framework without a measured
  hotspot and a demonstrated win.

See [EVIDENCE.md](EVIDENCE.md) for the family inventory and measured limits. The
historical 97-case fixture was heavily reused; evaluate new ideas on fresh seeds
and the fixed holdout too. Compare equal execution budgets with the same oracle
and runtime. Separate generation, execution/checking, reduction and serialization
costs; concurrent runs are not clean throughput comparisons.

### Calibration and quality checks

```sh
# Ordinary controls, then deliberately remove an expected wake in a disposable bundle.
pnpm --filter @solidjs/signals fuzz --calibrate --out /tmp/solid-fuzz-calibration-clean
pnpm --filter @solidjs/signals fuzz --calibrate --fault drop-wake --out /tmp/solid-fuzz-calibration-fault

# These require a separately built worker (see above).
node packages/signals/tests/semantics/quality.mjs --worker /tmp/solid-fuzz-worker/worker.mjs --inputs reduced --budget 150 --out /tmp/solid-fuzz-quality-current.json
node packages/signals/tests/semantics/quality.mjs --worker /tmp/solid-fuzz-worker/worker.mjs --inputs reduced --disable cuts --budget 150 --out /tmp/solid-fuzz-quality-without-cuts.json
node packages/signals/tests/semantics/quality-experiments.mjs --worker /tmp/solid-fuzz-worker/worker.mjs --experiment native --out /tmp/solid-fuzz-quality-native.json
node packages/signals/tests/semantics/quality-experiments.mjs --worker /tmp/solid-fuzz-worker/worker.mjs --experiment chunks --out /tmp/solid-fuzz-quality-chunks.json
```

`quality.mjs` supports `--ids`, `--baseline` (a bundled earlier reducer), `--schedule
restart|sweep`, and `--check`. The latter asserts historical quality routes only
with the pinned historical worker hash and selected route coverage. Do not use it
to demand that fixed upstream bugs keep failing. Historical `quality/results.json`
is evidence from its recorded target, not an up-to-date current-runtime score.

A successful fault calibration establishes sensitivity to the seeded fault in its
scope. It does not prove every upstream finding is a bug, or that all laws have
independent mutation coverage. `EVIDENCE.md` distinguishes those claims. Anchors can
drift when upstream internals change; diagnose and update the mutation deliberately.

## What to leave for the next session

Keep a small durable note alongside campaign outputs with target SHAs, commands,
artifact paths, rule revision, candidate-to-issue mappings, confirmed controls and
remaining questions. Include whether verification was core-only, compiled JSX in
jsdom or a real browser. Record why a candidate was grouped, deferred or rejected.
Don't make the next AI reconstruct those decisions from thousands of tool messages.

Do not promise perfect coverage, global minima, a unique issue count, or a formal
proof that orphaned work is impossible. The practical objective is a trustworthy,
explainable counterexample loop that helps the maintainer improve Solid and helps
us improve the semantic model. This iteration can remain experimental while being
useful for that work.

## Handoff validation (2026-09-15)

On the rebased source based on `next` `63560a11`:

- Frozen-lockfile installation succeeded.
- All 327 semantic harness tests passed; `fuzz:types` passed.
- The README's small JSON scenario replayed successfully in a fresh worker.
- A 1,000-case ordinary campaign (`--seed 3289 --shrink`) completed with 966 passes,
  22 semantic candidates and 12 policy findings; four candidates were reduced.
  No worker errors, invalid cases or limits were reported. This is an execution
  check, not a claim of 22 new bugs or a clean runtime.
- `--calibrate --fault drop-wake` detected the injected fault successfully.
- The documented persistent-worker build and selected-original quality command
  ran successfully; C46 passed and the other four selected inputs still failed.
- The saved C53 original reproduced in a fresh CLI replay.

These checks validate this handoff's operating path. They are not a full new
79,500-case campaign or verification of the still-open #3445 fix. Temporary run
outputs are not part of the shareable repository; rerun the documented commands
for current evidence rather than relying on this snapshot.
