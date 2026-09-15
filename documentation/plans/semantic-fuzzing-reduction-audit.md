# Implementation plan: get to the next actionable issue

The current implementation plan is [semantic-fuzzing-cleanup.md](semantic-fuzzing-cleanup.md).
The decisions and measurements below are retained as historical evidence.

Status: A, the bounded B transformations, and E are implemented and verified
(2026-09-14). C now includes implemented branch, delivery, observation and multi-proposal
experiments described below; other C opportunities and D remain deferred. This revision replaces the earlier plan that prioritized
preserving each original failure identity during reduction. Solid runtime semantics
and the fuzzer's rule definitions remain unchanged.

## Goal and working loop

Help the user find, understand, and fix **one real issue at a time**. A smaller
representative count, exhaustive root-cause classification, and preserving every
variation as a separate triage item are not objectives in themselves.

1. Run the fuzzer against the selected runtime and retain its generated failures.
2. Reduce a promising case aggressively toward a simple, valid semantic failure.
   It may expose a different bug from the original. That is useful, not a reason
   to reject the reduction.
3. Independently replay the result, check the rule's applicability, and manually
   translate/reduce it into a clear example. Present one actionable issue.
4. When a fix is available, replay the saved corpus against it and run fresh
   fuzzing. Use surviving or newly generated failures to select the next issue.

Saved originals provide cheap deterministic regression coverage; fresh fuzzing
provides new combinations. Neither requires an exhaustive classification before
reporting the first issue. Never claim that fixing a reduced example fixes every
original that reached it. Nothing in this plan automatically posts reports.

The 97-case audit remains useful evidence, not a target number to optimize:
`../solid-effect-publication-evidence/semantic-fuzzing/all-97-audit-2026-09-14/`.
Keep all 1,720 original memberships. The audit's previous warnings about losing
failure identity now identify possible bug changes, not automatic rejection rules.

## What changes from the previous plan

- Default discovery reduction may change the rule, diagnostic, source kind,
  lifecycle phase, observation shape, or failing value, provided the candidate
  independently constitutes a valid failure under an enabled semantic rule.
- Do not build structured witness matching, projection proofs, diagnostic alias
  registries, or default multi-runtime preservation checks.
- Preserve originals and the final reduced result with their actual diagnostics.
  No exhaustive bug-equivalence graph or full rewrite history is required.
- Keep strict, focused reduction available through the existing fingerprint/control
  mechanism when the user explicitly asks to minimize a particular issue or
  comparison. It is not the default discovery bottleneck.
- A reduction that becomes a clean pass is still rejected. A malformed scenario,
  unsupported oracle scope, harness error, timeout, or exhausted budget is not a
  substitute for a semantic bug. Policy/allowance-only findings remain separate.
- Prioritize removing distracting graph/schedule complexity over maximizing merges.
  Delay speculative grammar and state-history machinery until there is a specific
  useful repro it would simplify.

## A. Implement simple discovery acceptance first

Files: `shrink.ts`, `equivalence.ts`, and CLI replay/artifact handling.

- Add an explicit discovery acceptance mode and use it for ordinary bug discovery.
  Reuse the existing exact-fingerprint behavior for focused reduction.
- Centralize the small acceptance predicate. In discovery mode, require a valid,
  supported execution with an actual admitted semantic violation; it need not
  have the original fingerprint. Consult result disposition/allowances, rather
  than assuming every non-pass result is a bug.
- Do not accept a W1 review finding or a waived progress observation as a
  replacement for an actionable failure. Review-only cases may be minimized in
  their own existing workflow and must remain labeled review-only.
- Do not weaken the invariants or introduce special-case waivers to make a
  candidate fail or pass. The new candidate is checked against its own graph,
  dependencies, update history and observation obligations.
- On acceptance, update the selected result and its reported fingerprint. Final
  replay must reproduce that reduced result, not the original diagnostic.
  Audit the CLI's current fingerprint comparisons and artifact keys accordingly.
- Record the original case reference, original diagnostic, reduced scenario and
  final diagnostic. Keep original corpus entries even when several reduce to the
  same result. Report a reduction relationship, not proven shared root cause.
- Reuse the current budget and seen-set machinery. Additional confirmation only
  needs to verify the final candidate on the runtime being investigated.

Examples now allowed when they remain valid failures: C14 → C05, C17 → C20,
C18 → C16, C03 → C01, and reductions exposing a simpler optimistic lifetime
problem. C02 → C11 must not silently replace a bug report with a policy review.
C56/C83 may reduce to ordinary failures on a runtime where those failures exist;
they do not need to keep failing on every other historical PR branch.

Tests: cross-rule semantic failure accepted; clean pass, invalid, inapplicable,
policy-only, waived, worker-error and budget-limit outcomes rejected; final replay
and artifact labeling follow the reduced diagnostic. Exact mode and explicitly
requested passing controls still work. Use fabricated result records for these
unit tests so upstream fixes do not invalidate reducer correctness tests.

## B. Implement the replay-proven transformations

Keep these as ordinary candidate generators. They do not need semantic
identity metadata under discovery acceptance. Replay decides whether the simpler
program still exposes a useful violation.

### Tuple-source projection

Files: observation candidates in `reduce.ts` and tests.

Extend fixed-reader-to-anchor conversion to a flat, always-observed data reader
containing sources and derivations. Extract its source fields into publication
anchors, adding each once, and retain its remaining fields in order. Start with
unaddressed readers without nesting, boundaries, pending mode or attachment
features. One extraction per reader is sufficient initially; no subset explosion.

This changes effect structure intentionally. Positives: C26 → C22, C28 → C48,
C36 → C21, C41 → C40, C83 → C56, C92 → C76. The tested C04/C20/C74/C84
projections pass and must be rejected. No tuple-versus-anchor witness matcher.

### Optimistic/action-to-signal substitution

Files: optimistic candidates and reference helpers in `reduce.ts`.

Start with simple single-proposal scripts. Replace the proposal with an ordinary
write, remapping dependencies, branch selectors, reader refs, anchors and supported
imperative reads. Ensure no dangling references or invalid action controls remain.
Initially skip complex queued scripts and explicit request selections that cannot
be translated cheaply.

Removing action lifetime or a later authority write is permitted as an intentional
simplification if the resulting program is valid and still fails. It must not be
presented as equivalent lifecycle behavior. Similarly, a tested latest-to-explicit
optimistic substitution may be offered without asserting those APIs equivalent.

C19 → C35, C56 → C21 and C83 → C36 are useful paths. C43/C93 become passes
under the tested substitution. Other authority-driven cases need candidates that
retain or remove the later write explicitly, rather than mislabeling an accidental
omission as a faithful translation.

### Coordinated proposal/authority rewrite

Recognize no-op proposal plus immediate action completion; replace the pair with
one live proposal of the authoritative value, editing the script and values
jointly. Keep the first implementation restricted to direct, adjacent operations
with no intervening queued work. It may change the eventual lifetime: accept only
if the rewritten scenario independently fails. C10 → C13 and C30 → C19 are
positive examples; C25/C88 pass after the attempted rewrite.

### Arithmetic cone plus exact request translation

Extend `affineQuestions` and existing reference helpers instead of adding another
parser. Replace a single-source pure synchronous arithmetic cone feeding an async
memo with a simple async identity. Translate explicit resolve keys together with
the graph: owner, input tuple and occurrence. Keep each retained resolution exact
and valid for the rewritten schedule; reject ambiguous mappings or try deletion
of that operation as a separate explicit candidate. Never silently resolve an
arbitrary different request as a fallback.

Start with cones whose removed nodes have no other consumers or imperative reads.
Keep safe numeric representations. C60/C94 → C12 are positives; the C42 identity
rewrite passes. Test repeated equal inputs, occurrences, cancellation and remapped
owners. Reuse existing source merging in small coordinated cone/branch candidates;
a merge may change the type of bug, but must leave a valid modeled graph.

### Schedule rewrite that unlocks pruning

Add a small late-running candidate family alongside the existing within-callback
ordering rules. First support moving an uncanceled visibility microtask into a
new host turn immediately after its enclosing turn. Preserve unrelated steps and
queue IDs. Then rerun cheap deletion/pruning: this lets C31/C38 shed a latest read
and reach C02.

Changing batching is allowed because this is a new replayed candidate, not a
normalization equivalence. Reject malformed queue/cancel/task references. Use a
fixed representation preference and the existing seen set to prevent cycles;
charge the enabling move and subsequent reduction to the same budget. C52/C59/
C61/C77/C88/C95 are negative controls for the tested host-turn rewrite.

## C. Try inexpensive extensions after the first useful results

Each item is a bounded experiment. Land it if it materially simplifies a candidate
worth understanding, not merely because it reduces the number of groups.

| Opportunity | Implementation approach | Cases / stopping condition |
| --- | --- | --- |
| Broader diagnostic/verdict projection | With A in place, let existing reader/pending/anchor deletion candidates expose other admitted rules. Keep the final rule and disposition honest; no alias framework. | C03/C12/C19/C37/C43/C50/C56/C60/C83/C94. Do not accept a mere policy review or harness failure. |
| Source merging | Reuse the existing merge helper with a bounded accompanying branch/key rewrite. Validate the resulting source/update history. Independent sources may become one source if the new program still has a real failure. | C32/C33/C39/C49/C65/C86. Do not claim the original G2 relationship survived. |
| Legacy v1 to v2 | Encode the actual v1 source/anchor defaults in a valid v2 candidate, then run normal reduction. Keep legacy loading supported. Treat it as replay-tested until output and oracle-scope equivalence are established. | C59/C95. Stop if this requires unrelated runner-semantic changes. |
| Branch rewriting | First bypass whole branch cones, collapse repeated selectors, and simplify both arms using the existing grammar. Condition reads and async edges may change intentionally, but the independent model must describe the new graph correctly. | C16–C20/C62/C66/C78/C84/C86. A simpler C84 that only fails the selected runtime is useful; no historical multi-target requirement. |
| Alternative async delivery | From a local minimum, try one bounded delivery change and a finishing pass. Accept only a smaller or equally small preferred result that independently fails. Share budgets and avoid rewrite cycles. | C34/C68, C21/C76/C36/C92; negatives around C43/C93/C74/C96. No unbounded beam search. |
| Boundary/ownership projection | Try flat boundary-to-pending substitutions and removal of one nesting level. Rewrite reader ownership consistently and replay under the resulting graph's rules. A different genuine bug is acceptable. | C08/C23, C44/C81/C90, C54/C71/C79/C87. Do not alter visibility rules or excuse leaks using Solid owner state. |
| Mount/gate projection | Extend isolated reader conversion with coordinated initial flag, control writes and anchors. Produce a valid new observation model; hidden/absent/detached remain distinct in its oracle. | C24/C25/C27/C46/C65/C70/C72/C77. C74/C96's passing Show translations are rejected as candidates, not reasons to weaken the checks. |
| General action simplification | Try inlining synchronous actions, deleting empty segments, or jointly removing holds/resumes and keeping resulting ordinary writes. Simplifying away the original unfinished action is allowed if the new program still independently fails. | C04/C06/C80. Retain valid same-callback batching for whatever script remains; no invented async lifetime surrogate. |
| Broader timing / latest-read erasure | Try a few explicit callback-hoisting or flush/turn templates; retry existing read deletion afterward. Validate IDs and request selections and keep the search bounded. | C50/C61/C67/C68/C73/C77/C85/C88/C95. No automatic assumption that operations commute. |

A failed candidate is ordinary negative evidence, not a reason to keep a whole
family forever or to construct machinery that forces it to work.

## D. Defer machinery with uncertain return

### Grammar extensions

Do not start by adding a general expression AST. If an otherwise useful issue
remains needlessly complicated because a constant branch cannot be represented,
prototype the smallest bounded extension for that example. Update the independent
model, runner, normalization and request capture together. Land it only if the
benefit outweighs the extra language/model surface. Otherwise retain the larger
repro and move on to fixing the issue it already demonstrates.

### Initial-state and prefix reduction

First try existing prefix deletion and coordinated value changes. Do not build
reactive-history reconstruction. If several useful cases would become much clearer
with nonzero source initializers, consider a small optional initial-values array.
The resulting graph can be a different program: it does not need to recreate
original owner/prev/lane history. It does need a correctly modeled initialization
and valid suffix operations/request keys. A real failure in that new program is
useful. No graph snapshots, pooling or generalized state serialization.

C51/C64/C67/C72/C73/C85/C87/C89 are exploratory examples, not a commitment to
support every prefix. Preserve the originals for replay after a fix.

### Cross-runtime preservation

Do not add it to ordinary reduction. Select the runtime being investigated, verify
the final repro there, and replay/fuzz against its fix afterward. Existing focused
controls can serve an explicit request to retain a particular regression boundary;
that exception should not drive the normal architecture or replay cost.

## E. Keep paired findings honest without locking discovery to them

Reuse `equivalence.ts` and its existing two-run semantics. An E4 claim still needs
two valid comparable executions, eligible warmup, and correct variant-specific
request keys. Never report an invalid comparison as a Solid bug.

In discovery mode, if reduction exposes an ordinary admitted semantic failure in
one valid variant, that can become the selected issue. Export the actual variant
as an ordinary scenario, clear paired-only fields/comparison labels, and retain
the original paired case as provenance. Do not keep calling it E4. If a reduction
still relies on an E4 difference, retain and replay both variants normally.

Focused equivalence reduction remains available when specifically requested. Test
single-variant conversion, variant-key cleanup, one-sided inapplicability and
warmup that starts async work. C91 remains in the saved corpus regardless of what
simpler issue discovery selects.

## F. Validation and the fix/replay/fuzz cycle

For each implemented slice:

- Add transformation/acceptance tests with passing and failing controls. Keep
  reducer unit tests independent of upstream bugs remaining unfixed.
- Run relevant semantic tests and typecheck. Compare old/new reduction on the
  same frozen corpus and budgets, including another old-rule finishing pass.
- Independently replay the final candidate with its actual rule and graph. Check
  exact request selection and artifact correctness. Preserve all originals.
- Manually inspect a few before/after examples: did the change remove meaningful
  explanatory complexity and make an issue easier to reproduce and understand?
- Record replay cost, time, budget exhaustion and candidate complexity as supporting
  metrics. Representative count is diagnostic, not an acceptance target.
- Check the ordinary budget on a separate generated sample. Avoid building a
  reducer specialized only for the 97 audited shapes.

The operational success criterion is reaching a small, credible repro promptly,
then being able to tell what remains after its fix. Present one issue, not a dump
of every surviving category. Keep supporting variants in artifacts unless they
materially change the user's understanding of that issue.

After a fix, replay saved originals and reduced examples, then run fresh fuzzing
on the patched runtime. A formerly merged case can now surface as its own issue.
When a known unfixed bug dominates a run, retain its examples and test a candidate
fix when available; do not blacklist an entire rule or broadly waive related
failures just to make the run look clean.

Implementation style: small helpers, loops, predictable numeric IDs and cheap
applicability checks before copying. Reuse request/key helpers. Keep accounting
and provenance off the graph hot path. No pooling, generic proof machinery,
always-on multi-version replay, arbitrary permutation search or exhaustive root-
cause bookkeeping before the next issue can be fixed.

## Coverage of the original audit opportunities

| Opportunity | Revised location |
| --- | --- |
| diagnostic / verdict-projection | A; C |
| tuple-projection | B |
| source-kind | B |
| lifecycle / action-lowering | B; C |
| graph-quotient / request-translation | B; C |
| source-merge | B; C |
| schedule / latest-read-erasure | B; C |
| version-upgrade | C |
| branch-rewrite / delivery-substitution | C; grammar extensions in D only if justified |
| boundary-substitution / ownership-projection | C |
| control-projection | C |
| initial-state | D, deferred |
| multi-target | D, removed from default scope |
| paired-preservation | E, correct reporting rather than mandatory same-bug preservation |


## First implementation results (2026-09-14)

Discovery is now the default for admitted semantic failures; `--shrink-mode focused`
retains fingerprint matching. W1 review and waived P1 observations cannot replace a
bug. Final replay and artifact diagnostics follow the reduced result. Paired
findings may export an independently failing variant with ordinary replay metadata.

Implemented candidates: mixed source/derived reader projection, single-proposal
optimistic lowering, latest-to-override substitution, adjacent no-op proposal and
completion rewriting, an isolated affine cone with exact request translation, and
an uncanceled visibility microtask moved to the next host turn. These deliberately
have narrow applicability checks; broader grammar and schedule searches are deferred.

On all 97 saved representatives, using the same frozen PR #3425 worker and a
500-attempt budget, old/focused/discovery reduction produced 97/88/72 distinct
repro keys. Those are not counts of unique bugs. All final examples replayed;
none exhausted the budget; all 1,720 original memberships remain saved.
Discovery changed the diagnostic of 29 examples. Runtime calls were
2,187/2,453/2,714; single-run wall times were 11.4/13.2/13.0 seconds. These timings
are supporting measurements, not a statistically established speed comparison.

Useful concrete simplifications:

- C31/C38 lost their imperative latest read and queued callback, leaving an ordinary
  write followed by hiding the reader in the next event.
- C60/C94 lost their arithmetic helper and explicit request-resolution operation,
  leaving one async memo and one optimistic proposal. The result reports S4 instead
  of O2; that is a different independently witnessed failure, not proven same cause.
- C91 still requires a paired E4 comparison and remains labeled as such.

A separate 1,000-case ordinary campaign at seed 91427, on checked-out target
`e69d4769b25e695c010f34c592fb75be4e33cc8f`, retained 13 semantic failures and
five policy findings with no worker errors. The four selected examples were
independently replayed after shrinking; two reached the normal 150-attempt budget.
The campaign including shrinking took 7.2 seconds. These findings are validation
of the discovery workflow, not newly triaged upstream issue claims.

A same-runtime, same-budget old/new comparison on all 18 retained fresh findings
produced identical scenarios and diagnostics (1,895 attempts each; three cases hit
150). This sample establishes replay compatibility, not a general reduction win.
The demonstrated improvements are in the audited optimistic/observation examples.
Validation: 41 semantic test files / 304 tests pass; semantic TypeScript checking
and `git diff --check` pass.

Evidence, replay scripts and complete results:
`../solid-effect-publication-evidence/semantic-fuzzing/discovery-reduction-2026-09-14/`.
The next useful step is selecting a clear repro and replaying its originals against
its fix, rather than expanding all optional reducers before reporting anything.


## Coordinated reduction results (2026-09-14)

Implemented and retained after real replay experiments:

- Conditional-to-consumer folding and simultaneous shortening of both branches,
  with immediate disconnected-node pruning.
- Uniform async delivery plus explicit-flush-to-host-turn rewriting.
- One memo's delivery changed together with bypassing another memo, preserving
  mixed async paths. These are bounded two-edit templates, not a general search
  through passing intermediate programs.
- Nested/gated/pending observation scaffolding collapsed into one fixed reader,
  with obsolete reader-control commands removed together. Render regions are excluded.
- Multiple direct optimistic proposals lowered into ordinary writes, including
  explicit authority. This is an intentional new program, not preserved action timing.

More elaborate async modes require removing a node or an explicit flush in the same
candidate. The first unrestricted experiment kept switching async forms and cost
6,395 runtime calls. It was replaced with the bounded version; its results remain
in evidence as `unrestricted-*`, not as the chosen implementation.

At equal 500-attempt budgets, starting from the prior 97 saved outputs, old/new
reduction produced 72/67 distinct repro keys. All final outputs independently
replayed; no case hit its budget; all 1,720 original memberships remain. The final
67 contain 55 semantic failures and 12 policy-review findings, not 67 proven bugs.
The extra pass used 2,914 runtime calls versus 2,037; single-run wall times were
9.8 versus 8.9 seconds. This is no claim of a stable throughput benchmark.

Concrete wins: C68 now matches C34 despite the original delivery/event difference;
C84's conditional graph loses a memo; C89 loses a memo and preparation turn; C93
reaches the existing one-memo S4 failure; C62 loses a memo and reaches the existing
three-memo L1 example. C28/C48 also lose a separate source reader. Ordinary source
role swaps were probed but produced no further matches, so were not implemented.

A fresh 1,000-case branch campaign (seed 91428, checked-out runtime, ordinary
150-attempt budget) retained seven semantic failures and six policy findings, with
zero worker errors. It took 5.9 seconds including shrinking. This is validation,
not a claim of seven new upstream issues. These rules improve concrete repros but
have not reduced the report queue to a handful of established issue families.

Scripts, pinned runtime comparisons, raw findings and reduced examples:
`../solid-effect-publication-evidence/semantic-fuzzing/coordinated-reduction-2026-09-14/`.

Validation of the final coordinated slice: 42 test files / 313 tests pass, semantic
TypeScript checking passes, and `git diff --check` is clean. The prior separate
18-finding sample reached the same final repros with 1,895 vs 1,900 attempts and
three budget exhaustions each. Of the fresh branch campaign's five selected
examples, three reached 150 attempts; those are reduced witnesses, not claimed
local minima.


## Further paired edits implemented (2026-09-14)

All four follow-up ideas are implemented: source merging plus one small offset
adjustment; queued callback payload moved to the containing callback's end;
first direct visibility setter absorbed from a mixed callback; and one memo's
delivery changed together with a valid adjacent declaration swap. Surviving exact
request identities remain intact; invalid or policy-only outcomes cannot replace
a semantic failure. These are new replayed programs, not assumed equivalences.

Delivery/declaration candidates prefer a canonical direction or combine with cone
removal. A small per-run ordering limit prevents another family from resetting the
ordering search. A final ordinary reduction pass disables delivery/declaration
moves and retries prior simplifications, sharing the remaining budget and passing
control. This makes shared repros converge instead of ending on different visited
async forms. Both ordinary and paired reducers implement this finishing pass.
Read-order reversals alone showed no direct reduction benefit and were left out.

Final frozen-runtime comparison: 67 -> 64 repro keys, comprising 52 semantic
failures and 12 policy findings. All 97 outputs replayed; all 1,720 original
memberships remain; none exhausted 500 attempts. Runtime calls increased from
2,649 to 5,865; single-run wall times were 10.6 and 21.5 seconds. This is a real
search-cost increase for more aggressive reduction, not a performance improvement.
The first unrestricted ordering experiment took 8,256 calls and hit one budget;
those intermediate artifacts are retained separately.

Confirmed wins: C32 reaches C17 by merging its sources and repairing an equality;
C61 reaches C29 by appending the queued write after the visibility setter; C76 and
C21 now converge through delivery/declaration changes and cleanup. C42 loses its
arithmetic memo and initial hide operation. The total count is not a count of
independent bugs and is still larger than the desired handful of issue reports.

Validation: 43 test files / 320 tests, semantic TypeScript checking and diff checks
pass. A fresh 1,000-case branch campaign at seed 91429 on the checked-out runtime
retained 11 semantic failures and five policy findings, with no worker errors.
It took 8.0 seconds including shrinking. The five selected results all replayed;
two used the full default 150-attempt budget and are not claimed local minima.

Evidence and reproducible scripts:
`../solid-effect-publication-evidence/semantic-fuzzing/paired-reduction-2026-09-14/`.
