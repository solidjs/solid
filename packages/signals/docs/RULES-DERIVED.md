# Async rules — derived rules

**Status: DRAFT (2026-10-07), paired with [`RULES-FUNDAMENTALS.md`](./RULES-FUNDAMENTALS.md).** Every rule below cites the fundamental(s) it comes from, states the behavior in today's understanding, and links the archive entries it collapses — the A-rule sections of [`SPEC-ASYNC-SEMANTICS.md`](./SPEC-ASYNC-SEMANTICS.md) (with their dated amendments), the L2 hold-model rulings, the pre-L2 recovery's proposed rules (`B-…`), and the rulings of 2026-10-05 → 07. A derived rule narrows a fundamental to a shape; it never contradicts one. A rule whose source cannot cite a fundamental is under **Flagged** at the end.

Each rule carries: **From** (fundamentals) · **Scenarios** (in [`SCENARIOS.md`](./SCENARIOS.md)) · **Collapses** (archive links; the archive text is unchanged) · **Status** (`standing` — pinned and built; `ruled, not built` — pinned `it.fails`; `open → Q<n>` — in [`OPEN-QUESTIONS.md`](./OPEN-QUESTIONS.md)).

Archive links: `SPEC` = `./SPEC-ASYNC-SEMANTICS.md`. The L2 hold-model section is `SPEC#the-hold-model--l2-2026-10-04`; its dated paragraphs are cited by their bold titles.

---

## A. Holds — what waits (F-2, F-7)

### D-1. Reading a held value joins its hold

**From:** F-2, F-7, F-1. **Rows:** S-1, S-2, S-3, S-6, S-31. **Pins also:** `tests/born-held.test.ts`, `tests/issue-3800-repro.test.ts`, `tests/verdict-mount-first-pass-3851.test.ts`.

A derivation whose pass reads a value a hold has not yet revealed — tracked or untracked, its first pass included — is that hold's work: its result belongs to the hold and reveals with it. Nothing joins by being created while a hold is open; a pass joins by what it reads. Born held, a node has no answer until the commit: a plain read of it throws, `latest` of it shows what it produced, and a render effect that reads it holds the change that mounted it, so the branch attaches whole at the commit, never around an empty slot — unless a fresh boundary catches the read (F-4). A first pass that reads this flush's staging is born held when the flush parks, whoever opened the branch (decision 4, 2026-11-05). A render effect is not a derivation: it reads the screen (D-3).

**Status:** standing. Absorbs D-2 (2026-11-06). Mechanism and history: `INTERNALS-ASYNC-STATE.md` §7.

### D-2. A new memo joins a hold by reading it, not by being created

**Folded into D-1 (2026-11-06).** the same sentence as D-1 once _the hold's work_ and _born held_ are glossary terms. Rows and pins moved to D-1; the text is archived in `INTERNALS-ASYNC-STATE.md` §7.

### D-3. A render effect is a leaf: it shows the screen and re-derives at the commit

**From:** F-1, F-2. **Scenarios:** S-3, S-4.

A render effect that reads a held value is served the committed value — what is on screen — and is re-run at the hold's commit. It joins nothing, and it does not hold: it has a value to show. So a mainline mount whose bindings read held values directly shows the committed frame now and re-derives at the commit; a mount with a born-held derivation (D-2) has a reader that throws, so the whole branch waits for the commit, its direct bindings with it. A render effect groups whatever bindings the compiler put in one hole, and a pass belongs to whoever dirtied it: an unrelated sync write that re-runs a binding mid-hold publishes at once, reading the held flight as a stale reader (`{b()}:{detailsA()}` publishes `1:0`, then `1:1` at the landing); two independent flights read in one hole land at their own times. Memos keep the hold (a memo's value _is_ its hold's work), so entanglement through a user derivation of both stands.

**Collapses:** [A15](./SPEC-ASYNC-SEMANTICS.md#a15-transition-entanglement-is-graph-driven-lanes-settle-as-one-reveal) stale-reader term and shared-hole corollary (#3407), L2 statement 2 "frame readers see the screen", §13 "render effects are the frame" (2026-10-01), N1's surviving half ("only leaves read the screen"). **Status:** standing.

### D-4. Membership in a hold is the tick's

**From:** F-2, F-7. **Scenarios:** S-5.

The synchronous work one flush settles is one frame. Two mounts created before the same flush that each read a _different_ hold join both, and the two holds merge and reveal together; a manual `flush()` between them makes two frames, and the holds stay independent. The tick is defined by the flush, not by a microtask, `await` or timer. Inside a flush, a mount whose render effect reads a foreign hold through a derivation born held (D-2), or consumes a first load, makes the whole tick join it — the `Show` that opened the mount, its direct bindings, the tick's other writes — unless a fresh boundary catches that render effect (D-12). The derivation itself joins nothing by being created or computed: membership is decided by the render effect that reads it, so a memo no render effect reads holds nothing, and the mount's direct bindings show the committed frame (D-3; #3802). The author's ways out are `<Loading>` (fallback now) and `latest()` (the proposal now).

**Collapses:** "Membership in a hold is the tick's" (2026-10-04, #3788), the #3761 ruling, #3802's analysis. **Status:** standing (`tests/tick-scoped-pass-transaction.test.ts`). A new async a render effect consumes in that tick makes the hold wait, whatever its source, unless a boundary catches it (F-2). `tests/direction-rule-probe.test.ts` pins it (#3977). `tests/held-effect-restage-run-3802.test.ts` pins the unread memo.

### D-6. A first load starts no hold of its own; uncaught, it holds the change that mounted it, and the root attach

**From:** F-2, F-4, F-9. **Scenarios:** S-6, S-7.

A source's first load is loading, not a change: it does not start a hold of its own. A render effect outside a boundary that consumes it makes the surrounding hold wait (F-2). Navigation: `setId("b")` is held by the shell's `product(b)`, and the keyed page it mounts creates `reviews(b)` with no `<Loading>` around the list — the screen stays on `A | A's reviews` until both have landed, then `B | B's reviews`; never `B` beside an empty list. With `<Loading>` around the list, `B | Loading reviews…` lands with `product(b)` and the reviews follow. An unobserved first load never bridges later writes into its flight. On first render, async that no boundary catches cannot show a fallback, so the root mount withholds the DOM attach until that async settles and then attaches atomically (`ASYNC_OUTSIDE_LOADING_BOUNDARY` warns; F-12). A root mount with a boundary above its async attaches now and shows the fallback (D-12). A node born with a declared first paint (`loadingValue`) is already committed: its first flight never suspends, never holds, never pends (D-30).

**Collapses:** [A27](./SPEC-ASYNC-SEMANTICS.md#a27-the-commit-0-loading-window-is-loading-class-and-verdict-quiet) (2), #2937, carve plan §15.2, B-ROOT, recovery 8.1, `34c65b8bf` (the deferred root attach). #2933's "a navigation is never slowed by what the new page starts loading" is withdrawn (2026-10-09); that fetch holds the navigation unless a boundary catches it (F-2). **Status:** standing.

### D-7. Actions are holds; `yield` is the suspension point; the same tick's earlier writes are adopted

**From:** F-2, F-10, F-11. **Scenarios:** S-8, S-9.

An `action`'s writes are held until every body in the transaction has returned and everything they put in flight has landed; the surrounding UI sees one atomic update at the end. `yield` is the only hold-safe suspension: the body resumes inside the hold at a `yield`, so the idiom is `await` for typed results, then a bare `yield` before any writes. A write to a fresh signal between an `await` and the next `yield` escapes and commits ambiently (a platform limitation, accepted); a signal the action already holds rejoins it even after an `await`. `flush()` inside a body does not reveal the hold. The writes stay held until the body settles. Dev throws `FLUSH_IN_ACTION`. Production skips the drain: `flush(fn)` still runs `fn`, and its writes stay in the hold. Ambient writes made earlier in the same tick as the action's start are the action's ("transitions are ambient; an action is just a special case to link them over async"); work arriving after the body's first `await` is not. Boundaries under an action follow the ordinary rules — entering a fallback may happen ahead (F-4), leaving one lands with the hold.

**Collapses:** [A26](./SPEC-ASYNC-SEMANTICS.md#a26-an-ambient-transaction-window-is-one-flush-parking-is-flush-driven), [O1](./SPEC-ASYNC-SEMANTICS.md#o1-same-tick-adoption--an-action-adopts-the-ambient-writes-made-before-it-in-the-same-tick), §26 "Actions" (2026-10-02), §27 question 5 "actions are just transitions", recovery 4.3/7.2/7.3, #3333 (2026-09-09, before the L2 rebuild: a `flush()` in the body parked the hold and committed the writes that followed; the older "drains the transaction mid-step" line described that bug). **Status:** standing. The `action`/`until`/`refresh` JSDoc lost detail in L2 (recovery 7.1/7.5) — restore from `06-actions-optimistic.md`, which is unchanged.

### D-8. A write is a proposal

**From:** F-2, F-10, F-1. **Scenarios:** S-10.

While a hold has a proposal for a slot (a staged, unrevealed value), a further write to that slot — the same value or another — is a second suggestion for the same slot, and the two cannot finish at different times: the writer's tick joins the hold and reveals with it. A tick whose writes net to the slot's committed value made no proposal: the slot is not held, pends nothing, and a later write to it is a plain mainline write. A held _derivation_ is not a proposal: a mainline write to a node whose held value is a pass result becomes `prev` for the hold's re-derivation and does not suppress it (`setB(101)` mid-hold, `b` re-derives to `200` under the hold; a `prev`-reading derivation folds the write); a second _write_ is still last-write-wins. Writes apply first, then derivations re-run.

**Collapses:** [A34](./SPEC-ASYNC-SEMANTICS.md#a34-a-write-is-a-proposal-one-on-a-held-node-entangles-its-tick-one-that-nets-to-the-committed-value-is-none) (1)–(3), rule B (#3733), #3743 (a store fold's notifications are diffs). **Status:** standing. The store shape — a later mainline setter that does not write the held key publishes on the mainline tick — is built (U-8, 2026-10-13: a setter's written keys are its own set, the batch's earlier setters' chained behind it, so the notify visits this setter's keys and the fold keeps the batch's union; `store/unchanged-presence-no-hold-3743.test.ts`).

### D-9. Entanglement is graph-driven; what shares an on-screen async derivation settles as one, and a hold ends when its last on-screen reader leaves

**From:** F-1, F-2, F-3. **Rows:** S-11, S-13. **Pins also:** `tests/fuzz-findings-l2.test.ts`.

Two changes whose async work is observed by a shared on-screen derivation settle as one unit; changes on fully disjoint graphs settle independently. "Observed by a shared reader" is a pass observing the flight pending — a render effect's mere existence entangles nothing (D-3). A second flight reaching a memo another hold already holds enters that hold at the propagation. A reveal that discovers an async already in flight joins the hold that flight blocks, as its first observer if nothing displayed it before; when the flight's inputs are themselves still held elsewhere, the reveal is a stale reader of that other hold. A reader whose removal a hold has staged is still on screen and holds for every other change until the commit removes it. A hold lasts while an on-screen reader still observes a flight it waits on; when the last such reader leaves — disposed, re-run without the read, reset behind a fallback — the writes it kept for those readers alone commit at once; a display-ahead reader never keeps it open, and a `<Loading>` reset moves the wait onto the boundary (D-12).

**Status:** standing. Absorbs D-11 (2026-11-06). Mechanism and history: `INTERNALS-ASYNC-STATE.md` §7.

### D-10. The committed frame keeps its inputs until it is replaced

**From:** F-1. **Scenarios:** S-12.

A held pass has not replaced the committed frame, so the committed value still derives from the previous pass's inputs: a mainline write to an input the held pass stopped reading still reaches the node, which re-derives — and, reading a held input, joins that hold (D-1). A render effect's frame is the run that applied its value, so the same write reaches the effect and it re-derives on the screen at once (D-3). A pass that changed nothing replaced nothing either. An async memo's frame is replaced by its landing, not by the pass that started the flight. A source going _pending_ behind a kept input re-derives the node rather than marking it pending or skipping it.

**Collapses:** [A30](./SPEC-ASYNC-SEMANTICS.md#a30-a-memos-dependencies-are-the-committed-frames-until-the-frame-is-replaced) (#3410, #3438, #3461, #3469, #3494/#3519 refinements). **Status:** standing.

### D-11. A hold ends when its last on-screen reader leaves

**Folded into D-9 (2026-11-06).** D-9's last clause and F-3's statement. Rows and pins moved to D-9; the text is archived in `INTERNALS-ASYNC-STATE.md` §7.

## B. Boundaries (F-3, F-4, F-5)

### D-12. An armed boundary catches what is pending under it; its fallback is seen when the frame that armed it is

**From:** F-4, F-3, F-5, F-7, F-6. **Rows:** S-14, S-15, S-16, S-17, S-24, S-40. **Pins also:** `tests/boundary-not-born-held-3540.test.ts`, `tests/fresh-boundary-born-held-reader.test.ts`, `tests/loading-fallback-in-flush-3540.test.ts`, `tests/fuzz-findings-l2.test.ts`.

An armed `<Loading>` catches the render effects under it that are pending — a first load, a held value, a memo born held over one, a lane's own async — by their position under it, wherever the memo was created; what it catches holds nothing outside it, so a transition or a lane whose only pending readers sit behind the fallback reveals at once, while a reader of the same async outside the boundary still holds. Whether the fallback is seen is the frame's: when the frame that mounts the boundary is not held, the fallback shows now and the content appears when ready — with the hold's commit for content that derives from a hold, at the landing for its own first load; when the mount is itself held — a `<Show>` over a held value, content a hold has not revealed, a pass that joined the hold — the boundary appears at that hold's commit, on its fallback if its content is still loading. An `on` reset moves the wait onto the boundary: the readers it sends back to the fallback stop holding the change, and the fallback stays until everything under it has settled, flights started before the reset included, then one reveal. A disarmed boundary forwards instead (F-5).

**Status:** standing. Absorbs D-13, D-14, D-21 (2026-11-06). Mechanism and history: `INTERNALS-ASYNC-STATE.md` §7.

### D-13. A boundary whose own mount is held appears at that hold's commit

**Folded into D-12 (2026-11-06).** the held half of "the fallback is seen when the frame that armed the boundary is". Rows and pins moved to D-12; the text is archived in `INTERNALS-ASYNC-STATE.md` §7.

### D-14. A fallback-caught flight holds nothing; an `on` reset moves the wait onto the boundary

**Folded into D-12 (2026-11-06).** F-3, F-4 and F-5 restated; the reset clause is now D-12's last sentence. Rows and pins moved to D-12; the text is archived in `INTERNALS-ASYNC-STATE.md` §7.

### D-15. `on` is a dependency list; the swap lands with the frame of the change that caused it

**Folded into D-17 (2026-11-06).** D-17's first sentence. Rows and pins moved to D-17; the text is archived in `INTERNALS-ASYNC-STATE.md` §7.

### D-16. A re-arm whose data is also read outside the boundary never shows its fallback; a race lost is not reported

**Folded into D-17 (2026-11-06).** a consequence of D-17: the `on` read of a held value is the hold's work, so the swap lands with the frame; the outside-hold clause and the diagnostic are in D-17. Rows and pins moved to D-17; the text is archived in `INTERNALS-ASYNC-STATE.md` §7.

### D-17. A re-arm shows its fallback with the frame of the `on` pass

**From:** F-6, F-5, F-4, F-7. **Rows:** S-18, S-19, S-20, S-21, S-48, S-49. **Pins also:** `tests/loading-on-frame-following-3540.test.ts` §1–5, `tests/loading-on-rearm-3540.test.ts`, `tests/loading-on-latest-fallback-4337.test.ts`.

`on` is a dependency list: a change to anything it reads arms the boundary, and what it returns is never compared — optimistic writes and a source going pending notify like any write, an expression that reads nothing reactive never does. The pass that reads it is a pass like any other. One whose every read of a held value was ahead (`latest`, `isPending`, a guess) has a frame that has landed, so the fallback shows now beside the held screen (S-21); one that read a held value plainly — a value it did not also read ahead (D-25) — is that hold's work, and the swap lands with the hold's frame (S-18, S-48; the mixed `on`, S-49, ruled 2026-11-05). While that frame is held the boundary has entered its fallback and the screen keeps the old content; the fallback is seen only if the hold lifts before the new content is ready. When the frame waits on the very data the boundary waits on — a reader outside the boundary of the same source — the content is ready in the same frame and the fallback is never seen; DEV reports `LOADING_ON_OUTSIDE_HOLD` once, at the change, for re-arms only, and a race lost the other way is not reported (S-19, S-20). What the fallback itself reads is its own display-ahead, not the swap's.

**Status:** standing; S-49 ruled, not built. Absorbs D-15, D-16 (2026-11-06). Mechanism and history: `INTERNALS-ASYNC-STATE.md` §7.

### D-18. A fallback that itself reads pending data

**From:** F-4, F-5. **Scenarios:** S-22.

On first load, a fallback that reads pending data is the parent's pending: the parent boundary shows _its_ fallback. After a re-arm, the swap waits for the fallback to be ready: the old content stays until the fallback can show, then the fallback, then the content — and if the content lands first, the fallback is never seen. A parent never drops to its own fallback for a child's re-arm.

**Collapses:** the 2026-09-21 ruling ("if a not ready async read happens in fallback…"), B-FALLBACK-PENDING, recovery 5.5, `tests/loading-on-rearm-reveal-3540.test.ts`. **Status:** standing.

### D-19. Queued runs behind a fallback wait; the synchronous first render goes through

**From:** F-3. **Scenarios:** S-23.

Every _queued_ run behind a fallback — render-effect updates and user effects, `Portal`'s `schedule: true` render effect included — waits in the boundary and is released at the reveal, so nothing behind a fallback reaches `document.body` early. The synchronous first render on creation goes through.

**Collapses:** §27 7g (2026-10-02, "we definitely shouldn't be showing portals early. Flip it."), B-QUEUED, recovery 9.5. **Status:** standing. The first render goes through whichever boundary above is on its fallback when the effect is created — an outer one about to reveal in the same flush included, so a subtree opened by an async memo settling runs its render effects with the mount, as one opened by a signal does (#4343, `tests/render-effect-under-async-gate-4343.test.ts`).

### D-21. An armed boundary lets a lane reveal: the async under the fallback does not hold it

**Folded into D-12 (2026-11-06).** the lane form of D-12: an armed boundary catches a lane as it catches a transition. Rows and pins moved to D-12; the text is archived in `INTERNALS-ASYNC-STATE.md` §7.

## C. Display-ahead readers and verdicts (F-6, F-9)

### D-22. `latest(x)` shows the newest answer `x` has produced; before any, it throws

**From:** F-6, F-10, F-9. **Rows:** S-25, S-44, S-45, S-53, S-56. **Pins also:** `tests/latest-held-till-flush.test.ts`, `tests/latest-repeated-writes.test.ts`, `tests/latest-unread-identity-memo-4474.test.ts`.

An answer is a committed value, `x`'s own async landed — into a hold or not — or a declared first paint; a sync derivation of a held value has produced one too. `latest(x)` is the newest of these and never `undefined`; before a first one it throws `NotReadyError` in every scope. A slot that is displaying a guess has the guess as its newest value: `latest` of it shows the guess until the hold commits (ruled 2026-11-05, decision 3; S-44). A guess written before the first answer is the first value the node produced: it shows, `latest` shows it, and the first answer judges it (F-11; S-56, ruled 2026-11-07, not built — today's dev guard refuses the write). A write is visible to `latest` from the flush that carries it, not before (S-25). Laziness is never observable: a memo nobody has read has produced what the flushes it missed would have given it (#4474).

**Status:** standing; the guess clause built 2026-11-07 for a signal and for a superseded keyed row (#4689); a folded keyed arrangement (rows removed, the lane kept) still reads the world whole through `latest`, see §7. Mechanism and history: `INTERNALS-ASYNC-STATE.md` §7, the 2026-11-06 and 2026-11-07 entries.

### D-23. `isPending(x)` is true while a new question about `x` has no committed answer

**From:** F-9, F-1, F-12. **Rows:** S-26, S-27, S-28, S-54. **Pins also:** `tests/question-scoped-pending.test.ts`, `tests/latest-isPending-consistency.test.ts`, `tests/ispending-combined-atomic-3442.test.ts`, `tests/untracked-verdict-rederive.test.ts`.

True while an input change is held, while `x`'s own flight for a new question is up, or while a landed answer waits in a hold; false the moment the shown value is final. A re-ask of the same question is quiet; an `affects()` mark is a declared new question; a guess is verdict-inert. A node with no answer (D-22) has no verdict: owned, the probe does what a read does — it suspends or holds; unowned, it never throws and reads `false`, as it does for a thunk that throws a real error. Untracked inside a computation the probe is a snapshot. Its thunk's return value is never inspected: the probe is reads-only. `[isPending(x), x()]` read in one scope never pairs `true` with the fresh value, in either order; the `latest` channel is judged on its own (A8, S-27). A landed answer the frame still holds is not showable, so it is still a question without a committed answer: `isPending` stays `true` until it shows, even when the answer is ready — for a reader outside the lane, while the lane holds on a sibling's flight; the reader re-derives at the reveal (S-54, ruled and built 2026-11-07; the checkout pattern's opacity now waits for its lane, `latest()` text showing ahead on its own channel, A8).

**Status:** standing. Absorbs D-24 (2026-11-06). Mechanism and history: `INTERNALS-ASYNC-STATE.md` §7.

### D-24. `isPending` never throws unowned; the probe is reads-only

**Folded into D-23 (2026-11-06).** one sentence of D-23. Rows and pins moved to D-23; the text is archived in `INTERNALS-ASYNC-STATE.md` §7.

### D-25. A display-ahead read never holds the change it reads ahead of; its reader's own async holds the reader

**From:** F-6, F-1, F-3. **Rows:** S-27, S-29, S-30, S-31, S-39, S-40, S-46, S-49, S-50, S-51, S-52, S-58, S-60. **Pins also:** `tests/ispending-combined-atomic-3442.test.ts`, `tests/verdict-memo-held-branch-4544.test.ts`, `tests/latest-memo-inline-parity.test.ts`, `tests/lane-render-effect-grouping-4284.test.ts`, `tests/display-ahead-plain-write-content.test.ts`.

A pass's posture is decided by its own reads in that pass, never inherited from a creator or a memo it reads (#4544) and never carried into its next run. Each `latest` or `isPending` read sees the hold's world and joins nothing. A plain read of a node this pass also read ahead is the screen's: the two channels of one node agree within a scope, so `[x(), isPending(x)]` shows `[committed, true]` now in either order (A10, S-27). A memo that hoists that pair keeps the screen it had inline (S-52, 2026-11-07): the display, not the probe, is what makes the pair showable. A plain read of any other held value makes the pass the hold's work (D-1): a mixed `on` waits (S-49), and a memo that probed on its last run and probes nothing on this one holds the tick (S-50, both ruled 2026-11-05). Whether a read throws is that read's own: an earlier display-ahead read does not disarm a later plain read's throw (S-39). A branch a display-ahead read gates is not derived from it: a mount under `<Show when={latest(x) > 0}>` is a mainline mount whose plain reads are the screen's — `latest(x)` inside shows ahead at its own site — and a first pass under it that reads the hold's staging is born held (D-1), attaching at the landing, on its fallback inside a `<Loading>` (S-31, S-46). A render effect off a lane that reads what the lane is revealing — mounted mid-hold, or re-run by an unrelated write — shows the committed value and re-derives at the reveal (S-30). What is rendered from a display-ahead read waits for that read's own async, as one reveal (S-29). A display-ahead pass shows; it never asks (F-6's limit, 2026-11-07): the display — a render effect, a compiled binding, a user effect, and the sync derivations feeding them — holds the value it showed beside the verdict, in a render effect or a memo alike (S-52; hoisting the pair into a memo changes no screen), and an async derivation that reads a held value plainly, or `isPending` of one, is the hold's, asking once, of the truth (S-51, #4677; ruled and built 2026-11-07) — a pass that asks is a verdict reader only by a window of its own, never by reading a verdict memo (#4504). A user effect's callback runs at the frame it belongs to, lane or mainline; async in an effect is the author's.

**Status:** standing; S-51, S-52's #4349 shape and S-46's plain row built 2026-11-07, the plain row for every gate shape 2026-11-08 (S-58: `<Show>`, the compiled ternary, a truthiness memo and a branch memo, or one memo that probes and mounts — and S-53′ with it; S-58′ the same day: the mount's own pass reading ahead, of the same node or another, does not change its seat; S-58″/‴: nor does a guess lane — the mount under an action's guess is born held on the lane's flight, not served the screen as lane work is); S-49, S-50 ruled, not built. Absorbs D-26, D-27, D-28 (2026-11-06). The 2026-10-28 paragraph "a verdict posture outlives the pass that asked" is withdrawn. Mechanism and history: `INTERNALS-ASYNC-STATE.md` §7.

### D-26. A `latest()`/optimistic reader mounted or re-run mid-hold shows the committed value and reveals with the lane

**Folded into D-25 (2026-11-06).** the same-node clause of D-25 (the `[s(), L()]` parity) and D-3 (a leaf shows the screen). Rows and pins moved to D-25; the text is archived in `INTERNALS-ASYNC-STATE.md` §7.

### D-27. The branch a display-ahead `Show` opens is a mainline mount; its plain reads are the screen's

**Folded into D-25 (2026-11-06).** after decision 4 its content is D-1's; its one distinct idea — a branch a display-ahead read gates is not derived from it — is the glossary's _Lane_ and D-25's third sentence. Rows and pins moved to D-25; the text is archived in `INTERNALS-ASYNC-STATE.md` §7.

### D-28. A read throws on its own; an earlier read does not disarm a later throw

**Folded into D-25 (2026-11-06).** per-read posture (D-25) stated for throws. Rows and pins moved to D-25; the text is archived in `INTERNALS-ASYNC-STATE.md` §7.

### D-29. `createTrackedEffect` and `onSettled` callbacks see the screen

**From:** F-1, F-6.

Effect-phase code that runs after the frame is decided reads the frame as it stands: committed values, and a displayed optimistic value (the override is the frame). A held write is never visible to it; it cannot open or enter a hold of its own. On a pending node it reads the committed value; on an uninitialized one it receives `NotReadyError` (DEV: `PENDING_ASYNC_FORBIDDEN_SCOPE`); on a loading-window node, the loading value.

**Collapses:** [A32](./SPEC-ASYNC-SEMANTICS.md#a32-children-forbidden-readers-see-the-frame-not-the-graph). **Status:** standing.

### D-30. A derived store's seed is a draft, never an observable value

**From:** F-9, F-1. **Rows:** S-36, S-37. **Pins also:** `tests/store/createProjection.async.test.ts`, `tests/strict-read-pending-store.test.ts`.

Until a derived store's first landing (the first yield for a generator), every outside read of it — tracked, untracked, `in`, enumeration — throws `NotReadyError`; write-path reads see the draft. A seedless derived store starts from an empty record, the same unobservable draft. Pending is per key (F-9); a declared first paint is an answer (D-22); a derived store's leaves report their derive's new question as an async memo's readers would, and a quiet re-ask is quiet on them too.

**Status:** standing. Shortened 2026-11-06 (the per-key and first-paint clauses are F-9's and D-22's). Mechanism and history: `INTERNALS-ASYNC-STATE.md` §7.

### D-31. `resolve`, `until` and `refresh` deliver by the hold they are called in

**From:** F-6, F-11, F-2.

An action is not special here. It is only the usual way a hold is open when they are called.

`resolve(fn)` delivers the first settled value as that hold sees it, guesses included. With no hold open, that is the screen. `until(fn)` always reads the authoritative view: a guess and the structure it adds are invisible, so a guess never satisfies the wait for its own confirmation. A derivation of a guess is truth only once every guess beneath it is confirmed; until then the authoritative view has no value for it and `until` waits — the world before the guess does not satisfy the wait either. Staged truth reads normally, including a `refresh()` issued in the same hold. If a hold is open, the landing that flips the predicate joins it and reveals with it; with nothing held, `until` waits and resolves. `refresh(x)` returns the next quiescent state. A re-ask of the same question is quiet (`isPending` stays `false`). Called inside a hold, the landing is staged into that hold and the promise delivers the staged value, never the hold's guess. Called with nothing held, it delivers the settled value. A reader of a foreign hold's frame delivers at that hold's commit, never a foreign hold's unrevealed frame.

**Collapses:** L2 statement 8 (#3482/#3490), §27 question 2 (#3164), [A17](./SPEC-ASYNC-SEMANTICS.md#a17-an-active-override-is-the-displayed-value-until-its-transaction-commits-and-the-graphs-value-until-its-own-source-answers)'s authoritative-reader carve-out, `06-actions-optimistic.md` `until`. **Status:** standing; JSDoc on `until`/`refresh` lost this detail in L2 (recovery 7.1).

---

## D. Writes and optimistic values (F-10, F-11)

### D-32. Nothing shows a write before its flush; a guess with nothing to be optimistic over is void

**Folded into D-33 (2026-11-06).** F-10 restated, plus the glossary's "a guess with nothing held under it is void" (now D-33's last sentence). Rows and pins moved to D-33; the text is archived in `INTERNALS-ASYNC-STATE.md` §7.

### D-33. An optimistic value lives exactly as long as the hold it was made over; same-slot writes entangle, disjoint slots do not

**From:** F-11, F-10. **Rows:** S-25, S-32.

An override's lifetime is that of the hold it was made over — in the usual shape, its own action's: the hold committing reverts, or lands the truth beneath, exactly its own writes; concurrent holds on disjoint slots — different signals, different store keys — settle independently; same-slot writes from two holds entangle, and the slot reverts only when the last of them settles. A store setter's slot is the point of write, at the level written (ruled 2026-11-08, #4724): a nested `obj.items = [...]` guesses `items`; a top-level `d[i] = x`, or a returned top-level array, is one write per index that differs, as a returned object is one per key; the list itself is the slot only when its keys or length changed — a length change reaches every reader of the list. Two setters that change the same row are the same guess however they rebuild the array (S-59). Ownership never travels through a shared reader. A guess is visible from the flush that carries it, as a guess over that frame's hold; one written in a frame that commits with nothing held is as if it never happened — nothing is applied, no effect sees it (S-32).

**Status:** standing. Absorbs D-32's guess clause (2026-11-06). Mechanism and history: `INTERNALS-ASYNC-STATE.md` §7.

### D-34. A different truth corrects the graph now and the screen at the commit; what the screen never showed is void

**From:** F-11, F-1, F-6. **Rows:** S-33, S-34, S-35, S-44, S-56. **Pins also:** `tests/spec-async-semantics.test.ts` "#3331", `tests/optimistic-question-change-4336.test.ts`, `tests/optimistic-key-guess-reask-4329.test.ts`.

When a guess's own source answers: an equal answer confirms silently; a different one corrects — derivations re-derive from the truth now as the hold's work, so downstream refetches restart at once — while the screen, untracked reads and `latest` of the displayed slot keep the guess until the commit, and a guess the screen never showed is void at the correction (S-33). A guess is an edit over the answers to the question it was written over: an answer to a new question is not its truth, and the frame that changed the input is held with the guess's hold until it commits (S-44); a `refresh()` re-asks the same question and holds nothing new. Provenance: two rapid holds on one slot — the older's answer landing after the newer guess is staged for the commit but does not supersede (`latest` keeps the guess, `isPending` is true); only the guess's own hold, a later one, or mainline supersedes (S-34). When every body has returned and nothing authoritative is in flight, each guess still in force is corrected by the truth at hand, the display unchanged until the commit (S-35). A guess before a source's first answer is the newest value the node has produced: it shows in place of the loading, the function form receives `undefined`, and the first answer judges it (S-56, ruled and built 2026-11-07, reversing #4656's guard for optimistic memos; a derived optimistic store keeps the DEV guard `OPTIMISTIC_WRITE_BEFORE_LOAD` until its engine can show such a guess). A guess whose lane never shows is void at the correction, as any.

**Status:** standing; the `latest` clause built 2026-11-07 for a signal and a superseded keyed row (decision 3, #4689; pins `tests/optimistic-question-change-4336.test.ts`, `tests/optimistic-key-guess-reask-4329.test.ts`, `tests/optimistic-read-lane-not-transaction-3698.test.ts`, `tests/spec-async-semantics.test.ts` "#3331"); not for a folded keyed arrangement (`tests/held-truth-lane-only.test.ts`, see §7). Absorbs D-35 (2026-11-06). Mechanism and history: `INTERNALS-ASYNC-STATE.md` §7.

### D-35. Provenance: an older question's answer never corrects a newer guess; the body's end corrects what nothing authoritative is answering

**Folded into D-34 (2026-11-06).** D-34's second paragraph. Rows and pins moved to D-34; the text is archived in `INTERNALS-ASYNC-STATE.md` §7.

### D-36. A resting optimistic node is a plain memo

**Retired as a rule (2026-11-06).** a consequence of the glossary's _Guess_: a slot with no guess is its source. Kept as a pin (`tests/spec-async-semantics.test.ts`, A12/A13), not a rule. The text is archived in `INTERNALS-ASYNC-STATE.md` §7.

### D-37. A lane sees the screen plus its own guesses and never holds a sync write

**Retired as a rule (2026-11-06).** the glossary's _Lane_ plus D-25. The text is archived in `INTERNALS-ASYNC-STATE.md` §7.

## E. Errors (F-12)

### D-38. Effect error phases; a comparator throw is a compute error; an escaping error halts

**From:** F-12.

`createEffect`'s error arm intercepts compute-phase errors only; an unhandled compute-phase error in a user effect is logged and the run skipped; effect-phase throws escalate to the nearest `<Errored>` and halt with none. A user `equals` that throws is a compute-phase error. An error escaping every boundary halts the system (`REACTIVITY_HALTED`); later writes log "Update ignored". `ASYNC_OUTSIDE_LOADING_BOUNDARY` is warn-only; `<Errored>` never catches a pending.

**Collapses:** [A1](./SPEC-ASYNC-SEMANTICS.md#a1-effect-error-interception-is-compute-phase-only), [A2](./SPEC-ASYNC-SEMANTICS.md#a2-unhandled-compute-phase-errors-in-user-effects-are-logged-and-skipped), [A3](./SPEC-ASYNC-SEMANTICS.md#a3-comparator-throws-are-compute-phase-errors), [A5](./SPEC-ASYNC-SEMANTICS.md#a5-an-error-escaping-every-boundary-halts-the-system), [A6](./SPEC-ASYNC-SEMANTICS.md#a6-async_outside_loading_boundary-is-warn-only). **Status:** standing.

### D-39. An error fallback is the display; it stays until a new answer replaces the error

**Folded into D-41 (2026-11-06).** contained in D-41 as "recovery is the mirror". Rows and pins moved to D-41; the text is archived in `INTERNALS-ASYNC-STATE.md` §7.

### D-41. An error is an answer: it ends the wait like a value, and it shows when a value would

**From:** F-2, F-1, F-12. **Rows:** S-38, S-42, S-43, S-53. **Pins also:** `tests/error-is-an-answer.test.ts`, `tests/watch-error-outcomes.test.ts`, `tests/errored-recovery-wedge-4403-4404-4405.test.ts`. **Ruled 2026-10-15** (Q-6 B, from #3886; first drafted as D-40 in #3995).

A rejection, a compute-phase throw or a comparator throw is the answer to the question its node asked. As an answer it _settles_ the async: a hold never waits on an errored flight, and nothing here changes what a hold waits for. But settled is not shown. A value that lands on a held node is staged until the frame reveals (F-2); an error that lands on a held node is staged the same way, because the error fallback is content (F-4) and showing it beside the previous frame's other content is the torn screen F-1 forbids. Until the reveal: the screen keeps what it showed, an ordinary outside read serves the committed value (it reads the screen, D-29, D-34), `createEffect`'s error arm does not run, `<Errored>` does not flip, `resolve`/`until`/`refresh` do not reject (D-31), `isPending` of it is `true`, and `latest` of it throws the proposed error — the one way to see the answer early (F-6). That error is the display-ahead reader's answer, published as its value would be (ruled 2026-11-09, #4705): an `<Errored>` around `latest(m)`, or around a memo of it, shows its fallback now, in the reader's lane, and later errors and the recovery reach that fallback the same way; the clauses above are a plain reader's. At the reveal the error and everything that waited with it show as one frame: the arm runs, the boundary shows its fallback, the outside read throws, `isPending` is `false`.

Recovery is the mirror: a shown error stays the display until the frame that carries its replacement reveals — through a pending retry, and through a held recovery, success or a different failure. A recovery to a value equal to the last good one is still a change of answer: payload equality never silences it, held or not. `latest` is the mirror's exception as it is the error's: as `latest` throws a proposed error early, it shows a held recovery early — the newest answer produced — so a `Show` gated on `latest(m)` recovers while the action is open (S-53, ruled 2026-11-07, not built; the plain-read rows S-42 and S-43 are unchanged).

A first load that rejects has no previous content to keep: born held (D-2), it stays loading until its frame commits, as a first load's value does; under an armed boundary it is the boundary's and shows with the boundary's frame (F-4). A derivation that reads a staged error throws it, as it would read a staged value: its own pass errors and stages with the same frame.

**What it does not say.** It does not say an error keeps a hold open. It does not say an unheld error waits: with nothing held, an error publishes at the flush that found it, like a value (S-38). It does not say `latest` hides the error. It does not change what a boundary catches (F-12), the effect arms (D-38), or the halt.

**Built 2026-10-15.** An error a held node's flight or pass finds is staged in `_pendingValue` (CONFIG_STAGED_ERROR) and committed with the frame, which publishes it through the ordinary error path; a held recovery keeps the shown error (`_shownError`) until its own commit, and a recovery equal to the last good value is a change of answer, held or not. `watch` (`resolve`, `until`, `refresh`) rejects at the landing. The duplicated immediate-publish path is gone. Pins: `tests/error-is-an-answer.test.ts`, `tests/watch-error-outcomes.test.ts` (GabbeV, #3886).

**Built 2026-11-09 (#4705, GabbeV).** A boundary that catches an error a lane read threw takes the reader's lane for its swap (`caught`), and the swap's pass enters it, so the fallback, its `error` accessor and the recovery publish with the reader; `laneRead` enters the lane for an errored member as for a value, so a memo over `latest(m)` selects the same update before it throws. Pins: `tests/latest-derived-sync-error-4377.test.ts` (held rows flipped), `tests/latest-uninitialized-over-latest-4362.test.ts`, `web/test/latest-error-publication.spec.tsx`.

**S-53 (built 2026-11-07).** `latest` is the mirror's exception for a held recovery as for a proposed error: it shows the newest answer `m` produced, so a `<Show when={latest(m)}>` under an errored boundary opens while the action holding the recovery is open, and the boundary recovers with it; a recovery equal to the last good value is that answer. A plain read keeps the error until the landing (the mirror clause), and the content a display-ahead `Show` opens is S-46's mount (born held when it reads the staging plainly). Mechanism: `INTERNALS-ASYNC-STATE.md` §7, the 2026-11-07 entry. Pin: `tests/errored-recovery-wedge-4403-4404-4405.test.ts` (#4403).

**Derived stores (closed 2026-10-30, #4489).** A derived store's (`createStore(fn)`, projections, optimistic stores) held rejection is staged like a memo's: an untracked read of its property reads the screen until the frame reveals. Pinned in `tests/error-is-an-answer.test.ts` and `tests/optimistic-held-error-untracked-read-4489.test.ts`. The standalone cases from #3886's audit (a write to a failed writable memo, error-wrapper formatting, comparator release, snapshot capture) are not this rule. **Status:** standing.

Absorbs D-39 (2026-11-06): an error fallback is the display, and it stays until the frame that carries a new answer reveals.

### D-42. A reactive read is not an `await`: `try/catch` around it is not a channel

**From:** F-12, F-2, F-4, F-9. **Scenarios:** S-47. **Ruled 2026-10-30.**

A tracked read of a source that is pending or errored throws, and the throw is addressed to the graph, not to the code around the read. `NotReadyError` is how the read suspends — to an armed boundary, or into the hold (F-2, F-4); an error is how it reaches `<Errored>` or the effect's error arm (F-12). Wrapping the read in `try/catch` — in a memo, a render effect, a component body, a store derive — as one would wrap an `await`, is not supported, and not because it is forbidden: it is unreliable by construction. When a source goes pending or errored, its dependents are _marked_ with that status and do not run — the status rides the edge so that every dependent is not re-executed just to re-throw (the point of the design: no downstream over-execution). The computation is bypassed; its catch never sees the change. The catch runs only when the computation happens to run for some other reason while the source is already in that state — its creation, another input of its own changing — so the same code catches on one pass and is bypassed on the next (S-47: a first load is caught; the re-ask of the same source is held through the catching memo as if the catch were not there; an error under a catching memo reaches the boundary; a catching memo over an errored source is errored with it, whether it catches or not (#4486)). For errors the catch is fully inert (F-12, #4410); for not-ready it is bypassed on the change and masks on the pass — the two halves differ until ruled otherwise.

And when the catch does run it severs the channel: the computation completes with a value computed without the answer, and nothing records that it needed one. The first load is masked — no fallback enters, nothing holds, a `<Loading>` above never sees it; what is downstream reads the substitute as a real value; an error never reaches `<Errored>`, so SSR cannot know the tree failed (the 1.x `resource.error` split, removed in 2.0). On the browser build the dependency registered before the throw, so the computation re-runs at the landing and the mistake heals; on a build with no subscription graph — the server — nothing retries, and the substitute is the answer (#3073, derives).

What the author has instead: `isPending(x)` to branch on readiness; `latest(x)` to show ahead or to see a staged error early (D-22, D-41); `<Loading>`, `<Errored>` and `createEffect`'s error arm as the catchers (F-4, F-12, D-38). `try/catch` belongs where something is actually awaited — an action body (`yield refresh(x)` throws back at the yield), an event handler, `resolve()`/`until()`/`refresh()` (D-31). `NotReadyError` is exported for interop layers that re-throw it, not as an app-code catch; the runtime's own catches (`isPending`/`latest` unowned, A16) are the mechanism, not a license.

**What it does not say.** It does not say catching is detected: nothing warns today — a computation that completes after a `NotReadyError` or a source's error was thrown into it is indistinguishable from one that never read the source (dev: `CAUGHT_REACTIVE_READ` warns when the catch ran and the pass completed; the bypass is not detectable). It does not say a derivation can never observe an error: `latest(x)` throws a staged error (D-41), and a `createEffect` error arm sees compute-phase errors (D-38). It does not say a dependent never re-runs on a status change: a verdict reader, a boundary output and a kept-tail link re-derive (`propagateStatus`), and a catch in one of those sees the change — that it does is the mechanism's business, not a contract.

**Collapses:** `05-async-data.md` "Error handling" (one path; the 1.x split), `04-stores.md` "A derive must never swallow `NotReadyError`" (#3073 — the derive form of this rule), the `NotReadyError` JSDoc, [A16](./SPEC-ASYNC-SEMANTICS.md#a16-ispending-never-throws-in-untracked-contexts)'s swallow scope (B5a, #2928), #4486. **Status:** standing; the not-ready bypass is pinned as it is in `tests/try-catch-reactive-read.test.ts`. Deviation today (#4486): a reader created over, or re-run onto, an already-errored sync memo completes with its caught value until the clock-gated retry (`read()`'s errored-memo path) re-runs the source inside its pass, which halts (no boundary) or errors the boundary while the memo still reads the caught value. Ruled 2026-10-30: errored from the first pass. Fix built on `fix/errored-reader-4486` (+83 B min / +41 B brotli core floor), not shipped: the deviation is reachable only through a catch `CAUGHT_REACTIVE_READ` warns on in dev (#4481), and without a catch the path is coherent; accepted 2026-10-30, #4486 closed. Pinned `tests/errored-reader-4486.test.ts` (`it.fails` at the ruled screens, so a core change that fixes it is noticed).

---

## F. Declared lag (F-1, F-2, F-7, F-9)

### D-40. A deferred source lags its readers and never leads them

**From:** F-1, F-2 (both amended 2026-10-14 for declared lag), F-7, F-9, F-4, F-12. **Scenarios:** S-41.

`createDeferred(fn)` is an async memo whose author declared that its previous answer is acceptable while the next one loads. Its first load is a first load like any: a reader suspends to a boundary or holds (F-2, F-4), and with `loadingValue` the declared first paint shows instead, verdict-quiet (D-30). After its first answer:

- **Nothing waits for it.** A change that re-asks it holds nothing on its account: its readers keep the answer they show, and the rest of the change shows now. An unready source it reads (`createDeferred(() => query())`) is the same: the node keeps its answer, nothing pends through it.
- **Its landing is a change of its own.** It shows when it lands, unless it lands into a hold (next bullet); an unrelated hold does not keep it back.
- **It never leads.** A re-ask that read a held value derived from that hold's world, so its answer lands into that hold and shows with its commit (F-7). Its readers that also read a held value see the committed one, as any reader does.
- **A held answer stays held.** Once a hold has taken its landing (a reader downstream is pending and staged it), a change that re-asks it still holds nothing: the change shows now, and the hold keeps the landing it took and shows it at its commit.
- **The verdict sees it.** `isPending` of the node, and of everything derived from it (a memo over it, a derived store's keys), is `true` from the re-ask until the landing (F-9: a new question). A `refresh()` re-ask is quiet. The verdict and the landed value change in one frame.
- **Truth readers wait for it.** `await refresh(d)` delivers the landing; `until`'s predicate does not see the stale answer of a source it derives from (the reader's own declaration: `resolve` takes the first settled value and does not wait).
- **Errors are not lag.** A rejected re-ask errors like any memo (F-12); the stale answer never masks it.
- **On the server it is `createMemo`** (everything is first load there).

**Collapses:** `docs/create-deferred.md` D1–D11 (2026-09-08, D11 ruled 2026-10-04; its lane-landing mechanism is superseded, see its §6). **Status:** standing, built 2026-10-14 (`tests/create-deferred.test.ts`, `tests/create-deferred-3710.test.ts`).

---

## Flagged — rulings that cannot cite a fundamental, stale archive text, mistakes

| item                                                                                                                                                                                                                                          | finding                                                                                                                                                                                                                                                                    | disposition                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **A35 draft (2026-10-06)** and fuzzer rule **MH8** (rev 21/22): a committed outside reader keeps a fresh or root mount closed                                                                                                                 | contradicts F-4 and the #3540 pins; generalized the `on` re-arm rule (D-16) to fresh mounts                                                                                                                                                                                | **mistake** — dropped 2026-10-07 (`outside-read-spec-draft.DROPPED.md`, fuzzer rev 23); D-12 is the statement       |
| **O2** "Creation under a transaction escapes the hold — recorded, not ruled"                                                                                                                                                                  | the archive text says _escapes_; the pins were re-pinned 2026-10-02 to _born held_ (D-2)                                                                                                                                                                                   | **stale archive text** — the archive is not edited; D-2 is the standing statement; O2 is linked from it             |
| **"Not yet one-way"** (direction rule, 2026-10-06): same-tick and in-flush mounts make the hold wait on their first loads — and the direction rule itself (#3820) was written as a maintainer ruling without one; its #3800 value half is D-2 | the wait is the rule (F-2). The +270 B mechanism that would stop the wait was not adopted, and should not be. The #3800 value half is D-2 (U-1)                                                                                                                            | **the rule** — the hold waits (F-2). U-2 is withdrawn. The #3800 value half is D-2 (U-1)                            |
| **#3824 known gap**: a boundary mounted by a pass that joined the hold shows its fallback now                                                                                                                                                 | contradicts D-13/F-7 as ruled 2026-10-06                                                                                                                                                                                                                                   | **built** (U-3, 2026-10-14)                                                                                         |
| **2026-10-06 `on` part of the boundary-scope ruling** (re-armed content "belongs to that boundary"), deferred in #3824                                                                                                                        | read as a visible spinner beside a same-source outside reader, it contradicts D-16. The off-screen half is the rule: the re-arm enters the fallback while the screen stays on the old content                                                                              | **withdrawn as a visible-screen claim, 2026-10-09** — D-16 is the statement; the archive sentence is unchanged      |
| **The 9:23 PM 2026-10-06 answer** ("1 i agree.. i had to do work to make Solid do this originally on page load")                                                                                                                              | answered a question that presented `next` as the outlier and omitted the #3540 pins; the maintainer's memory matches D-6 (no boundary), not a root-mounted `Loading`                                                                                                       | **misframed question**, superseded 2026-10-07; recorded so it is not cited again                                    |
| **A4** a custom `equals` never sees `undefined` prev on first commit                                                                                                                                                                          | an API contract about comparators, not an async-visibility rule; no fundamental covers it                                                                                                                                                                                  | **outside this spec's scope** — keep in the archive; belongs with the `createMemo` options docs                     |
| **A23's direct-argument form** `isPending(store)`                                                                                                                                                                                             | an accepted API shape (post-2.0), not a behavior rule                                                                                                                                                                                                                      | **not a rule** — tracked as API work                                                                                |
| **A28 (5)'s ambient clause and OL-R5** — an optimistic write with no action "is installed at the flush's start and reverted at its end" (`[1, 2, 1]`)                                                                                         | the earlier feasible width — the guess existed for one flush and reverted. Lane contract 2 (2026-10-01) tightened that to nothing; the pins were re-pinned 2026-10-02 and the `createOptimistic` JSDoc states it. The archive sentence was not amended                     | **tightened 2026-10-01** — D-32 is the statement                                                                    |
| **A20 / A21** (the mask)                                                                                                                                                                                                                      | superseded 2026-07-13 by A24                                                                                                                                                                                                                                               | archive only; D-23 is the statement                                                                                 |
| **§27 7b's loss** of the top-level `isPending(count)` affordance over `Errored > Loading`                                                                                                                                                     | a deliberate loss ("no one was expecting something that high in the parent scope to be isPending")                                                                                                                                                                         | **recorded**, not a rule; D-39                                                                                      |
| **`Reveal`** (`sequential`/`together`/`natural`/`collapsed`; "a collapsed tail renders nothing")                                                                                                                                              | reveal-order coordination, not async visibility                                                                                                                                                                                                                            | **outside this spec's scope** — `03-control-flow.md` is the statement                                               |
| **Server-side** (`isPending` always `false` on the server; `deferStream`; frames)                                                                                                                                                             | hydration-parity consequences of F-9; the frames contract has its own rulings doc                                                                                                                                                                                          | pointer only — `documentation/server-components/frames-rulings.md`                                                  |
| **A26's `await` escape**                                                                                                                                                                                                                      | a platform limitation, not a rule; stated as a narrowing of F-2 in D-7                                                                                                                                                                                                     | **narrowing**, documented escape                                                                                    |
| **JSDoc drift** (`action`, `until`, `refresh`, `affects`, `createOptimistic` lost detail in L2; `latest`/`isPending` have no JSDoc)                                                                                                           | the user docs are unchanged and complete                                                                                                                                                                                                                                   | **doc work** — restore from `05`/`06`, point JSDoc at the derived rules                                             |
| **D-20 as first drafted** — a fresh boundary "reports no pending" while its fallback shows                                                                                                                                                    | `isPending` false on a first load is F-9. A shown boundary forwarding pending is F-5. Content behind a fallback does not hold (F-3), but its verdicts are its own: `isPending` of it is what it would be anywhere, and `latest` of it is the value it produced (F-9, D-22) | **withdrawn 2026-10-08; residue ruled 2026-10-09** — no boundary verdict rule; F-3, F-9, and D-22 are the statement |
