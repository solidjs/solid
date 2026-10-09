# Async rules — open questions, as screens

**Status: one batch, 2026-10-07.** These are the places where two sources genuinely disagree, or where a ruling was read two ways within a day. The worker did not decide them. Each is laid out as a sequence with the candidate screens side by side; the answer is a column letter. Where the record already leans one way, that is said, with the evidence — but the fundamental is fixed by your answer here, not by the record.

Three sections were drafted. **Q** stays while a ruled screen is still written out here. A resolved confirmation is deleted once the rule carries it. **U** — ruled, not built (`it.fails` pins), confirm the ruling stands and say whether it is for 2.0.

---

## Q-1. Ruled 2026-10-09 — a new memo joins by reading a held value

**The sentence that caused the mix-up (2026-10-07, #3869):** "in general transitions can hold on any unready read.. But new memos created don't need to be part of it." The restructure brief read it as "new memos that read nothing _async_ don't join". On 2026-10-09 the maintainer: the word was async, and what was meant was a held value. Column **A**. Creation joins nothing. A memo joins by reading a held value, sync or async. Columns B and C are rejected.

```tsx
const [x, setX] = createSignal(0);
const slow = createMemo(() => fetchSlow(x()));
<h1>{x()}</h1> <i>{slow()}</i>
const save = action(function* () { setX(1); yield gate; });
// save() is open, x = 1 is held on slow(1). On a click:
const m = createMemo(() => x() * 10);
<p>{m()}</p> <span>{x()}</span>
```

| #   | Step                                                               | **A** — born held (A29 as pinned)    | **B** — shows the committed world (N1, reverted) | **C** — shows the staged world  |
| --- | ------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------ | ------------------------------- |
| 1   | mount, `flush()`                                                   | `h1 0 \| i 0 \| p (empty) \| span 0` | `h1 0 \| i 0 \| p 0 \| span 0`                   | `h1 0 \| i 0 \| p 10 \| span 0` |
| 1   | `untrack(m)`                                                       | throws `NotReadyError`               | 0                                                | 10                              |
| 2   | `slow(1)` lands, body returns                                      | `h1 1 \| i 1 \| p 10 \| span 1`      | same                                             | same                            |
| —   | the same `m` wrapped in a fresh `<Loading fallback="…">` at step 1 | `[fallback]`, then `p 10` at 2       | `p 0`, then `p 10` at 2                          | `p 10` now                      |

- **A** is what `tests/born-held.test.ts` pins, what the L2 "ruling A" generalized (2026-10-01), what #3761 was ruled against (2026-10-05), and the reading `RULES-FUNDAMENTALS.md` encodes (F-1 + F-2: a derivation of a held change belongs to it; D-2).
- **B** was built as N1 on 2026-10-02 (20 pins flipped) and reverted the same day on "there must have been a reason": a memo is shared — the hold's own later passes read it — so it cannot answer `0` to the screen and `10` to the hold. #3761's PR did this at +615 B and was ruled against.
- **C** tears (F-1): `p 10` beside `h1 0`. It is the pre-born-held behavior that `#3451` fixed.

**(a) Ruled — column A.** D-2: a transition holds on any unready read; creation alone joins nothing; a new memo joins by reading a held value.

**(b) Ruled.** `latest` throws only when it cannot provide a value. `m` is sync and has already produced one, so `latest(m)` is `10` and `isPending(m)` is `true` until the hold paints it. An async memo with no resolution has nothing, so `latest` of it throws. A lane held on async downstream of the read does not paint, and does not hide a value `latest` can already return. The A7 column below is the async case, misapplied to this sync memo.

|                | **A7 reading**                             | **A11 reading**                                                                                               |
| -------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `latest(m)`    | throws                                     | 10                                                                                                            |
| `isPending(m)` | false (no visible value — A19 exception 1) | true (A19 cause i: a held value) — both A19 clauses apply to a born-held node, so the archive does not decide |

The record has no pin for `latest(m)` on a born-held memo whose reader is still the display. Off that fallback, Q-1 (b) says `latest(m)` is the pending value and `isPending(m)` is true. The same memo whose only reader is behind a fresh fallback does not hold (F-3): `latest(m)` is the value it produced and `isPending(m)` is false. The pin is `tests/loading-fallback-in-flush-3540.test.ts`.

## Q-2. Ruled 2026-10-09 — a re-arm enters its fallback off screen; the screen stays on the old content while the frame is held

Two readings, two days apart. The visible screen is #3575. The re-arm does enter the fallback; that fallback is off screen while the frame is held.

- **#3575 (2026-09-21, pinned):** the swap follows the frame of the change; a same-source outside reader holds the frame until the data lands, so the fallback can never be seen; DEV `LOADING_ON_OUTSIDE_HOLD` at the change. B-SAME-SOURCE in the recovery; `loading-on-frame-following-3540.test.ts` §3.
- **The boundary-scope ruling's `on` part (2026-10-06, deferred in #3824):** "content under a boundary that an `on` change has re-armed, committed content included, belongs to that boundary" — read literally, the boundary owns its wait and shows the fallback now regardless of who else reads the data.

```tsx
const [id, setId] = createSignal(1);
const data = createMemo(() => fetchData(id()));
<Loading on={id()} fallback="spinner">{data()}</Loading>     // A: re-armed by the change
<Loading fallback="spinner">{data()}</Loading>               // B: a shown boundary over the SAME data, outside A
// both primed for id = 1
```

| #   | Step                                                                                            | **A** — #3575: the frame waits (as pinned)                    | **B** — the re-armed boundary owns its subtree (2026-10-06 `on` part) |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | `setId(2); flush()`                                                                             | `A: data-1 \| B: data-1` — DEV `LOADING_ON_OUTSIDE_HOLD` once | `A: spinner \| B: data-1`                                             |
| 2   | `data(2)` lands                                                                                 | `A: data-2 \| B: data-2`                                      | `A: data-2 \| B: data-2`                                              |
| —   | the product-page shape (`on={id()}` beside a shell reading `product(id)`, a _different_ source) | `[A] → [B + spinner] → [B + comments]` — unchanged in both    | same                                                                  |

Under **A** the fallback shows only when the frame of the change can commit; B's old content is still valid, and a fallback would say it is not. Under **B** boundary A shows a spinner beside boundary B's stale `data-1` for the same `id` — two readers of one source disagreeing about whether it is loading. The 2026-10-06 ruling's _fresh-mount_ half (F-4, D-12) is settled; this is only its `on` half.

**(a) Ruled — neither column as written.** The re-arm enters the fallback, and the content belongs to the boundary. While the frame is held, that fallback is off screen and the screen stays on the old content. The fallback is seen only if the hold lifts before the new content is ready. A same-source outside reader holds the frame until the data lands, so the content is ready in that frame and the fallback is never seen: `[A] → [B]` (D-15, D-16, S-19). Column A's visible screen is the ruled one; "the fallback was never entered" is not. Column B — a visible spinner beside the outside reader's stale data — is rejected. DEV `LOADING_ON_OUTSIDE_HOLD` stands. #3824 did not rule the re-arm; its fresh-mount half is F-4. The deferred archive sentence is this rule's off-screen half, and is withdrawn as a claim that the spinner shows now.

**(b) Ruled.** A header `latest(id)` beside `on={id()}` shows the new id beside the boundary's old content for the whole hold. That is what `latest` is for (F-6). The boundary does not swap with the header; its fallback stays off screen until the hold lifts. "The swap lands with the header" is rejected.

`on={latest(id)}` is a different read and the same rule (D-17, S-21). `on` follows the frame of whatever it reads. `latest(id)` has already landed, so the fallback shows now, beside the held page. It does not break the hold. Every read of `id()` is still held.

**(c) Ruled with (a).** A visible inner fallback while a same-source outside reader still holds the frame is an engine bug. The 30 fuzzer cases in `pre-l2-rules-recovery.md` item 6 were not re-run.

## Q-3. Ruled 2026-10-09 — a read throws on its own; a boundary that only reads `latest` shows that value

`read-order-ruling-brief.md` (fuzzer cases 827, 416, 936; 2026-10-06). The brief asked which agreeing screen is right, on the premise that read order must not change what a mount shows. That premise is wrong, ruled 2026-10-09: a throw ends the pass, so the orders are different computations, and what must not depend on order is whether a given read throws. `n0()` has never shown a value, so it throws whichever read comes first, and the pass is held (D-28, S-39). Today's `[latest(s), n0()]` column is that throw going missing. Column **1** below is the ruled screen. Column **3** is rejected.

```tsx
const [s, setS] = createSignal(0);
const n0 = createMemo(async () => fetchEcho(latest(s))); // nobody on screen reads it yet
<Show when={mounted()}>
  <Child a={latest(s)} b={n0()} /> {/* one render effect: latest(s) first, then n0 */}
</Show>;
const save = action(function* () {
  setS(1);
  yield gate;
  setS(0);
});
// save(); then setMounted(true) while n0(1) is in flight; then n0(1) lands; then the body resumes and ends
```

| #   | Step                                      | **Today** (`[latest(s), n0()]`) | **Today** (`[n0(), latest(s)]`) | **1** — the mount's wait is its own, both orders | **3** — the routed reader shows what it can |
| --- | ----------------------------------------- | ------------------------------- | ------------------------------- | ------------------------------------------------ | ------------------------------------------- |
| 1   | `setMounted(true)`, `n0(1)` in flight     | control on, slot `(empty)`      | control off (whole mount held)  | control off (whole mount held)                   | control on, `[1, 0]` — torn                 |
| 2   | `n0(1)` lands                             | `[1, 1]`                        | control on, `[1, 1]`            | control on, `[1, 1]`                             | `[1, 1]`                                    |
| 3   | body ends (`s = 0`)                       | `[0, 0]`                        | `[0, 0]`                        | `[0, 0]`                                         | `[0, 0]`                                    |
| —   | the same child inside a fresh `<Loading>` | control on, slot `(empty)`      | —                               | control on, `loading`, then `[1, 1]`             | control on, `[1, 0]`                        |

And the boundary-wrapped sibling case (416): a sibling `<p>{n0()}</p>` on screen holds the lane; a fresh `<Loading>` whose tree reads only `latest(s)` is mounted.

| #   | Step                                      | **Today**                                                              | **1**                              | **3**                                                 |
| --- | ----------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------- |
| 1   | mount, lane held by the sibling's `n0(1)` | sibling `0`; control on; slot `(empty)` — neither fallback nor content | sibling `0`; control on; `loading` | sibling `0`; control on; `[1]` — ahead of the sibling |
| 2   | `n0(1)` lands                             | sibling `1`; `[1]`                                                     | sibling `1`; `[1]`                 | sibling `1`; `[1]`                                    |

**(a) Ruled.** Column 1 is D-28. The `[n0(), latest(s)]` order already does it. The `[latest(s), n0()]` order is the bug: `latest()` routes the reader into the verdict lane and `n0()` does not throw. Column 3 keeps that missing throw and tears. Option 2 of the brief (the mount joins the lane) stays dropped: it contradicts D-27.

**(b) Ruled — not a separate rule.** The boundary reads `latest(s)`, which has a value, and it never reads `n0()`. Nothing under it is pending, so the fresh `<Loading>` shows `1` beside the sibling, which stays on `0` (D-12, F-6, S-40). When `n0` lands, the sibling shows `1` too. Column 1, the fallback, is the boundary waiting on an async it did not read. Column 3's pixels are this screen; they are `latest` beside the held sibling, not a tear. Today's empty slot — neither fallback nor content — is the same early lane stamp as (a)'s missing throw. D-27 is unchanged.

## Q-4. Ruled 2026-10-09 — a new async memo that reads a held value is that hold's

The value half is D-2: the memo joins by reading the held value, so its answer does not show beside the old value. Column **4** is rejected. The time half was F-8 and is withdrawn (2026-10-09): a render effect outside a boundary that consumes the async makes the hold wait, whatever the source (F-2). That is column **2**. Column **1**'s "the hold never waits" does not stand. The missing build is only the value half (U-1).

**Provenance.** GabbeV's #3800 (2026-10-05) → `issues-3800-3802-create-time-ruling.md` §7, Option 1 at 70% → an agent-authored structural review → #3820 (2026-10-06, docs only), which wrote it into `SPEC-ASYNC-SEMANTICS.md` as "the direction rule (maintainer ruling)". On 2026-10-08 the maintainer had not seen the value half as a screen ("feels new to me"). On 2026-10-09 the value half fell out of Q-1. The #2933 time half was withdrawn the same day: the hold waits.

```ts
const [count, setCount] = createSignal(1);
const slow = createMemo(() => fetchSlow(count())); // ~1 s
<p>parent {count()} {slow()}</p>;
setCount(2);
flush(); // count = 2 held on slow(2); the screen shows parent 1 1
const fast = createMemo(() => Promise.resolve(count())); // created during the hold, reads the held count
<p>child {fast()}</p>;
```

| #   | Step                                                            | **1** — the child waits for the hold; the hold never waits (withdrawn with F-8) | **2** — the hold also waits for the child's first load (the brief's Option 2) | **4** — today, by design: a first load is initial-load class, even over a hold |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 0   | `setCount(2); flush()`; mount `child`                           | `parent 1 1 \| child (empty)`                                                   | `parent 1 1 \| child (empty)`                                                 | `parent 1 1 \| child (empty)`                                                  |
| 1   | `fast` resolves (the hold is live)                              | — (staged into the hold)                                                        | — (staged into the hold)                                                      | **`parent 1 1 \| child 2`**                                                    |
| 2   | `slow(2)` lands                                                 | `parent 2 2 \| child 2`                                                         | `parent 2 2 \| child 2`                                                       | `parent 2 2 \| child 2`                                                        |
| E1  | variant — `fast` is _slower_ than `slow`: `slow(2)` lands first | `parent 2 2 \| child (empty)`, then `child 2` when `fast` lands                 | **`parent 1 1` until `fast` lands**, then both                                | `parent 2 2 \| child (empty)`, then `child 2`                                  |

- **1** is F-1 (no `child 2` beside `parent 1 1`) plus #2933 (the parent is never slowed by the child's first load). Its sync twin already behaves this way: `createMemo(() => count())` created mid-hold is born held (S-3, A29) — the sync/async asymmetry is what GabbeV reported. Cost estimated +35–60 B, unbuilt (`fix/create-time-holds`).
- **2** is F-1 but gives up #2933 in a new place: an older update waits for a component mounted later. Fewer bytes (+15–25 B est.).
- **4** is today's engine (and pre-L2's): zero cost, but `child 2` beside `parent 1 1` is a derivation of the held `count = 2` shown ahead of it. Rejected. It would have needed an exception on F-1 and F-7, and it would have made S-3's sync twin the odd one out.

**Ruled — the value half is D-2. The time half is F-2, column 2, when a render effect outside a boundary consumes the async.** F-8 is removed. Column 4 is withdrawn.

## Q-5. Ruled 2026-10-09 — content behind a fallback does not hold; `latest` still returns the value it produced

The fallback is what is shown, and it is the display, so the reader behind it does not hold (F-3). `isPending` of that memo is false (F-9). The memo has produced a value, so `latest` of it returns that value (D-22). `isPending` of the source still on screen is true, because that reader is still the display. `isPending` of the boundary is false, because the fallback is not a value of the source. There is no boundary verdict rule. D-20 is not a rule.

Two rows are not this question. A fresh boundary over a **first load** (the source never had a value): `isPending` false and `latest` throws, F-9, in every reading. A **shown** boundary keeping its content through a refetch: it forwards, so `isPending` is true and `latest` is the staged value (F-5, D-22).

```tsx
const [count, setCount] = createSignal(0);
const slow = createMemo(() => fetchSlow(count()));
<p>Count {count()}</p> <p>Slow {slow()}</p>
const save = action(function* () { setCount(1); yield gate; });
// save() is open, the screen shows Count 0 | Slow 0. On a click:
<Loading fallback="fallback"><p>{/* m */ count()}</p></Loading>  // view
```

| #   | Step                    | Screen                            | **A** — verdicts are the source's; the boundary adds nothing (today's pin)              | **B** — off screen is quiet                                                                                       |
| --- | ----------------------- | --------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | mount, `flush()`        | `Count 0 \| Slow 0 \| [fallback]` | `isPending(count)` true · `isPending(view)` false · `isPending(m)` true · `latest(m)` 1 | `isPending(count)` true · `isPending(view)` false · `isPending(m)` false · `latest(m)` throws, or the committed 0 |
| 2   | `gate`, `slow(1)` lands | `Count 1 \| Slow 1 \| count 1`    | all false · `latest(m)` 1                                                               | same                                                                                                              |

- **A** follows Q-1 (b): the boundary adds nothing, so `m` answers as it does off the fallback. `latest(m)` is the pending value and `isPending(m)` is true. `isPending(view)` is false because the fallback is not a value of `count`. The pin (`tests/loading-fallback-in-flush-3540.test.ts`, `view=false m=false latest=content 1`) matches `latest` and `view`, and not `isPending(m)`.
- **B** reads F-3 harder: content behind a fallback is not on screen, so its verdict channels do not peer into the hold. `latest(m)` throws or reads the committed `0`, and `isPending(m)` is false. Q-1 says a held sync memo is pending and `latest` can see it even when the screen will not paint it; B says the fallback changes that.

**Ruled — neither column.** Column A applied Q-1, which is a reader the hold has not revealed and that is still the display: `isPending` true. This memo's reader is not the display. Column B has `latest` forget a value the memo produced. The pin is the rule: `isPending(count)` true, `isPending(view)` false, `isPending(m)` false, `latest(m)` the staged `1` (`tests/loading-fallback-in-flush-3540.test.ts`). S-14.

---

## U. Ruled, not built — confirm the ruling stands, and whether it is for 2.0

Each is pinned `it.fails`; the ruled screen is in `SCENARIOS.md`. Confirming here fixes the derived rule; the build order is yours.

|         | ruling                                                                                                          | pin                                                 | the deviation today                   | size note                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| **U-1** | D-2 — a new async memo's answer does not show beside the old value (#3800)                                      | none yet (`fix/create-time-holds`, `91e474506`)     | `child 2` beside `parent 1 1` (S-6 ✗) | est. +35–60 B. The hold waiting for that memo is F-2, not this build       |
| **U-2** | withdrawn with F-8. The hold waits for a mount's first load a render effect consumes outside a boundary         | `direction-rule-probe.test.ts` ×3                   | the pins expect the hold not to wait  | nothing to build. The +270 B mechanism would implement the rejected screen |
| **U-3** | D-13 — a boundary mounted by a pass that joined the hold appears at the hold's commit                           | `loading-fallback-in-flush-3540.test.ts:299`        | it shows its fallback now             | not measured                                                               |
| **U-4** | D-14 — an outer `on`-reset boundary does not wait for a flight its nested `on`-reset boundary catches (A33, B5) | `fuzz-findings-l2.test.ts`, fuzzer finding F1       | the outer waits                       | not measured                                                               |
| **U-5** | D-9 — a landing does not reveal a gate its stale reader re-derives onto a new flight (A15 reveal corollary)     | `fuzz-findings-l2.test.ts`, fuzzer finding F2       | it reveals                            | not measured                                                               |
| **U-6** | D-26 — a stale reader of a held re-guess shows the revealed guess, not the unrevealed one (A17, #3460)          | `fuzz-findings-l2.test.ts`, fuzzer finding F5b      | shows `1,2` where `1,1` is ruled      | needs a per-node slot for the revealed lane value                          |
| **U-7** | D-30 — a store row first read after an adoption derives nothing from the hold (#3706)                           | `adoption-unchanged-key-read-3706.test.ts:278`      | it derives                            | not measured                                                               |
| **U-8** | D-8 — a later mainline setter that does not write the held key publishes on the mainline tick (#3743)           | `store/unchanged-presence-no-hold-3743.test.ts:491` | it is held                            | not measured                                                               |
| **U-9** | D-14 — a held tree under a re-armed boundary re-derives without a redraw loop                                   | `loading-fallback-in-flush-3540.test.ts:1020`       | a redraw loop                         | Q-2 ruled 2026-10-09 (D-16); the loop is still the deviation               |

**Answer format that is enough:** `U-1, U-3–U-9 stand, U-6 after 2.0` — or the line you prefer. U-2 is withdrawn with F-8. Q-1 through Q-5 are ruled. C-1 is D-12. C-2 is D-7. C-3 is D-32.
