# Async rules — open questions, as screens

**Status: one batch, 2026-10-07.** These are the places where two sources genuinely disagree, or where a ruling was read two ways within a day. The worker did not decide them. Each is laid out as a sequence with the candidate screens side by side; the answer is a column letter. Where the record already leans one way, that is said, with the evidence — but the fundamental is fixed by your answer here, not by the record.

Three sections were drafted. **Q** stays while a ruled screen is still written out here; Q-6 and Q-7 (2026-10-12, from #3886) are open. A resolved confirmation is deleted once the rule carries it: Q-1 through Q-5, ruled 2026-10-09, are now carried by the fundamentals, the derived rules and the scenarios, and are deleted. **U** — ruled, not built (`it.fails` pins), confirm the ruling stands and say whether it is for 2.0. This file goes when U is answered.

---

## Q. Proposed, not ruled — the answer is a column letter

### Q-6. Does an error wait for its frame the way a value does? (D-40, from #3886)

The sequence is S-41: `count` 1 → 2; `data(2)` rejects while the sibling `slow(2)` is still in flight; an `<Errored>` around `data`, a `createEffect(data, { effect, error })`, and `<p>{count()}</p>` beside it.

|                                                          | **A — today**                                                            | **B — D-40**                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| screen after `data(2)` rejects, `slow(2)` up             | `1 \| Error 2 \| 1`                                                      | `1 \| 1 \| 1`                                                          |
| the error arm                                            | runs now                                                                 | runs when `slow(2)` lands, in the frame that shows `2`                 |
| `data()` untracked, meanwhile                            | throws `Error 2`                                                         | `1` (the screen)                                                       |
| `isPending(data)` / `latest(data)`, meanwhile            | `false` / throws `Error 2`                                               | `true` / throws `Error 2`                                              |
| `resolve(data)` / `until` / `refresh` called in the hold | reject now                                                               | reject at the landing (D-31: delivered by the hold they are called in) |
| what the hold waits for                                  | `slow(2)`                                                                | `slow(2)` — unchanged in both columns                                  |
| recovery to the last good value (S-42 step 6)            | the arm never runs; the screen shows `1` with the arm still on `Error 2` | the arm runs with `1`                                                  |

**Where the record leans.** B. F-1 (the fallback is content, F-4, and `Error 2` beside `slow`'s `1` is a value beside a stale derivation of its input); F-2 (a change that needs async shows nothing of itself until that async has landed; the error is part of the change); D-39's reading of the mirror. A was never ruled: the engine publishes an error straight into the node's working status, which is also what reads and effects see, so the error has one state where a value has two (staged, committed). "An error is the resolved future" is true of what the hold waits on, and both columns agree there.

**Not in the question.** The standalone bugs #3886 found beside this, each its own fix with no rule: an async recovery to the last good value never notifies the effect even with nothing held; a write to a failed writable memo does not clear its error; a thrown value whose `toString`/`message` throws reaches the arm as the formatter's error; a failing async comparator does not release unobserved lazy readers; snapshot scopes do not capture a failure.

### Q-7. `loadingValue` after a shown failure: does a pending retry serve the seed again? (from #3886)

`createMemo(() => fetch(id()), { loadingValue: 42 })`; the first request rejects and the error shows; then `setId(2)` re-asks.

|                                     | **A — today** (`loading-value.test.ts:268`, #2989)   | **B — #3886's contract change**                             |
| ----------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------- |
| screen while the retry is in flight | `42` — the seed serves again; `isPending` is `false` | the error stays; `isPending` is `true`                      |
| the seed as memo `prev`             | `42`                                                 | `42` (unchanged: the seed stays the last successful `prev`) |

**Where the record leans.** B is D-39's wording applied literally ("the error stays until a new answer replaces it; a pending is not a value"), and D-30 says a declared first paint is _loading_, not pending, which is A's ground: the seed is the first paint until a first answer. A revealed failure is a first answer, which favors B. A is pinned twice today and was ruled for #2989 before D-39 existed. Not needed for Q-6; decide on its own.

**Answer format that is enough:** `Q-6 B, Q-7 A` — or the line you prefer.

---

## U. Ruled, not built — confirm the ruling stands, and whether it is for 2.0

Each is pinned `it.fails`; the ruled screen is in `SCENARIOS.md`. Confirming here fixes the derived rule; the build order is yours.

|         | ruling                                                                                                                       | pin                                                                                                            | the deviation today                                                                                          | size note                                                                  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **U-1** | D-2 — a new async memo's answer does not show beside the old value (#3800)                                                   | `issue-3800-repro.test.ts`                                                                                     | built (#3977)                                                                                                | −22 B minified with `_bornIn` dropped (column 2)                           |
| **U-2** | withdrawn with the direction rule (F-2). The hold waits for a mount's first load a render effect consumes outside a boundary | `direction-rule-probe.test.ts` ×3                                                                              | flipped to wait (#3977)                                                                                      | nothing to build. The +270 B mechanism would implement the rejected screen |
| **U-3** | D-13 — a boundary mounted by a pass that joined the hold appears at the hold's commit                                        | `loading-fallback-in-flush-3540.test.ts:299`; outside-reader form in `fresh-boundary-born-held-reader.test.ts` | it shows its fallback now; held by an outside reader, the fallback runs and is swapped in the commit's flush | not measured                                                               |
| **U-4** | D-14 — an outer `on`-reset boundary does not wait for a flight its nested `on`-reset boundary catches (A33, B5)              | `fuzz-findings-l2.test.ts`, fuzzer finding F1                                                                  | the outer waits                                                                                              | not measured                                                               |
| **U-5** | D-9 — a landing does not reveal a gate its stale reader re-derives onto a new flight (A15 reveal corollary)                  | `fuzz-findings-l2.test.ts`, fuzzer finding F2                                                                  | it reveals                                                                                                   | not measured                                                               |
| **U-6** | D-26 — a stale reader of a held re-guess shows the revealed guess, not the unrevealed one (A17, #3460)                       | `fuzz-findings-l2.test.ts`, fuzzer finding F5b                                                                 | shows `1,2` where `1,1` is ruled                                                                             | needs a per-node slot for the revealed lane value                          |
| **U-7** | D-30 — a store row first read after an adoption derives nothing from the hold (#3706)                                        | `adoption-unchanged-key-read-3706.test.ts:278`                                                                 | it derives                                                                                                   | not measured                                                               |
| **U-8** | D-8 — a later mainline setter that does not write the held key publishes on the mainline tick (#3743)                        | `store/unchanged-presence-no-hold-3743.test.ts:491`                                                            | it is held                                                                                                   | not measured                                                               |
| **U-9** | D-14 — a held tree under a re-armed boundary re-derives without a redraw loop                                                | `loading-fallback-in-flush-3540.test.ts:1020`                                                                  | a redraw loop                                                                                                | Q-2 ruled 2026-10-09 (D-16); the loop is still the deviation               |

**Answer format that is enough:** `U-1, U-3–U-9 stand, U-6 after 2.0` — or the line you prefer. U-2 is withdrawn with the direction rule's time half (once drafted as F-8; F-2). Q-1 through Q-5 are ruled and carried by the rules. C-1 is D-12. C-2 is D-7. C-3 is D-32.
