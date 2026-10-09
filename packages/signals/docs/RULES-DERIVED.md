# Async rules — derived rules

**Status: DRAFT (2026-10-07), paired with [`RULES-FUNDAMENTALS.md`](./RULES-FUNDAMENTALS.md).** Every rule below cites the fundamental(s) it comes from, states the behavior in today's understanding, and links the archive entries it collapses — the A-rule sections of [`SPEC-ASYNC-SEMANTICS.md`](./SPEC-ASYNC-SEMANTICS.md) (with their dated amendments), the L2 hold-model rulings, the pre-L2 recovery's proposed rules (`B-…`), and the rulings of 2026-10-05 → 07. A derived rule narrows a fundamental to a shape; it never contradicts one. A rule whose source cannot cite a fundamental is under **Flagged** at the end.

Each rule carries: **From** (fundamentals) · **Scenarios** (in [`SCENARIOS.md`](./SCENARIOS.md)) · **Collapses** (archive links; the archive text is unchanged) · **Status** (`standing` — pinned and built; `ruled, not built` — pinned `it.fails`; `open → Q<n>` — in [`OPEN-QUESTIONS.md`](./OPEN-QUESTIONS.md)).

Archive links: `SPEC` = `./SPEC-ASYNC-SEMANTICS.md`. The L2 hold-model section is `SPEC#the-hold-model--l2-2026-10-04`; its dated paragraphs are cited by their bold titles.

---

## A. Holds — what waits (F-2, F-7)

### D-1. Reading a held value joins its hold

**From:** F-2, F-7, F-1. **Scenarios:** S-1, S-2.

A derivation that reads a value a hold has not yet revealed — a memo whose branch flips onto a held signal, a derived store's fold reading a held key through its draft — derives from the held world, so its result belongs to that hold and reveals with it. Tracked or untracked makes no difference (`untrack` is about dependencies, not about which world a pass derives from). A render effect is not a derivation: it reads the screen (D-3).

**Collapses:** [A29](./SPEC-ASYNC-SEMANTICS.md#a29-a-tracked-read-served-a-live-transactions-staged-value-enters-that-transaction) (read form, #3408; generalized 2026-10-01 "ruling A"), [A11](./SPEC-ASYNC-SEMANTICS.md#a11-sync-derivations-of-held-sources-are-visible-through-latestispending) (the sync derivation is visible through `latest`), L2 statement 2 "Reading the future joins it", CS-R31/#3733 (a derive reading a held key joins). **Status:** standing.

### D-2. A new memo joins a hold by reading it, not by being created

**From:** F-2, F-1, F-7. **Scenarios:** S-3, S-6, S-31.

A memo or effect created while a hold is live is not the hold's because it is new. It becomes the hold's if its first pass reads a held value, sync or async (D-1): it is then _born held_ — it has no committed value until the hold's commit, an untracked read of it throws `NotReadyError` meanwhile, and a render effect created with it first runs at that commit. A new memo that reads nothing held and nothing pending publishes now. A fresh render effect that reads the held value _directly_ shows the committed value (D-3). The entry is the pass's alone: a write made after the mount is a mainline write, not the action's. **Inside a flush**, a first pass that reads a value this same flush staged (not yet held) is treated as the frame's: it publishes with the flush, and if the flush parks it re-derives on the committed values; only a mount made under a display-ahead reader whose first pass read such a staging is born held (D-27). A boundary a held memo mounts in the same flush is not the hold's by creation: its content does not join, and it appears with the memo at the commit. The boundary reports no pending of its own while its fallback shows (F-9). `latest` of the content behind it is the value that content has produced, and `isPending` of that content is false, because that reader is not the display (F-3, D-22).

A sync memo that has read a held value has produced one, so `latest` of it returns that value and `isPending` of it is true until the hold paints it. An async memo has produced nothing until its answer lands, so `latest` of it throws. That answer is the hold's while a render effect outside a boundary consumes it, so the hold waits for it (F-2). If no such render effect reads it, the answer is the memo's own first commit once the hold has landed. A lane held on async downstream of the read does not paint, and does not hide a value `latest` can already return.

"In general transitions can hold on any unready read. But new memos created don't need to be part of it" (2026-10-07): a transition holds on any unready read (F-2); creation alone joins nothing. The word in that sentence was async; what was meant was a held value.

**Collapses:** [A29](./SPEC-ASYNC-SEMANTICS.md#a29-a-tracked-read-served-a-live-transactions-staged-value-enters-that-transaction) creation-time form ("born held", 2026-09-14/15, #3451) and its 2026-10-07 amendment "A verdict lane's mount over a staging" (#3851/#3869); L2 statement 3 as amended 2026-10-07; [O2](./SPEC-ASYNC-SEMANTICS.md#o2-creation-under-a-transaction-escapes-the-hold--recorded-not-ruled) (its text is stale — see Flagged); N1 (reverted 2026-10-02); #3761 (ruled against 2026-10-05); recovery 3.1/3.3; #3800 (the async first answer; drafted as D-5 and withdrawn as its own rule 2026-10-09) and the direction rule's value bullets (#3820). **Status:** standing, ruled 2026-10-09 (`tests/born-held.test.ts`, `tests/verdict-mount-first-pass-3851.test.ts`). The async first answer is ruled and not built (S-6, U-1).

### D-3. A render effect is a leaf: it shows the screen and re-derives at the commit

**From:** F-1, F-2. **Scenarios:** S-3, S-4.

A render effect that reads a held value is served the committed value — what is on screen — and is re-run at the hold's commit. It joins nothing. So a mainline mount shows the committed frame for its direct bindings and holds its derived ones (D-2) until the commit reveals both. A render effect groups whatever bindings the compiler put in one hole, and a pass belongs to whoever dirtied it: an unrelated sync write that re-runs a binding mid-hold publishes at once, reading the held flight as a stale reader (`{b()}:{detailsA()}` publishes `1:0`, then `1:1` at the landing); two independent flights read in one hole land at their own times. Memos keep the hold (a memo's value _is_ its hold's work), so entanglement through a user derivation of both stands.

**Collapses:** [A15](./SPEC-ASYNC-SEMANTICS.md#a15-transition-entanglement-is-graph-driven-lanes-settle-as-one-reveal) stale-reader term and shared-hole corollary (#3407), L2 statement 2 "frame readers see the screen", §13 "render effects are the frame" (2026-10-01), N1's surviving half ("only leaves read the screen"). **Status:** standing.

### D-4. Membership in a hold is the tick's

**From:** F-2, F-7. **Scenarios:** S-5.

The synchronous work one flush settles is one frame. Two mounts created before the same flush that each read a _different_ hold join both, and the two holds merge and reveal together; a manual `flush()` between them makes two frames, and the holds stay independent. The tick is defined by the flush, not by a microtask, `await` or timer. Inside a flush, a derivation in a mount that reads a foreign hold makes the whole tick join it — the `Show` that opened the mount, its direct bindings, the tick's other writes — unless a fresh boundary catches the derivation (D-12). The author's ways out are `<Loading>` (fallback now) and `latest()` (the proposal now).

**Collapses:** "Membership in a hold is the tick's" (2026-10-04, #3788), the #3761 ruling, #3802's analysis. **Status:** standing (`tests/tick-scoped-pass-transaction.test.ts`). A new async a render effect consumes in that tick makes the hold wait, whatever its source, unless a boundary catches it (F-2). `tests/direction-rule-probe.test.ts` pins the old screen, where the hold does not wait.

### D-6. A first load holds nothing; with no boundary anywhere, the root attach waits

**From:** F-2, F-4, F-9. **Scenarios:** S-7.

A source's first load is loading, not a change: it does not start a hold of its own. A render effect outside a boundary that consumes it makes the surrounding hold wait (F-2). An unobserved first load never bridges later writes into its flight. On first render, async that no boundary catches cannot show a fallback, so the root mount withholds the DOM attach until that async settles and then attaches atomically (`ASYNC_OUTSIDE_LOADING_BOUNDARY` warns; F-12). A root mount with a boundary above its async attaches now and shows the fallback (D-12). A node born with a declared first paint (`loadingValue`) is already committed: its first flight never suspends, never holds, never pends (D-30).

**Collapses:** [A27](./SPEC-ASYNC-SEMANTICS.md#a27-the-commit-0-loading-window-is-loading-class-and-verdict-quiet) (2), #2937, carve plan §15.2, B-ROOT, recovery 8.1, `34c65b8bf` (the deferred root attach). #2933's "a navigation is never slowed by what the new page starts loading" is withdrawn (2026-10-09); that fetch holds the navigation unless a boundary catches it (F-2). **Status:** standing.

### D-7. Actions are holds; `yield` is the suspension point; the same tick's earlier writes are adopted

**From:** F-2, F-10, F-11. **Scenarios:** S-8, S-9.

An `action`'s writes are held until every body in the transaction has returned and everything they put in flight has landed; the surrounding UI sees one atomic update at the end. `yield` is the only hold-safe suspension: the body resumes inside the hold at a `yield`, so the idiom is `await` for typed results, then a bare `yield` before any writes. A write to a fresh signal between an `await` and the next `yield` escapes and commits ambiently (a platform limitation, accepted); a signal the action already holds rejoins it even after an `await`. `flush()` inside a body does not reveal the hold. The writes stay held until the body settles. Dev throws `FLUSH_IN_ACTION`. Production skips the drain: `flush(fn)` still runs `fn`, and its writes stay in the hold. Ambient writes made earlier in the same tick as the action's start are the action's ("transitions are ambient; an action is just a special case to link them over async"); work arriving after the body's first `await` is not. Boundaries under an action follow the ordinary rules — entering a fallback may happen ahead (F-4), leaving one lands with the hold.

**Collapses:** [A26](./SPEC-ASYNC-SEMANTICS.md#a26-an-ambient-transaction-window-is-one-flush-parking-is-flush-driven), [O1](./SPEC-ASYNC-SEMANTICS.md#o1-same-tick-adoption--an-action-adopts-the-ambient-writes-made-before-it-in-the-same-tick), §26 "Actions" (2026-10-02), §27 question 5 "actions are just transitions", recovery 4.3/7.2/7.3, #3333 (2026-09-09, before the L2 rebuild: a `flush()` in the body parked the hold and committed the writes that followed; the older "drains the transaction mid-step" line described that bug). **Status:** standing. The `action`/`until`/`refresh` JSDoc lost detail in L2 (recovery 7.1/7.5) — restore from `06-actions-optimistic.md`, which is unchanged.

### D-8. A write is a proposal

**From:** F-2, F-10, F-1. **Scenarios:** S-10.

While a hold has a proposal for a slot (a staged, unrevealed value), a further write to that slot — the same value or another — is a second suggestion for the same slot, and the two cannot finish at different times: the writer's tick joins the hold and reveals with it. A tick whose writes net to the slot's committed value made no proposal: the slot is not held, pends nothing, and a later write to it is a plain mainline write. A held _derivation_ is not a proposal: a mainline write to a node whose held value is a pass result becomes `prev` for the hold's re-derivation and does not suppress it (`setB(101)` mid-hold, `b` re-derives to `200` under the hold; a `prev`-reading derivation folds the write); a second _write_ is still last-write-wins. Writes apply first, then derivations re-run.

**Collapses:** [A34](./SPEC-ASYNC-SEMANTICS.md#a34-a-write-is-a-proposal-one-on-a-held-node-entangles-its-tick-one-that-nets-to-the-committed-value-is-none) (1)–(3), rule B (#3733), #3743 (a store fold's notifications are diffs). **Status:** standing; one store shape pinned `it.fails` (`store/unchanged-presence-no-hold-3743.test.ts`, "a later mainline setter that does not write the held key publishes on the mainline tick").

### D-9. Entanglement is graph-driven; what shares an on-screen async derivation settles as one

**From:** F-1, F-2, F-3. **Scenarios:** S-11.

Two changes whose async work is observed by a shared on-screen derivation settle as one unit; changes on fully disjoint graphs settle independently. "Observed by a shared reader" is a pass observing the flight pending — a render effect's mere existence entangles nothing (D-3). A second flight reaching a memo another hold already holds enters that hold at the propagation, not at the memo's next pass. A reveal that _discovers_ an async already in flight — a `Show` opening onto a pending node whose inputs are already visible — joins the hold that flight blocks, as its first observer if nothing displayed it before; when the flight's inputs are themselves still held elsewhere, the reveal is a stale reader of that other hold (shows committed, entangles nothing, re-derives at its commit). A reader whose removal a hold has _staged_ is still on screen and holds for every other change until the commit removes it; a removal nothing holds releases at once. Removing a flight's last on-screen reader releases the write it held, even when a `latest()` of the flight follows.

**Collapses:** [A15](./SPEC-ASYNC-SEMANTICS.md#a15-transition-entanglement-is-graph-driven-lanes-settle-as-one-reveal) and its corollaries (#3407, #3443, #3305/#3334 reveal, #3458 first observer, #3463 zombies, #3494 through-a-memo and beside-a-release), [O3](./SPEC-ASYNC-SEMANTICS.md#o3-a-render-effect-gated-away-from-a-never-landing-flight-keeps-the-sources-write-held--fixed). **Status:** standing; fuzzer finding F2 ("a landing does not reveal a gate its stale reader re-derives onto a new flight") pinned `it.fails` in `tests/fuzz-findings-l2.test.ts`.

### D-10. The committed frame keeps its inputs until it is replaced

**From:** F-1. **Scenarios:** S-12.

A held pass has not replaced the committed frame, so the committed value still derives from the previous pass's inputs: a mainline write to an input the held pass stopped reading still reaches the node, which re-derives — and, reading a held input, joins that hold (D-1). A render effect's frame is the run that applied its value, so the same write reaches the effect and it re-derives on the screen at once (D-3). A pass that changed nothing replaced nothing either. An async memo's frame is replaced by its landing, not by the pass that started the flight. A source going _pending_ behind a kept input re-derives the node rather than marking it pending or skipping it.

**Collapses:** [A30](./SPEC-ASYNC-SEMANTICS.md#a30-a-memos-dependencies-are-the-committed-frames-until-the-frame-is-replaced) (#3410, #3438, #3461, #3469, #3494/#3519 refinements). **Status:** standing.

### D-11. A hold ends when its last on-screen reader leaves

**From:** F-3. **Scenarios:** S-13.

A hold lasts while an on-screen reader still observes a flight it waits on. When the last such reader leaves — disposed, re-run without the read (a gate closing), reset behind a fallback — the writes the hold kept for those readers alone commit at once; a hold is never kept open by a reader that no longer derives from the flight, nor by a display-ahead reader. A `Loading` reset moves the wait onto the boundary instead (D-14).

**Collapses:** [O3](./SPEC-ASYNC-SEMANTICS.md#o3-a-render-effect-gated-away-from-a-never-landing-flight-keeps-the-sources-write-held--fixed), #3426, #3372, #3375, A23 (a probe is never a blocker). **Status:** standing.

---

## B. Boundaries (F-3, F-4, F-5)

### D-12. An armed `<Loading>` whose mount is not held shows its fallback now; its content appears when ready

**From:** F-4, F-7, F-6. **Scenarios:** S-14, S-40.

An armed `<Loading>` catches the render effects under it that are pending (F-4) — membership is the render effect's position, not where a memo was created. When the frame that mounts it is not held — a click with nothing else holding, a mainline flush, a root `render`, a mount nested under a disarmed boundary — that frame is shown now, so the fallback is seen now, and the content appears when it is ready. An outside reader holding the same value holds that frame. The boundary has entered its fallback: the fallback is the display, so the content under it does not hold, and the fallback is not shown. The screen stays on the outside reader's content. The fallback is shown only if that hold ends before the boundary's content is ready. A sync read of the held value is ready when the hold ends, so the next screen is the content and the fallback is never shown: `Count 0 | Slow 0` while the hold is up, then `Count 1 | Slow 1 | count 1`. A root that is only that boundary shows nothing of the fallback while the hold is up, and the content at the release. Content under it that is bound by a render effect (`<p>{m()}</p>`) is caught the same way, so the boundary never reveals empty content. Content under it that is only loading (its own first fetch) appears at the landing, and the hold does not wait for it (F-4). A derivation _outside_ the boundary in the same flush still holds the tick (D-4). A fresh boundary whose content reads only `latest` of a held value, and nothing pending, shows that value now. A sibling that reads the unresolved async stays on the old content. The boundary does not wait for the sibling (F-6, S-40). While the fallback is the display, `isPending` of the boundary is false (F-9). `latest` of the content behind it is the value that content has produced, and `isPending` of that content is false, because that reader is not the display (F-3, D-22).

**Collapses:** [A29](./SPEC-ASYNC-SEMANTICS.md#a29-a-tracked-read-served-a-live-transactions-staged-value-enters-that-transaction) boundary exemption (#3540), "A boundary that has not shown content owns its subtree" (2026-10-06) and #3824, direction rule bullet 4, B-FRESH, B-ROOT, recovery 1.1–1.4, 8.1; the dropped A35 / fuzzer MH8 (Flagged). **Status:** standing for the catch, ruled 2026-10-09 for the sight. `tests/boundary-not-born-held-3540.test.ts` still shows the fallback beside the outside reader. The 2026-10-06 "fresh mount stays closed beside an outside reader" draft was withdrawn 2026-10-07; the catch stands, and the fallback is not shown while that reader holds.

### D-13. A boundary whose own mount is held appears at that hold's commit

**From:** F-4, F-7. **Scenarios:** S-15.

Whether a fallback is seen depends on whether the boundary is on screen. A fresh boundary opened by `<Show when={x()}>` with `x` held, or nested in content a hold has not revealed, is not on screen until that hold commits; it appears then, showing its fallback if its content is still loading, its content otherwise. A boundary mounted by a pass that itself joined a hold is the same case.

**Collapses:** the 2026-10-06 boundary-scope ruling ("a boundary mounted as part of a hold appears at that hold's commit"), #3869's "a boundary a held memo mounts in the same flush … appears with the memo at the commit". **Status:** ruled; one shape pinned `it.fails` — `tests/loading-fallback-in-flush-3540.test.ts` "a boundary mounted by a pass that joined the hold appears at its commit, no fallback" (today it shows its fallback now).

### D-14. A fallback-caught flight holds nothing; an `on` reset moves the wait onto the boundary

**From:** F-3, F-5. **Scenarios:** S-16, S-17.

A flight whose only observers are render effects behind a fallback holds no change — a memo under the boundary that no render effect reads was never an observer at all, and one rendered by an effect outside the boundary is that effect's read (F-3). In both orders: a render effect created under a fallback never counts, and a reader that counted while the boundary showed content stops counting the moment `on` sends it back to the fallback. Writes the hold kept for those readers alone commit at once (`Boundary: Loading... | Sum: 2` publishes as one frame); a reader outside the boundary still holds (`Sum` waits until `details` lands). The wait does not vanish; it moves onto the boundary: after the reset the fallback stays until every reader under it has settled — including readers whose flights started before the reset — then one coherent reveal.

**Collapses:** [A33](./SPEC-ASYNC-SEMANTICS.md#a33-a-fallback-caught-flight-holds-no-transaction-a-loading-reset-moves-the-hold-onto-the-boundary) (#3375, #3459), §23.1 item 1, recovery 2.2. **Status:** standing. The nested form — an outer `on`-reset boundary not waiting for a flight its nested `on`-reset boundary catches — is pinned `it.fails` (`tests/fuzz-findings-l2.test.ts`, fuzzer finding F1).

### D-15. `on` is a dependency list; the swap lands with the frame of the change that caused it

**From:** F-4, F-5, F-7. **Scenarios:** S-18.

`on` is a tracked expression whose value is irrelevant; a write to anything it reads re-arms the boundary. Optimistic writes and a source going pending notify like any write; an expression that reads nothing reactive never does; a zero-argument function is a tracked accessor, not a callback. The fallback follows the frame of that read: it lands with the change that caused it — now, when nothing else on the page waits on that change (`[A] → [B + spinner] → [B + comments]`); together with the rest of the new page during a held navigation (the shell reads `product(id)` outside: `[A] → [B + spinner] → [B + comments]` with the spinner arriving with B, not beside A). While that frame is held, the boundary has entered the fallback and the screen keeps the old content; the fallback is seen only if the hold lifts before the new content is ready. If the content is ready when the frame commits, no fallback is ever shown. The children are not re-created.

**Collapses:** #3575 (GabbeV's design, ruled 2026-09-21), B-ON, B-FRAME, recovery 4.1/4.2/5.1/5.2, the `createLoadingBoundary` JSDoc, `05-async-data.md`. **Status:** standing (`tests/loading-on-frame-following-3540.test.ts` §1–§2).

### D-16. A re-arm whose data is also read outside the boundary never shows its fallback; a race lost is not reported

**From:** F-5, F-7, F-2. **Scenarios:** S-19, S-20.

When the frame of an `on` change waits on the very source the boundary waits on — because a live reader _outside_ the boundary also reads it (a sibling `<Loading>` over the same data, an `isPending()` on it in the header) — the re-arm has entered its fallback, and that fallback is not shown. The hold lifts when the data lands, the content is ready in the same frame, and the fallback is never seen: `[A] → [B + comments]`. DEV reports `LOADING_ON_OUTSIDE_HOLD` once, at the change; the fix is structural (one boundary owns the read). A fresh mount beside an outside reader of the same value is the same sight (D-12); the diagnostic is re-arms only. This is only the flight the `on` change itself started: an outside reader of a flight the change did not start, or content an earlier action holds by a staged write, does not keep the re-arm's fallback from showing now (§3b, §3c of the frame-following pins). A frame held past the content's landing by something _else_ — the write's `action` staying open, other data the shell waits on — is a race the fallback may still win, a legitimate outcome, and nothing is reported (S-20).

A header that reads `latest(id)` beside `on={id()}` shows the new id beside the boundary's old content for the whole hold. That is `latest` (F-6). The boundary's `on` still reads the held value, so its fallback stays off screen; the header does not pull it on screen.

**Collapses:** #3575, #3584 (the after-the-fact report removed), B-SAME-SOURCE, B-RACE, recovery 5.3/5.4, `08-dev-diagnostics.md` `LOADING_ON_OUTSIDE_HOLD`. The 2026-10-06 sentence "committed content included, belongs to that boundary" (deferred in #3824) is this rule's off-screen half. Read as a visible spinner beside the outside reader's stale data, it is withdrawn (2026-10-09). **Status:** standing, ruled 2026-10-09 (`loading-on-frame-following-3540.test.ts` §3, §5).

### D-17. A display-ahead read in `on` shows the fallback now, beside the held frame

**From:** F-6, F-5. **Scenarios:** S-21.

`on` re-arms from whatever it reads, and the fallback appears when that read's frame has landed (D-15). `on={latest(id)}`, an `isPending()` or an optimistic signal reads a value whose frame has already landed, so the fallback shows now, beside the page that is still held: `[A] → [A + spinner] → [B + spinner] → [B + comments]`. The hold still owns every read of the held value. Content under the boundary stays off screen until it is ready; content under it that reads nothing held reveals as soon as it lands. No diagnostic. The `[A + spinner]` frame is the new id's loading state inside the old page, the same shape as a header showing the new id early. A memo between `isPending` and `on` behaves as the direct read does.

**Collapses:** #3575, B-AHEAD, recovery 6.1, §27 7a (#3528), `tests/loading-on-frame-following-3540.test.ts` §4, `tests/loading-on-rearm-reveal-3540.test.ts` ("on: () => latest(dep)"). **Status:** standing, ruled 2026-10-09 as the frame rule, not a break through the hold.

### D-18. A fallback that itself reads pending data

**From:** F-4, F-5. **Scenarios:** S-22.

On first load, a fallback that reads pending data is the parent's pending: the parent boundary shows _its_ fallback. After a re-arm, the swap waits for the fallback to be ready: the old content stays until the fallback can show, then the fallback, then the content — and if the content lands first, the fallback is never seen. A parent never drops to its own fallback for a child's re-arm.

**Collapses:** the 2026-09-21 ruling ("if a not ready async read happens in fallback…"), B-FALLBACK-PENDING, recovery 5.5, `tests/loading-on-rearm-reveal-3540.test.ts`. **Status:** standing.

### D-19. Queued runs behind a fallback wait; the synchronous first render goes through

**From:** F-3. **Scenarios:** S-23.

Every _queued_ run behind a fallback — render-effect updates and user effects, `Portal`'s `schedule: true` render effect included — waits in the boundary and is released at the reveal, so nothing behind a fallback reaches `document.body` early. The synchronous first render on creation goes through.

**Collapses:** §27 7g (2026-10-02, "we definitely shouldn't be showing portals early. Flip it."), B-QUEUED, recovery 9.5. **Status:** standing.

### D-21. An armed boundary lets a lane reveal: the async under the fallback does not hold it

**From:** F-4, F-3, F-6. **Scenarios:** S-24.

An armed boundary catches a lane the same way it catches a transition (D-12, D-14). A fallback lets a transition end early because the reads under it hold nothing; a fallback lets a lane end early for the same reason. A display-ahead value whose own async sits under that fallback is not held by it, so it reveals immediately, beside the fallback: header `1 | loading`, then `1 | details 1` when the async lands. A reader of that same async outside the boundary still holds the lane, as an outside reader still holds a transition. A disarmed boundary is not this rule: it forwards, and the lane holds on the async under it until that lands (F-5).

**Collapses:** the fuzzer-finding F6 ruling's fallback half (2026-10-05, "a boundary on its fallback still holds nothing", A33, B5). The showing-content half of that ruling is F-5, pinned by `tests/fuzz-findings-l2.test.ts` "F6: a lane holds through a Loading boundary showing content". "A boundary output that never committed holds nothing" (2026-10-05) is F-3. **Status:** standing, as the lane form of D-12 and D-14. A header `latest(id)` beside an `on={id()}` re-arm is D-16.

---

## C. Display-ahead readers and verdicts (F-6, F-9)

### D-22. `latest(x)` reads the newest value a flush has carried; it throws before a first value

**From:** F-6, F-10, F-9. **Scenarios:** S-25.

`latest(x)` answers the held write (the newest value a flush has processed, held or not), the optimistic value where one displays, the arrived truth under a superseded override, and the committed value of a node whose own flight is up (below the async nothing newer exists). A sync derivation of a held source is visible through it (the held recompute is a write path like any other). It throws `NotReadyError` only when no value has been produced — before a first landing, including an async memo with no resolution — in every scope. It returns `T`, never `undefined`. A lane held on async downstream of the read does not paint, and does not hide a value `latest` can already return. A memo behind a fallback has still produced its value, so `latest` returns it; that reader is not the display, so the node is not pending (F-3, F-9). Resolved async never pairs `[false, undefined]`.

**Collapses:** [A28](./SPEC-ASYNC-SEMANTICS.md#a28-a-write-becomes-visible-at-flush--to-every-channel) (`latest` reads the flushed staged world), [A11](./SPEC-ASYNC-SEMANTICS.md#a11-sync-derivations-of-held-sources-are-visible-through-latestispending), [A7](./SPEC-ASYNC-SEMANTICS.md#a7-resolved-async-never-reads-false-undefined), [A17](./SPEC-ASYNC-SEMANTICS.md#a17-an-active-override-is-the-displayed-value-until-its-transaction-commits-and-the-graphs-value-until-its-own-source-answers) (`latest` returns the arrived value). **Status:** standing.

### D-23. `isPending(x)`: three causes, two exceptions, question-scoped, atomic with the value

**From:** F-9, F-1. **Scenarios:** S-26, S-27.

`isPending(x)` is `true` while any of three causes holds: (i) a write held by a live hold; (ii) the node's own async in flight for a new question; (iii) a fresh value landed but held uncommitted by a hold it is entangled with — and `false` the moment none does. Exception 1: an uninitialized source is loading, not pending (`false`; its `NotReadyError` propagates to boundaries). A sync memo that has already produced a value, and whose reader is still the display, is cause (i), not this exception (D-2). Behind a fallback that reader is not the display, so `isPending` of the memo is false (F-3). Exception 2: a re-ask of the same question is quiet; an `affects()` mark is a declared new question and pends exactly the marked data and what derives from it, released when the declaring hold settles (or at flush end, ambient). `[isPending(x), x()]` read in one scope never pairs `true` with the fresh value: a verdict reader sees the screen. `isPending(() => latest(x))` follows `x`'s own non-quiet async only — on a signal or sync memo the latest form is never pending — so `[isPending(() => latest(x)), latest(x)]` never pairs `true` with the fresh value either. A spinner driven by `isPending` fires while the owner's async is still in flight (it does not wait for the hold).

**Collapses:** [A19](./SPEC-ASYNC-SEMANTICS.md#a19-ispendingx--the-observable-value-is-not-final-three-causes), [A24](./SPEC-ASYNC-SEMANTICS.md#a24-question-scoped-pending-pending-iff-a-value-change-is-in-flight-or-an-affects-mark-is-live), [A10](./SPEC-ASYNC-SEMANTICS.md#a10-ispendingx-x-is-atomic-within-one-scope), [A8](./SPEC-ASYNC-SEMANTICS.md#a8-ispending--latestx-follows-xs-own-async-only--verdicts-are-per-channel), [A14](./SPEC-ASYNC-SEMANTICS.md#a14-companion-nodes-get-child-lanes-that-do-not-merge-with-the-owner), [A20](./SPEC-ASYNC-SEMANTICS.md#a20-superseded-optimistic-writes-announce-a-store-wide-pending)/[A21](./SPEC-ASYNC-SEMANTICS.md#a21-superseded-the-store-wide-mask) (superseded — the mask is gone), recovery 6.3. **Status:** standing.

### D-24. `isPending` never throws unowned; the probe is reads-only

**From:** F-9, F-12. **Scenarios:** S-28.

`isPending(fn)` returns `false` from an unowned caller (an event handler, imperative code) whose thunk throws a real error or reads an uninitialized source; inside an owner — a component body, a computation, `untrack()` within either — the `NotReadyError` propagates so the reader participates in loading boundaries. `latest()` shares the mechanism but throws in every scope (D-22). The probe's thunk return value is never inspected: `isPending(() => store)` reads nothing and reports `false`; whole-store questions are asked through reads. (The direct-argument form `isPending(store)` is accepted API for post-2.0.)

**Collapses:** [A16](./SPEC-ASYNC-SEMANTICS.md#a16-ispending-never-throws-in-untracked-contexts) (B5/B5a; wording corrected 2026-09-14), [A23](./SPEC-ASYNC-SEMANTICS.md#a23-the-ispending-probe-is-reads-only). **Status:** standing.

### D-25. A display-ahead reader's own async is held; a memo computes under its own posture

**From:** F-6, F-1. **Scenarios:** S-29.

What is rendered from a display-ahead read reveals together with it: an async memo over `latest(x)` holds the `latest` view's reveal until it lands; a combined `isPending(() => [fast(), copy()])` over two async memos, one wrapped in a sync memo, stays `true` until both land, because a memo's value is one shared slot — it computes under its own hold posture, never under the posture of whichever reader pulled it.

**Collapses:** [A31](./SPEC-ASYNC-SEMANTICS.md#a31-a-memo-computes-under-its-own-lane-posture-never-its-pullers) (#3442), §20.1 question 3 ("Yeah definitely it is held. Consistent with any optimistic update"), OL-R24/R25/R34, recovery 6.2. **Status:** standing.

### D-26. A `latest()`/optimistic reader mounted or re-run mid-hold shows the committed value and reveals with the lane

**From:** F-6, F-1, F-3. **Scenarios:** S-30.

A held display-ahead world ("a lane") is a hold seen from the outside. A render effect _off_ it that reads what it is revealing — mounted mid-hold, or re-run by an unrelated sync write — shows the committed value (what is on screen), publishes now, entangles nothing, and re-derives at the release: `Late: 0` at the mount, `Details: 1 | Late: 1 | Value: 1` at the release. `latest()` is not special here: a `createOptimistic` source behaves the same. A reader whose removal is staged in a live hold is still on screen and keeps holding the lane while visible; `latest()` read in such a branch peers through to the proposal. A direct leaf reading a lane's derivation shows the lane's revealed value and re-derives at the reveal (control and content never disagree); a derivation between (a memo, a boundary's tree) carries the future and is born held with its mount (D-2).

**Collapses:** [A15](./SPEC-ASYNC-SEMANTICS.md#a15-transition-entanglement-is-graph-driven-lanes-settle-as-one-reveal) lanes corollary (#3460, #3463, #3479, #3662, #3698), #3444, the fuzzer-finding F8 ruling (2026-10-05, #3806), the adopted-staging ruling. **Status:** standing; fuzzer finding F5b ("a stale reader of a held re-guess shows the revealed guess") pinned `it.fails`.

### D-27. A verdict reader's mount is a mainline mount

**From:** F-6, F-4, F-1. **Scenarios:** S-31.

A `<Show when={latest(x) > 0}>` opens at once (display-ahead). The `<Loading>` it mounts is a mainline mount: it does not inherit the display-ahead world, so its content reads the screen's `x`. Inside an action's own flush that content's first pass reads the staging the action is about to hold, so it is born held (D-2): the boundary shows its fallback beside the committed `x = 0`, and `content 1` appears at the landing. Never `content 1` beside `x = 0`. A first pass created by an _optimistic_ lane, by contrast, is that lane's work (a binding an optimistic mount creates lands with its element).

**Collapses:** #3851/#3869 (2026-10-07), [A29](./SPEC-ASYNC-SEMANTICS.md#a29-a-tracked-read-served-a-live-transactions-staged-value-enters-that-transaction)'s 2026-10-07 amendment, L2 statement 3 as amended, #3835. **Status:** standing (`tests/verdict-mount-first-pass-3851.test.ts`, `tests/optimistic-mount-binding-3835.test.ts`).

### D-28. A read throws on its own; an earlier read does not disarm a later throw

**From:** F-1, F-2, F-4. **Scenarios:** S-39.

A read that has nothing to show throws, and a throw ends the pass, so the pass is held. Whether it throws is a property of that read. An earlier read in the same pass does not change it: an earlier `latest(s)` does not stop a later `n0()` — a lane derivation whose value has never shown — from throwing. `[n0(), latest(s)]` throws on `n0()` and `latest(s)` never runs. `[latest(s), n0()]` reads `latest(s)`, then `n0()` throws anyway. Both orders hold the mount: control stays off until `n0(1)` lands, then control and `[1, 1]` together. Under a fresh `<Loading>` the same throw is caught (F-4): control on, the fallback, then `[1, 1]`.

Order is not irrelevant. A throw means the rest of the pass does not run, so the two orders are different computations. What must not depend on order is the throw. The empty slot — control on, child absent — is that throw going missing: `latest(s)` put the reader in the lane and `n0()` waited as lane work instead of throwing.

**Collapses:** `read-order-ruling-brief.md` case 827 (the brief's "order never changes what a mount shows" was the wrong statement of this), `rewrite-bugs-rulings.md` item 1. **Status:** standing, ruled 2026-10-09. The `latest`-first order still suppresses the throw today. A fresh `<Loading>` that reads only `latest(s)` beside a sibling reading `n0()` never reads the throwing value, so it is not this rule (D-12, F-6, S-40).

### D-29. `createTrackedEffect` and `onSettled` callbacks see the screen

**From:** F-1, F-6.

Effect-phase code that runs after the frame is decided reads the frame as it stands: committed values, and a displayed optimistic value (the override is the frame). A held write is never visible to it; it cannot open or enter a hold of its own. On a pending node it reads the committed value; on an uninitialized one it receives `NotReadyError` (DEV: `PENDING_ASYNC_FORBIDDEN_SCOPE`); on a loading-window node, the loading value.

**Collapses:** [A32](./SPEC-ASYNC-SEMANTICS.md#a32-children-forbidden-readers-see-the-frame-not-the-graph). **Status:** standing.

### D-30. Stores: pending is per key; a derived store's seed is never visible; a declared first paint is loading

**From:** F-9, F-1. **Scenarios:** S-36, S-37.

Pending is per node — per store key: a held write to a plain store pends exactly the touched keys; a derived store's leaves report the derive's new-question refetch like any async memo, in both forms, and a quiet re-ask (`refresh(store)`) is quiet on them too. A derived store's landing resumes the frame that asked it: when a consumer of its leaves goes async, the landed leaves are held with that frame and read stale and pending until it reveals (signal parity); an untouched sibling key is final. A derived store's seed is a draft for the derive, never an observable value: until the first resolution (first yield for a generator) every outside read — tracked, untracked, `in`, enumeration — throws `NotReadyError` (DEV in a component body: `PENDING_ASYNC_UNTRACKED_READ`); write-path reads see it. `loadingValue` / `seedLoadingValue` promote a first value to commit #0: reads serve it, no boundary trips, no hold starts or extends, `isPending` is `false` on every axis until the first real landing — a hydration invariant (the server always answers `false`) — after which the node is an ordinary memo.

**Collapses:** [A9](./SPEC-ASYNC-SEMANTICS.md#a9-store-leaves-behind-a-firewall-report-the-firewalls-new-question-refetch), [A22](./SPEC-ASYNC-SEMANTICS.md#a22-pending-is-per-node-store-wide-only-for-the-firewalls-own-work) (amended 2026-10-03), [A25](./SPEC-ASYNC-SEMANTICS.md#a25-a-derived-stores-seed-is-a-draft-never-an-observable-value), [A27](./SPEC-ASYNC-SEMANTICS.md#a27-the-commit-0-loading-window-is-loading-class-and-verdict-quiet), the L2 stores ruling (statement 7), OS-R30–R36, PJ-R23/R30/R31. **Status:** standing; one adoption shape pinned `it.fails` (`adoption-unchanged-key-read-3706.test.ts`, a row first read after the adoption).

### D-31. `resolve`, `until` and `refresh` deliver by the hold they are called in

**From:** F-6, F-11, F-2.

An action is not special here. It is only the usual way a hold is open when they are called.

`resolve(fn)` delivers the first settled value as that hold sees it, guesses included. With no hold open, that is the screen. `until(fn)` always reads the authoritative view: a guess and the structure it adds are invisible, so a guess never satisfies the wait for its own confirmation. Staged truth reads normally, including a `refresh()` issued in the same hold. If a hold is open, the landing that flips the predicate joins it and reveals with it; with nothing held, `until` waits and resolves. `refresh(x)` returns the next quiescent state. A re-ask of the same question is quiet (`isPending` stays `false`). Called inside a hold, the landing is staged into that hold and the promise delivers the staged value, never the hold's guess. Called with nothing held, it delivers the settled value. A reader of a foreign hold's frame delivers at that hold's commit, never a foreign hold's unrevealed frame.

**Collapses:** L2 statement 8 (#3482/#3490), §27 question 2 (#3164), [A17](./SPEC-ASYNC-SEMANTICS.md#a17-an-active-override-is-the-displayed-value-until-its-transaction-commits-and-the-graphs-value-until-its-own-source-answers)'s authoritative-reader carve-out, `06-actions-optimistic.md` `until`. **Status:** standing; JSDoc on `until`/`refresh` lost this detail in L2 (recovery 7.1).

---

## D. Writes and optimistic values (F-10, F-11)

### D-32. Nothing shows a write before its flush; a guess with nothing to be optimistic over is void

**From:** F-10, F-11. **Scenarios:** S-25, S-32.

`set(count, 30); latest(count)` is the pre-write answer until the flush that carries it, after which `latest(count)` is 30 and `latest(doubled)` is 60 in the same instant. `isPending(x)` is `false` for an unflushed write. A `latest()`/`isPending()` reader created after several flushes answers as if it had always existed (its answer is the holding change's, and lives and reverts with the hold). An optimistic write is visible from the flush that carries it, as a guess over that frame's hold: one an action holds stays for the action's lifetime; one made in a frame that something else holds (a plain write waiting on async) rides that hold. A guess written in a frame that commits with nothing held is as if it never happened — nothing is applied, no effect sees it. A28 (5) and OL-R5 installed that guess for the flush and reverted it (`[1, 2, 1]`): the narrowest width that could be built then. Lane contract 2 (2026-10-01) closes that gap. The `createOptimistic` JSDoc states the tightened rule.

**Collapses:** [A28](./SPEC-ASYNC-SEMANTICS.md#a28-a-write-becomes-visible-at-flush--to-every-channel) (1)–(5), [O4](./SPEC-ASYNC-SEMANTICS.md#o4-adopted-unflushed--the-signals-verdict-channels-see-a-write-no-flush-has-carried--fixed), lane contract 2, OL-R5, OS-R22. **Status:** standing.

### D-33. An optimistic value lives exactly as long as the hold it was made over; same-slot writes entangle, disjoint slots do not

**From:** F-11. **Scenarios:** S-32.

An override's lifetime is that of the hold it was made over — in the usual shape, its own action's: the hold committing reverts (or lands the truth beneath) exactly its own writes; concurrent actions on disjoint slots — different signals, different store keys — settle independently; same-slot writes from two actions entangle, and the slot reverts only when the last of them settles. Ownership never travels through a shared reader: a render effect reading keys two actions wrote merges their reveals for scheduling, not their ownership. Regular writes in the same action hold (F-2); at the end, revert and commit are one frame.

**Collapses:** [A18](./SPEC-ASYNC-SEMANTICS.md#a18-an-override-lives-exactly-as-long-as-its-own-transaction-a-newer-truth-from-the-source-supersedes-it-in-the-graph-immediately-on-screen-at-commit) lifetime, store corollary (#2899), node corollary (#2912); OL-R6/R14–R18/R26; OS-R18–R23. **Status:** standing.

### D-34. A different truth corrects the graph now and the screen at the commit; what the screen never showed is void

**From:** F-11, F-1, F-6. **Scenarios:** S-33.

When an override's own source answers (its own landing, or a sync recompute from an upstream change): an equal answer confirms silently — nothing re-runs; a different answer corrects — derivations re-derive from the truth now as the hold's work (downstream refetches restart at once, no waterfall), the screen and untracked reads keep what the screen showed until the commit, `latest()` answers the truth and `isPending()` reads `true` while they differ, and the correction reveals with the hold. "Keep the override" means keep what _showed_: a guess the screen never displayed — its reveal held on its own downstream flight, including through a shown `Loading` — is void at the correction, and untracked reads see the committed value, as the screen does. A later landing equal to the override restores it as the graph's value.

**Collapses:** [A18](./SPEC-ASYNC-SEMANTICS.md#a18-an-override-lives-exactly-as-long-as-its-own-transaction-a-newer-truth-from-the-source-supersedes-it-in-the-graph-immediately-on-screen-at-commit) supersession (#3331, 2026-09-09/10) and (d) before the first commit, "Correction display is what showed" (2026-10-05), lane contract 2, lane ruling 5, [A17](./SPEC-ASYNC-SEMANTICS.md#a17-an-active-override-is-the-displayed-value-until-its-transaction-commits-and-the-graphs-value-until-its-own-source-answers) (2026-09-09), OS-R39. **Status:** standing.

### D-35. Provenance: an older question's answer never corrects a newer guess; the body's end corrects what nothing authoritative is answering

**From:** F-11. **Scenarios:** S-34, S-35.

Two rapid actions on one slot: the older action's refetch landing after the newer override is a question the user has since changed — it is staged for the commit but does not supersede (no downstream re-derivation, no pending flip; `latest` keeps the override; `isPending` is `true` because the held value differs). Only the override's own action, a later action, or mainline supersedes. A keyed store landing beneath an arrangement guess is re-based over the older truth by row key. When every action body has returned and nothing authoritative is in flight — not the override's own source, not a plain load the action asked for — each override still in force is corrected by the truth at hand (the staged equal landing, else the committed value), for a store guess as for a signal's; display is unchanged until the commit.

**Collapses:** [A18](./SPEC-ASYNC-SEMANTICS.md#a18-an-override-lives-exactly-as-long-as-its-own-transaction-a-newer-truth-from-the-source-supersedes-it-in-the-graph-immediately-on-screen-at-commit) provenance (2026-09-10; Q-D 2026-10-03), body-end corollary (#3427), §27 question 1, L2 statement 5, OL-R20, OS-R24/R43/R45. **Status:** standing.

### D-36. A resting optimistic node is a plain memo

**From:** F-9, F-11.

With no active override, `createOptimistic(fn)` is observationally a `createMemo(fn)` for `read`/`latest`/`isPending` at every checkpoint of a refetch cycle — before any override and after a full cycle reverted; a revert is not a refetch and never pends.

**Collapses:** [A12](./SPEC-ASYNC-SEMANTICS.md#a12-resting-optimistic-nodes-report-pending-like-a-plain-memo), [A13](./SPEC-ASYNC-SEMANTICS.md#a13-resting-optimistic--plain-async-memo-at-every-checkpoint), V1–V3/V5. **Status:** standing.

### D-37. A lane sees the screen plus its own guesses and never holds a sync write

**From:** F-6, F-11, F-1.

The optimistic world is the screen plus the action's guesses: derivations of a guess publish into that world (a memo over an optimistic value shows the speculative result to the lane's readers and to direct reads, the committed one to readers off the lane — a whole frame either way). Lane work never makes its node the action's: an unrelated sync write re-running a `<Show>` over an optimistic value publishes at once and the action stays open; the frame a lane pass replaces leaves the screen when the lane's run applies, after a held lane's reveal, never before.

**Collapses:** L2 statement 4 and §19 (2026-10-01), [A17](./SPEC-ASYNC-SEMANTICS.md#a17-an-active-override-is-the-displayed-value-until-its-transaction-commits-and-the-graphs-value-until-its-own-source-answers) "lanes stage" (#3479), [A15](./SPEC-ASYNC-SEMANTICS.md#a15-transition-entanglement-is-graph-driven-lanes-settle-as-one-reveal) lane work vs transaction work (#3662, #3698), OL-R9/R31. **Status:** standing.

---

## E. Errors (F-12)

### D-38. Effect error phases; a comparator throw is a compute error; an escaping error halts

**From:** F-12.

`createEffect`'s error arm intercepts compute-phase errors only; an unhandled compute-phase error in a user effect is logged and the run skipped; effect-phase throws escalate to the nearest `<Errored>` and halt with none. A user `equals` that throws is a compute-phase error. An error escaping every boundary halts the system (`REACTIVITY_HALTED`); later writes log "Update ignored". `ASYNC_OUTSIDE_LOADING_BOUNDARY` is warn-only; `<Errored>` never catches a pending.

**Collapses:** [A1](./SPEC-ASYNC-SEMANTICS.md#a1-effect-error-interception-is-compute-phase-only), [A2](./SPEC-ASYNC-SEMANTICS.md#a2-unhandled-compute-phase-errors-in-user-effects-are-logged-and-skipped), [A3](./SPEC-ASYNC-SEMANTICS.md#a3-comparator-throws-are-compute-phase-errors), [A5](./SPEC-ASYNC-SEMANTICS.md#a5-an-error-escaping-every-boundary-halts-the-system), [A6](./SPEC-ASYNC-SEMANTICS.md#a6-async_outside_loading_boundary-is-warn-only). **Status:** standing.

### D-39. An error fallback is the display; it stays until a new answer replaces the error

**From:** F-12, F-3, F-1. **Scenarios:** S-38.

An `<Errored>` flipping to its fallback is a boundary going back to its fallback: the nodes behind it stop holding (unless read elsewhere, where they error too), and non-errored nodes that lose their only visible consumer that way stop holding as well. The error stays on screen until a new answer replaces the errored one — a pending is not a value: over `Errored > Loading(never shown)`, a write publishes beside the old error (`0 | Fetch error for 0` → `1 | Fetch error for 0` → `1 | Fetch error for 1`); the inner fallback is hidden behind the error. `Errored` builds its function fallback in its own scope, like `Show`.

**Collapses:** §23.1 items 2–3, §27 7b (2026-10-02; the top-level `isPending(count)` affordance was lost by this ruling, knowingly), recovery 9.1–9.3. **Status:** standing.

---

## Flagged — rulings that cannot cite a fundamental, stale archive text, mistakes

| item                                                                                                                                                                                                                                          | finding                                                                                                                                                                                                                                                | disposition                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **A35 draft (2026-10-06)** and fuzzer rule **MH8** (rev 21/22): a committed outside reader keeps a fresh or root mount closed                                                                                                                 | contradicts F-4 and the #3540 pins; generalized the `on` re-arm rule (D-16) to fresh mounts                                                                                                                                                            | **mistake** — dropped 2026-10-07 (`outside-read-spec-draft.DROPPED.md`, fuzzer rev 23); D-12 is the statement       |
| **O2** "Creation under a transaction escapes the hold — recorded, not ruled"                                                                                                                                                                  | the archive text says _escapes_; the pins were re-pinned 2026-10-02 to _born held_ (D-2)                                                                                                                                                               | **stale archive text** — the archive is not edited; D-2 is the standing statement; O2 is linked from it             |
| **"Not yet one-way"** (direction rule, 2026-10-06): same-tick and in-flush mounts make the hold wait on their first loads — and the direction rule itself (#3820) was written as a maintainer ruling without one; its #3800 value half is D-2 | the wait is the rule (F-2). The +270 B mechanism that would stop the wait was not adopted, and should not be. The #3800 value half is D-2 (U-1)                                                                                                        | **the rule** — the hold waits (F-2). U-2 is withdrawn. The #3800 value half is D-2 (U-1)                            |
| **#3824 known gap**: a boundary mounted by a pass that joined the hold shows its fallback now                                                                                                                                                 | contradicts D-13/F-7 as ruled 2026-10-06                                                                                                                                                                                                               | **ruled, not built** — `it.fails`                                                                                   |
| **2026-10-06 `on` part of the boundary-scope ruling** (re-armed content "belongs to that boundary"), deferred in #3824                                                                                                                        | read as a visible spinner beside a same-source outside reader, it contradicts D-16. The off-screen half is the rule: the re-arm enters the fallback while the screen stays on the old content                                                          | **withdrawn as a visible-screen claim, 2026-10-09** — D-16 is the statement; the archive sentence is unchanged      |
| **The 9:23 PM 2026-10-06 answer** ("1 i agree.. i had to do work to make Solid do this originally on page load")                                                                                                                              | answered a question that presented `next` as the outlier and omitted the #3540 pins; the maintainer's memory matches D-6 (no boundary), not a root-mounted `Loading`                                                                                   | **misframed question**, superseded 2026-10-07; recorded so it is not cited again                                    |
| **A4** a custom `equals` never sees `undefined` prev on first commit                                                                                                                                                                          | an API contract about comparators, not an async-visibility rule; no fundamental covers it                                                                                                                                                              | **outside this spec's scope** — keep in the archive; belongs with the `createMemo` options docs                     |
| **A23's direct-argument form** `isPending(store)`                                                                                                                                                                                             | an accepted API shape (post-2.0), not a behavior rule                                                                                                                                                                                                  | **not a rule** — tracked as API work                                                                                |
| **A28 (5)'s ambient clause and OL-R5** — an optimistic write with no action "is installed at the flush's start and reverted at its end" (`[1, 2, 1]`)                                                                                         | the earlier feasible width — the guess existed for one flush and reverted. Lane contract 2 (2026-10-01) tightened that to nothing; the pins were re-pinned 2026-10-02 and the `createOptimistic` JSDoc states it. The archive sentence was not amended | **tightened 2026-10-01** — D-32 is the statement                                                                    |
| **A20 / A21** (the mask)                                                                                                                                                                                                                      | superseded 2026-07-13 by A24                                                                                                                                                                                                                           | archive only; D-23 is the statement                                                                                 |
| **§27 7b's loss** of the top-level `isPending(count)` affordance over `Errored > Loading`                                                                                                                                                     | a deliberate loss ("no one was expecting something that high in the parent scope to be isPending")                                                                                                                                                     | **recorded**, not a rule; D-39                                                                                      |
| **`Reveal`** (`sequential`/`together`/`natural`/`collapsed`; "a collapsed tail renders nothing")                                                                                                                                              | reveal-order coordination, not async visibility                                                                                                                                                                                                        | **outside this spec's scope** — `03-control-flow.md` is the statement                                               |
| **Server-side** (`isPending` always `false` on the server; `deferStream`; frames)                                                                                                                                                             | hydration-parity consequences of F-9; the frames contract has its own rulings doc                                                                                                                                                                      | pointer only — `documentation/server-components/frames-rulings.md`                                                  |
| **A26's `await` escape**                                                                                                                                                                                                                      | a platform limitation, not a rule; stated as a narrowing of F-2 in D-7                                                                                                                                                                                 | **narrowing**, documented escape                                                                                    |
| **JSDoc drift** (`action`, `until`, `refresh`, `affects`, `createOptimistic` lost detail in L2; `latest`/`isPending` have no JSDoc)                                                                                                           | the user docs are unchanged and complete                                                                                                                                                                                                               | **doc work** — restore from `05`/`06`, point JSDoc at the derived rules                                             |
| **D-20 as first drafted** — a fresh boundary "reports no pending" while its fallback shows                                                                                                                                                    | `isPending` false on a first load is F-9. A shown boundary forwarding pending is F-5. Content behind a fallback does not hold (F-3): `isPending` of it is false, and `latest` of it is the value it produced (D-22)                                    | **withdrawn 2026-10-08; residue ruled 2026-10-09** — no boundary verdict rule; F-3, F-9, and D-22 are the statement |
