# Async/Pending/Transition Semantics — Spec Propositions

> **Index:** every rule ID cited from `src/` or `tests/` — this file's A/B/C/V ids, the INV/RUL/R/§ vocabularies of the internals and rules-mining docs — is listed with status, definition and citations in [`RULES-INDEX.md`](./RULES-INDEX.md) (generated; `node scripts/rules-index.mjs`). IDs are never renumbered.

Companion to `INTERNALS-ASYNC-STATE.md`. Each proposition is a testable,
user-observable behavior statement about `isPending` / `latest` / transitions /
optimistic lanes.

- **Tier A** — has a citable ruling or design decision. Pinned by tests that
  should be treated as _spec_: changing them requires a design decision, not a
  code fix. Do not "update expectations" here to make an implementation change
  pass. These are the topic sections below.
- **Tier B** — believed correct but _inferred_ from code/issues; needed a
  maintainer verdict before promotion to Tier A. Every B item has since been
  ruled (promoted or rejected); the list is under History.
- **Tier C** — genuinely open items needing a decision. Every C item has since
  been ruled or closed; the list is under History.

## How to read this file

Rules are grouped by **topic**, not by number; IDs are stable and never renumbered (source comments cite them — `docs/RULES-INDEX.md` resolves every citation). Each rule carries:

- **Status** — `ruled` (a citable ruling), `ruled, amended in place` (re-ruled or re-scoped since; the statement text records how and when), `superseded … by A<n>` (replaced; kept verbatim for the reasoning record).
- **Pinned by** — the tests that are this rule's spec. Changing them is a design decision, not a code fix.
- **Mechanism** — added by the 2026-09-14 index: the node fields / functions the rule requires. This is the column a single visibility resolver would be built from; it is a cross-reference, not part of the ruling.

The former Tier A table is these sections. Tier B/C, the fixed violations, and the dated re-ruling logs are unchanged below under History.

## Reads and visibility — what a read serves

### A17. An active override is the displayed value until its transaction commits, and the graph's value until its own source answers

**Status:** **ruled, amended in place** 2026-07-06 (promoted from C4) — maintainer ruling, 2026-07-06/07; amended 2026-09-09 (#3331: "knowing otherwise" splits display from tracked derivations — see A18 supersession); carve-out ruled 2026-09-14 (`until()` reads the landed world); **lanes stage** ruled 2026-09-15 (#3479 review: an optimistic derivation is an override)
**Pinned by:** `tests/spec-async-semantics.test.ts`; downstream-async lane holding: `tests/createOptimistic.test.ts` (CategoryDisplay/News-Finance real-world sections); `tests/lane-outside-view.test.ts` (#3460: a reader mounted or re-run mid-hold, `latest()` and `createOptimistic` alike; #3479: the outsider's frame is whole, a never-ready guess never shows beside its old derivation)
**Mechanism (index, 2026-09-15):** `_overrideValue` + `hasActiveOverride`; value selection in `read` / `readNodeFast` / store `serveDataKey`; authoritative-view carve-out for `until()` (`CONFIG_AUTHORITATIVE_READ`); held-truth mask `CONFIG_HELD_TRUTH` (#3164); after the own-source landing `supersededRead` routes tracked readers to the arrived value while untracked reads keep `_overrideValue` (`CONFIG_OVERRIDE_SUPERSEDED`, #3331). **Lanes stage (#3479):** a lane pass on a memo — its sync recompute (`recompute`'s lane branch) or its async landing (`asyncWrite`'s lane branch) — publishes into the override slot as a _derived override_ (`laneOverride`, `CONFIG_DERIVED_OVERRIDE`); `_value` stays the committed truth. The derived override rides the written override's machinery unchanged: display and tracked selection (`read()`'s override arm, `overrideRead`), the A18 sync twin when a plain pass re-derives it, the revert with the lane's transaction (`resolveOptimisticNodes`, which _promotes_ it — the truth confirmed the guess — instead of dropping to a stale `_value`). Where a written override means intent, a derived one means "a pass's answer": it does not block lane merging through the node (`assignOrMergeLane`), does not stop pending propagation as an optimistic boundary (`notifyStatus`), suspends its lane readers while its re-ask is in flight (`laneSuspends`), is not superseded at body-end nor does its flight hold the settle (`endOptimism`, `transitionBlocked` — it re-derives when its source's is), carries no `_overrideTime` (not an unflushed write, A28), and is no acknowledgement to the hold census (attribution `isCompanion`). A lane pass over a WRITTEN guess (a `createOptimistic(fn)` corrected from fresh upstream data) marks it derived too — the guess is gone, the slot holds fn's answer — and the next user write re-arms it (`optimisticWrite` clears the bit).

**Statement (current).** (was C4) **Amended 2026-09-09 (#3331):** "until we know otherwise" is the landing of the node's own async, and knowing otherwise splits the readers: from that landing on, the override is the value for the _display_ — untracked/ambient reads and the applied frame — until the transaction commits, while tracked derivations (memos, async drivers, lane recomputes) see the arrived truth (A18 supersession). `latest(x)` returns the arrived value; `isPending(x)` is `true` iff it differs from the override. "It is the optimistic future value... it is both immediate and is the future until we know otherwise." "Knowing otherwise" is its own async source resolving (see A18); a transition whose optimistic node is still pending on its own fetch is not complete, so the override cannot be dropped early. **No-tearing is an effect-level concern, not a read-level one**: when async _derived from_ the optimistic value is in flight, the lane holds its render effects (the rendered view keeps the committed state as a unit) — but direct reads still return the override ("direct read shows optimistic, effect waits"). Every render effect off the lane is held to the same view (#3460, A15 lanes corollary): one mounted or re-run by an unrelated sync write mid-hold is served the committed value and re-runs at the release — only direct reads return the override while the lane holds. **Lanes stage (ruled 2026-09-15, #3479 review):** that committed view is a _whole frame_. An optimistic derivation is an override: a memo the lane recomputes publishes its speculative result as a derived override, not into `_value`, so the source's shadow and every derivation of it are held in one place — the lane's readers and direct reads see the optimistic frame, a reader off the lane sees the committed one, and neither is torn. Before, a lane pass direct-committed `_value` (INV-11's "lane direct commit"), and the outsider saw the committed source beside a speculative derivation (`Late: 0 1` for `latest(count)` and a memo of it; gabbev's fuzzer, latest cohort: 57 → 6 published-derivation disagreements, 26 → 0 torn tuples delivered to an effect). Off the lane is provenance, not membership: a pass under the lane's own transaction — its async's landing re-entering it with no ambient lane — is the lane's work, not an outsider (`readsHeldCommitted`; the `1:0` frame of an optimistic value that never finished preparing, #3479 review). The revert promotes a derived override that was not superseded: a derivation nobody told otherwise is, by the graph's invariant, what the truth yields — re-deriving it re-asked an async member's flight and held the transaction on a frame already on screen. **Authoritative-reader carve-out (ruled 2026-09-14, visibility oracle):** `until()`'s predicate reads the _landed_ world — values a source has actually produced, staged or committed, before they have become visible — and never the caller's optimism. Maintainer: "it needs to work off landed values, but before they have become visible." So under a held write it sees the staged value; over an override it sees the truth beneath (staged if one arrived, else committed); over a pending or uninitialized node it suspends like any reader; over a loading-window node it sees the loading value. Mechanism: `CONFIG_AUTHORITATIVE_READ` on the predicate's computation, `authoritativeServe()` on the store side.

**History (superseded formulation, kept verbatim).** The 2026-07-06 wording — its "tracked alike" and "any read path" clauses are replaced by the 2026-09-09 amendment the statement now leads with; the display half of both sentences still holds: An _active_ optimistic override is THE value for every **read** — ambient/untracked and tracked alike — regardless of transition entanglement. Do NOT mask the override from any read path to prevent tearing; that breaks the real-world optimistic-UI contract.

### A18. An override lives exactly as long as its own transaction; a newer truth from the source supersedes it in the graph immediately, on screen at commit

**Status:** **ruled, amended in place** 2026-07-07 (promoted from B4) — maintainer rulings, 2026-07-07 (original) and 2026-07-07b (re-rule: "the non-blocking aspect… only gates the reveal"); mechanism re-ruled 2026-09-09 (#3331, supersession: "a new value from the source should remove the optimism immediately") with scope and provenance ruled 2026-09-10; store/node ownership corollaries 2026-07-17/18 (#2899, #2912); body-end corollary 2026-09-14 (#3427: the action body ending supersedes the overrides still in force when nothing authoritative is in flight)
**Pinned by:** `tests/spec-async-semantics.test.ts` (same pins — behavior coincides in unmerged graphs); `tests/optimistic-store-layer-scope.test.ts` (store corollary: disjoint-key independence, nested rows, same-key entanglement, delete survival, ambient flush-end); `tests/optimistic-lane-transaction-ownership.test.ts` (node corollary: shared-subscriber lane merge with swapped write order, three-action signal hijack); `tests/optimistic-lane-release.test.ts` (body-end corollary, and #3426: the last async reader unmounting releases the frame)
**Mechanism (index, 2026-09-14):** `CONFIG_OVERRIDE_SUPERSEDED` set by `supersedeOverride` on a differing, postdating source landing; `supersededRead` serves the arrived value to tracked readers while untracked reads keep `_overrideValue` until commit (#3331); `_overrideTime` / `_overrideStamp` decide "postdates" and provenance (2026-09-10); `_overrideOwner` answers ownership instead of the lane (#2912); the arrival itself is staged in `_pendingValue` and elevated by `commitPendingNode` like any transition write; `endOptimism` (`GlobalQueue._endOptimism`, from `flush` after the heap, before the verdict) supersedes with the node's own truth once `_acted` and no `_actions` remain and nothing authoritative blocks (#3427).

**Statement (current).** (was B4; **refined by re-rule 2026-07-07b**) An override's lifetime is bound to **its own transition** — which, because lanes keep their transitions separate from unrelated work, contains exactly the override's own async cascade. **Supersession (re-ruled 2026-09-09, #3331): own-source arrival removes the optimism from the graph immediately; the display keeps it until the transaction commits.** Maintainer: "a new value from the source should remove the optimism immediately.. if it matches then no more work, if it doesn't match then that work gets folded into the parent transition"; "when the optimism drops we might not see it until end of transition because it folds into the parent's transition." This replaces the mechanical sentence above ("elevate to `_value` only at their transition's commit; the elevation is unobservable under the override mask") — that model let the override's own downstream flight serialize ahead of the truth's, doubling the delay the reporter saw. Now: (a) a landing that _equals_ the override confirms silently — nothing re-runs, the lane's in-flight work completes the frame; (b) a landing that _differs_ marks the node superseded: its subscribers recompute from the arrived value on the plain channel (their lane affinity is dropped, so this is held transaction work, not lane work), downstream async restarts from the truth _now_, and the override's own downstream flight is inert when it lands; (c) untracked reads and the applied screen keep the override until the transaction — holding for whatever the corrected derivations observe (A15) — commits and clears the override; (d) `latest` returns the arrived value, `isPending` reads `true` iff the arrival differs (consequence (3) unchanged in statement, now true in mechanism). **(d) before the first commit (2026-09-15, visibility oracle):** the verdict holds for a node that has never committed — its first landing held by a reveal that never landed — because the override is the observable value; A19 exception (1) ("uninitialized is loading, not pending: no observable value exists") does not apply under a displayed override. Pinned: `tests/superseded-before-first-commit.test.ts`. A later landing on the same node that equals the override un-supersedes it (the override is again the graph's value). **Scope (ruled 2026-09-10): "the source" is whatever recomputes the node** — its own async landing, or a synchronous recompute driven by an upstream change (`createOptimistic(() => userCategory())` over an async memo is the common real-world shape): "if the source recomputes it doesn't matter if it is async or not." **Ordering:** a new value from the source is one that _postdates_ the override — a source write and an override in the same batch derive nothing new (the override is written over that batch's truth knowingly and stays the graph's value until the commit reveals it). **Provenance (ruled 2026-09-10):** "a new value from the source" answers the override's _own_ question or a newer one. Two rapid actions on one node merge into one transaction, and the older action's refetch can land after the newer override; that answer is a question the user has since changed — it is staged for the commit like any landing (and reveals then iff it is still the truth) but does **not** supersede: no downstream re-derivation, no pending flip on downstream readers. "A slow source shouldn't leak back in like that." Only the override's own action, a later action, or mainline (no action — a fresh question by definition) supersedes. **Body-end corollary (2026-09-14, #3427):** the action bodies were the optimism's justification; once they have all ended, an override still in force is superseded by the truth already at hand — the staged value an equal (A17-silent) landing left, else the committed value — exactly as an arriving differing truth would be, _unless_ the transaction is still waiting on authoritative work: an override node's own source in flight (that answer confirms or supersedes on arrival), or a held flight that does not derive from an override (a plain load the action asked for; a co-written `saving` flag stays through it — the optimistic world is one, A17). Flights that derive from an override are questions about a guess that is about to revert, and nobody reads their answer: the graph re-derives from the truth as the transaction's held work and settles when _that_ lands, so the correction starts at the body's end instead of after the obsolete flight (which used to reveal the obsolete optimistic frame first, then revert and re-ask — a waterfall with a flash). Display is unchanged: the override stays on screen until the commit (c). Optimistic store edits keep the settle-then-revert order (their truth is a base layer under an overlay, with no tracked/displayed split), and companions snap at settlement. **Visibility during the body-end window (2026-09-15, visibility oracle):** identical to a landing supersession — the display and stale readers keep the override, a fresh derivation is held (A29), `latest()` answers the truth and `isPending()` reads true iff it differs — although nothing is staged (the truth at hand is the committed value). The node carries no `_transition` stamp in this window (an override written inside an action never passes the adoption loop that stamps one), so the read path and the verdict resolve the owning transaction through `_overrideOwner` (node corollary, #2912). Pinned: `tests/body-end-supersession-visibility.test.ts`. Consequences: (1) in unmerged graphs, own-source resolution IS the lane-transition's completion, so the correction reveals on arrival — the original A18 pins hold unchanged; (2) matching confirmations collapse silently (revert sees value == override, nobody re-runs); (3) when the override's transition genuinely merges with unrelated async, the correction reveals atomically with that merged completion — verdict during the window per A24 (amended 2026-07-13; was "false throughout" under the A20 mask): a held correction that _differs_ from the displayed override reads pending; a matching confirm stays quiet — corrections still _propagate_ internally on arrival (fresh readers/async drivers see the hold), so downstream refetches start immediately and no waterfalls form; only the reveal is gated. **Store corollary (2026-07-17, #2899): the optimistic layer obeys the same per-transaction lifetime.** `createOptimisticStore`'s override layer is one record per store target, but each entry is owned by the transaction that wrote it (`STORE_OPTIMISTIC_OWNERS` stamps, merge chains resolved): a settling action consumes only its own keys, so concurrent actions on disjoint keys revert independently — first-settling no longer wipes the other's live overrides. Same-key writes still entangle through the shared node (one joint settle); ambient (transaction-less) entries clear at plain flush end; a derived store's projection landing still consumes the whole layer (fresh authority supersedes every tentative write). **Node corollary (2026-07-18, #2912): ownership never travels through lanes.** Lanes are scheduling affinity — a shared subscriber (one effect reading keys touched by two actions) merges them correctly for flushing, but the merged root's `_transition` must not answer "which transaction owns this override": that let one action's settle revert another's live override, and same-key follow-up writes entangle with the wrong transaction. Every optimistic write stamps `_overrideOwner` on the node (post-merge, so entangled writers share the joint root; cleared at settle); `resolveTransition` prefers a live owner stamp over the lane, falling back to lane `_transition` for nodes without overrides (async routing) exactly as before. Pinned: `tests/spec-async-semantics.test.ts` ("#3331" describe: own-async, sync-wrapper, same-batch, provenance, simple graph; A18 entangled pin re-expected: the merged correction reveals as one frame, never the committed-behind-the-mask tear); `tests/createOptimistic.test.ts` (CategoryDisplay no-double-flicker pin, unchanged: the older action's answer never moves the graph; "second action while first still in flight" pin, resolver repaired and re-expected to the same rule).

**History (superseded mechanism, kept verbatim).** The 2026-07-07b mechanical model — replaced by the 2026-09-09 supersession, which the statement now leads with; take the mechanism from the statement, not from here: Mechanically: authoritative values arriving under an active override hold in `_pendingValue` like any other transition write and **elevate to `_value` only at their transition's commit** (`_value` changes at commit points, period); the elevation is unobservable under the override mask (A17); reverting is a pure drop — there is no revert target and reverts commit nothing. This supersedes the earlier "bound to its own async source, not its transition" formulation, which was implemented by escaping the transition commit (revert-target commit at revert) and allowed a mid-flight arrival to reveal before its own transition completed.

### A28. A write becomes visible at flush — to every channel

**Status:** **ruled, mechanism landed 2026-09-15** — maintainer ruling 2026-09-08 ("since we can't derive downstream before flush happens I do like latest being invisible until flush"; "nothing should be 30 pre flush… because double count can't be 60"; "latest opts into the tearing but really only after a flush"); optimistic writes 2026-09-10 ("My gut is to match. I'm gathering React does."; "yeah lets match"). Landed as a READ-SIDE rule (see Mechanism), superseding #3337's deferred-walk mechanism; the runtime's pre-flush cells in both oracles read the rule.
**Pinned by:** `tests/latest-held-till-flush.test.ts` (A28 (1)–(4): held and ambient writes, companions created after the write, #3336 born-holding store keys and companions); `tests/visibility-oracle.test.ts` and `tests/visibility-oracle-store.test.ts` (the pre-flush states — every cell cites A28); `tests/latest-repeated-writes.test.ts` (#2922 re-pinned); `tests/latest-unobserved-memo.test.ts`; `tests/latest-probe-order-independence.test.ts`; `tests/isPending-memo-consistency.test.ts`; `tests/latest-plain-write-purity.test.ts`; `tests/store/projection-transition-isolation.test.ts`; optimistic (5): `tests/createOptimistic.test.ts`, `tests/store/createOptimisticStore.test.ts`, `tests/question-scoped-pending.test.ts` (same-tick `affects(parent)` covers the pushed row), `tests/optimistic-store-layer-scope.test.ts`, `tests/store/shallow.test.ts`.
**Mechanism (index, 2026-09-15 — as landed):** read-side, no marker on the plain write path. "Unflushed" is structural: outside a flush (`!globalQueue._running`), a node with an ambient staged value (`_pendingValue` set, `_transition` null) was written since the last flush — ambient staging commits at flush end, so nothing else leaves a node in that state (`unflushedValue`, core.ts). Exempt: engine companions (`_parentSource` — written at the source's write to mirror it, installing eagerly, A8) and writes issued inside a creation-time recompute (`CONFIG_PROMOTED`, set only when `!_running && context !== null` — A28 (4): promoted at that recompute's end). A rewrite of a HELD node stashes the staged value the last flush left (`_x._flushedStaged`, `unflushedRewrites`) and `latest()`/verdicts answer with it until the next flush. Optimistic writes (5): `_overrideTime === clock` outside a flush is the unflushed override (`unflushedOverride`); readers skip it (`read()`'s override arm, store `nodeValue`/`visibleOverride`/`optimisticView(…, draft=false)`), the writer's channels — the draft, the `affects()` declaration walk — compose on it. Readers served the flushed value because of an unflushed write are latched for the carrying flush (`REACTIVE_MISSED_WAKE`, `markLateLinker`) — the late-linker case #3337 deferred the walk for. Companion-bearing nodes written outside a flush are re-synced as the flush begins (`unflushedCompanions`, `resyncUnflushedCompanions` inside the running window); a companion created lazily backfills as the owner's transaction's write (`backfillCompanion`, #3336) and, when the source is unflushed at its creation, joins that re-sync (`joinUnflushedResync`) — brought current by the optimistic write like a companion that existed at the write, so a derivation over `latest()` direct-commits as the optimistic view it is instead of being staged under whatever hold the round entered. The read sites test one module flag (`unflushedStaged`, set when a node is staged or a held node rewritten outside a flush, cleared at flush start) rather than `_running`; the write-path arms (`stashHeldRewrite`, `notePromotedWrite`) are cold helpers gated on loads the write already pays. No mid-tick `latest()` pull (#2922 superseded). A write to a held node from mainline no longer enters the transaction eagerly (the node is already its; entering captured the caller's block). Store: a key first read under a held FOLD is born holding (`heldFoldTransition`, `stageHeldKey`), stale/owner-less readers of a transaction-held backing see committed through every channel (`heldFromReader`, `foreignHold`) — #3336's store half, lifted from #3337.

(**ruled 2026-09-08**; supersedes the #2922 mid-tick pull) **A write becomes visible at flush — to every channel.** Between `set(x)` and the next `flush()` the write is _unflushed_: it is not the committed value, not the staged value `latest()`/`isPending()` serve, and not an input to any recompute. `latest(x)` reads the **flushed staged world** — the newest value a flush has processed, held or not (a transaction's hold governs what _effects_ publish, not what `latest` answers; `latest` opts into that tearing, but only once a flush has carried the write) — so `setCount(30); latest(count)` is the pre-write answer until the flush that carries the write, after which `latest(count)` is 30 and `latest(doubled)` is 60 in the same instant (the derivation flushed with it). Nothing is ever 30 while its derivations are still 20-shaped: there is no "read your own write" channel that bypasses the flush, because no channel can show downstream of an unflushed write, and a channel that shows the write alone tears against every derivation. Consequences: (1) `latest` is one rule regardless of reader — event handler, memo, prop getter — so wrapping a `latest` read in a memo does not change what it answers (the visibility mismatch that motivated a separate `readStaged` does not arise); (2) `isPending(x)` is false for an unflushed write (nothing is observable yet to be pending _from_); (3) a companion created lazily after several flushes needs no retained history — the flushed staged value is the only answer it could ever have given — and it answers **as if it had always existed** (#3336): its backfill is the write of the transaction _holding_ that value, not of the ambient window the reader happens to run in, so it lives and reverts with the hold instead of reverting at the reader's flush end; the same one level down for a store key first read under a hold — the node is born with the committed value and the held write staged as the holding transaction's, so plain reads and `latest()` answer for an unobserved key exactly as they do for one some other reader had materialized before the hold; (4) `flush()` is the boundary, so the imperative idiom is `set(x); flush(); latest(x)`, and within a recompute or a flush every write issued is promoted at the end of that recompute/round so the graph never runs a round against a value it wrote but cannot see; (5) (**extended 2026-09-10**, "let's match" — React's `useOptimistic` shows the optimistic value on the next render, never synchronously) **an optimistic write is a write**: `setOptimistic(x)` becomes the _active_ override (A17) at the flush that carries it, and until then no reader — plain, `snapshot()`, `isPending()` — sees it. An ambient one (no action in flight) is installed at the flush's start and reverted at its end, so effects are the channel that shows it (`[1, 2, 1]`); one an action holds stays readable after the flush for the action's lifetime. The writer's own composition channels see the parked write exactly as they see a plain write's staged value: a functional updater, and a store draft (`setState(s => …)` composes on the tick's earlier setters — two `count++` are +2, a push after a push lands in the next slot, a toggle toggled back diffs against the first and emits the write that cancels it). The `affects()` declaration walk is a writer channel too: tagging a parent covers the whole record as the writer sees it, so a same-tick `affects(state)` after an optimistic push covers the pushed row (the walk composes the tick's parked writes, as it already walks a plain store's pending backing). Only the slot form on a row born this tick needs the draft — `state.rows[2]` is not readable before the flush, so it is named as `affects(s.rows[2], key)` inside the setter (the same target the flush will serve). Engine companions (the `latest()` shadow, the `isPending()` verdict signal — `_parentSource` set) are the system's own overrides, written inside the flush after its promotions to mirror flushed state (A8), and install eagerly.

### A11. Sync derivations of held sources are visible through `latest()`/`isPending()`

**Status:** **ruled** — #2831 finding 3
**Pinned by:** `tests/latest-isPending-consistency.test.ts`
**Mechanism (index, 2026-09-14):** `recompute`'s transition-held branch stages into `_pendingValue` and syncs companions like a write (§4 write path 3).

Sync derivations of transition-held sources are visible through `latest()`/`isPending()` (held sync recompute is a write path like any other).

### A26. An ambient transaction window is one flush; parking is flush-driven

**Status:** **ruled** 2026-07-17 — maintainer ruling 2026-07-17 ("2913 is not addressable… it is a known thing and it isn't detectable, otherwise we'd have a different solution"; "one reason to not yield the promise is TypeScript — we are set up so you can await typed results and then yield nothing the next line"; flush-in-body ruled out of contract: "if they follow that they shouldn't be flushing there")
**Pinned by:** `tests/action-await-contract.test.ts` (documented escape, the await-then-bare-yield idiom, yield-the-promise alternative, pre-await stamp rejoin); `tests/store/optimistic-ambient-capture.test.ts` (#3141 — the ambient window closes in one flush even for a writeless transaction)
**Mechanism (index, 2026-09-14):** `initTransition` schedules a flush; `stashQueues` parks incomplete transactions (#2913, hardened #3141).

(**ruled 2026-07-17**, #2913; **enforcement hardened 2026-08-31**, #3141 — parking is flush-driven, and a transaction opened with no writes before its first suspension scheduled no flush, so `activeTransition` stayed ambient across the await window and captured exactly the unrelated work this ruling rejects: an optimistic store's authoritative landing on a still-live lane was adopted and held until the stranger action settled. `initTransition` now guarantees a flush, so the ambient window closes one flush later regardless of whether the transaction wrote anything) **`yield` is an action's only transaction-safe suspension point; internal `await` continuations run outside the transaction by platform necessity.** The driver regains control exclusively at yield boundaries (`it.next()` resumes the body synchronously, so `restoreTransition` wraps the segment); a post-`await` continuation is a bare promise job the runtime cannot hook — JavaScript has no ambient async context (TC39 AsyncContext, unshipped), and holding `activeTransition` open across the await window was rejected as strictly worse: unrelated ambient writes interleaving during `await fetch()` (a user click, a timer) would be captured into the action's transaction and held until it settles. Consequences, all accepted: (1) a write to a **fresh** signal between an `await` and the next `yield` escapes and commits ambiently; (2) a signal **already written under the transaction** rejoins it even after an `await` (its `_transition` stamp routes the write back) — containment is write-history-dependent by design, not by accident; (3) the supported idiom is `await` for typed results, then a **bare `yield` before any writes** — re-entry is what `yield` is for, and TypeScript ergonomics are exactly why `await` stays welcome (yield results are untyped; awaited results are typed); (4) calling public `flush()` inside an action body is out of contract — it drains and stashes the transaction mid-step, stranding later same-segment writes; follow the idiom and there is nothing to flush for. The doc block on `action()` teaches the idiom.

### A29. A tracked read served a live transaction's staged value enters that transaction

**Status:** **ruled, amended in place** 2026-09-13 (#3408) — maintainer ruling, Cluster 4 triage: a value derived from the held world is that transaction's work, whichever path first read it; amended 2026-09-14 (creation-time form — "born held"; the entry is the pass's, never the mainline block's)
**Pinned by:** `tests/held-conditional-memo.test.ts` (#3408: a memo whose branch flips mainline and starts reading a held signal reveals with it, not before); `tests/born-held.test.ts` (creation-time form: fresh memo + effect held, fresh direct effect shows committed, unrelated write after the mount stays mainline, untracked read throws until commit); `tests/visibility-oracle.test.ts` (published column, held and superseded states)
**Mechanism (index, 2026-09-14):** `enterStagedRead` on each of `read()`'s value selections that return `_pendingValue` (both fast paths and the slow path) → `globalQueue.initTransition(el._transition)`; no-op for the ambient batch (`_transition` null), the active transaction, and a probe read (`pendingCheckActive`). Creation-time form: outside a flush `enterStagedRead` records the transaction (`stagedEntry`) instead of entering; `recompute` stages the pass's node into it (`_transition` stamped, pushed to its `_pendingNodes`, `STATUS_UNINITIALIZED` kept), adds an effect to its `_gatedSubs` and skips the synchronous first run (`effect()`); `commitPendingNode` initializes it; `read()` holds readers of a node with a staged value and no committed one. Optimistic-posture nodes keep the entering path; verdict pulls (`GlobalQueue._verdictPull` — `latest()`/`isPending()` companions and their pulls) are observations and never enter from mainline (a `latest()` call that entered captured the caller's block, 2026-09-15).

A tracked computation served a node's staged `_pendingValue` — a value a live transaction holds — derives from that transaction's world, so its pass enters the transaction and its result is held with it. This is the read twin of the two entries that already existed, `setSignal` on a stamped node and `recompute` of a stamped node, and closes the gap between them: a conditional memo whose branch flipped mainline (`panel = show() ? count() : "hidden"`) started reading a held `count`, was served the staged value (non-stale readers keep speculation), and published a value derived from the held world into the mainline frame — `Panel: 1` beside `Count: 0`. A stale (render) reader is unchanged: the reveal carve-out (A15) serves it the committed value with no entanglement, which is why the same shape written as a plain JSX expression already showed a coherent frame. A probe (`isPending(() => x())`) observes, it does not derive, so it enters nothing (A23). **Creation-time form (amended 2026-09-14, "born held"):** the same rule for a memo or effect CREATED from mainline code while the hold is live — a component mounting on a click while an action is in flight. Its creation pass is served the staged value and derives from the transaction's world, so its result is the transaction's: staged into it, committed with it, and — for an effect — first run by its commit; it has no committed value until then (an untracked read of it throws `NotReadyError`, A19 exception 1; a stale reader of it cannot fall back to the committed frame and enters instead). A fresh reader that reads the held node DIRECTLY is a stale reader of a parallel transaction and shows the committed value as before (A15) — so a mainline mount shows the committed frame for direct bindings and holds derived ones until the commit reveals both. The entry is the pass's alone: `activeTransition` and the ambient batch are never touched from creation code, so a write made after the mount is a mainline write. (Maintainer, on the earlier direct-commit: "new creation wouldn't be on screen anyway… we could just be preemptive" — true for nodes the transaction itself creates, which stay inside it; a mainline mount IS on screen.) Before this the creation pass direct-committed the staged value into the mainline frame, and the ambient entry swallowed the handler's later writes into the action.

### A31. A memo computes under its own lane posture, never its puller's

**Status:** **live** 2026-09-14 (#3442) — stated by the fix; the lane-side twin of A29's "a value derived from the held world is that transaction's work"
**Pinned by:** `tests/ispending-combined-atomic-3442.test.ts` (#3442: a combined `isPending` over two async memos, one wrapped by a sync memo, holds both until both land)
**Mechanism (index, 2026-09-14):** `recompute` clears `currentOptimisticLane` for a non-effect node before the lane branches (`recomputeLane(el, true)` for an OPT-dirty node, `recomputeLane(el, false)` adoption through deps) re-establish the memo's own posture; effects keep the ambient lane.

A memo's value is one shared slot every reader sees, so its pass runs under the lane posture the memo itself owns — OPT-dirty, or adopted through its dependencies — and never under the lane of whichever reader happened to pull it. Lane posture changes what a read serves: under a lane, a pending node on no lane (or another lane) serves its committed value instead of throwing, and the entanglement gates serve committed values for the lane's own view. Those carve-outs are sound for the lane's effects, whose runs are that view, and unsound for a memo, whose result is cached for everyone. Before: the probe effect of `isPending(() => [fast(), copy()])` carried the companion lane of the pending signals it reads, and its pull of `copy = createMemo(() => slow())` ran under it; `copy` read the in-flight `slow` as its committed `0`, published a clean value, dropped its pending status, and its readers stopped holding `slow` — the transaction settled on `fast`'s landing with `slow` still in flight (`Fast: 1` beside `Slow: 0`, `Pending: false`). Now the pull throws `NotReady` as a plain reader would, `copy` stays pending, and the hold lasts until both flights land. A plain getter in place of `copy` never had the gap: the probe read `slow` directly, and a probe observes without deriving (A23).

### A32. Children-forbidden readers see the frame, not the graph

**Status:** **ruled** 2026-09-14 — maintainer ruling (visibility oracle): "createTrackedEffect is like an after effect, it can't really participate in any meaningful way. It will be held for any transition it is linked to if something else holds it, but it's too late on creation… onSettled is a similar issue."
**Pinned by:** `tests/visibility-oracle.test.ts` (childrenForbidden column, every state)
**Mechanism (index, 2026-09-14):** `CONFIG_CHILDREN_FORBIDDEN` on the reader; `read()` / `readNodeFast()` serve `_value` for it after the override arm (#3006); `PENDING_ASYNC_FORBIDDEN_SCOPE` dev warning on a pending read.

`createTrackedEffect` and `onSettled` callbacks are effect-phase code that runs after the frame is decided. They read the frame as it stands: committed values, and an active override where one is displayed (the override _is_ the frame — it shows through, superseded or not); a write held by a transaction is never visible to them. They cannot open or enter a hold of their own — a transaction reaches them only through the computation that linked them, and then only as a hold, never as a view of the staged world. On a pending node they read its committed value (the frame); on an uninitialized node there is none and they receive the `NotReadyError` (dev: `PENDING_ASYNC_FORBIDDEN_SCOPE` warns on any pending read); on a loading-window node, the loading value (A27).

## Verdicts — `isPending()` and `latest()`

### A19. `isPending(x)` ≡ the observable value is not final (three causes)

**Status:** **ruled** 2026-07-07 (promoted from C1) — maintainer ruling, 2026-07-07
**Pinned by:** cause (i) + boundary interplay: `tests/spec-async-semantics.test.ts`; causes (ii)/(iii): same file, "V1–V5" describe
**Mechanism (index, 2026-09-14):** `computePendingState` (verdict.ts) over `_pendingValue`, `STATUS_PENDING`, transition membership; `_pendingSources` rails.

(was C1 — **partially reverses an earlier decision**) **Definition: `isPending(x)` ≡ the value you can currently observe for `x` is not the final one.** Three causes of non-finality, each ending on its own terms: (i) a write held by a live transition — ends at commit; (ii) the node's own async in flight — ends at resolution; (iii) a fresh value that arrived but is held uncommitted by a transition it's entangled with — ends at that commit. A node is pending while _any_ cause holds it and final the moment none does — cascading async falls out of the definition rather than needing a rule ("once it can show its landed value it is no longer pending"). **Two exceptions.** (1) The initial NotReady: an uninitialized source is _loading_, not pending (A16/A12) — no observable value exists to be non-final — and its thrown `NotReadyError` must propagate to loading boundaries (A16/B5a) because SSR streaming and hydration reveal are driven by boundaries. (2) (re-amended 2026-07-13; was the 2026-07-07c decree) Question scoping: causes (i)–(iii) count only when the in-flight work answers a _new question_ (an input value change not yet revealed) — a re-ask of the same question (refresh/poll/confirm with value-stable inputs) is quiet, because the shown value still answers the question being asked (A24). An active optimistic override is the displayed value on its own slot (verdict-inert — pending only for a held correction that differs from it) but never exempts anything else; the old mask exemption is deleted. Everywhere else, boundaries and reporters never enter the definition: they decide what renders and what a transition waits for, not verdicts. The rejected earlier framing ("if it isn't read somewhere that reports to the transition, it isn't actually pending") was a proxy for cause (i) wrongly applied to causes (ii)/(iii), tying data verdicts to graph-topology accidents. Causes (ii)/(iii) were implemented by the #2838 shadow/companion redesign (2026-07-07) — see V3/V1 under Known violations (fixed). (A27 extends the question scoping to the commit-#0 loading window: a node born committed via `loadingValue` answers its first question by declaration, so its first flight is quiet.)

### A24. Question-scoped pending: pending iff a value change is in flight or an `affects()` mark is live

**Status:** **ruled** 2026-07-13 — maintainer ruling 2026-07-13 (#2844/#2728 convergence; cause-scoped pending, per-path masking + UNCHANGED vouching, `background()`, and lane-bounded vouches each rejected on the way)
**Pinned by:** `tests/question-scoped-pending.test.ts` (scenario matrix: foos bug, list over-lighting, navigation-over-override, poll, reload, iMessage posture; cross-family raw sharing #2904); `tests/affects-propagation.test.ts` (marks through derivation: bare-mark windows on memos, late-mark wake, mid-mark landing hold, settle release, no settlement deadlock, store record/keyed marks reaching derived readers); `tests/affects-audit-2893.test.ts` (audit corollaries: container survival under 3+ sources, transaction-inert propagation, transitive/probe-stable re-establishment, error precedence); re-pinned A13/A14/A20-block in `tests/spec-async-semantics.test.ts`; `tests/createOptimistic.test.ts`, `tests/store/createOptimisticStore.test.ts`, `tests/store/createProjection.async.test.ts`, `tests/latest-isPending-consistency.test.ts`, `tests/createMemo.test.ts`, `tests/createLoadingBoundary.test.ts` (quiet-refresh + declared-reload re-pins); INV-10 (affects-count balance)
**Mechanism (index, 2026-09-14):** `_reask` (quiet re-ask), `_affectsCount` on the node / `_affectsNodes` on the transaction, `witnessAffects` (verdict.ts).

(**ruled 2026-07-13** — supersedes A20/A21; the converged model from the #2844/#2728 threads) **Question-scoped pending: a read is pending iff a value change is in flight for it that has not yet revealed, or it carries a live `affects()` mark.** (1) **Same-question motion is silent.** Async whose tracked inputs are value-stable — `refresh()`, polling, an action's confirm refetch — is a _re-ask of the same question_: the shown value still answers it, so `isPending` stays `false` and the fresh value reveals silently. (2) **A new question pends monotonically.** Any tracked input value change in flight (a `setSignal`, an upstream memo's new value, an optimistic write feeding downstream async) pends every read under the source until its answer reveals; **nothing can silence it** — pendingness is additive-only. (3) **Optimistic writes are verdict-inert.** An active override is the displayed value on its own slot: not pending from itself (only a held authoritative _correction_ differing from the override re-opens the verdict; a matching confirm reveals nothing), and it masks nothing — an override displaying over an in-flight new question is the honest mixed state `{ value: guess, pending: true }`. To _downstream_ async the write is a real input change and pends those slots normally. Action affordances still belong in the data (co-written flags — the A20 §1 half that survives). (4) **`affects(target, key?)` is the sole declaration verb** (single optional key since 2026-07-14; the variadic form read as a 1.x path and was dropped). Additive pending on exactly the marked data (store record → every record reachable from it at declaration time, captured proxies included per #2882, siblings untouched; key → that leaf slot; accessor → that source); **store marks — keyed and keyless — cover by raw identity, not by proxy family** (amended 2026-07-17, #2904): a keyed mark registers an identity scope (owning record's raw, narrowed to the key), so reads through any other proxy sharing that backing record — e.g. a derived optimistic store whose projection landed the source store's value — witness the mark and inherit it on nodes born during the window, exactly as keyless scopes do **and on everything derived from it** (re-ruled 2026-07-14: a mark is a synthetic in-flight change on the normal status rails — `isPending(() => derived())` reads `true` during a mark window on `derived`'s inputs, exactly as it would over real in-flight async — while the marked values themselves stay readable; **mark-only pending is value-transparent through derivation too** (amended 2026-07-14, #2886): a read whose owner's pending sources are all mark sentinels never suspends — pendingness reaches readers only through verdicts, so optimistic writes under a whole-store mark keep rendering in live tracked readers; a mark's channel is never a re-ask, so a declared reload's own `refresh()` cannot silence it, and a mark never blocks its own transaction's settlement), live from declaration until its surrounding transaction settles or reverts (ambient marks release at flush end). Four corollaries pinned by the #2893 audit (2026-07-16): **(a)** derivation coverage is transitive and probe-stable — tracked reads of mark-pended owners re-establish the mark on the reader after any mid-window recompute (including the recompute an `isPending()` probe itself triggers), at every derivation depth, for graphs built before or during the window; **(b)** mark propagation is transaction-inert — pended subscribers are not queued as pending nodes, so plain writes to marked data (value-transparency) and to unmarked data sharing a downstream memo commit and render immediately, and concurrent actions don't merge into the marker's transaction through the pend; **(c)** a real error outranks a mark — a node holding `STATUS_ERROR` neither takes a sentinel on propagation nor re-applies collected marks after its recompute, so the user's error is never clobbered by a sentinel `NotReadyError`; **(d)** the pending-source container survives any number of overlapping sources (the singular→Set migration bug stranded mark sentinels forever on the third source — exactly the keyless-store-mark-over-`mapArray` shape). The declared-reload idiom `affects(x); refresh(x)` is how process knowledge enters the verdict when the graph can't see the change yet. Trade accepted knowingly: a re-ask that happens to return different data is silent until it reveals — honest silence over blanket alarm; whoever knows declares.

### A7. Resolved async never reads `[false, undefined]`

**Status:** **ruled, amended in place** — #2829 (the `[false, undefined]` pins were a regression); amended 2026-09-14 (uninitialized: `latest()` throws in every scope, never `undefined`)
**Pinned by:** `tests/latest-async.test.ts`, `tests/createMemo.test.ts`
**Mechanism (index, 2026-09-14):** `latest()` shadow (`_latestValueComputed`) is backfilled from `_pendingValue` when created after the write (verdict.ts, #3041).

After an async memo resolves, `[isPending(x), latest(x)]` is `[false, resolvedValue]` — never `[false, undefined]`. **Amended 2026-09-14:** before the first landing there is no visible value, and `latest()` never fabricates one — it throws `NotReadyError` in every scope, owned or unowned, exactly like the plain read. (Maintainer: returning `undefined` "would mess with types" — `latest<T>` returns `T`.) The unowned scope used to return `undefined` by sharing the pending-shadow fallback's condition; the `isPending` twin stays `false` there because `false` inhabits `boolean` (A16). **Judged on the owner (2026-09-15, store oracle):** a store leaf behind a projection's firewall is a plain signal whose `_value` is the seed; `latest(() => store.key)` on an uninitialized projection returned the seed — A25's draft made visible through the one read path that bypasses the firewall gate. `latest()` now asks the leaf's owner (the firewall) whether anything has landed, as `read()` does. Pinned: `tests/visibility-oracle-store.test.ts` (projection uninitialized × latest).

### A8. `isPending(() => latest(x))` follows `x`'s own async only — verdicts are per-channel

**Status:** **ruled, amended in place** 2026-07-07 — GabbeV/maintainer re-rule, 2026-07-07c; quiet-re-ask filter 2026-07-13
**Pinned by:** `tests/createMemo.test.ts`, solid-web `test/latest-async.spec.tsx`
**Mechanism (index, 2026-09-14):** Companion nodes per channel (`_pendingSignal`, `_latestValueComputed`, `_parentSource` backlink); quiet re-ask filter via `_reask`.

(**re-ruled 2026-07-07c** — was "tracks the transition the same as `isPending(x)`"; **amended 2026-07-13**: "own async in flight" is further filtered to _non-quiet_ flight — a re-ask of the same question is silent in the latest form too, and a live `affects()` mark on the owner pends it) **`isPending(() => latest(x))` follows `x`'s own async only — verdicts are per-channel.** `latest` is an override the system writes for itself the moment a held value exists ("it is like an optimistic that sets itself to the value as soon as it is available to do so"). So the latest form reads `true` only while `x`'s own fetch for a _new question_ is in flight (showing the stale value) and turns `false` the instant that fetch resolves — even if the same update has other async still running and the commit is held. On a signal or sync computed the held value exists from the instant of the write, so their latest form is _never_ pending. The plain form keeps watching the committed channel (holds included). Pairing falls out: `[isPending(() => latest(x)), latest(x)]` never pairs `true` with the fresh value.

### A9. Store leaves behind a firewall report the firewall's new-question refetch

**Status:** **ruled, amended in place** 2026-07-07 — #2831 finding 1; both-forms re-ruled 2026-07-07c; question scoping 2026-07-13
**Pinned by:** `tests/latest-isPending-consistency.test.ts`, V4 pin in `tests/spec-async-semantics.test.ts`, `tests/question-scoped-pending.test.ts`
**Mechanism (index, 2026-09-14):** `_parentSource` chain store leaf → firewall; `computePendingState` follows it; A24 filters same-question re-asks.

`isPending` on a store leaf behind a firewall reports the firewall's refetch like any async memo — in **both** forms (the latest-form filter of the old A20 is gone; an in-flight refetch supersedes both channels). (**Amended 2026-07-13**: "refetch" means a _new-question_ refetch — an input value change in flight. A quiet re-ask of the same question (`refresh(store)` with value-stable inputs) is silent in both forms; the declared reload `affects(store); refresh(store)` pends. The old exception — the store-wide mask (A21) silencing it — is deleted with A21.)

### A10. `[isPending(x), x()]` is atomic within one scope

**Status:** **ruled** — #2831 finding 2
**Pinned by:** `tests/latest-isPending-consistency.test.ts`
**Mechanism (index, 2026-09-14):** `_recordFresh` (#2831): a probe that observed the fresh value cannot pair it with `pending`. The pairing only covers a LANDED answer awaiting reveal: while the transaction still has an async source computing, the fresh value is an input and pending stays the verdict for every reader (`heldAwaitingAsync`, #3028) — including a node staged after the transaction opened, which carries no `_transition` stamp until the flush stashes the hold (#3457).

`[isPending(x), x()]` read in one scope is atomic: a reader that observed the fresh value must not see `pending === true` for it.

### A12. Resting optimistic nodes report pending like a plain memo

**Status:** **ruled, amended in place** — #2799, #2806
**Pinned by:** `tests/createOptimistic.test.ts` (#2806 cases)
**Mechanism (index, 2026-09-14):** `(NOT_PENDING, NOT_PENDING)` posture; verdict has no optimistic carve-out (V1 removed it).

A resting optimistic node reports pending via exactly the causes a plain async memo does (A19) — a reverting optimistic write is not among them (a revert is not a refetch). (Phrasing updated with V1: "only the async-in-flight check" predated held-value pends, which resting nodes now report like any memo.)

### A13. Resting optimistic ≡ plain async memo at every checkpoint

**Status:** **ruled** 2026-07-06 (promoted from B1) — maintainer keep, 2026-07-06
**Pinned by:** `tests/spec-async-semantics.test.ts`
**Mechanism (index, 2026-09-14):** Same as A12; pinned equivalence matrix in `spec-async-semantics.test.ts`.

(was B1) A resting optimistic node (no active override) is observationally identical to a plain async memo for `read`/`latest`/`isPending` at every checkpoint of a refetch cycle — both before any override was written and after a full override cycle reverted. (Pin re-checked 2026-07-13: both sides of the equivalence now read `false` through a bare `refresh` — the quiet re-ask, A24 — which preserves the identity.)

### A14. Companion nodes get child lanes that do not merge with the owner

**Status:** **ruled, amended in place** 2026-07-06 (promoted from B2) — maintainer keep, 2026-07-06; re-scoped 2026-07-07c and 2026-07-13
**Pinned by:** `tests/spec-async-semantics.test.ts`
**Mechanism (index, 2026-09-14):** `_parentLane` carve-out in `assignOrMergeLane` (lanes.ts).

(was B2) `isPending`/`latest` companion nodes get child lanes that do not merge with the owner's lane: an `isPending` effect (spinner) fires while the owner's async is still in flight. (Re-scoped 2026-07-13: the pin drives the spinner with a _question change_ — `setId` — which pends the slot even while an optimistic override displays over it; the override is verdict-inert, A24. The 2026-07-07c mask scoping is superseded.)

### A16. `isPending` never throws in untracked contexts

**Status:** **ruled, amended in place** 2026-07-06 (promoted from B5) — maintainer keep, 2026-07-06; wording corrected 2026-09-14 (the boundary is ownership, not tracking)
**Pinned by:** `tests/spec-async-semantics.test.ts`
**Mechanism (index, 2026-09-14):** `pendingCheckRead` swallows `NotReadyError` / errors when `getObserver() === null`; tracked carve-out B5a.

(was B5) `isPending` never throws in untracked contexts — thunks that throw real errors or read uninitialized async sources yield `false`. Carve-out (B5a, pinned as current behavior): in _tracked_ contexts the `NotReadyError` of an uninitialized source propagates so the reader participates in loading boundaries. **Wording corrected 2026-09-14 (visibility oracle):** the boundary is _ownership_ (`context === null`), not tracking. Inside an owner — a `createRoot` body, a computation, `untrack()` within either — the `NotReadyError` propagates, tracked or not, because an owner can route it to a boundary; only an unowned caller (event handler, imperative scope) gets `false`. `latest()` shares the mechanism but not the verdict: it throws in every scope (A7).

### A22. Pending is per-node; store-wide only for the firewall's own work

**Status:** **ruled** 2026-07-08 — GabbeV plain-store demo + maintainer, 2026-07-08 ("probably not.. it's non optimistic and it isn't derived from an async source"; "this makes me want to keep things per property even more")
**Pinned by:** A22 describe in `tests/spec-async-semantics.test.ts`
**Mechanism (index, 2026-09-14):** Per-leaf `_pendingSignal`s; firewall `_parentSource`; no store-wide mask (A21 superseded).

**Pending is per-node: store-wide verdicts exist only as the firewall's own in-flight work (A9) and the decree that silences it (A21 — **superseded 2026-07-13 by A24**; no decree survives, so of this sentence only the A9 half is live).** Every other A19 cause lives on the individual node — a transition-held write to a plain store pends exactly the touched leaves (untouched siblings and proxy-level reads stay settled: the writer's change set is known, unlike a refetching authority's unbounded one), manual projection writes pend the written leaf only, holds outliving a settled firewall stay leaf-local. Direction of flow: a node's verdict never inherits its _consumers'_ in-flight state — once a fetch commits, leaves show the landed value and read settled immediately, even while downstream async still holds the effect-level reveal (the commit is immediate at the data level; only the visual is lane-held, and `isPending` companions probe from their own lane, A14, so they are not fooled by the hold).

### A23. The `isPending` probe is reads-only

**Status:** **ruled** 2026-07-08 — maintainer, 2026-07-08 (GabbeV ergonomics ask; "This isn't about returns.. the whole props issue again")
**Pinned by:** A23 describe in `tests/spec-async-semantics.test.ts` (reads-only half; direct form pinned when implemented)
**Mechanism (index, 2026-09-14):** `pendingCheckActive` / `pendingProbe` collect reads; the thunk's return value is never inspected.

**The `isPending` probe is reads-only — the thunk's return value is never inspected.** `isPending(() => store)` reads nothing and reports `false` by design: keying any behavior off the returned value is inconsistent under the probe's expression semantics (`() => store && other()` doesn't return the store; a child component reading `props.options` never has the store to return — the props issue). Whole-store questions are asked through reads: any leaf reports the firewall's refetch (A9), spread/iteration reads report structure. The accepted ergonomic complement is the **direct-argument form** `isPending(store)`, mirroring `refresh(store)` — _argument_ inspection (a controlled API taking the store identity, no expression semantics), consulting the firewall: projections report their shared computation's refetch (question-scoped per A24; the original "A21-mask-aware" note died with the mask), plain stores read `false` (no firewall — consistent with A22 and with `refresh`, which is also only meaningful for derived stores). Accepted 2026-07-08; implementation post-2.0.

## Transactions and holds

### A15. Transition entanglement is graph-driven; lanes settle as one reveal

**Status:** **ruled, amended in place** 2026-07-06 (promoted from B3) — maintainer keep, 2026-07-06; amended 2026-09-14 (#3407: a shared render effect entangles nothing by itself — see the shared-hole corollary); mechanism completed 2026-09-14 (#3443: a held memo made pending by another flight entangles at the propagation, not at its next pass); lanes corollary extended 2026-09-15 (#3460, maintainer: "a held lane is basically a micro transition from the outside… we wouldn't hold a sync write on a transition. Lanes are the same"); reveal corollary's stale-reader term completed 2026-09-15 (#3458 first observer; #3463 a zombie reader is live for the hold)
**Pinned by:** `tests/spec-async-semantics.test.ts`; `tests/shared-effect-no-entangle.test.ts` (#3407); `tests/overlapping-flights.test.ts` (#3443: two flights through one memo reveal once; the effect arm stays parallel; the second flight's own write is held with the first); `tests/lane-outside-view.test.ts` (#3460: a `latest()` / `createOptimistic` reader mounted or re-run by a sync write mid-hold shows the committed value and reveals with the lane; #3463: a reader whose removal is staged holds the lane while it is visible, a plain removal still releases at once); `tests/first-observer-stale-reader.test.ts` (#3458: a stale reader that is a flight's first observer holds the transaction on it); `tests/posture-born-held-and-observation.test.ts` (posture matrix, ruled 2026-09-15: `latest(x)` evaluated inside another live action ENTANGLES — "optimistic lanes are transition-bound, so it does need to entangle; that doesn't mean optimism for both can't poke through in the meanwhile" — the held value is served at once, the two transactions reveal as one)
**Mechanism (index, 2026-09-14):** `_asyncReporters`, `mergeTransitionState`, `laneHeld` / `waitingTransition` (#3335); `sourceObserved` (the live-reporter test, shared by the verdict, the lane hold and the landing, #3426); `recompute`'s stamp re-entry is memo-only and `settleTransition` → `enterWaiting` folds every waiter in at the landing (#3407); `notifyStatus`'s pending propagation onto a memo another live transaction holds (stamped, and pending or staged) enters it (`initTransition(sub._transition)`, #3443). `readsHeldCommitted` (lanes.ts; from `overrideRead` — `read()`'s override arm's single engine hook `GlobalQueue._overrideRead`, which also carries the A18 supersession selection — and `latestRead`) serves a render effect off a held lane the committed value and queues its re-run on the lane's render queue (#3460); `heldFromStale` notifies a first observer's pending status up its queue chain under the transaction (#3458); `reporterBlocksSource` / `sourceObserved` take the judged transaction (`verdict`) and count a `REACTIVE_ZOMBIE` reporter as live unless the verdict is the commit that disposes it (#3463).

(was B3) Transition entanglement is graph-driven: writes whose async work is observed by a shared reader settle as one unit (no tearing — nothing commits until all entangled async resolves); writes on fully disjoint graphs keep independent transitions and settle independently. **Shared-hole corollary (amended 2026-09-14, #3407):** "observed by a shared reader" is a reader's _pass_ observing the flight pending — not the reader's mere existence. A render effect groups whatever bindings the compiler put in one hole, and a pass belongs to whoever dirtied it: a stamped effect (it observed one transaction's flight) dirtied by another transaction's write — a sync `action`, or a second flight's landing — runs that writer's pass, reads the held flight as a stale reader (its committed value, coherent with the flight's inputs which are also committed) and publishes with the writer; the two transactions stay parallel. Only a pass that _observes_ a pending flight — the reveal carve-out refused, next paragraph — joins that flight's transaction, and every transaction waiting on a flight completes at its landing. Maintainer: "we do want unrelated sync updates to pass through render effects… it makes no sense to the end user that separate bindings would hold"; "splitting a render effect per [binding] is a non-starter… the grouping cannot change." Consequence: `{b()}:{detailsA()}` publishes `1:0` when `b` is written (plainly or in an action) and `1:1` when `detailsA` lands; two independent flights read in one hole land at their own times. Memos keep the stamped re-entry (a memo's value _is_ its transaction's work), so entanglement through a user derivation of both stands — and it stands from the moment the second flight reaches the memo (#3443): pending _propagates_ onto a held memo without recomputing it (its inputs' values are unchanged), so the propagation itself enters the memo's transaction — when the memo is genuinely _held_ (pending on that transaction's work, or staged by it); a stamp alone decides nothing (#3334), so a second write that supersedes the first through a shared output memo does not drag the superseded flight into the live reveal; waiting for the memo's next pass let the first flight land, reveal its inputs (`A: 1`) beside the memo's committed value (`Sum: 0`), and left `Sum: 2` to arrive with `B: 1`. Consequence: the write that started the second flight is held with the first when its async work flows into a memo the first holds (`page=1` waits with `count=1` while `details` re-asks), even where a plain binding of the same write would have passed through — the async work, not the binding, is what is shared. **Lanes corollary (clarified 2026-09-09, #3335):** for optimistic writes the unit that settles is the _reveal_ — lanes merge through the shared reader (their effect queues become one) while transaction ownership stays put (A18 node corollary, #2912). The merged reveal is held while **any** member's observed async is in flight: a hold is a property of the async node — observed pending by a render reader in whichever live transaction recorded it (INV-3) — never of the root lane's transaction, which after a cross-transaction merge knows only one member's observations. Pinned: `tests/lane-hold-on-observation.test.ts` (#3335). **Reveal corollary (clarified 2026-09-09, re-ruled 2026-09-10; #3305, #3334):** a reveal that _discovers_ an async already in flight — a write that makes a render reader read a pending node for the first time — is that shared-reader observation: the reveal holds and joins the transition the flight blocks, settling as one unit with it, **whenever the flight's inputs are already visible** — committed by a batch that left the flight in the air with no observer (#3305), or revealed through an optimistic / `latest` lane (#3334). Showing the node's pre-flight (committed) value beside those inputs would tear the frame, and which transaction stamped the node says nothing about it. When the flight's inputs are themselves still held (unpublished, in some _other_ transaction), the reveal is a stale reader of a parallel transaction and follows the effects rule: it shows the node's committed value — coherent with the frame, whose inputs are also committed — does **not** entangle the two transactions, and re-derives at that transaction's commit (the reader is recorded for the commit replay). Corollary of the A18 node corollary: when the flight is lane-routed, the reveal waits on the _flight_, not on the transaction that owns the lane — an in-flight action holding that lane open does not hold the reveal once the flight lands. Pinned: `tests/spec-async-semantics.test.ts` (#3334, optimistic and `latest` sources; #3305 second reveal), `tests/stale-read-uninitialized-cross-transition.test.ts` (unpublished inputs: show committed, no entanglement), `tests/reveal-carve-out.test.ts`. **First observer (2026-09-15, #3458):** the stale reader's "joins the transaction's reporters when it has an entry" (#3374) has no gap: when the transaction has NO entry for the flight — it was in flight but nothing displayed it, and this reveal is its first observer — the observation registers it (the reader's status notification runs under the transaction), and the transaction waits on the flight it now shows a reader of. Before, `show → true` revealed `B: {b()}` as a stale reader of the `count=1` transaction (correctly served the committed `0`), the transaction was judged complete on `a` alone, and `Count: 1 | A: 1` published beside `B: 0`. Now one reveal, when both have landed. **Zombie readers (2026-09-15, #3463):** a reader whose removal is staged in a live transaction is still on screen and is live for every hold until the commit that disposes it — its say is moot only for the verdict of the transaction staging its removal (done, and the commit disposes it; not done, and it stays parked regardless). Before, it counted as dead everywhere, and a lane it alone held revealed `Value: 1` beside its `Details: 0`. A removal nothing else holds still commits at once and releases (the #3426 line). **Lanes mirror transitions (2026-09-15, #3460):** a held lane is a transaction seen from the outside. A render effect OFF the lane that reads what the lane is revealing — an override, a `latest()` shadow — is a stale reader of it: it shows the committed value (which is what is on screen: the lane defers its own readers' runs), publishes now, entangles nothing — "we wouldn't hold a sync write on a transition. Lanes are the same" — and re-derives at the release. Inside, a reader ON the lane computes the reveal and sees the lane's values and the parent transaction's landings, as before. `latest()` is not a special case: the same rule for a `createOptimistic` source. Before, only a reader under ANOTHER lane got the committed shadow; a mainline reader mounted mid-hold, or re-run by an unrelated sync write, showed the speculative `1` beside the lane's deferred `Value: 0`. Now `Late: 0` at the mount and `Details: 1 | Late: 1 | Value: 1` at the release; a sibling sync write re-runs `Both` to `0 y` at once and the release brings `1 y`.

### A30. A memo's dependencies are the committed frame's until the frame is replaced

**Status:** **ruled** 2026-09-13 (#3410) — maintainer ruling, Cluster 4 triage; the dependency twin of held children (#3404); amended 2026-09-15 (#3469: an unchanged pass waits on the flush's verdict)
**Pinned by:** `tests/held-conditional-memo.test.ts` (#3410: a memo whose held pass stopped reading an input still follows a mainline write to it); `tests/held-conditional-effect.test.ts` (#3438: an effect whose held pass stopped reading an input, its run stashed, still follows a mainline write to it); `tests/async-landing-deps-3461.test.ts` (#3461: an async memo whose held flight stopped reading an input, its landing staged, still follows a mainline write to it); `tests/held-frame-dependencies.test.ts` (#3469: a memo whose held pass computed the same value still follows its committed inputs; the render-effect arm follows them at once)
**Mechanism (index, 2026-09-15):** `recompute` trims the previous pass's dependency tail (`trimStaleDeps`) only when the pass published or changed nothing (`_pendingValue === NOT_PENDING`, no `_error`) and, for an effect, owes no run (`_modified` clear); a pass that staged its value leaves the tail linked and `commitPendingNode` trims it after a clean pass (`_error == null`); an effect pass that direct-committed and owes a run leaves it for `runEffect` to trim once the run applies (again after a clean pass). `__OBSERVE__` fan-in counting and the attribution engine's subscription diff walk the validated prefix only. An async landing (`asyncWrite`) follows the same gate (#3461): it trims only when it published (`_pendingValue === NOT_PENDING` after the write, an equal-value or lane landing); a transition-held landing leaves the tail for `commitPendingNode`. An unchanged pass (#3469) trims at its tail only when created, OPT-dirty, or a tracked effect; otherwise its stale tail goes to `heldTrims`, trimmed by `commitPendingNodes` when the flush commits and dropped (tail kept) when it parks.

A pass that _staged_ its value has not replaced the committed frame, so the committed value still derives from the previous pass's dependencies and a write to one of them must reach the node — and, through the node's `_transition` stamp, join its hold — exactly as an unconditional read would. Before: `selected = fixed() ? 2 : count()` held on `fixed → true` dropped `count` at its held pass, and a mainline `count` write then published `Count: 1` beside the committed `Selected: 0` / `Fixed: false`. Decided at commit rather than at the pass because a plain flush knows nothing at recompute time: the transaction that ends up holding the pass may open later in the same flush (an async memo downstream pends and the batch is adopted). An errored pass (a throw, NotReady included, a comparator throw) keeps its full list as before, and the commit skips the trim by the same `_error`. Cost on the plain path: none — a pass that publishes trims at its tail as before; only a staged pass moves the trim to the same flush's commit.

An effect's frame is the run its value is applied by, not its value slot (#3438). A plain-flush pass direct-commits `_value` and enqueues the run, but the same flush can still become a hold (the async memo downstream pends, the batch is adopted) and stash that run with the transaction — so the committed frame is still what the _last_ run published, and it still derives from the previous pass's dependencies. Before: `{show() ? count() : "hidden"}` (the compiler's insert effect) held on `show → false` dropped `count` at its pass, and the mainline `count` write then published `Count: 1` beside `Panel: 0` while `Show` still read `true`. Now the pass leaves the tail while a run is owed and `runEffect` trims once it applies. The write reaches the effect; a render effect is a mainline reader of the foreign hold (it is served the committed `show`, A15's stale-reader term), so it re-derives `Panel: 1` beside `Count: 1` in the mainline frame, and the hold's reveal re-derives it to `hidden` — unlike a memo, which is served the staged value and joins the hold (A29). Both frames are coherent; the shapes differ because effects render mainline by design. A pass that changed nothing owes no run and trims at its tail as before.

An async memo's frame is replaced by its landing, not by the pass that registered the flight (#3461). The flight's pass throws `NotReady` and keeps its full list; the landing used to trim unconditionally, before the write, even when `setSignal` then staged the value under a live transaction. Before: `selected = async () => (b() ? b() : a())` held on `b → 1` dropped `a` at its landing, and a mainline `a` write then published `A: 1` beside `Selected: 0` while `B` still read 0. Now the landing trims only when it published; a held landing leaves the tail for its commit, so the `a` write reaches `selected` and joins its hold (its stamp), exactly as the sync memo's staged pass does. Unchanged by design: a landing equal to the committed value published nothing new and trims at once, like a sync pass that changed nothing, so `b() ? 0 : a()` still drops `a` in both shapes.

A pass that changed nothing replaced nothing either (#3469). "Published or changed nothing" is not one case: a pass that changed nothing under a hold still left the committed frame deriving from the previous pass's dependencies, and it cannot know at its own tail whether the flush that ran it will park with its inputs held. Before: `selected = b() ? b() : a()` held on `b → 1` computed `1`, equal to the `1` it had from `a`, and trimmed `a`; the flush parked (b's flight was observed), and the mainline `a=2` never reached it — `A: 2 | B: 0 | Selected: 1`. Now the trim waits on the flush's verdict: trimmed when it commits, kept when it parks (the tail stays linked until a committing pass trims it — one spurious recompute at most). The consequence is the memo rule's: the `a=2` pass re-derives `selected`, is served the staged `b` and enters the hold (A29), so `A: 2` reveals with `B: 1` — the same held outcome as `sum = a() + b()` has always had, and one of the two outcomes the report accepts. The render-effect arm follows its inputs at once instead (`Selected: 2` on the write, `1` at the commit): a stale reader is served the committed `b`, and a sync write is never held by a transaction. A creation pass, an OPT-dirty pass and a tracked effect trim at their tails as before — their frames are replaceable like a direct commit, and a tracked effect's spurious run would be user-visible.

### A33. A fallback-caught flight holds no transaction; a Loading reset moves the hold onto the boundary

**Status:** **ruled** 2026-09-12 (#3375) — maintainer ruling; extended 2026-09-15 (#3459, maintainer confirmed: the hold transfers to the boundary rather than ending)
**Pinned by:** `tests/async-chain-supersession.test.ts` (#3375: a boundary reset ends the hold on writes only its readers observed, and the boundary waits for the downstream async; the hold stays while a reader outside the boundary observes the flight); `tests/loading-reset-collects-forwarded-3459.test.ts` (#3459: after an `on` reset the fallback stays until every reader under the boundary settles — the sibling-effects JSX shape and the one-effect control)
**Mechanism (index, 2026-09-15):** `reporterBlocksSource` walks the reporter's `_queue._parent` chain and treats a reporter behind a collecting pending-type boundary (`_collectionType & STATUS_PENDING && !_initialized`) as not live, so `transitionComplete` no longer counts it; the reset calls `wakeParked()` so the re-judgement lands in the same drain. `CollectionQueue.notify`'s `on` reset then collects, from every live transaction's `_asyncReporters`, the registered source and `_pendingSources` of each reporter it routes (`_holds`: under this queue with no collecting pending-type boundary between) into its own `_sources`, and flips to the fallback if it found any.

A `<Loading>` boundary showing its fallback is the display of everything under it. A flight whose only observers are behind that fallback therefore holds nothing: nothing on screen derives from it, so no transaction needs to wait for it. This is true in both orders — a reader created under a fallback never registers (the collecting boundary consumes the notification), and a reader that registered while the boundary showed content stops counting the moment the boundary's `on` changes and it flips back to the fallback. Writes the transaction was holding for those readers alone commit at once; a reader outside the boundary still holds. Shape (#3375): `Loading on={page()}` over `Details: {details()}` where `details` derives from `pageData(page)` and `count`, with `Sum: {page() + count()}` outside. `setCount(1)` restarts `details` under the initialized boundary — forwarded, so `Sum` stays 0 with the flight. `setPage(1)` resets the boundary: its `pageData` flight makes `details` pending, so `page=1` joins the `count=1` transaction (A15), and the only reader of `details` is now behind the fallback — the hold is over, the reset wakes the parked transaction, and `Boundary: Loading... | Sum: 2` publishes as one frame while the boundary alone waits for `details`. With an `Outside: {details()}` reader beyond the boundary, `Sum` stays held until `details` lands.

The hold does not vanish; it moves onto the boundary (#3459). The readers behind the fallback are still pending, and a revealed `<Loading>` shows nothing pending, so the boundary must wait for what they wait on. A reader already pending never re-notifies (status propagation dedupes on its `_pendingSources`), so after the reset the boundary's own `_sources` held only the fresh flights its readers started — a sibling's fast landing then revealed the boundary with the forwarded reader still in the air, `B: 1 | Fast: 1 | Slow: 0`. Now the reset collects the forwarded readers' sources from their transaction registrations (the one record of a forwarded reader) and stays on the fallback until the whole chain lands: `B: 1 | Loading` until `Slow: 1`, one coherent reveal. The writes the transaction released still commit at once (`B: 1` beside the fallback) — the transaction's hold and the boundary's are different things, and only the second survives the reset. Cost: one walk of the live transactions' reporter registrations per `on` change.

## Loading window and seeds

### A27. The commit-#0 loading window is loading-class and verdict-quiet

**Status:** **ruled** 2026-08-10 — maintainer ruling 2026-08-10 ("the reason I had skeleton or isPending is because isPending would be false in my mind"; "it was false both upstream and downstream")
**Pinned by:** `tests/loading-value.test.ts`
**Mechanism (index, 2026-09-14):** `_loading`; `handleAsync` serves `_value` instead of `NotReadyError` while set; `parkLoadingWindow`; window closes on the first OBSERVABLE landing (#2990).

(**ruled 2026-08-10**) **The commit-#0 loading window is loading-class and verdict-quiet.** A node born committed via `loadingValue` (memos: `createMemo` / `createSignal(fn)` / `createOptimistic(fn)`) or `seedLoadingValue` (projections: `createProjection` / `createStore(fn)` / `createOptimisticStore(fn)`) starts with the loading value as commit #0 of its lineage instead of `STATUS_UNINITIALIZED`. While its first real answer is in flight, the window is loading-class on every axis: (1) **reads** — every consumer path serves commit #0 (no `NotReadyError`, no Loading-boundary suspension; `latest()` and `resolve()` return it; it is the compute's first `prev`); (2) **transitions** — the window never initiates or extends one (matching boundary-fallback semantics): ambient writes concurrent with the window commit immediately rather than being held, and a loading node mounted inside a live transition does not add to what that transition waits for; (3) **verdict** — `isPending` reads false at the source, upstream, and downstream, in both forms. The quiet ruling is not an exception to A19 but its question scoping applied: commit #0 answers the question **by declaration**, so the first flight is re-ask-shaped — the shown answer still answers the question (A24 family). The alternative was rejected as structurally unavailable: genuine pending is chain-shaped (the shadow of a held commit — held write upstream, in-flight async at the node, propagated non-finality downstream), and the window has no held commit to shadow, so a true verdict could only exist as a point anomaly at the probed node while upstream and downstream read false — and making it propagate would reintroduce exactly the status machinery the window exists to silence (and re-open the server/client split: `isPending` is always false on the server). First-load affordances are therefore the **value channel**'s job — the author encodes provenance (`null`, a `skeleton` flag) into the loading value itself — and `data.skeleton || isPending(data)` covers the two disjoint states. The window closes at the first real landing on any path (sync return, sync-resolved thenable, first iterator yield, async settle); a real error answers reads but does not close it — a retry serves commit #0 again. After close, A19 applies unchanged: refetches are pending-class forever. A25 is unchanged for plain seeds: without `seedLoadingValue` a derived store's seed remains an unobservable draft; `seedLoadingValue` is precisely the author promoting the seed to commit #0 — observable by declaration. **Amended 2026-09-15 (visibility oracle):** the window is a loading boundary's twin, and two things follow. (1) Verdict-quiet is a _hydration invariant_, not only ergonomics: the server always answers `isPending` false, so the client cannot answer anything else on creation without a mismatch — through the window the verdict is false whatever re-asked the node, including an action's held write. Maintainer: "loadingValue has the same SSR hydration concerns… isPending can't be true on creation or we might get a hydration mismatch." (2) The window's first real landing is _initial-load class_, like a boundary's first content reveal (A19 exception 1): it commits on arrival even when the input that re-asked it is still held by an action — the derived value is on screen before its input, the same initial-load exception boundaries have. From that landing on the node is an ordinary memo: new questions pend (A24), held landings pend (A19 iii) and are held. Pinned: `tests/visibility-oracle.test.ts` (loading window over a held input).

### A25. A derived store's seed is a draft, never an observable value

**Status:** **ruled** 2026-07-16 — maintainer rulings 2026-07-16 ("a seed… should never be visible under any case"; "we throw NotReady except in top-level component scope where we throw that other error"; "self reads are fine though — that's the point of seed, but outside isn't") and 2026-07-17 ("if the seed is visible in compute body it probably should be visible on write.. it throws on read so no consumer can rely on it")
**Pinned by:** `tests/strict-read-pending-store.test.ts` (untracked dev/prod matrix); `tests/store/createProjection.async.test.ts` (seed hidden until first resolution/first yield, supersession keeps it hidden, enumeration throws); `tests/uninitialized-visibility.test.ts` (write-path seed visibility, loading-vs-pending probe #2910)
**Mechanism (index, 2026-09-14):** Derived store stays `STATUS_UNINITIALIZED` until first landing / first yield; the status gate in the projection traps hides the seed (projection.ts, #2988; proj R23); strict-read matrix.

(**ruled 2026-07-16**, #2897) **A derived store's seed is a draft, never an observable value.** The seed exists for the derive function — self reads while it works its draft are the point — but to every outside consumer the store is _uninitialized_ (A19 exception 1: loading, not pending) until the first resolution lands; for async-iterator derives, until the **first yield** lands (uninitialized only until then — each later yield is a revealed snapshot, readable between yields even while the generator is still running). During that window every outside consumer path throws: tracked reads suspend into loading boundaries via their node's `NotReadyError` as always, and the untracked fall-throughs — property reads, `in` checks, enumeration/spread — throw the same `NotReadyError` from the firewall (in dev strictRead scopes, i.e. component bodies, the more descriptive `PENDING_ASYNC_UNTRACKED_READ` error wins, matching async memos and preventing infinite loops). Returning the seed leaked a value the reader could never observe updating; returning `undefined` would break non-nullable types. Write-path reads (reconcile enumerating during the first landing) are exempt — they _are_ the initialization. This is safeguard parity: memos already behaved this way; store proxies bypassed `read()` and with it every guard. **Write-visibility corollary (ruled 2026-07-17, #2910 follow-up): the seed IS visible to write-path consumers.** A setter's function-form argument — the store setter's draft, `prev` in `set(prev => …)` — reads the raw current state: the seed for an uninitialized derived store, `undefined` for an uninitialized optimistic computed (it has no seed argument), the displayed value once initialized. Same exemption as the derive body: writes need a base, and because every read channel throws during the window, no consumer can _rely_ on the seed — visibility on the write path leaks nothing observable. Absolute writes were never gated.

## Errors

### A1. Effect error interception is compute-phase only

**Status:** **ruled** 2026-07-06 — #2839 ruling (2026-07-06)
**Pinned by:** `tests/effect-error-phases.test.ts`
**Mechanism (index, 2026-09-14):** `EffectBundle.error` handler wraps the compute half of `createEffect`; effect-phase throws route through `handleError` → nearest `createErrorBoundary` → `REACTIVITY_HALTED`.

`EffectBundle.error` intercepts compute-phase errors only; effect-phase throws escalate to the nearest error boundary (halt if none).

### A2. Unhandled compute-phase errors in user effects are logged and skipped

**Status:** **ruled** — #2839 ruling
**Pinned by:** `tests/effect-error-phases.test.ts`
**Mechanism (index, 2026-09-14):** `runEffect` catch for `EFFECT_USER`; no boundary participation.

Compute-phase errors in _user_ effects without a handler are logged and the run is skipped; the system keeps running.

### A3. Comparator throws are compute-phase errors

**Status:** **ruled** — #2837
**Pinned by:** `tests/equals-comparator-errors.test.ts`
**Mechanism (index, 2026-09-14):** `setSignal` / `asyncWrite` / `recompute` route a throwing `_equals` through `notifyStatus(STATUS_ERROR)` (#2837).

Errors thrown by a user `equals` comparator behave exactly like compute-phase errors (boundary-containable; loud halt without a boundary).

### A4. A custom `equals` never sees `undefined` prev on first commit

**Status:** **ruled** — #2837 follow-on
**Pinned by:** `tests/equals-comparator-errors.test.ts` (async case)
**Mechanism (index, 2026-09-14):** `STATUS_UNINITIALIZED` is checked before `_equals` runs in `setSignal` and `recompute`.

A custom `equals` is never invoked with `undefined` previous value on a node's first commit.

### A5. An error escaping every boundary halts the system

**Status:** **ruled** — #2761/#2762
**Pinned by:** `tests/createErrorBoundary.test.ts`, `tests/errorHalt.test.ts`
**Mechanism (index, 2026-09-14):** `REACTIVITY_HALTED` latch in `scheduler.ts`; later writes log 'Update ignored'.

An error escaping every boundary permanently halts the system with `REACTIVITY_HALTED`; later writes log "Update ignored".

### A6. `ASYNC_OUTSIDE_LOADING_BOUNDARY` is warn-only

**Status:** **ruled** — #2822
**Pinned by:** `tests/enforceLoadingBoundary.test.ts`, solid-web `test/dev-warning.spec.tsx`
**Mechanism (index, 2026-09-14):** Diagnostic emission only; `createErrorBoundary` must not catch a pending (`NotReadyError` is not `StatusError`).

`ASYNC_OUTSIDE_LOADING_BOUNDARY` is a warn-only diagnostic; an `Errored` above must not swallow it and must not show its fallback for a pending.

## Open rulings

### O1. Same-tick adoption — an action adopts the ambient writes made before it in the same tick

**Status:** **ruled, by design** 2026-09-15 — maintainer: "transitions are ambient. Action is just a special case to link them over async; every write is a conceptual transition." Surfaced by the posture matrix (`tests/visibility-oracle-posture.test.ts`, class A: 16 cells across the `staged, ambient` and `override, ambient` states under the `foreignAction` / `foreignLane` postures); pinned by `tests/posture-born-held-and-observation.test.ts` (an ambient write made before an action in the same tick reveals with the action).
**Current behavior:** `initTransition` adopts the ambient batch wholesale (`_pendingNodes`, `_optimisticNodes`, `_affectsNodes`, gated readers), so `set(x, 1); startAction()` in one tick makes `x`'s plain write the action's — `x()` stays 0 until the unrelated action settles, and inside the action's body `latest(x)` answers 1 and `isPending(x)` true (A28 would say 0 / false pre-flush for a write nothing holds). An ambient optimistic write made before the action (`setO(5); startAction()`), which mainline reverts at the next flush (OL-R5), instead lives on as the action's override for its whole lifetime.
**Ruling:** intended. The same-tick window is one ambient transition; an action that opens in it owns it. (#3141 ruled the ASYNC-GAP version a bug — work arriving after the body's first await is not the action's.) Not React's `startTransition`, deliberately.

### O2. Creation under a transaction escapes the hold — recorded, not ruled

**Status:** **recorded** 2026-09-15 — maintainer: "generally creation escapes because it isn't visible"; "I'm fine either way as long as we end up somewhere consistent"; "let's capture things as they are." Pinned as OBSERVED by `tests/posture-born-held-and-observation.test.ts`; the matrix (class B, 10 cells) records it.
**Current behavior:** a memo + render effect created inside a live action's body over a value another action holds (or over the superseded / body-ended states) direct-commits (`recompute`'s `create && bornHeld === null` arm — `stagedEntry` is only recorded when `activeTransition` is null) and its render effect publishes the held value, while untracked reads keep the committed frame until both actions settle. Mainline creation over the same value is born held (A29's creation-time form, 2026-09-14). Creation inside the HOLDING action's own body is unaffected: the body's write is unflushed (A28), the creation reads the committed frame.
**In-flush form (2026-09-16, posture matrix over the store states):** a memo + render effect created inside loading-boundary CONTENT over a held value publishes it too — the content pass entered the hold, the creation direct-committed — for signals and store leaves alike (`tests/posture-store-parity.test.ts`, S2, observed).
**Tension:** A29 (born held) applies to mainline creation only; the "isn't visible" premise does not hold for a render effect created in the body. A future ruling either extends A29 to every posture (`creatingPass` in `enterStagedRead`, prototyped 2026-09-15: +83 B, suite green) or states creation-escapes as the rule and re-examines the mainline form.

### O3. A render effect gated away from a never-landing flight keeps the source's write held — fixed

**Status:** **violation, fixed** 2026-09-16 — fuzzer #3446 law P1 ("ordinary writes publish after a drain when no visible reader still needs an unresolved answer"), 21 of 1,000 cases in one symptom group, reduced to case 854; reproduced in the posture matrix (`effect × gatedAway` on the "observed only by the matrix reader" state) and pinned in `tests/posture-born-held-and-observation.test.ts`.
**Current behavior:** a render effect that directly observed an uninitialized async memo registers as the flight's reporter (`_asyncReporters`); when it re-runs without reading the memo (a `show()` gate closes) the source's ordinary write stays held — forever when the flight never lands. A memo between the effect and the flight releases the hold (its re-run clears its status). `reporterBlocksSource` still answers true for the effect from its stale `_pendingSources` / NotReady `source`, and the parked transaction's verdict may not be re-evaluated by a flush with no async event.
**Rule:** A15 / #3426 — the hold lasts while a LIVE reporter observes the flight; "re-ran and no longer derives from the source" is the fifth liveness case after disposed, zombie, behind-fallback and first-observer.
**Mechanism (2026-09-16):** the predicate was already right — `reporterBlocksSource` judged the re-run effect dead; nothing RE-JUDGED the parked transaction. `recompute`'s tail now treats a pending reporter recovering without its flight landing as the completion event it is: it wakes the transaction it reported to (`wokenTransitions`, the third site after disposal #3372 and boundary reset #3375; `wakeParked` when the reporter carries no stamp), skipped under that transaction's own flush, which judges the landing itself. 21 → 4 of 1,000 fuzzer cases.
**Same-flush form (fixed 2026-09-16):** gate and write in ONE flush (fuzzer case 21; case 79 the multi-step variant). A first reading blamed effect parking; a probe showed the effect's pass ran and _staged_ `"hidden"`, and that A30 kept its previous dep on the memo linked past `_depsTail` for the commit to trim — `reporterBlocksSource`'s deps scan read that kept dep and called the effect live. The hold kept the dep that kept the hold: Rule 2's predicate reading Rule 3's deferral. Fix: the scan is bounded at `_depsTail` — "still derives from the source" is a question about this pass's reads; a trimmed list ends there anyway, a pass that read nothing has a null tail. Pinned; fuzzer P1 4 → 0 with the two mechanism corrections below.
**Mechanism (2026-09-16, complete):** (1) `reporterBlocksSource`'s deps scan is bounded at `_depsTail` — this pass's reads, not the committed frame's kept tail. (2) `recompute`'s tail retires a reporter when its pass **dropped a dep** (deps past `_depsTail`, or a pass that read nothing) — not only when it recovered from pending: a reporter registered by the stale-reader carve-out (`heldFromStale`, an initialized source refetching) displays the committed value and is never pending (fuzzer case 79). (3) The retirement wakes **every** parked transaction (`wakeParked`), not the reporter's stamp: the transaction waiting on it registered it without stamping it (a later write's hold over a flight an earlier step observed). The fuzzer's same campaign: 994 pass / 0 fail / 6 policy (from 984 / 4 / 12 before #3488).

### O4. Adopted, unflushed — the signal's verdict channels see a write no flush has carried — violation, open

**Status:** **violation, recorded** 2026-09-16 — posture matrix over the store states beside the signal states (`staged, ambient × foreignAction`): the store leaf answers `latest` 0 / `isPending` false inside the adopting action's body; the signal answers 1 / true. Pinned `it.fails` (signal) beside the passing store twin in `tests/posture-store-parity.test.ts` (S1).
**Rule:** same-tick adoption is by design (O1); A28 (1)/(2) still govern visibility — nothing is visible before the flush that carries the write, on any channel. The store is right.
**Mechanism (current):** adoption stamps the signal with the transaction (`initTransition`'s pending-node loop); `unflushedValue` reads a stamped node with no `_flushedStaged` stash as a flushed held node and serves `_pendingValue`. The store's selection (`nodeValue` / `serveDataKey`, `flushedStaged`) does not take that path. One rule, two implementations — the fix is making "unflushed" mean the same thing at both sites (a node staged outside a flush and adopted before any flush is unflushed whatever its stamp).

### O5. INV-4 — a projection leaf's `latest()` shadow is stale on the flush right after its root is disposed mid-refetch — violation, open

**Status:** **violation, recorded** 2026-09-16 — surfaced by O3's fix: the posture matrix had been leaking parked transactions (dead reporters never re-judged), which kept `transitions.size > 0` and silenced every quiescence invariant for the rest of the run. With the leak gone, INV-4 fires. Pre-existing on `next` (standalone repro: projection store with a held refetch, `latest()` read of a leaf, `dispose()`, synchronous `flush()`); pinned `it.fails` in `tests/posture-store-parity.test.ts` (S3). Transient — the shadow is re-derived a microtask later — but under `__TEST__` a throw from the runtime's own scheduled flush leaves the scheduler mid-flush, so the matrix excludes the two triggering cells (`gatedAway` × the projection states) until fixed.
**Where to look:** the disposal snap (`disposeChildren` → `_snapCompanions`) covers the disposed computed's own companions; a projection's leaves hang off the firewall, not the child chain, and their companions are re-derived only by the scheduled pass that follows.

## Superseded rules (kept verbatim)

Cited by tests and by A24's reasoning; the statements below are as they stood when superseded.

### A20. (superseded) Optimistic writes announce a store-wide pending

**Status:** **superseded** 2026-07-13 by A24 — kept for the reasoning record
**Pinned by:** A20 describe in `tests/spec-async-semantics.test.ts`; `tests/createOptimistic.test.ts` (mask + source-still-pends contrast); latest-channel: `tests/createMemo.test.ts`, solid-web `test/latest-async.spec.tsx`; INV-10 enforces the mask in dev

(**SUPERSEDED 2026-07-13 by A24** — the mask is deleted; optimistic writes are verdict-inert. Kept for the reasoning record. The surviving pieces: verdicts are per-channel (§2, now in A8), and action affordances belong in the data (co-written flags), not derived from verdicts.) (**re-ruled 2026-07-07c** — supersedes the 2026-07-07 "overrides are unsettled" ruling, which held for one day) **The mask: an optimistic override is certainty by decree; `isPending` follows the channel you read.** (1) An _active_ override reads `isPending === false` — uniformly, on every node kind, in **both** forms, for the override's whole lifetime (until its own source confirms it, A18, or the transition reverts it). Writing optimistically _declares_ the shown value the outcome; a decree cannot be superseded by work already in motion, because the writer just asserted it won't be. `isPending` is reserved for data being updated by machinery the reader did _not_ decree — refetches, transition-held commits — never for the provisional nature of an override ("isPending is about the data being in the process of being updated, not about an action being in progress"). Action-scoped affordances ("Saving…", per-row spinners) therefore belong **in the data**: a co-written flag (`todo.pending = true` — the repo's todos example) or a separate `createOptimistic(false)`. You are already writing the optimistic update; the flag rides along. The old no-extra-boolean idiom (`isPending(() => books.length)` as the "Adding…" label) is rejected — it derived an action's progress from a data verdict. (2) Verdicts are per-channel: the plain form watches the _committed_ channel — pending while its own fetch is in flight and while a resolved value is held uncommitted by a transition; the latest form watches the _fresh_ channel — `latest` is an override the system writes for itself the moment a held value exists (A8), and that self-override masks holds like any user override, leaving only actually-in-flight async as its pending cause. Pairing falls out for both forms: neither ever pairs `true` with the value that made it false. (3) Scope: the mask covers the primitive that was written — node-scoped for signals and computeds; store-scoped for derived optimistic stores (A21). (4) Non-derived optimistic signals/stores are never pending _from themselves_ — there is no source to confirm or refetch, the write is an instantly-visible decree — they pend only via a transition hold on the trigger like any plain signal. (5) No tension with A17/A18: the override is THE value (A17), its lifetime is transition-bound (A18), and the mask simply says the verdict agrees with the decree for exactly that lifetime — mask on at write, off at revert/confirm, in the same atomic settle.

### A21. (superseded) The store-wide mask

**Status:** **superseded** 2026-07-13 by A24 — kept for the reasoning record
**Pinned by:** "store-wide mask" pin in the A20 describe, `tests/spec-async-semantics.test.ts`; `tests/store/createOptimisticStore.test.ts` (refresh-pends → write-masks → lift contrasts); INV-10 store-mask arm

(**SUPERSEDED 2026-07-13 by A24** — the store-wide mask is deleted with the mask model; nothing silences a new question. The effective-write gate (consequence 4) survives as transaction-entanglement hygiene: no-op optimistic writes still neither entangle nor decree anything.) **The store-wide mask: for a derived optimistic store, the store is the primitive — any active optimistic write masks `isPending` for the _entire_ store.** Written leaves, untouched siblings, structural reads (`length`, iteration), and the firewall's own refetch all read `false` while any override on the store is live, in both forms; the mask lifts when the store's optimistic state fully clears (same lane lifetime as A20). Rationale: a refetch pends the whole store because the authority's change set is unbounded (A9) — the decree that silences it must speak for the same unbounded scope, or `isPending(() => store.items.length)` would flip on a refresh the writer already declared the outcome of ("If I do `setOptimisticFormOptions(x => x.cities.push("London"))` then I expect the select to consider it settled" — same for `x.cities[i] = "London"`). Once you write optimistically you own the store's pending affordances (A20 §1: flags in the data). Consequences: (1) optimistic writes to the same store entangle — not just writes to the same property; (2) plain (non-derived) optimistic stores get this for free — with no source they were never pending from themselves (A20 §4); (3) A9 is the unmasked rule: with **no** active override, every leaf reports the firewall's refetch in both forms — the store-wide mask is an override-lifetime exception, not a repeal; (4) (added 2026-07-08) only **effective** writes arm the mask and entangle — the decree is about data actually asserted, so trap fires that change nothing (`s => s`, `s => ({ ...s })` replaying equal values, same-value property writes, deletes of absent properties) are no-ops with no decree, matching the signal path where an equal-value first optimistic write short-circuits before any override exists. A deliberate "silence this refresh" affordance is future explicit API (#2844 family), not an emergent no-op write.

## History

### Tier B (inferred — needs verdict)

Mark each **keep** or **change**; on _keep_ it gets a spec test and moves to
Tier A.

- [x] **B4 — RULED, promoted to A18 (2026-07-07).** The original inferred
      statement ("async resolution must not clobber a user override") was
      rejected: overrides clear when **their own async source** resolves. Stale
      in-flight resolutions (initiated before the user's write) are dropped by the
      dirty-flag check in `asyncWrite`; they never clobber mid-lane. (The old
      `_overrideSinceLane` flag that also guarded this was removed 2026-07-07 —
      the re-ruled A18 hold model made its correction path unreachable.)

### Tier C (open — needs decision)

- [x] **C1 — RULED, promoted to A19 (2026-07-07).** `isPending` is about
      data, not boundaries: `true` during any in-flight refetch with a stale
      visible value, even after the transition completed. Reverses the earlier
      boundary-semantics decision. Implementation deferred to the #2838 redesign
      (pinned as expected failure V3).
- [x] **C2 — RULED (2026-07-07): reverts do not trump other live lanes.** A
      reverting node's committed value is fresh authoritative input to any other
      lane's view (A18); releasing a cross-lane subscriber from its live lane
      would tear that lane's atomic reveal. A revert may only clear lane
      assignments that resolve to the reverting node's own (dead) lane. The
      blanket clear in `insertSubs`'s reversion branch violates this in
      principle; no observable divergence is constructible today (convergence
      merges lanes; companion child-lanes behaved in all probes), so the fix and
      a "live lane members are only released by their own lane's resolution"
      assertion are queued for the #2838 redesign rather than patched now.
- [x] **C3 — CLOSED by A19 (2026-07-07): early completion is by design.**
      Transitions coordinate rendered commits; in graphs with no render-effect
      reporters there is nothing to coordinate, so a transition completing after
      reporter pruning (even with async still in flight) is legal. The harm it
      used to cause — wrong `isPending`/`latest` verdicts in the window — is
      A19's responsibility (verdicts derive from data state, never reporter
      topology) and is pinned as V3.
- [x] **C4 — RULED, promoted to A17 (2026-07-06).** The override must always
      be read if present. The observed divergence was not a visibility question
      but a premature-revert bug: `transitionComplete` excluded a node pending on
      _its own_ fetch from blocking completion (`_error.source !== node`), so an
      entangled (merged) transition completed on the first flush and silently
      dropped the override. Fixed by removing the self-source exclusion.

### Known violations — ALL FIXED by the #2838 redesign (2026-07-07)

Four ruled Tier A propositions were violated, mostly in the **blocked-merged
window** (a node's own fetch resolved, but a shared reader entangles it with
another still-pending async source, so nothing commits). All four now pass
and are pinned as spec tests in `tests/spec-async-semantics.test.ts`
("V1–V5" describe); the former `it.fails` characterization file
(`spec-async-open-questions.test.ts`) is retired. What each was, and what
fixed it:

- **V1 (violated A13) — FIXED.** A _resting_ optimistic node reported
  `isPending === false` in the window while still showing the stale value.
  Root cause: `computePendingState`'s #2799 carve-out skipped the held
  `_pendingValue` for every resting optimistic node. The INV-8 provenance
  probe proved a resting node can never hold a _revert target_, so the
  carve-out was removed outright: a held value on a resting node is always a
  refetch/transition hold and reads pending, like a plain memo. (Revert
  targets were later eliminated entirely — 2026-07-07b, see V5 — so today
  _every_ held value on _any_ node is a pending commit.) `asyncWrite`'s
  resting-hold branch also now syncs companions like every other write path.
- **V2 (violated A7/A13) — FIXED.** `latest()`'s verdict in the window was
  _read-order dependent_: an early probe froze the shadow at the stale value
  for the entire window. Fixed by the same resting-hold companion sync (the
  arriving value is pushed into the shadow) plus the settlement checkpoint
  (`snapCompanionsToState`): commits/reverts invalidate a shadow whose
  cached value diverged from committed state, so it re-derives on next pull.
- **V3 (violated A19) — FIXED.** After a reporter-less transition completed,
  an existing companion kept its transition-scoped `false` while the refetch
  was still in flight. Fixed by the settlement checkpoint: when
  `resolveOptimisticNodes`/`commitPendingNode` settle a node (or its
  companion), the companion re-derives from `computePendingState` and the
  verdict is written _committed_ — verdicts are a property of the data (A19)
  and survive the transition that produced them.
- **V4 (violated the old A20's three-form algebra) — FIXED, then the rule it
  enforced was superseded (2026-07-07c).** The durable half of the fix stands:
  the stuck-true companion is gone — a firewall's status change pokes the
  companions of its probed leaves (`updateChildCompanions`). The behavioral
  half (latest-form filtering a pure firewall refresh on a resting
  optimistic-capable leaf) was an artifact of the one-day "overrides are
  unsettled" ruling and is **gone**: under the re-ruled A9/A20, an in-flight
  refetch supersedes both channels, so **both** forms report it on a resting
  leaf — unless the store-wide mask (A21) is live. The pin now asserts the
  new algebra ("V4/A20: both forms report a pure firewall refresh on a
  resting leaf").

- **V5 (A17 corollary — found and fixed with the revert-target elimination,
  2026-07-07b).** A first optimistic write in the blocked-merged window
  clobbered the held refetch value (`_pendingValue = _value` stashed the
  stale committed value over it), so the eventual revert resurrected stale
  data. Fixed structurally: revert targets no longer exist — masked
  authoritative arrivals hold in `_pendingValue` like any other transition
  write and elevate at their own transition's commit, unobservably under the
  override (A17); revert is a pure drop. Pinned in the "V1–V5" describe
  alongside its siblings.

The companion-vs-oracle census (`COMPANION_CENSUS=1`) reports **zero
divergence fingerprints** across the suite post-redesign.

### Re-ruling log — 2026-09-09: lane authority (#3335, #3334, #3331, #3330)

Four GitHub reports against `2.0.0-rc` lanes, all pre-existing (not
regressions from the held-till-flush change, #3337). Common thread: places
where a lane's or a transaction's _bookkeeping_ (a stamp, a root's
`_asyncReporters`, an override's mask) was consulted where the graph's
_state_ (is this async node in flight; is this value on screen) was the
question.

- **A15 lanes corollary** added (#3335): a merged reveal's hold is per async
  node, looked up in whichever live transaction recorded the observation —
  not the root lane's transaction.
- **A15 reveal corollary** added (#3305, #3334): a reveal that discovers an
  in-flight async joins the transition that flight blocks, whatever stamped
  the node. Two implementation consequences: `read()` no longer serves a
  pending node's committed value to a stale-stamped reader (the "carve-out"),
  and a lane-routed landing re-enters the _waiting_ transaction, not the
  lane owner's — an in-flight action holding the lane open does not hold a
  reveal once the flight lands. Actions are not special here; the transition
  they hook into is.
  - **Re-ruled 2026-09-10 (review on #3347):** the carve-out was the right
    semantics for the case it was written for — parallel transactions,
    effects don't entangle — and wrong only where the flight's inputs were
    already on screen. Removing it outright made a new reader of a memo whose
    input write is _itself_ still held wait for the landing, though showing
    the committed pair introduces no inconsistency (React 19.3 stopped
    entangling the same shape). Restored, gated on input visibility: refused
    when the node's inputs were published while it was pending
    (`CONFIG_INPUTS_PUBLISHED`, set by the commit that left the flight in the
    air) or when the node is routed through a live lane; otherwise the stale
    reader shows committed, does not entangle, and is recorded for the commit
    replay. The initialized-memo pin returns to its original expectation.
- **A17** amended, **A18** supersession block added (#3331): own-source
  arrival supersedes the override for the graph at once; display and
  untracked reads keep it until the (possibly merged) commit. Equal landing:
  silent confirm. Differing landing: subscribers recompute from the truth on
  the plain channel as transaction work, lane affinity dropped; the
  override's own downstream flight is inert. The A18 entangled pin's old
  expectation was a tear (committed `other = 2` while the screen showed
  `mOther(1)`) and is re-expected to a single merged frame.
- **INV-11** added (#3330, no semantic change — a straight violation of
  A17): a recompute's equality gate compares against the slot it publishes
  to. A lane recompute publishes `_value`, so a transaction-held
  `_pendingValue` that already equals the result does not make it
  "unchanged"; the override's derivation reveals with the override (pinned
  under A17).
- **Supersession scope ruled (2026-09-10):** the sync twin is in. A first
  cut fired supersession only at the node's own async landing, which left
  the most common real shape — a sync wrapper over an async memo — without
  the fix; the maintainer: "if the source recomputes it doesn't matter if it
  is async or not." Two shapes had made the sync twin look like an over-fire
  and were re-examined: (1) a source write and an override in the _same
  batch_ — resolved by the ordering rule (a new value postdates the
  override; `_overrideTime` vs `clock`), so the override written over that
  batch's truth stands; (2) an earlier action's answer landing under a later
  action's override on a shared node — not sync-specific (the async twin has
  the identical case). The agent first proposed accepting (2) as an honest
  pending window and re-expected the two `createOptimistic.test.ts` pins
  from the masked model that assert the opposite ("categoryData should NOT
  recompute and isPending should NOT flicker"). Maintainer: "getting it not
  to flicker was super important. a slow source shouldn't leak back in like
  that. we spent many cycles getting the behavior." Resolved by
  **provenance**: transactions merge, so the override's owner cannot say
  which action asked; the scheduler carries the running action's invocation
  sequence (`origin`) through each action slice and the flush that ends its
  window, every flight captures it at registration, and a landing propagates
  under its flight's provenance. The override stamps it at its write
  (`_overrideStamp`); a differing arrival from an older action holds
  silently. A same-value re-prediction by a newer action (the fast path,
  which writes no new override) renews the stamp: the user re-asked, so the
  older action's answer is stale to it too (review on #3347). The
  no-double-flicker pin is restored verbatim; the "second
  action" pin keeps its repair (its second action orphaned the first's
  continuation, so its final-state assertions had been passing against a
  transaction that never closed) and is expected to the same rule.
- **Replay gating** (found under #3330): `laneReadsCommitted` recorded a
  lane reader for commit-time replay whenever the node it read had a staged
  value; when that staged value equals the committed one (a lane recompute
  already published it, INV-11) the replay re-ran effects against an
  unchanged frame — the duplicate frame seen in the #3330 and #3334 pins.
  Recorded only when the commit will change what the reader saw.
- Internals: `waitingTransition(node)` (replaces `asyncObserved`),
  `CONFIG_OVERRIDE_SUPERSEDED`, `_overrideTime`, `_overrideStamp` /
  scheduler `origin`,
  `GlobalQueue._supersedeOverride` / `_overrideRead` (was `_supersededRead`; #3479 folded it with the lane outside-view rule) hook slots (the
  authoritative-observer wake now lives inside the former), lane demotion on
  supersession, the `runEffect` owner-gate exception for lane-less lane
  runners. See INTERNALS-ASYNC-STATE.md §1–§3.

### Re-ruling log — 2026-07-13: question-scoped pending (#2844/#2728, supersedes the mask)

The mask model held for six days. The #2844 thread kept producing cases where
a decree silenced ground truth it could not know (the foos bug: an optimistic
increment silencing an unrelated in-flight navigation via A21) or where
honesty over-alarmed (list over-lighting: a confirm refetch pending every
sibling row). Intermediate designs — cause-scoped pending, per-path masking
with write-vouching (`UNCHANGED`), `background()`, lane-bounded vouches —
were each rejected; the convergence keeps GabbeV's "don't set it in the first
place" for _same-question_ motion while keeping verdicts additive and
un-maskable for _new_ questions. One conceptual change — **pending is a
property of the question, not the process** — rippled through:

- **A24** added (the model: quiet re-asks, monotone new questions,
  verdict-inert optimistic writes, `affects` as the declaration verb).
- **A20/A21** superseded (the mask and the store-wide mask are deleted;
  `maskStoreTarget`/`STORE_MASKED`/`_optimisticMask` removed from the
  implementation). A20's per-channel reading and data-borne action
  affordances survive; A21's effective-write gate survives as entanglement
  hygiene.
- **A8/A9** amended (both channels filter quiet re-asks; `affects` pends
  both; A9's mask exception deleted).
- **A19** exception (2) rewritten (question scoping replaces the decree).
- **A18** consequence (3) re-flipped (a held _correction_ under an override
  reads pending; a matching confirm stays quiet).
- **A13** unchanged in statement; its refresh checkpoints now read `false`
  on both sides of the equivalence.
- **A14** re-scoped again (the spinner pin drives on a question change
  through an active override).
- **INV-10** replaced (mask assertion → affects-count balance).
- Internals: `REACTIVE_REASK`/`_reask` re-ask classification (with the
  same-batch heap-dirt guard), `_affectsCount` + `$AFFECTS` record nodes,
  probe witnessing through traps _and_ the `snapshot`/`deep` walk, probe
  NotReady rethrow narrowed to truly uninitialized sources. See
  INTERNALS-ASYNC-STATE.md §5g.

API-shape rulings for `affects` (from the 2026-07-08 design round, which
predated A24 and survived it; the standalone design doc is retired in favor
of this record):

- **Named `affects`** — honest about scope: you can affect without mutating
  (a boundary reset, a fire-and-forget POST). `mutates` overpromises a
  write; `markPending` reads as machinery rather than intent.
- **No separate `isAffected` probe** — declared motion feeds the one
  `isPending` verdict. The only read a second channel enables is
  "intent but not machinery", which nobody asked for, while the common case
  would force `isPending(x) || isAffected(x)` on every consumer.
- **Not folded into `refresh`** — the declaration must exist from the start
  of the dead window (before any graph operation), the targets commonly
  differ (`affects(todo)` … `refresh(todos)`), and the pair isn't mandatory
  (a mutation may end in a push or a targeted write, with no refresh at
  all). `affects(x); refresh(x)` is an idiom, not one call.
- **Per-invocation, not a static `action` option** — the affected row is
  usually an argument, not a static binding.
- **Store-row identity is proxy identity** — survives reorders; a mark dies
  if `reconcile` replaces the underlying object mid-flight (new object, new
  identity — accepted as correct).

### Re-ruling log — 2026-07-07c: the mask model (#2844/#2728) — superseded 2026-07-13

The "overrides are unsettled" algebra ruled on 2026-07-07 was reversed the
next day after the #2844 background-refresh discussion converged with GabbeV's
long-standing position (and the repo's own todos example, which already
managed per-row pending with co-written flags). One conceptual change — **an
override is certainty by decree, and verdicts follow the channel you read** —
rippled through:

- **A20** rewritten (the mask; `isPending` never reports an active override).
- **A21** added (store-wide mask for derived optimistic stores).
- **A8** re-ruled (`latest` is a self-written override → the latest form
  follows the source's own async only; never pending on signals/sync
  computeds).
- **A9** re-ruled (both forms report a firewall refetch on resting leaves;
  the old latest-form filter is gone; A21 is the only silencer).
- **A19** amended (decree exception joins the initial-NotReady exception).
- **A18** consequence (3) flipped (`isPending === false` during a merged
  correction window — the mask outlives the merge).
- **A14** re-scoped (the spinner pin drives on a plain refetch; optimistic
  writes no longer produce `true`).
- **V4** behavioral half superseded (its companion-poke fix stands).
- The would-be **V6** (flagged during the re-evaluation: the latest form
  reading `false` for an active override with no async in flight, which the
  old A20 called a violation) is not a violation — it is the mask working
  as specified. No entry in Known violations; the A20 pins cover it.
- **INV-10** added: dev-mode asserts a companion's observable verdict is
  `false` whenever its owner has an active override or its firewall's
  store-wide mask is up.
- **A21 consequence (4)** added 2026-07-08: the mask/entanglement arm only on
  _effective_ writes. Previously arming ran in `prepareStoreWrite` before the
  equality short-circuit, so `s => ({ ...s })` and same-value writes masked
  while the semantically identical `s => s` did not — the boundary was "did a
  trap fire", not "did data change". Arming now happens per-trap after the
  effective-write determination (`armOptimisticStoreWrite`).
- **A22/A23** added 2026-07-08 (Discord follow-ups on the mask model): pending
  granularity is per-node everywhere outside A9/A21 (confirmed empirically:
  plain-store action write, projection + downstream async, derived store
  post-commit under a downstream hold), and the probe's reads-only contract is
  now explicit — with the direct-argument `isPending(store)` form accepted as
  the ergonomic complement (post-2.0), closing GabbeV's `isPending(store)` /
  `isPending(() => store)` ask.

What did _not_ change: A17 (override is THE value), A18's lifetime/hold
mechanics, A19's cause algebra for non-decreed data, A13/V1–V3/V5 (resting
nodes and the blocked-merged window), and lane architecture (same optimistic
lanes; the mask is a verdict rule, not a scheduling change).

## Process

1. Tier B/C items get a maintainer verdict (issue comment, chat, or edit this
   file).
2. On verdict: write the spec test, cite the verdict date here, move to Tier A.
3. Tier A tests are spec. A PR that changes one must say _why the design
   changed_, not "updated expectations".
