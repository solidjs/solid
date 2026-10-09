# Async rules — open questions, as screens

**Status: one batch, 2026-10-07.** These are the places where two sources genuinely disagree, or where a ruling was read two ways within a day. The worker did not decide them. Each is laid out as a sequence with the candidate screens side by side; the answer is a column letter. Where the record already leans one way, that is said, with the evidence — but the fundamental is fixed by your answer here, not by the record.

Three sections were drafted. **Q** stays while a ruled screen is still written out here. A resolved confirmation is deleted once the rule carries it: Q-1 through Q-5, ruled 2026-10-09, are now carried by the fundamentals, the derived rules and the scenarios, and are deleted. **U** — ruled, not built (`it.fails` pins), confirm the ruling stands and say whether it is for 2.0. This file goes when U is answered.

---

## U. Ruled, not built — confirm the ruling stands, and whether it is for 2.0

Each is pinned `it.fails`; the ruled screen is in `SCENARIOS.md`. Confirming here fixes the derived rule; the build order is yours.

|         | ruling                                                                                                          | pin                                                 | the deviation today                   | size note                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| **U-1** | D-2 — a new async memo's answer does not show beside the old value (#3800)                                      | none yet (`fix/create-time-holds`, `91e474506`)     | `child 2` beside `parent 1 1` (S-6 ✗) | est. +35–60 B. The hold waiting for that memo is F-2, not this build       |
| **U-2** | withdrawn with the direction rule (F-2). The hold waits for a mount's first load a render effect consumes outside a boundary         | `direction-rule-probe.test.ts` ×3                   | the pins expect the hold not to wait  | nothing to build. The +270 B mechanism would implement the rejected screen |
| **U-3** | D-13 — a boundary mounted by a pass that joined the hold appears at the hold's commit                           | `loading-fallback-in-flush-3540.test.ts:299`        | it shows its fallback now             | not measured                                                               |
| **U-4** | D-14 — an outer `on`-reset boundary does not wait for a flight its nested `on`-reset boundary catches (A33, B5) | `fuzz-findings-l2.test.ts`, fuzzer finding F1       | the outer waits                       | not measured                                                               |
| **U-5** | D-9 — a landing does not reveal a gate its stale reader re-derives onto a new flight (A15 reveal corollary)     | `fuzz-findings-l2.test.ts`, fuzzer finding F2       | it reveals                            | not measured                                                               |
| **U-6** | D-26 — a stale reader of a held re-guess shows the revealed guess, not the unrevealed one (A17, #3460)          | `fuzz-findings-l2.test.ts`, fuzzer finding F5b      | shows `1,2` where `1,1` is ruled      | needs a per-node slot for the revealed lane value                          |
| **U-7** | D-30 — a store row first read after an adoption derives nothing from the hold (#3706)                           | `adoption-unchanged-key-read-3706.test.ts:278`      | it derives                            | not measured                                                               |
| **U-8** | D-8 — a later mainline setter that does not write the held key publishes on the mainline tick (#3743)           | `store/unchanged-presence-no-hold-3743.test.ts:491` | it is held                            | not measured                                                               |
| **U-9** | D-14 — a held tree under a re-armed boundary re-derives without a redraw loop                                   | `loading-fallback-in-flush-3540.test.ts:1020`       | a redraw loop                         | Q-2 ruled 2026-10-09 (D-16); the loop is still the deviation               |

**Answer format that is enough:** `U-1, U-3–U-9 stand, U-6 after 2.0` — or the line you prefer. U-2 is withdrawn with the direction rule's time half (once drafted as F-8; F-2). Q-1 through Q-5 are ruled and carried by the rules. C-1 is D-12. C-2 is D-7. C-3 is D-32.
