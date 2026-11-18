# Size reduction — G: the behavior-leniency ruling table

Companion to `size-reduction-audit.md` §4.G. Measured 2026-09-26 against `next` @ 55e20221f.

## Method

Every number below is a **measurement, not an estimate**. Each rule was stubbed out of a copy of
the built `@solidjs/signals` prod tree (`dist/prod`, exact literal edits on the emitted
`core.js` / `scheduler.js` / `async.js`), and the floor scenario — `createSignal`, `createMemo`,
`createEffect`, `createRoot`, `flush`, esbuild minified, brotli q11 — was re-measured. A stub
removes the rule's code and lets the bundler drop whatever becomes unreferenced; helpers a rule
shares with a path that stays are, correctly, not counted. Rig: `/tmp/size-audit/g/rules.py`
(outside the repo; reproducible from the descriptions here).

Baseline for the rig: 27,834 B minified, **9,953 B brotli** (the harness reads 9,922 for the
same artifacts; the 31 B is alias-path layout).

## The answer first

| what is removed                                                          | min B | **brotli B** |
| ------------------------------------------------------------------------ | ----: | -----------: |
| all 21 rule sites in `recompute` (G1–G22 below, G4 ⊂ G3)                 | 1,597 |      **553** |
| all 10 rule sites in the scheduler (S1–S10)                              |   842 |      **287** |
| G + S together — _every mainline hold rule since rc, undone_             | 2,447 |      **824** |
| relocation candidates F1–F5 (no semantics; pay-for-use seams)            | 1,660 |     **~570** |
| G + S + F1–F4                                                            | 3,294 |    **1,095** |
| CEILING A: the plain path never enters transaction machinery at all      | 2,782 |      **860** |
| CEILING B: no implicit holds anywhere — async landings never hold either | 3,844 |    **1,204** |

Reading it:

- **Rule-by-rule leniency is worth at most ~0.8 KB**, and that is the price of undoing _every_
  behavioral fix the rc era landed (#2916 … #3662). No individual ruling is worth more than
  127 B. The audit's −1.5 to −2.5 KB for G was an inference from the growth ledger (65% of rc
  growth attributed to hold rules) and is wrong by 2–3×: the ledger measured what each fix
  _added_ at the time, but most of each addition was shared machinery that later fixes also
  lean on, so removing one rule's site today frees only its own branch.
- **The bytes are the model, not the rules.** Un-mangled minified, the floor is `GlobalQueue`
  11.5K (flush, adoption, parking, commit), `recompute` 7.5K, `handleAsync` 6.0K, `read` 3.5K,
  `notifyStatus` 1.8K, `Queue` 1.6K, `finalizePureQueue` 1.4K — ~33K of the 68K total is
  transaction + async plumbing on the plain path. Ceiling B — a **model change**, not a
  leniency: no async landing or pending read ever holds a sibling write; only `action` opens a
  transaction — recovers 1.2 KB, because the machinery stays reachable from `runEffect`,
  `owner`, `heap` and the explicit-action paths even when nothing implicit enters it.
- **Hello world cannot reach 10 KB under the fixed API.** Hello world is 12,744 B: 9,922 of it
  the signals floor, 2,822 the `render`/component layer. Floor − (G+S+F ≈ 1.1) − (the
  unmeasured perf-trade re-measure, 0.5–1.0 at best) ≈ 7.8–8.3 → hello world ≈ **10.6–11.1**.
  With ceiling B instead of G+S the arithmetic is the same to within 0.1. Only removing the
  async engine from the plain read/recompute path (a packaging change the audit already
  recorded as out: `createSignal` alone retains 9.2 KB because the read path reaches
  `handleAsync`) moves the floor by the ~2.5 KB the goal needs.

**Ruling (2026-09-26 evening).** G is closed: no rulings. The floor is the async model, every
real app has async, and the one lever that reaches hello world 10 — the async engine behind a
hybrid static/dynamic seam (static install from any async-implying import; an `import()`
fallback from the first thenable, measured below at −1,057 B for `handleAsync` alone and
−2,132 B with the plain path never entering transactions, both lower bounds) — only helps apps
with no async, i.e. benchmarks. Hello world is informational from here; the target is the size
every real app ships (`size-reduction-audit.md` §4.I).

**Original recommendation, kept for the record.** Do not spend rulings on G. Take the F relocations (no semantics, ~0.5 KB,
each a small PR: companions resync behind the verdict hook, the store sweep behind the store
hook, lane hook sites, dormant sweep, the async-iterable consumer behind an install), and
re-base the hello world target to **≤ 11 KB** — or, if 10 is firm, reopen the one lever that
reaches it: async (`handleAsync` and the transaction entry it drives) behind a seam the plain
`createSignal`/`createMemo` path does not import. That is an API/packaging decision, which is
why it is a question here and not an item.

## Recompute rule sites (G)

Floor delta when the rule's code is removed. Negative brotli = layout noise (the rule is free).

| id  | rule (what mainline pays for)                                                                              | tag                   | min B | br B |
| --- | ---------------------------------------------------------------------------------------------------------- | --------------------- | ----: | ---: |
| G3  | Children of the committed frame are deferred as zombies until this node's commit, not disposed at re-pass  | #3404 #3463 #3543     |   395 |  127 |
| G7  | Silent recovery: errored/pending → unchanged value still settles dependents holding the propagated status  | #2949 + #3181 twin    |   214 |   82 |
| G13 | Contested effect: a shared effect is re-derived by each transaction at its own commit                      | #3322                 |   114 |   43 |
| G18 | Lane posture resolution and lane hook sites in `recompute` (engine seam; lanes themselves are pay-for-use) | A31 #3009 #3479 #3442 |   141 |   33 |
| G2  | Superseding a pass closes its iterator flight immediately rather than at the zombie drain                  | #3122                 |    62 |   29 |
| G4  | A lane pass on an effect parks a LANE frame (⊂ G3)                                                         | #3662                 |    79 |   23 |
| G16 | A stamped effect recomputed mainline re-runs under its transaction to refresh the staged view              | #3412                 |    69 |   23 |
| G10 | Born held: a creation pass served a staged value is staged into that transaction (+ boundary told)         | A29 #3540             |    33 |   17 |
| G14 | A reporter that dropped a dep re-judges every parked transaction                                           | #3426 / O3            |    73 |   14 |
| G22 | Re-ask classification hook sites                                                                           | verdict re-ask        |    56 |   10 |
| G17 | A throwing comparator is routed as a compute-phase error instead of unwinding the flush                    | #2837                 |    23 |    7 |
| G19 | Override plumbing: compare against the published slot; A18 sync twin; covered holds always queue           | A17 A18 #3330 #3331   |    46 |    6 |
| G21 | Sync companions stay visible to `isPending()`/`latest()` on a staged pass (hook site)                      | #2831 #3413           |    32 |    6 |
| G1  | A stamped memo re-enters its hold on re-pass                                                               | #3407 / A15           |    43 |    5 |
| G11 | Missed-wake latch: a dep write beneath the pass re-runs it                                                 | #3037                 |    31 |    3 |
| G9  | Loading window: NotReady under a live window parks silently (commit-#0 window)                             | A27                   |    23 |    1 |
| G20 | An effect drops its commit-replay recording when it recomputes under the transaction                       | gatedSubs replay      |    39 |    0 |
| G15 | Deps are the committed frame's until it is replaced (deferred tail trim)                                   | A30 #3410 #3438 #3469 |    66 |   −1 |
| G6  | A re-park drops the sources the earlier pass carried                                                       | #3456                 |    56 |   −3 |
| G5  | A sync settle that preempts a landing owns the pending-source sweep                                        | #3181                 |    13 |   −5 |
| G12 | A node disposed during its own pass publishes nothing                                                      | #3621 #3024           |    55 |  −13 |
| G8  | A held window landing re-opens the loading window until commit                                             | #2990                 |     2 |  −18 |

## Scheduler rule sites (S)

| id  | rule                                                                                      | tag                  | min B | br B |
| --- | ----------------------------------------------------------------------------------------- | -------------------- | ----: | ---: |
| S5  | Zombies of parked owners rerun for mainline writes until their commit                     | #2916 #3463 #3546    |   229 |   72 |
| S1  | A write that nets to the committed value is no proposal (unstaged at adoption)            | A34 #3494            |   101 |   44 |
| S4  | Held-truth reveal wake is deferred past the optimistic revert                             | #3164                |   120 |   38 |
| S6  | A tick proposed against a hold joins it in its own flush                                  | #3494 #3519          |    84 |   24 |
| S7  | Boundaries re-arm after the heap, under the transaction, ahead of the verdict             | #3540                |   109 |   19 |
| S8  | A parked transaction is re-judged when a reporter drops out (woken re-entry)              | #3446 O3 #3372 #3375 |    67 |   13 |
| S9  | A boundary whose fallback read something not ready is judged before the verdict           | #3540 judgeHeld      |    52 |   11 |
| S2  | Contested effects re-derive at each owner's commit (finalize half of G13)                 | #3322                |    −1 |    9 |
| S3  | Unchanged passes keep their dependency tail until the flush's verdict (drain half of G15) | A30 #3469            |    41 |    0 |
| S10 | Overrides still in force are superseded by their revert truth before the verdict          | #3427                |    24 |  −16 |

## Relocation candidates (F — no semantics)

Code in the floor that belongs to a feature the floor scenario never imports, reachable today
through a direct call rather than a hook the feature installs. Each is a pay-for-use seam of the
kind `optimistic.ts`/`verdict.ts` already use (33 of the 42 `GlobalQueue` slots).

| id  | what the floor carries                                                           | owner feature                 | min B | br B |
| --- | -------------------------------------------------------------------------------- | ----------------------------- | ----: | ---: |
| F5  | `handleAsync`'s async-iterable consumer (`consumeIterator`, flatten, live drain) | streams / `AsyncIterable` fns |   810 |  322 |
| F2  | `sweepTransientStoreNodes` + `canUseSimpleSyncFlush` store gate                  | stores                        |   393 |   82 |
| F1  | `resyncUnflushedCompanions` + `markUnflushedStaged` (A28 companions)             | `isPending()`/`latest()`      |   250 |   37 |
| F4  | `sweepDormant` in flush                                                          | unobserved-memo reclaim       |   110 |   29 |
| F3  | Lane hook sites in `flush`/`finalizePureQueue`                                   | optimistic lanes              |    99 |   24 |

F1–F4 together measure 252 B (some layout overlap); with F5 ≈ 570 B. These are the G-adjacent
work worth doing: no ruling, no oracle change, each its own small PR against `packages/signals`.
