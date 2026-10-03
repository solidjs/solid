# Size reduction — carve-down step 1: the async floor

Date: 2026-09-30. Branch `size/carve-step1` off `next` @ 309b08730. **Nothing
on the branch merges**; it is a measurement. Companion documents:
`size-reduction-audit.md` (the plan), `size-reduction-g-rulings.md` (the
rule-by-rule leniency pass this supersedes on the transaction layer),
`benchmarking-strategy.md` (Octane mechanics).

## 1. Summary

Stripping the signals core bottom-up — store → optimistic/verdict →
implicit transition → boundaries — with the async core kept verbatim and the
heap r3 pins intact, the floor scenario goes from **9508 → 5145 B brotli
(−45.9 %)**, 27.0 → 13.7 KB minified. Hello world goes 11970 → 7606. Every
retained test passes at every step; the posture matrix and oracle lose cells
and flip exactly one 8-row class (reported as the headline semantic delta);
the fuzzer's retained class is 69/69; the carved build is faster on every
retained path (micro-benches 0.73× time, Octane Solid-only 0.92×).

The number refutes "the structure itself is the cost" (the decision rule's
~9 KB branch). But the inventory shows that ≈2.9 KB of the 4.4 KB removed
lives _inside_ `recompute`, `read`/`serve` and the flush — the optimistic
value/notification channel and the implicit-entry transition shape — not
beside them. Step 2 is therefore not porting modules behind existing seams;
it is deciding three seams and building the transition primitive (zombies)
against them.

## 2. Method

- Harness: `scripts/size` (Rolldown) over all scenarios, plus per-module
  inventory (`attribute.mjs`) and V8 bytecode length/frame of the hot
  functions (`read`, `setSignal`, `recompute`) from the prod dist.
- Removed exports become throw stubs in `src/carved.ts`
  (`[CARVED] <name> was removed on the measurement branch`) so downstream
  dists keep resolving; the stub tax was bracketed directly (≤ 55 B br on
  CSR, 0 on the floor).
- Each step: typecheck → measure → full vitest with posture/oracle reports →
  classify failures by message (`[CARVED]` direct; otherwise isolate and
  re-run at file level) → diff posture/oracle against the previous step →
  record the coupling inventory.
- **Reclassification rule (agreed with the maintainer mid-carve):** tests
  that assert the hold model — entanglement, stale-reader carve-outs,
  adoption, kept tails, held children, zombies, contested effects, wake —
  are _removed cells_ whether or not `action` appears in them. Only a flip
  in a retained cell counts as a regression, and flips are reported
  explicitly. The carve does not re-implement base mechanisms to make a
  removed cell pass.
- Baseline reproduced byte-for-byte before the first cut (`base0`).

## 3. The async floor

| scenario                                                               | next                | carved                  | Δ                     |
| ---------------------------------------------------------------------- | ------------------- | ----------------------- | --------------------- |
| signals: core floor (createSignal/Memo/Effect/Root/flush + async core) | 9508 br / 27013 min | **5145 br / 13723 min** | **−45.9 % / −49.2 %** |
| app: render + one signal (hello world)                                 | 11970               | 7606                    | −36.5 %               |
| app: CSR (Show/For/Loading/Errored/lazy)                               | 14901               | 9498                    | −36.3 %               |
| app: hydrating (no stores)                                             | 19663               | 14343                   | −27.1 %               |

What the 5145 br IS: sync graph (heap r3, owner tree, one queue, effects
with the status protocol) + async values (NotReady, status propagation,
landings, settle walk, same-flush staging A28). Hot functions: `read`
1001 → 687 B, `setSignal` 473 → 201, `recompute` 4708 → 1705 (frame
512 → 336).

What it is NOT: no store, no optimistic/verdict, no implicit transition
(holds, parks, zombies, entanglement), no `action`, no boundaries.

Hello world (`createSignal` + `render` + one binding) uses none of the
removed capabilities. Its 4.4 KB delta is entirely residue paid for
features it does not use: store 0.33, optimistic/verdict 1.6, implicit
transition 2.1, boundaries 0.28. What remains is 5.1 KB of signals floor
and ≈2.5 KB of renderer (`web.js`, `solid.js`, `flatten`).

## 4. Capability → marginal bytes → couplings → classification

Floor = residue every consumer pays even when the capability is unused
(the module itself never reaches the floor). CSR = residue + module where
the app uses it. Coupling IDs (C/O/T/B) are expanded in the appendix.

| capability (step)                                                                                | floor br                            | CSR br | module when reached                                                        | core couplings                                                                                                                                                                                   | separable                       | needs a seam                                                               | structural                                                                     |
| ------------------------------------------------------------------------------------------------ | ----------------------------------- | ------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Store family** (1)                                                                             | **334**                             | 346    | ≈7.8–7.9 KB br (SC pages)                                                  | C1–C17: slot-signal child chain, `_firewall \|\| el` owner resolution in read/height/hold/verdict/landing, GlobalQueue hook statics, withheld schedule, transient slot sweep                     | C3 C6 C8 C9 C10 C11 C13 C14 C17 | C4 C5 C7 C12 C15 C16 — one idea: _a store leaf answers for its projection_ | —                                                                              |
| **Optimistic + verdict** (2)                                                                     | **1612** (1559 residue)             | 1731   | ≈2.5 KB br when `isPending`/`latest`/`createOptimistic` are reached        | O1–O14: second value channel (override) + second notification channel (lane) through recompute/read/finalize; 11 NodeExtension slots; ~30 hook statics                                           | O1 O6 O10–O14                   | O5 O9 (setter / landing fork)                                              | **O3 O4 O7 O8** — `recompute`, `read`/`serve`, `finalizePureQueue`, node shape |
| **Implicit transition** (3a): holds, parks, zombies, entanglement, run ownership, `action` hooks | **2136**                            | 2100   | `action.js` is shaken at baseline; its floor cost is hooks (tens of bytes) | T1–T14: Transition object + stash/restore + verdict + wake; recompute deciding its frame after the pass; a read entering a transaction; setter stamp; landing→hold lookup; zombie chain in owner | T5 T6 T9 T10 T11 T13 T14        | T4 (stamp) T8 (landing lookup) T12 (boundary's own registry)               | **T1 T2 T3** — the _implicit-entry_ shape                                      |
| **Boundaries** (4)                                                                               | **281** (230 queue tree + 50 slots) | 1226   | boundaries.js 2.9 KB min + error-hooks 0.46 + context 0.27 (CSR)           | B1–B8: queue tree under the global queue, status forwarding chain, commit sweep, #3540 re-arm phase, per-owner `_queue`, per-node `_notifyStatus`                                                | B1 B2 B4 B6                     | B3 (per-owner queue = _who owns this node_); B5 is the seam itself (kept)  | —                                                                              |
| **Async values** (retained)                                                                      | 5145 incl. L0                       |        |                                                                            |                                                                                                                                                                                                  |                                 |                                                                            |                                                                                |
| **total removed**                                                                                | **4363**                            | 5403   |                                                                            |                                                                                                                                                                                                  |                                 |                                                                            |                                                                                |

Zombie primitive (T7, owner.ts): ≈300 B min, zero allocation, cleanly
separable — the piece to keep, minus its wake coupling to the verdict.

Learning cost of the transaction layer (indicative, two methods):
machinery ≈1 KB br (Transition + stash/restore + verdict + wake + zombie
queue + action hooks) : rules-by-issue-number ≈1 KB br (A15/A29/A30,
contested, held children, kept tail, #3372 wake, authoritative replay).
About 1:1, on a 0.3 KB primitive. Corrected 2026-09-30: the single-future
convergence (`_transition` stamping, `batchJoins`, `mergeTransitionState`,
≈100 B of `setSignal` plus the merge) is primitive (§8 test 4), not a rule;
it moves to the machinery side.

## 5. Gates

- Retained tests: zero regressions at every step (transition matrices in
  the appendix; s4 vs s3a: passed→fail 0, fail→passed 0).
- Posture matrix: removed cells only, except **one flip class in 3a**
  (8 rows, "pending own async" × effect readers: served `0` → `HELD` — the
  A15 render-effect stale-reader carve-out). Oracle: 0 violations
  throughout.
- Fuzzer (`solid-fuzzer` fuzz/6b, seed 3289, 1000 cases): retained class
  **69/69**; 483 stubbed (boundary readers); **359 fail S1/S2** — the hold
  invariant stated as an oracle, nothing else. The fuzzer is ~¾ a
  hold-model oracle, less a core gate than assumed. (Harness drift fixed in
  a /tmp copy: three observe hooks newer than the fuzz branch; `next` itself
  scores 995/5 on the same seed.)
- Perf, A/B on one machine, base = 309b08730 from a detached worktree:
  in-repo benches **0.73× time** (prod tier, 14 retained benches,
  order-independent; propagation −43 %, disposal −36 %); Octane Solid-only
  **0.92× median / 0.86× min** over 113 timed ops in the 5 store-free suites
  (uibench, memo-wall, portal-swarm, recursive-context, signal-favoring).
  js-framework and effectful-list Solid fixtures build their rows with
  `createStore` and are stubbed on this branch; with `createSelector`
  retired there is no store-free js-framework fixture to author.
- The speed is the removed layers' runtime cost, not an optimization of
  retained code; step 2 spends some of it back.

## 6. Semantic deltas and public surface on the branch

- **S1** a mainline write whose downstream is async commits at the flush
  instead of being held — readers of the in-flight memo block, siblings
  that read only the source publish (tearing). The fuzzer's 359.
- **S2** the old frame goes dead at the pass — the tab test fails as the
  "ghost" (cleanups run before the new frame lands).
- S3 no entanglement / re-park / proposals; S4 no run ownership; S6 no
  fallback posture (pending at root defers the mount; an error at root
  halts); S7 no reveal order.
- **Public surface (measurement branch only):** stubs for every
  store/optimistic/`isPending`/`latest`/`affects`/`action`/boundary export;
  `installAuthoritativeRead` removed; `IQueue` narrowed to
  `enqueue/run/notify`; `Queue` class removed from core/index; DEV
  `LOADING_ON_OUTSIDE_HOLD` no longer emitted; observe-tier hold/transition
  hooks typed but silent. `flatten` moved to `src/flatten.ts`, export
  unchanged.

## 7. Alignment with expectations

| expectation (on record before the carve)                                                      | result                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Decision rule: floor ~6–7 KB → rebuild as modules; still ~9 → the structure is the cost       | **5.1 KB.** The structural reading is refuted; the async core with nothing on it is small.                                                                                                                                                             |
| 0.10.0 floor was 5.18 KB (Feb 2026), grew to 9.5–9.9 with no new primitives                   | 5.15 KB carved — the growth since Feb is, to within noise, the layers' residue. (Feb's figure included some residue of simpler layers, so the retained core grew a little.)                                                                            |
| Target column: floor gap ≈ 4 KB                                                               | −4.4 KB.                                                                                                                                                                                                                                               |
| G-ruling pass (dist stubbing): leniency ≈0.8 KB, "no implicit holds anywhere" ceiling ≈1.2 KB | **2.1 KB.** The stubbing method undercounted by ~0.9 KB: it can null branches but not remove slots, stamps, frames or the parked-children machinery that stays reachable. "Leniency can't close the gap" still stands; the machinery estimate was low. |
| Optimistic/verdict residue                                                                    | No prior number. **1.6 KB on the floor, in the hot paths, paid by apps that never call it.** The surprise of the step.                                                                                                                                 |
| Store / boundaries residue                                                                    | 334 B / 281 B. As assumed.                                                                                                                                                                                                                             |
| Gate: removed cells only, never flip                                                          | One 8-row flip class (3a), reported as S1.                                                                                                                                                                                                             |
| Gate: fuzzer 994/0/6 on retained                                                              | 69/69 — but retained is 69 of 1000.                                                                                                                                                                                                                    |
| Gate: perf kept                                                                               | Faster (0.73× / 0.92×).                                                                                                                                                                                                                                |

Where it did not line up: (a) the modules path is a design step, not a
packaging step — three seams first; (b) hello world ≤ 10 KB depends on one
item. On this branch hello world is 7.6; L2 returns unconditionally (zombies
are the fundamental piece, entry is implicit) at a ≤ 1 KB budget → ≈8.6;
store, boundaries and optimistic should return at **zero** for hello world
if their seams are real — today they cost it 2.2 KB. The only one in doubt
is the optimistic channel (1.6 KB today): expressed as a parked frame with a
visible override it is L2's slots; as a second channel it is ≈10.2. The CSR
band (~8) is a separate problem: 9.5 KB at the end state with ≈2.7 KB of it
in `web.js`/`map.js`/`solid.js`, untouched by this step.

## 8. The two contracts, reframed

**L0+L1 — the floor.** Committed vs this-flush-staged is the only frame
concept. 5.1 KB br.

**L2 — implicit transition = zombie.** Not `action`: actions are a thin
layer above (hooks measured in tens of bytes; the module shakes). The
primitive is _defer the doomed frame's disposal_: when a pass under a
pending read produces a frame that cannot land, park the OLD children
(already allocated — zero new objects) and keep them reacting until the new
frame lands; swap atomically; run the old cleanups at the swap.

Contract tests, in the order to rule them:

1. **Ownership invariant** — every node, parked or live, is reachable from
   a live owner at every instant; owner disposal is total (Solid 1's
   `tOwned` failure; #3543's near-miss).
2. **The tab test** — two tabs; tab 1's counter on `setInterval`; navigate
   to tab 2 (own async); the counter keeps ticking until tab 2 lands; then
   one atomic swap with tab 1's cleanups at the swap.
3. **O2** — creation under a parked frame (§10, decision 1) — ruled before
   any visibility rule.
4. **Single future** (maintainer, 2026-09-30: "our transitions never cancel
   or supersede; it's working towards a single future"). There is one
   pending future at a time. A write during it either reaches the future
   (its propagation touches a node already in it) and joins it, or does not
   and publishes live — the route write is the first case, tab 1's counter
   the second. Exactly one landing; the landing is total; nothing is
   dropped. A pass joins the future if it reads something pending _or_
   something already in the future — one mechanism, stamp propagation. The
   value-level stale-flight discard in async.ts (`_inFlight !== result`) is
   convergence, not cancellation: the latest question's answer lands.
5. Only then the visibility rules (A15 stale reader, A29 adoption, A30 kept
   tail…) — each re-derived from 1–4 or dropped.

Implementation gaps in today's zombie, found by reading it out:
`REACTIVE_ZOMBIE` conflates chain position with scheduling
(`queueFor`/`zombieQueue`, #3543, scheduler-livelock); two parking
mechanisms (`_pendingFirstChild` vs `CONFIG_LANE_FRAME`); the held decision
is computed after the pass (`needsPendingCommit`/`held`/
`CONFIG_HELD_CHILDREN`) instead of being the pass's input; disposal is
coupled to the verdict (`wokenTransitions` push in `disposeChildren`); O2 is
unruled.

## 9. Step 2 — proposal (built; results in §12)

On a branch off the s4 end state:

1. Write the contract tests first, failing on the floor: ownership
   invariant, tab test, O2 under ruling A (§10), single future (§8 test 4).
2. Add exactly one flush seam — "end of pure phase: commit or park" — plus
   the setter stamp (T4, which decides convergence) and the landing lookup
   (T8). No verdict object; a pass parks if it read something pending or
   something already in the future.
3. Port T7 verbatim minus its wake coupling: `markDisposal`,
   `_pendingFirstChild`, `disposeChildren(…, zombie)`, `runDisposal`. One
   parking mechanism.
4. Measure marginal bytes at each landing under the ratchet rule (hello
   world may move only by L2's own cost); run the retained suite plus the
   zombie tests (#3463, #3546, #3404, transition-orphan-recompute); sort
   every failing removed-cell test into _implementation gap_ or _rule we
   don't need_. Budget signal: ≤ 1 KB br over the floor.
5. Then L3 placement (decision 2), then boundaries and store as modules
   behind B5 / the flush-phase hook / "a leaf answers for its projection".

Not this track: the CSR band's renderer bytes; 3b (same-flush staging off
the mainline path — edits the async landing path; ≤ 300 B br estimated).

## 10. Decisions (maintainer, 2026-09-30)

**Ruled:** O2 → **A, parked-frame ownership**; L3 placement → **B, build L2
first and test L3 on its seams**. Step 2 (§9) proceeds under these two
rulings. The options as laid out are kept below for the record.

**Decision 1 — O2: who owns a node created during a pass that gets parked?**
A pass under a pending read (tab 2's body reads async data that is not
ready) creates memos, effects, DOM-building render effects. The pass cannot
land. Two rulings are coherent:

- **A. Parked-frame ownership (total).** The new children belong to the
  owner of the parked pass. They _compute_ (the pass must run to discover
  its reads, and live writes that reach them keep them current) but they do
  not _publish_ or _effect_ until the swap. They are disposed only by a
  later pass of their parent within the same future (normal recompute
  disposal, inside the frame, with cleanups) or by disposal of their owner
  from the live graph — never by abandoning a frame, because there is no
  competing frame (§8 test 4). The ownership invariant is then a structural
  property (one owner tree per frame), the swap is "replace children, run
  old cleanups, run new effects", and same-flush staging (A28) extends from
  values to the owner tree. Cost: the parked subtree's effects are cold
  until it lands.
- **B. Live-owner ownership (Solid 1 shape).** New children attach to the
  live owner immediately and run; parking is about _values_ only. No
  parked-children chain, simpler scheduler — but the old and new frames
  coexist under one owner, which is exactly where `tOwned` leaked, and the
  effects created in the parked pass run against a world that has not
  landed, so rules (born-held, run ownership) re-enter to suppress them.

Today's `next` is A as implemented with rule patches (born-held,
`CONFIG_HELD_CHILDREN`, zombie queue, run ownership) and a second parking
mechanism for lanes. Recommendation: **A**, as a ruling rather than a rule
set.

**Decision 2 — L3 placement: spike before L2 lands, or after?**

- **A. Spike first.** Prototype "optimistic lane = parked frame with a
  visible override" on the floor and measure it against the 1.6 KB channel
  before L2's seams harden. Risk: the spike has to build a chunk of L2 to
  exist, so it is L2 designed under L3's pressure.
- **B. L2 first, L3 as the test of its seams.** Build L2 against its own
  three tests, with one constraint carried from L3: a read must be able to
  be routed to a parked frame's value (the "which world is this read served
  from" seam), so a future _visible_ bit can use it. Then try to express L3
  on it; if it does not fit, the misfit is the finding. Risk: rework of L2
  if the seam is wrong; benefit: L2 is not bent by L3, and the ≤ 1 KB
  budget question gets a clean answer.

Recommendation: **B** — it matches the order the system was originally
right in ("the basic transition zombie piece working in isolation was much
smaller").

## 11. Reproducing

- Ledger with every step's numbers, per-module deltas, bytecode, gate
  triage and coupling inventories: appendix below (local evidence under
  `/tmp/carve/`: `step1..4.patch`, `s*-posture.md`, `s*-oracle.md`,
  `s*-tests.json`, `bench-*`, `fuzz-*`, `octane/`).
- Base for A/B: detached worktree of 309b08730 with its own `node_modules`
  so `@solidjs/signals` resolves to the base dist; compiler and babel-plugin
  are byte-identical between the two and shared.
- Octane: the fork's `link:` overrides pointed at each build in turn with
  `pnpm install --no-frozen-lockfile`; the override/lockfile edits are not
  committed.

## 12. Step 2 — L2 built on the floor (2026-09-30)

Built in place on the s4 working tree under the §10 rulings (O2 → A, L3 → B)
and the single-future contract. Still a measurement: nothing merges. The s4
end state is snapshotted at `/tmp/carve/s4-src` for A/B (src swap), its
prod dist at `/tmp/carve/dist-s4`; L2's at `/tmp/carve/dist-l2`.

### 12.1 Headline

| scenario (brotli B)               | base  | s4 floor | **L2**   | L2 − s4  |
| --------------------------------- | ----- | -------- | -------- | -------- |
| signals: core floor               | 9508  | 5145     | **5683** | **+538** |
| signals: + createStore            | 16848 | 5198     | 5730     | +532     |
| signals: + isPending/latest       | 12160 | 5212     | 5750     | +538     |
| app: render + one signal          | 11970 | 7606     | **8151** | **+545** |
| app: hydrating (no stores)        | 19663 | 14343    | 14882    | +539     |
| app: CSR with Show/For/Loading/…  | 14901 | 9498     | 10041    | +543     |
| app: hydrating + every store      | 30789 | 15190    | 15761    | +571     |
| app: CSR, observe tier            | 16421 | 11050    | 11620    | +570     |
| app: observe + attribution engine | 30654 | 24934    | 25498    | +564     |
| page: base server components      | 46193 | 32990    | 33535    | +545     |
| page: live server components      | 50442 | 34315    | 34829    | +514     |

Minified, core floor: 13723 → 15406 (+1683). Per module (min B): scheduler
1679 → 2670 (+991: the seam, `holdNode`/`holdFrame`, the zombie deferral,
`notify`, `commitPendingNode`'s in-flight arm), core 4598 → 5024 (+426:
park/born-held/join sites in `recompute`, `read`, `setSignal`), owner
1078 → 1290 (+212: `markDisposal`, the zombie walk in `disposeChildren`,
`runDisposal(zombie)`), async +37, graph +10, heap/effect +3.

Hot-function bytecode (prod dist): `read` 687 → 761 (+74, frame 80 → 80),
`setSignal` 201 → 225 (+24, frame 32), `recompute` 1705 → 1957 (+252, frame
336 → 344). Base was 1001 / 473 / 4708.

**Budget verdict: +538 B br on the floor, ≤ 1 KB (§9 step 4). Ratchet
rule holds:** every scenario moves by +514…+571 — hello world by L2's own
cost (+545), nothing re-couples. L2 vs base: core floor −3825 B (−40 %),
hello world −3819, CSR −4860.

### 12.2 What was built

One seam, one parking mechanism, one future. Mechanisms, with the site:

- **The seam** — `GlobalQueue.settle()` (scheduler.ts), called where both
  flush paths called `commitPendingNodes()`: _end of pure phase: commit or
  park_. `parkFlush` (module boolean) is the pass's input, set by
  `joinFuture()`; the seam consumes it. Park = move this flush's
  `pendingNodes` onto `heldNodes` (`CONFIG_HELD`), `holdFrame` over each
  `CONFIG_STAGED` node's live children (ruling A: a held pass's children are
  the future's), stash both effect queues on `heldQueues`. Land = when
  `heldNodes` is non-empty and `futurePending` (the pending **observers**)
  is empty: `commitPendingNode` over the held set (old frames die here,
  cleanups first), stashed effects run ahead of the flush's own. T8 — the
  landing lookup — degenerates to a set-empty check under the single
  future; T4 — the setter stamp — is `setSignal` on a `CONFIG_HELD` node
  joining.
- **Four join sites**, all `joinFuture()`: (a) a pass goes pending inside a
  flush (`GlobalQueue.notify`, PENDING arm — the observer rule: a pending
  memo nobody renders holds nothing); (b) a tracked read of a HELD node by a
  non-children-forbidden reader (`read`, both blocks — also marks the reading
  pass `REACTIVE_JOINED`); (c) `setSignal` on a HELD node; (d) a recompute of
  a HELD node.
- **Born held** (`recompute`, publish branch): a first pass stages instead
  of publishing — and `effect()` skips its synchronous first run (A29) —
  when `parkFlush` is set and either the pass read the future
  (`REACTIVE_JOINED`) or a pass created it (its creator computed is
  `REACTIVE_RECOMPUTING_DEPS`). A born-held node is `holdNode`d at birth so
  a read of it in the same tick is a read of the future.
- **Zombies** — every non-create recompute parks its previous frame
  (`parkChildren`: O(1) move of `_firstChild`/`_disposal` to
  `_x._pendingFirstChild`/`_pendingDisposal`, then `markDisposal` flags the
  subtree `REACTIVE_ZOMBIE`); the node's commit disposes the parked frame
  (`disposeChildren(node, false, true)`), owner death drains it
  (`disposeChildren(self)` first drains the parked chain). A pass whose
  previous pass is still uncommitted (`CONFIG_STAGED`) disposes those
  children on the spot — the frame parked before them stays parked. A pass
  still in flight (pending, nothing staged) stays `CONFIG_STAGED` through
  the seam and keeps its parked frame: the displayed frame reacts until a
  pass of that node commits a value.
- **Zombie scheduling** — no second heap. `GlobalQueue._update` defers a
  zombie's recompute (`deferZombie`: out of the heap, DIRTY/CHECK cleared,
  onto a list); the seam decides: a park drops them (the batch joins — the
  writes that dirtied them are held), a commit runs the survivors after the
  commits that would have disposed them, height-sorted (#3546 semantics).
  `REACTIVE_ZOMBIE` is carried through every per-pass flag wipe (#3543); the
  splice in `disposeChildren` skips zombies (the parked chain is drained
  whole); the reawaken path does not relink a zombie; the three
  auto-dispose sites skip zombies (base parity).
- **New flags/fields:** `CONFIG_STAGED`, `CONFIG_HELD`, `REACTIVE_ZOMBIE`
  (bit 5), `REACTIVE_JOINED` (bit 7, pass-scoped); `NodeExtension` gains
  `_pendingFirstChild`, `_pendingDisposal` (cold, on `_x`). No public API
  change.

### 12.3 Contract tests

`packages/signals/tests/l2-contract.test.ts` — 7 tests, all **failing on
the s4 floor** (verified by src swap) and **passing on L2**: ownership
invariant (parked frame alive and owned, `dispose()` total, cleanups once;
a dev-hook walk asserts `isDisposed ⇔ unreachable` at every flush), the tab
test (tab 1 ticks until tab 2 lands; one atomic swap; `tab1:cleanup` before
`render:tab2`), O2 under ruling A (children of a parked pass compute but do
not effect; a later pass of the parent disposes them with cleanups; a frame
born into the future is cold; landing order), single future (a write that
reaches the future joins — `theme()` stays `light` — one that does not
publishes live — the counter; one total landing; a superseded flight's
answer is convergence), and — added in step 2 — **a mount during the hold**:
a new root whose memo reads the held `tab` is born held and cold until the
landing (A29 — the oracle's `published → HELD` cell), its sibling reading
only the committed world publishes at once.

### 12.4 Retained suite — transition matrix vs s4

`passed → passed` 797, `carved → carved` 3770, `failed → failed` 111;
**`failed → passed` 19**, **`passed → failed` 10**; `failed → carved` 2,
`carved → failed` 1 (the test now gets further before hitting a carved
API). New: 7.

**Fixed by L2 (19)** — the hold-model tests that come back once there is a
future: #3461 (held landing keeps the committed frame's deps), #3410
(conditional memo across a held branch), #3372 ×2 (held write whose reader
leaves), #3443 ×2 (overlapping flights entangle), #3456 ×2 (re-park retires
sources), P1 release (#3446/#3426), #3462 ×2 (superseding re-ask keeps
blocking), #3494 tick-mates, #3546 ×2 (zombies rerun for live writes after
the commit that spared them), transition-orphan-recompute (separate flush),
#3404 (nested render effect releases children at its own commit),
late-pending-equality, createMemo "do not auto-dispose zombie".

**Regressions (10), sorted:**

- _Rule we do not carry — 1._ **(Reversed in §13: this is A15's stale-reader
  rule, not provenance; carried in step 2a and passing.)**
  `effect-mainline-ownership-3412` "panel hides
  when show flips" (`boundary:false` variant; the others already failed on
  s4). #3412 is per-node provenance: an observer that was pending on the
  held source re-passes for an unrelated write, stops reading the source,
  and must be mainline again. L2's membership is the flush's (batch): the
  observer is HELD because it was pending when the flush parked, and (d)
  joins. The same class: `held-derivation-3612` "an unrelated hold (T holds
  k; b unstamped): the mainline write commits at once" (`carved → failed`;
  base's two-world read — a mainline pass sees committed `c=1` beside
  mainline `b=101` while T holds k — has no counterpart under one future).
  Carrying these needs per-node provenance (base's `_transition` stamps on
  the write path); not built, by the §9 brief.
- _Test-isolation artifacts of the single future — 9._ `attribution-timeline`
  ×1, `held-derivation-3612` ×5, `write-proposals-3494` ×3. **Each passes
  in isolation** (`-t`). In-file, an earlier test that was already failing
  on s4 — it hits a carved API (`latest`/`isPending`) mid-hold — leaves its
  root undisposed with a pending observer; under one future that observer
  blocks every later landing in the worker. Base's independent transactions
  did not have this property. On a real L2 branch those earlier tests
  complete and dispose; the property itself (one stuck unbounded flight
  gates every held write in the app until it settles or its owner dies) is
  the single-future ruling and is listed under §12.7 for the record.

The zombie set named in §9 step 4: #3546 2/3 fixed (the third needs
`action`), #3404's sync re-run fixed (the other four need
`createLoadingBoundary`/`action`), transition-orphan-recompute 2/2 (one was
already passing), createMemo's `do not auto-dispose zombie` fixed; #3463's
own test needs `action` (carved) — its liveness rule is exercised through
the three auto-dispose guards instead.

### 12.5 Performance

Vitest benches (`SIGNALS_TIER=prod`, the CodSpeed harness, three interleaved
runs each): L2 is −10…−20 % on `updateSignals`/`propagation`, −12…−28 % on
`createComputations`, within noise on `createSignals` (−0.6 % median). On
the **built prod dist** (`/tmp/carve/microbench.mjs`, best of three
interleaved): `createComputations:create1to1` −4.5 %, `update1to1` −3.2 %,
`propagation:diamond` −6.5 %, `propagation:avoidable` −6.6 %. The gap
between the two is the harness: vite-node serves every imported constant
and live binding (`CONFIG_HELD`, `parkFlush`, `joinFuture`) as a
module-namespace property load, so each added cross-module reference on a
hot path counts several times over; Rolldown inlines them. Where the real
cost sits: `setSignal`'s T4 check (one load+mask+branch on a ~4 ns path —
the `diamond`/`avoidable` figure is 1000 re-writes of one signal per
flush), `read`'s HELD check per tracked read, `_update`'s zombie test per
heap pop, `recompute`'s park/queue checks. All are the L2 rules themselves,
not couplings; none was moved behind a hook. CodSpeed will show the harness
figure.

### 12.6 Deviations from the §9 brief, and why

- **`markDisposal` is flag-only.** Base migrated heap entries to a
  `zombieQueue` under the walk; L2 has no second heap. The flag is kept
  because scheduling needs O(1) zombie identification at the heap pop (the
  first matrix without it showed dirty zombies recomputing at their height
  before the commit disposed them — `parent before child`, `looped
effects`, orphan-1, store `recursive-effects`). The §8 critique
  ("conflates chain position with scheduling") stands as an observation:
  the flag _is_ position, and position is what the scheduler asks.
- **Observer rule at `GlobalQueue.notify`**, not `notifyStatus`: registering
  every pending node held the future for memos nobody rendered (25 → 40
  regressions in the first matrices). Base's `_asyncReporters` site.
- **Join on pending only inside a flush.** A pass that goes pending at root
  setup or in a mount has no previous frame to hold (A29 loading, not a
  transition). Without this every initial render parked, and a creation-time
  pending observer made the _next_ unrelated flush park (the A32 oracle
  cell, `createSignal` entanglement).
- **Born held is "read the future or created by a pass"**, not "`parkFlush`
  was set". The coarse form held root-level siblings created in a parking
  tick (the `createSignal` entanglement tests) — and the precise form needed
  the `REACTIVE_JOINED` pass mark, because without it a mount reading the
  held `tab` published the future's value live beside a frame showing the
  past (found while fixing the former; now contract test 7).
- **A pass in flight keeps its parked frame** (`inFlight` in
  `commitPendingNode`): the first version disposed it at the seam, which
  (a) tore down the displayed frame of a loading render effect at the flush
  end, as the floor did, and (b) moved `dormant-memo-chain-3554`'s cleanup
  ordering. Keeping `CONFIG_STAGED` while pending restores the floor's
  re-pass disposal timing and gives L2 the right semantics for free.
- **`isDisposed` unchanged**: zombies read live (contract 1 asserts it).
- **Known limitation under ruling A:** children created by a pass _before_
  its join point in a from-scratch flush (no `parkFlush` yet) publish and
  run their first effect live; the park then holds them by frame. Contract
  3's fixture joins at `setTab` time (T4) so it does not exercise this; the
  precise fix is a per-pass join (mark the pass, re-stage its earlier
  children at the join) — not built.
- The deferred-zombie release is a height-`sort` over a list rather than a
  heap run; the list is per flush and almost always empty.

### 12.7 For the maintainer

1. **Per-node provenance (#3412 class)** — rule we drop, or a per-pass join
   (REACTIVE_JOINED already exists) extended into membership? Estimated
   +150–300 B br; it would also close the §12.6 "before the join point"
   limitation.
2. **Single-future stuck flight** — one unbounded pending observer that
   never settles gates every subsequent held write app-wide (base: only its
   transaction's). Boundaries (step L3/B5) are the intended scope; worth
   stating as the rule.
3. **Batch stashes tracked-effect runs too** — a `createTrackedEffect`
   callback queued in a parking flush waits for the landing although it
   reads committed values only (A32). Exempting them needs a third queue or
   a tag; left as is.
4. **CodSpeed delta** (−10…−20 % harness, −3…−7 % dist) — accept as L2's
   price, or spend bytes to lift T4 off `setSignal`'s staged-rewrite path.

---

## 13. Step 2a — render effects are the frame (A15), 2026-10-01

### 13.1 The rulings, and the source

Maintainer, 2026-10-01, refining L2's membership model (normalized):

> We only hold changes that trigger within the same synchronous frame as the
> async, or that come in later and would overlap along dependencies.
> Ownership in itself doesn't entangle. If there isn't this overlap the
> change happens as its own transaction. One exception to the overlap rule
> is render effects: since we group on compilation and they are the only
> mechanism to report transition/boundary participation, overlap there does
> not entangle and instead sees committed values for read values outside of
> the current running transaction.

> O2 ownership was done to park because it is newly created as part of the
> transition — after the fact. This is why tab A can continue to tick up
> even though the parent owner is part of the transition.

> Async resolution continues the transition again until the next flush — it
> resumes the sync frame. (Actions can also resume transitions via `yield`;
> layered on later.)

> Concurrent non-overlapping holds land independently (needs per-node
> transaction identity — a later step). This step: the render-effect
> exemption only.

These rules were already written: `packages/signals/docs/SPEC-ASYNC-SEMANTICS.md`
— **A15** (shared-hole corollary #3407, reveal corollary #3305/#3334, first
observer #3458, liveness through a memo #3494), **A29** (born held; a stale
reader of an uninitialized held node enters), **A30** (the render-effect arm
of #3469; #3438), **A34** (proposals). **Correction to §12:** L2 was built
from the §8/§9 brief and the carve doc; it cited A28/A29/A32 but did not use
A15's corollaries as the design source, and §12.4 filed #3412/#3612 under
"rule we do not carry — per-node provenance". That was wrong: #3412 is
A15's stale-reader term, and it is carried here. The spec is the contract
for every further step.

### 13.2 Headline

| scenario (brotli B)               | s4 floor | L2    | **2a**   | 2a − L2 | **2a − s4** |
| --------------------------------- | -------- | ----- | -------- | ------- | ----------- |
| signals: core floor               | 5145     | 5683  | **5853** | +170    | **+708**    |
| signals: + createStore            | 5198     | 5730  | 5900     | +170    | +702        |
| signals: + isPending/latest       | 5212     | 5750  | 5924     | +174    | +712        |
| app: render + one signal          | 7606     | 8151  | **8334** | +183    | **+728**    |
| app: hydrating (no stores)        | 14343    | 14882 | 15047    | +165    | +704        |
| app: CSR with Show/For/Loading/…  | 9498     | 10041 | 10236    | +195    | +738        |
| app: hydrating + every store      | 15190    | 15761 | 15960    | +199    | +770        |
| app: CSR, observe tier            | 11050    | 11620 | 11857    | +237    | +807        |
| app: observe + attribution engine | 24934    | 25498 | 25708    | +210    | +774        |
| page: base server components      | 32990    | 33535 | 33729    | +194    | +739        |
| page: live server components      | 34315    | 34829 | 35003    | +174    | +688        |

Minified, core floor: 15406 → 15887 (+481). Per module (min B): core
5024 → 5253 (+229: `frameRead`, the two `read` arms, `recompute`'s
render-effect arm), scheduler 2670 → 2922 (+252: `futureBlocked`,
`frameReruns` + the landing loop, `commitPendingNode`'s published-inputs
mark; `futurePending` removed), constants +39, owner −24, async −9.
Hot-function bytecode: `read` 761 → 848 (+87, frame 80 → 88), `recompute`
1957 → 2012 (+55, frame 344), `setSignal` unchanged (225).

**Budget: step 2 total (L2 + 2a) is +708 B br on the floor, under the ≤ 1 KB
line of §9 step 4.** Ratchet holds: every scenario moves by the step's own
cost (+165…+199 prod; +210/+237 on the observe artifacts, not attributed).

### 13.3 What was built

- **The stale reader** — `frameRead(c, el)` (core.ts), asked by both `read`
  arms on a `CONFIG_HELD` source. A render effect, outside a parking flush,
  reading a held node is served the committed value (a pending one's too —
  A15's reveal corollary: "shows the node's committed value, coherent with
  the frame, whose inputs are also committed"), publishes mainline, joins
  nothing. It is recorded for the landing: `REACTIVE_FRAME_READ` (bit 11)
  set on the reader and the reader pushed to `frameReruns`, once per pass.
  Not a stale reader: a reader born into the future (`STATUS_UNINITIALIZED`
  and held — A29, "cannot fall back to the committed frame and enters
  instead"), a read inside a parking flush (the pass is the future's), a
  source whose flight's inputs are already visible (below). A source with
  no committed value at all (uninitialized held node) makes every reader
  join (A29), render effects included.
- **Re-derivation at the landing** — `settle()`'s land step walks
  `frameReruns`: a reader whose bit is still set (its _last_ pass was the
  committed read) is `enqueueSub`'d for the round after the commits; the
  bit is cleared. The bit survives its own pass's wipe and is cleared by the
  next pass's top wipe, so a reader re-derived since — in the future, or by
  a pass that no longer read the held node — owes the landing nothing. (The
  first version keyed on "has a staged value", which cannot see an effect's
  re-derivation: effects publish directly; `panel:open:D` logged twice.)
- **Memos and user effects still join** (`joinPass`); a recompute of a held
  render effect outside a parking flush no longer joins (it clears the stale
  staged value instead, if the node is initialized). `GlobalQueue.notify`'s
  pending arm joins unconditionally again — `read` carries the rule.
- **The hold is judged on the flight, not on who went pending** —
  `futureBlocked()` (scheduler.ts) replaces the `futurePending` set. The
  future is blocked while a held node in flight (`STATUS_PENDING`) is a
  render effect or has a render effect among its `_subs` with a
  **current-generation link** (`s._gen === r._depGen`). A15 #3494:
  "liveness is judged by what it derives from, not by whether it turned
  pending" — a stale reader never pends, but is linked to the flight. A
  memo between them is pending and held too, so one hop is the chain. The
  generation check excludes a tail kept for A30 (a dependency of the
  committed frame awaiting the run that retires it): a reader that stopped
  reading releases the flight (O3, write-proposals "hide after a coalesced
  toggle": 2500, not 4000). Found by #3407's plain-write test: with the set,
  the stale reader's clean pass emptied it and the future landed at 500 with
  the flight still up (`1:1 | 2:1` at 2000). Side effect: a pending mount
  outside a flush (a fresh root's own async, not held) no longer blocks an
  unrelated future — it is not in `heldNodes`.
- **A landing resumes the transaction** (`settlePendingSource`'s walk,
  async.ts): clearing pending on a `CONFIG_HELD` dependent calls
  `joinFuture()` — the re-pass over the landed value is the future's work
  and the flush that carries it parks ("it resumes the sync frame"). Found
  by contract 5c: a flight committed unobserved (`data` never held), later
  observed by a reveal (`panel` held, pending on it), landed in a mainline
  flush: the panel re-derived `closed` off the committed `show` and only
  then `open:D` — a spurious frame.
- **Published inputs refuse the carve-out** — `CONFIG_INPUTS_PUBLISHED`
  (bit 10, reintroduced; it went with the transactions in carve 3).
  `commitPendingNode` sets it on a computed committed _in flight_ (pending,
  nothing staged — its inputs just published beneath it) and clears it on
  the commit that lands a value. `frameRead` refuses a source carrying it:
  the reveal observes (pends, holds) instead of showing the pre-flight
  value beside visible inputs (A15 reveal corollary, #3305;
  `reveal-carve-out` "a replacement flight over published inputs refuses the
  carve-out" passes).
- **Owner death** (owner.ts): a held pending node's death, or a stale
  reader's (`REACTIVE_FRAME_READ`), schedules a seam — either can unblock
  the landing. `joinFuture()` outside a flush schedules one (a born-held
  mount otherwise left `parkFlush` set across ticks with no flush to
  consume it — found by the mount contract).
- **Flags:** `REACTIVE_FRAME_READ` (bit 11), `CONFIG_INPUTS_PUBLISHED`
  (bit 10). Removed: `futurePending`. No public API change.

### 13.4 Contract tests

`l2-contract.test.ts` grows contract 5 — _render effects are the frame, not
the transaction_ (A15): **5a** a live write that reaches a render effect
reading the held `tab` commits (`panel:1/1`, `panel:1/2` beside the held
tab, `panel:2/2` once at the landing); **5b** a reveal of a _held_ flight is
a stale reader — `panel:open:idle` at once beside the committed `go=false`,
`show` commits, `panel:open:D` once at the landing (first written to the
pre-spec expectation "the panel stays pending"; corrected to A15); **5c** a
reveal of a flight whose inputs are _visible_ observes it — `show` waits,
one reveal `panel:open:D` with the landing. Contract 4a adds the render
effect reading `tab` and `counter` in one hole (the maintainer's "easiest
render effect test"); the mount contract adds a second root mounted in a
separate tick that reads the held `tab` directly — `mount-tab:1` (A15: a
fresh direct reader is a stale reader), `mount-tab:2` at the landing. 10
tests, all passing.

### 13.5 Retained suite

**vs L2 (§12.4):** `passed → failed` **0**; `failed → passed` **9** —
#3407 plain write and plain reveal (`shared-effect-no-entangle`), #3412
`boundary:false` (`effect-mainline-ownership-3412`), #3458
(`first-observer-stale-reader`), #3438 (`held-conditional-effect`), #3469's
render-effect arm (`held-frame-dependencies`), the reveal carve-out and the
#3305 refusal (`reveal-carve-out` ×2), and the visibility oracle's
`pending own async × staleForeign` cell (whose own comment asked "does
INPUTS_PUBLISHED cover a flight opened by the same batch?" — it does now).

**vs s4 floor:** `passed → passed` 798, `carved → carved` 3771,
`failed → failed` 103, **`failed → passed` 27**, **`passed → failed` 9**,
`failed → carved` 2. The 9 are §12.4's second group exactly
(`attribution-timeline` ×1, `held-derivation-3612` ×5,
`write-proposals-3494` ×3): **each passes in isolation** (`-t`, re-verified
after this step). In-file, an earlier test that fails on a carved API or an
uncarried rule (A34(3) `rederiveHeld`, the first test of 3612) throws before
`dispose()`, and its root's held flight — a reader still linked to it —
blocks the single future for the rest of the worker. The liveness term makes
this stickier than `futurePending` was (a stale reader's link counts where
its cleared pending did not); the property itself is the single-future
ruling (§12.7 item 2), closed by independent transactions.

### 13.6 Not carried, by category

- **A30, #3469 memo arm** — `held-frame-dependencies` "a memo whose held
  pass computed the same value still follows its committed inputs"
  (`failed → failed`). An unchanged pass under a parking flush trims its
  stale tail at once (`trimStaleDeps` in `recompute`); the spec defers it to
  the flush's verdict (`heldTrims`: trim on commit, keep on park). Not A15;
  ~60 B (a list and a loop at the seam). **Built as step 2b, §14.**
- **A34 — writes are proposals; equality drop** — `write-proposals-3494`
  "repeating a held value entangles the tick", "a tick that nets to the
  committed value proposes nothing", `held-derivation-3612` ×N (A34(3),
  `rederiveHeld`). Membership (category B) and the writable-memo
  re-derivation; not this step.
- **Independent transactions** (category C) — `contested-effect` "two
  non-entangled transactions", and every in-file leakage above. Ruled
  "independent"; needs per-node transaction identity. Next step after B.
- **Batch residue** (category B) — an unrelated write in the same flush as
  a T-write is held; zombies dirtied in a parking flush are dropped.
  Unchanged from §12.

### 13.7 For the maintainer

1. The order of the remaining steps: A30 `heldTrims` (small, spec-pinned,
   independent of B/C — done, §14) → C (transaction identity; `yield`
   resumption layers on this) → A34's proposal rules, the small ones inside
   C's membership work.
2. `futureBlocked()` is an O(held nodes + their subs) scan at every seam
   while a future exists — nothing on the plain path. If a future lives long
   with a large held set it is the one place a counter would pay for itself.
3. The in-file leakage (§13.5) is the suite's lack of per-test teardown
   meeting the single future. Either `finally { dispose() }` in the affected
   files, or a dev-only reset of the seam state between tests, would make
   the matrix read true in-file; neither is a runtime change.

---

## 14. Step 2b — an unchanged pass waits on the flush's verdict (A30, #3469), 2026-10-01

The spec's mechanism, verbatim: "An unchanged pass (#3469) trims at its tail
only when created, OPT-dirty, or a tracked effect; otherwise its stale tail
goes to `heldTrims`, trimmed by `commitPendingNodes` when the flush commits
and dropped (tail kept) when it parks." OPT-dirty is carved.

**Built:** `recompute`'s trim site splits — a create pass or a tracked effect
calls `trimStaleDeps` at its tail as before; any other pass that published
or changed nothing (`_pendingValue === NOT_PENDING`, no `_error`, no owed
run) calls `heldTrim(el)` (scheduler.ts: a push). `settle()` drains the list
in its commit branch after `commitPendingNodes()` — skipping a node whose
later pass this flush threw (`_error`, NotReady included: it keeps its full
list) or left an effect owing a run (`_modified`: `runEffect` trims when the
run applies) — and clears it in the park branch, tails kept. Pushed outside
a flush too (a pull before the flush that carries the write): the write
scheduled the seam that drains it. A disposed node's trim is a no-op
(`clearDeps` nulled the list). No new flags; no public API change.

**Why it was the gap:** `selected = b() ? b() : a()` held on `b → 1`
computed `1`, equal to the `1` it had from `a`, and trimmed `a` at its tail;
the flush parked, and the mainline `a = 2` never reached it — `A: 2 | B: 0 |
Selected: 1`. Now the tail is kept at the park, `a = 2` re-derives
`selected`, which reads the held `b` and joins (A29): `A: 2` reveals with
`B: 1` at the landing — `5000: A: 2 | B: 1 | Loaded B: 1`.

**Size:** core floor 5853 → **5897 B br (+44)**, 15887 → 16032 min (+145:
scheduler 2922 → 3056, core 5253 → 5268). Every scenario +16…+91 (observe
tier −10, noise). `recompute` bytecode 2012 → 2040, `read`/`setSignal`
unchanged. **Step 2 total (L2 + 2a + 2b): +752 B br on the floor**, under
the ≤ 1 KB line.

**Suite:** vs 2a — `passed → failed` **0**, `failed → passed` **1**
(`held-frame-dependencies` memo arm). vs s4 — 798/3771/102 unchanged
classes, `failed → passed` 28, `passed → failed` the same 9 in-file
leakages (each passes with `-t`). Of A30's other pins: #3410 and #3438 pass
(§13.5); #3461's async arm asserts its A30 frame correctly (`5000: A: 1 |
B: 1 | Selected: 1 | Slow: 1`) and fails on the mount — it expects the async
memo's first landing to be held with the mount's pending `slow` and reveal
at 2000 ("resolution resumes the frame", applied to a mount frame), which
L2 does not park (§12.6: under one future, a parked mount made the next
unrelated flush join) — a C item, not A30 (maintainer: "that case wouldn't
be an independent transition but part of the same one"; built in §15); the
two 3494 pins of the kept-tail pending mark use `action` (carved).

---

## 15. Step 3 — independent transactions (C), 2026-10-01

### 15.1 Headline

| scenario (brotli B)               | base  | s4 floor | L2    | 2a    | 2b    | **3 (C)** | C − 2b | **C − s4** | C − base |
| --------------------------------- | ----- | -------- | ----- | ----- | ----- | --------- | ------ | ---------- | -------- |
| signals: core floor               | 9508  | 5145     | 5683  | 5853  | 5897  | **6120**  | +223   | **+975**   | −3388    |
| signals: + createStore            | 16848 | 5198     | 5730  | 5900  | 5945  | 6163      | +218   | +965       | −10685   |
| signals: + isPending/latest       | 12160 | 5212     | 5750  | 5924  | 5960  | 6182      | +222   | +970       | −5978    |
| app: render + one signal          | 11970 | 7606     | 8151  | 8334  | 8368  | **8600**  | +232   | **+994**   | −3370    |
| app: hydrating (no stores)        | 19663 | 14343    | 14882 | 15047 | 15100 | 15304     | +204   | +961       | −4359    |
| app: CSR with Show/For/Loading/…  | 14901 | 9498     | 10041 | 10236 | 10275 | 10480     | +205   | +982       | −4421    |
| app: hydrating + every store      | 30789 | 15190    | 15761 | 15960 | 15976 | 16196     | +220   | +1006      | −14593   |
| app: CSR, observe tier            | 16421 | 11050    | 11620 | 11857 | 11847 | 12066     | +219   | +1016      | −4355    |
| app: observe + attribution engine | 30654 | 24934    | 25498 | 25708 | 25736 | 25984     | +248   | +1050      | −4670    |
| page: base server components      | 46193 | 32990    | 33535 | 33729 | 33804 | 33979     | +175   | +989       | −12214   |
| page: live server components      | 50442 | 34315    | 34829 | 35003 | 35094 | 35256     | +162   | +941       | −15186   |

Minified: core floor 13723 (s4) → 15406 (L2) → 15887 (2a) → 16032 (2b) →
**16724 (C)**: C is +692, +3001 over the floor. Per module, 2b → C (min
B): scheduler 3056 → 3511 (+455: `Transaction`, `joinFuture`'s merge,
`txOf`, `blocked`, the per-transaction landing loop, the loading-source
skip), core 5268 → 5418 (+150: `txOf` at the join sites, `frameRead`'s
same-transaction test, `_transaction` in `ext()`), async +39, owner +13;
heap/effect/graph/error/signals/constants +2…+10 are mangled-name drift.
Hot-function bytecode (base / 2b / C): `read` 1001 / 848 / 862 (frame 128 /
88 / 88), `setSignal` 473 / 225 / 237 (frame 56 / 32 / 40), `recompute`
4708 / 2040 / 2081 (frame 512 / 344 / 344).

**Budget.** The whole hold model on the floor — L2 + 2a + 2b + C — is
**+975 B br**, under the ≤ 1 KB line of §9 step 4 on the core floor;
hello world +994; the heavier app scenarios +961…+1050 (the observe and
attribution artifacts carry the dev-only tracking). Against base the floor
is −3388 B (−36 %), hello world −3370, CSR −4421, every-store −14593.

### 15.2 What was built

- **`Transaction`** (scheduler.ts) — `{ _nodes, _queues[2], _reruns,
_into }`: the held staged nodes, the stashed effect queues, A15's stale
  readers, and a merge pointer. `transactions` is the live list (opened,
  unmerged, not landed), scanned at every seam while non-empty — nothing on
  the plain path. `NodeExtension._transaction` (cold, on `_x`) stamps a
  held node; `txOf(n)` resolves it through merges with path compression.
  `holdNode(n, t)` flags, stamps, and lists.
- **`flushTransaction`** replaces `parkFlush`: the transaction this flush
  parks into. `joinFuture(t | null)`: with nothing joined, `null` opens a
  new transaction (a pass went pending with nothing held — the async's own
  synchronous frame), a `t` joins it; a second, different `t` **merges**
  into the flush's — the work that touched both entangles them (A15:
  "overlap along dependencies"): `t._into = f`, arrays concatenated, `t`
  removed from the live list. Every join site passes the node's transaction:
  `read` (`joinPass(c, el)`, the uninitialized-source arm), `setSignal`,
  `recompute`'s held arm, the settle walk's "a landing resumes the frame"
  (async.ts), and `notify` (an observer already held re-pends into its own).
- **`notify` joins outside a flush too** — the mount frame (maintainer on
  #3461: "that case wouldn't be an independent transition but part of the
  same one"). A root's pending observers open the mount's transaction; the
  flush that follows parks the mount's pending nodes into it; a flight
  started in that frame (`quick`, `selected`) lands into it and waits for
  the frame's other flights. What the mount published synchronously
  (`effect()`'s first run) stays published — `0: A: 0 | B: 0`, then
  `2000: Selected: 0 | Slow: 0`. L2's §12.6 deviation ("join on pending
  only inside a flush") existed only because, under one future, a parked
  mount made the next unrelated flush join; under C that flush opens its
  own.
- **A loading source is not held** (the park loop): a node pending with
  nothing staged, no committed value (`STATUS_UNINITIALIZED` — A16, A19
  exception 1: loading, not pending) and not a render effect is nobody's
  frame. Its first landing is commit #0, not a resumption, and a write that
  reaches it later overlaps nothing. Found by `createSignal` "async
  computed's first settle does not permanently entangle unrelated effects"
  (#2937): an unobserved `createSignal(async () => counter())` held at the
  mount's park bridged every later `counter` write into a never-resolving
  flight's transaction. Its observers are still held and `blocked` waits on
  the flight through them.
- **`blocked(t)`** is `futureBlocked` per transaction, over `t._nodes`.
  The landing loop walks `transactions` backwards; each unblocked one
  lands: reruns enqueued, nodes committed (`_transaction` nulled), stashed
  queues ahead of the flush's own.
- **#3322, the contested effect** — at a landing, a stale reader being
  re-derived has its owed run voided (`_modified = false`): an effect has
  one value slot, and a foreign pass overwrote the value the stashed run
  was for (`both` computed `1:0` in T_A's flush, run stashed with T_A;
  T_B's flush recomputed it to `0:1` as a stale reader of `a`; T_A's
  landing ran the stashed run with `0:1` before the rerun's `1:0`). The
  re-derivation's run replaces it. Both #3322 tests and the file's control
  pass in-file.
- **`frameRead(c, el)`** — the stale-reader test is now "the node's
  transaction is not the flush's" (`txOf(el) !== flushTransaction`) rather
  than "no flush is parking": a render effect in T_A's flush reading a T_B
  node is a stale reader of T_B. The born-held clause is scoped to the
  reader's own transaction. `recompute`'s render-effect arm likewise clears
  a stale staged value when the flush's transaction is not the node's.
- **Flags/fields:** none new on the node; `_transaction` on `_x`.
  Removed: `parkFlush`, `heldNodes`, `heldQueues`, `frameReruns`. No public
  API change.

### 15.3 Contract tests

`l2-contract.test.ts` → 14 tests. Contract 4 is renamed _transactions_ (a
write that reaches a held node joins its transaction; one that does not
publishes live; a superseded flight's answer is convergence). **Contract 6
— independent transactions:** (a) two flights behind two signals, two
ticks: the later landing reveals alone (`b:1`, `B:b1`), `a` still held, then
`a` lands; (b) the same with a user memo of both: `both` re-derives for
`b`'s flight, reads the held `da`, and the two are one — `b` waits for `a`
(A15, #3443); (c) the mount frame: `quick` (an async memo resolving in a
microtask) lands into the mount's transaction and waits for `slow` —
`["x:0"]` until `slow` lands, then both; (d) an unrelated flight after the
mount is its own transaction and lands while the mount's `slow` is still
up. All 14 pass.

### 15.4 Retained suite

**vs s4 floor: `passed → failed` 0** — the first step with no regression
against the floor. `passed → passed` 807, `carved → carved` 3770,
`failed → failed` 99, **`failed → passed` 31**, `failed → carved` 2,
`carved → failed` 1 (gets further before a carved API). **vs 2b:**
`passed → failed` 0, `failed → passed` 12 — #3461's async arm, #3322 ×2,
and the nine in-file leakages of §12.4/§13.5 (`attribution-timeline` ×1,
`held-derivation-3612` ×5, `write-proposals-3494` ×3): with independent
landing, a leaked root's stuck flight blocks only its own transaction.

The 99 `failed → failed` (floor failures that are not `[CARVED]` throws)
by file: `createMemo` 26 (carve-adjacent — `latest`/`isPending`/`action`
reached through non-throwing paths, equality-gated landings), the
attribution engine 32 (`attribution-navigation` 11, `-holds` 7, `-feedback`
6, `-interactions` 3, others — transaction/hold records the engine no
longer receives), `visibility-oracle` 11 (`throws:Error` cells: carved
primitives inside the oracle's matrix), `async-chain-supersession` 3,
`rules-index`/`treeshake`/`dist-artifacts` 7 (branch tooling),
`held-derivation-3612` 2 (A34(3) `rederiveHeld` — the not-yet-carried
rule), `latest-*` 5, and singles. None is a hold-model rule C decides; the
A34 items are the next step's.

### 15.5 For the maintainer

1. **Budget:** the hold model is +975 B br on the core floor (under the
   line), +994 on hello world, +961…+1050 across the app scenarios. The
   §9 step-4 line was written for the floor; whether the app scenarios'
   crossing by 6–50 B matters is your call. The remaining known cost
   centres: `joinFuture`'s merge loops (~120 B — a union-find without array
   concatenation would move the cost to the landing walk), `blocked`'s
   per-seam scan.
2. **A34 next** — the small rules (a repeat of a held value joins before
   the equality gate: `setSignal`'s HELD check already precedes it, so this
   is the equality _drop_ for a tick that nets to the committed value, ~40
   B) and `rederiveHeld` (A34(3), writable memos — moderate). Then `yield`
   resumption layers on `Transaction` (an action's transaction is a
   `Transaction` held open across its yields).
3. **Merge order** — when a flush joins two transactions, the second is
   merged into the first (`flushTransaction`); landing order among several
   unblocked transactions at one seam is list order, and their stashed
   queues are prepended in that order (the later-listed runs first). No
   test observes it; worth stating if it should be defined.
4. The `#2937` loading-source rule is the one place C decides membership by
   node _status_ rather than by a join: a pending uninitialized node with
   no observer. If a boundary step wants loading sources held for a
   fallback, this is the hook.

---

## 16. Step 4 — lanes (`createOptimistic`), 2026-10-01

### 16.1 The rulings (maintainer, 2026-10-01)

A lane is "a new base of a transition": the sub-frame an optimistic write
opens in the transition of the frame it is made in. It **reads the parent's
staged world through** (live, not a snapshot), **breaks out of the parent's
hold** (shows now), **holds itself** if its own derivations hit async, and
**ends when the parent ends** — the guess reverts to the base it covered or
lands as the truth that superseded it. **Nesting** is the same rule
recursively. **No parent** (a frame that does not park) and the write is
**as if it never happened**. **Direct reads see the guess** throughout —
unblocked and blocked ("the optimistic write is the pending value of that
sub transition"). A **correction while blocked** voids the never-shown
guess; a **confirmation** leaves the lane to its own flight. **`latest`
above async is the pending value, below async the committed value.**
Actions are not special: they are a tool to resume a transition scope,
layered later. Render effects never merged (#2912's ownership split has no
case left).

Two slots, no third: the maintainer's question ("unless you have a way of
treating override as the pending value — work through it") was worked
through in-session; the evaluation that two slots suffice because the hold
model already has every _selection_ lanes need stands, with the roles below.

### 16.2 Headline

| scenario (brotli B)               | base  | s4    | C     | **lanes** | L − C     | L − s4 | L − base |
| --------------------------------- | ----- | ----- | ----- | --------- | --------- | ------ | -------- |
| signals: core floor               | 9508  | 5145  | 6120  | **7214**  | **+1094** | +2069  | −2294    |
| signals: + createStore            | 16848 | 5198  | 6163  | 7267      | +1104     | +2069  | −9581    |
| signals: + isPending/latest       | 12160 | 5212  | 6182  | 7280      | +1098     | +2068  | −4880    |
| app: render + one signal          | 11970 | 7606  | 8600  | **9697**  | +1097     | +2091  | −2273    |
| app: hydrating (no stores)        | 19663 | 14343 | 15304 | 16418     | +1114     | +2075  | −3245    |
| app: CSR with Show/For/Loading/…  | 14901 | 9498  | 10480 | 11590     | +1110     | +2092  | −3311    |
| app: hydrating + every store      | 30789 | 15190 | 16196 | 17361     | +1165     | +2171  | −13428   |
| app: CSR, observe tier            | 16421 | 11050 | 12066 | 13173     | +1107     | +2123  | −3248    |
| app: observe + attribution engine | 30654 | 24934 | 25984 | 27047     | +1063     | +2113  | −3607    |
| page: base server components      | 46193 | 32990 | 33979 | 35134     | +1155     | +2144  | −11059   |
| page: live server components      | 50442 | 34315 | 35256 | 36375     | +1119     | +2060  | −14067   |

Minified core floor 16724 → **20534 (+3810)**: scheduler 3511 → 6406
(+2895), core 5418 → 6181 (+763), async +88. Hot-function bytecode (C →
lanes): `read` 862 → 1054 (frame 88 → 104), `setSignal` 237 → 301 (frame
40 → 56), `recompute` 2081 → 2394 (frame 344 → 376). **After §16.6
(apply at the seam): core floor 7133 (+1013 over C), 20294 min; hello
world 9642; CSR 11515; every-store 17313; live page 36312.** `read` 1086,
`recompute` 2369, `setSignal` 301.

**Against the ledger:** base's optimistic + verdict layer was 1612 B br on
the floor (1559 residue). Lanes alone — no `isPending`/`latest`, no
`createOptimisticStore` — are **+1094**, all of it residue. The estimate
given before building (300–400 B for actions and lanes together) was wrong
by ~3×. §16.5 says where the bytes are and what a consolidation pass would
recover; the verdict on the layer waits on that pass and on the verdicts.

### 16.3 What was built

- **Node state** — two config bits plus a marker: `CONFIG_OVERRIDE`
  (`_value` is displayed optimism — a guess or a lane pass's derivation of
  one; the lane is `_x._transaction`), `CONFIG_LANE_HELD` (held by a blocked
  lane: `CONFIG_HELD` with lane read semantics), `CONFIG_GUESS` (the node
  carries a written guess: its own recompute or a plain write landing on it
  is the truth; a lane's derived staging is not). The base a guess covers is
  recorded on the lane (`_guesses: [node, base, …]`); an unblocked guess
  keeps its `_pendingValue` for the parent's staging (the truth, or the base
  a same-frame re-derivation computes), so the slot keeps its one meaning.
- **`Transaction` gains `_parent` and `_guesses`** (null for a transaction);
  `lanes` is the live list. **Per-pass membership**: `passLane`, set by
  `read` when a tracked pass reads displayed optimism or a blocked lane's
  staging, saved/restored around `recompute`, reset per flush round. A lane
  pass's staging goes to the lane (`laneStage`, also for an effect — the
  lane owns its run), its runs to the lane's queues (`enqueue`), and a
  pending it propagates is the lane's (`notifyStatus`'s walk). A pending
  observer that is lane work holds the lane, not the frame (`notify`).
- **The write** (`optimisticWrite`) records `[node, value]`; the updater's
  base is what the user sees (an unflushed guess to the same node, else the
  displayed value). **The seam** (`applyGuesses`, §16.6 — after the frame's
  verdict): the guess becomes `_value` — in the node's existing lane, or a
  new one under the frame's transaction (a lane's own flush parents nested
  lanes to it), under the hold already on the node, or under a transaction
  opened for the node's own in-flight refetch (A17: the guess is that
  flight's observer); with none of those the guess is dropped — nothing was
  applied, the write never happened. `insertSubs`: the lane's passes run in
  the next round of the same flush. Then each lane parks or reveals: **`parkLane`** (blocked — `blocked(l)`
  over its staging) moves a displayed guess into the pending slot
  (`_value` back to the base) and marks the staging LANE_HELD;
  **`revealLane`** swaps a held guess back, commits this round's staging
  through `commitPendingNode` (+ OVERRIDE for memos), re-derives the lane's
  stale readers (`_reruns`, #3460) and runs its queues ahead of the frame's.
- **Reads** (`laneRead`, `laneSees`): lane work reading a node held by the
  lane's parent chain is served the staged value without joining — the
  read-through. A displayed guess is `_value` for every reader
  (A17); a tracked read makes the pass lane work. A blocked lane's staging:
  direct reads and lane work see it, a tracked derivation becomes lane work,
  a render effect outside the lane's flush is a stale reader (committed,
  rerun at the reveal). Lane work reading a flight that is not the lane's
  own — the parent's, mainline's — is served the committed value (A31): a
  lane waits only on what derives from the guess. A written guess is an
  optimistic boundary: its own source in flight is its status, not its
  readers' (`notifyStatus`), while the frame it was asked in opens/holds a
  transaction for it (`joinFuture(null)`; `blocked` counts a pending guess).
- **The truth** (`supersede`, from `recompute` when a GUESS node's own pass
  runs outside lane work, and from `setSignal` for a plain write landing on
  one): stages under the lane's parent, clears the optimism, holds the node
  there; a correction notifies, a confirmation does not. A correction of a
  guess that never showed (LANE_HELD) voids the lane's frame: its nodes are
  the parent's, its runs the parent's, its other guesses reverted. **Same
  frame** (A18) falls out of applying at the seam: the guess node's own
  recompute for the frame's writes ran before the guess was applied, and
  what it staged is the base.
- **The end** (`endLanes`, from the parent's landing, nested first): a
  guess lands its staged truth or reverts to the base — through
  `commitPendingNode` (it retires whatever hold the node was under) —
  notifying if the display changes; derivations stop being optimism. A lane
  still blocked detaches and continues as a transaction: its guesses revert
  (never shown), its frame re-derives from the landed world and lands with
  its own flight.
- **`createOptimistic`** restored in `signals.ts` (plain and memo forms, the
  setter bound to `optimisticWrite`); the carved stub removed. **Public
  surface: restores an export carve 2 had stubbed; no new API.**

### 16.4 Contracts and suite

`tests/lane-contract.test.ts` — 10 tests, all passing: guess shows while the
parent holds and a confirming truth is silent; a differing truth re-derives
under the parent and reveals at its commit with the display keeping the
guess; a plain optimistic signal reverts to the value it covered; a second
guess replaces the first; a frame that does not park voids the write (alone
and beside a plain write); a derivation hitting async holds the lane's
frame and not the parent's, direct reads see the guess, the lane reveals at
its own flight; #3460 stale reader; the parent landing on a confirm while
the lane is blocked lets the lane continue; a never-shown guess corrected is
void and the guess's flight landing is inert; the base is the parent's
staged world (`view:5/b`). The L2 contracts (14) unchanged.

**Suite vs C: `passed → failed` 0; `carved → passed` 34**
(`createOptimistic` basics, `dev` graph tracking, `optimistic-settle-verdicts`
without an action, `optimistic-signal-refetch-hold` flash parity, A25's
write-visibility corollary, 17 posture-matrix cells and 6 visibility-oracle
cells over `createOptimistic`). **Vs s4: `passed → failed` 0, fixed 65.**

**`carved → failed` 41, sorted:**

- _Rule reversed today — 12 + 3._ `createOptimistic.test.ts` ×12 and
  `visibility-oracle` "override, ambient" ×3 pin the pre-ruling behavior of
  a no-parent optimistic write: "the flush shows 2, then reverts the
  ambient write" (`[1, 2, 1]`). Today: as if it never happened (`[1]`).
  Pins to change with the ruling, not regressions.
- _Rule reversed today — 2._ `transitionEntanglement.test.ts` pins the old
  lane view of a plain signal the parent holds: **committed** (`99:a`,
  A31's "the entanglement gates serve committed values for the lane's own
  view"). Today: read-through (`99:b`; contract 4 `view:5/b`). **Needs the
  maintainer's confirmation** — the consequence is a lane's hole showing a
  held write that the rest of the screen will show only at the landing.
- _Carved at a later call — 6._ `isPending`/`latest`/`action`/boundaries
  reached after the lane behavior was asserted.
- _In-file leakage — 13._ Each passes with `-t`. The main mechanism is new:
  a carved API thrown _inside a computation_ halts the reactive system
  (`REACTIVITY_HALTED`) for the rest of the file.
- _Attribution engine — 4._ Lane records the observe tier no longer
  receives.
- _The `"01"` vs `"1"` case_ (`createOptimistic` "should combine pending
  value…") resolved to the old pin: the guess updater composes on what the
  user sees, and a same-frame re-derivation of the guess node is the base,
  not the truth (A18). Passes.

### 16.5 For the maintainer

1. **The bytes.** +1094 B br / +3810 min is three times the estimate. The
   scheduler's +2895 min is ~240 lines of lane code in seven functions
   (`applyGuesses`, `parkLane`, `revealLane`, `endLanes`, `voidLane`,
   `supersede`, `optimisticWrite`) that overlap heavily — three separate
   "undo/re-home a lane" paths (void, blocked-correction, blocked-detach),
   and every function walking `_guesses` in pairs and `_nodes` separately.
   A consolidation pass — guess nodes as `_nodes` entries carrying their
   base in `_pendingValue` (now unambiguous: `CONFIG_GUESS` tells
   `laneRead` to serve `_value`), one `dissolveLane(l, into)` for the three
   undo paths, the void path simplified to revert-and-notify — is estimated
   at **−350…−450 B br**. That would put lanes at ~650–750, against base's
   1612 for lanes _and_ verdicts. Whether to spend that pass before verdicts
   are added is the first question.
2. **Read-through vs the old pin** (`transitionEntanglement`, above).
3. **Hot paths.** `read` +192 bytecode (the lane arm after the pull, the
   lane-work-reads-a-parent-flight check), `recompute` +313 (`passLane`
   save/restore, the lane/optimism branches), `setSignal` +64 (the GUESS
   check before the equality gate). All on the plain path; `laneRead` itself
   is behind a two-bit mask.
4. **Known gaps**, not pinned: a blocked lane holding two independent
   guesses is voided whole when one is corrected; a lane pass that read two
   lanes' guesses is attributed to the last; a pending propagated from
   outside any pass (a NotReady rejection) onto a lane's node is queued with
   the frame; a guess written in an effect callback of a parking frame is
   applied at the next round's seam, whose frame is usually empty — it voids
   unless the node is already held (actions give it an explicit parent).

### 16.6 Apply at the seam (2026-10-01, after the maintainer's question)

Maintainer: "how do you know you will need that optimism until you
actually run the graph?" — the parent is only known at the seam, and the
first build applied the guess at round start and _undid_ it when the frame
committed: `voidLane` reverted the guesses, discarded the lane's staging,
re-ran its passes inside the seam and suppressed the equal-value runs;
`freshGuesses` existed because a guess and its node's recompute shared a
round. Going back to the old rule (the one-flush flash) would have reused
the reveal and end paths for the void, but lets a `createEffect` observe a
value that never existed.

**Built instead:** the guess is applied _after_ the verdict. Round 1 runs
the frame as written. At the seam the frame's transaction is known:
`applyGuesses(joined)` opens the lane under it (or under the hold already
on the node, or under a transaction opened for the node's own in-flight
refetch — the guess is that flight's observer, A17, `optimistic-signal-
refetch-hold`), `insertSubs`, and the lane's passes run in the next round
of the same `flush()`; a frame that committed has no parent and the guess
is dropped, never applied. Two things became explicit that applying early
had gotten for free: **read-through** (`laneSees`: by round 2 the parent's
writes are `CONFIG_HELD`, so lane work reading a node held by its parent
chain is served the staged value without joining — before, they were merely
staged), and **ownership in `blocked`** (`blockedBy(nodes, owner)`: a
pending that propagated through the not-yet-guess node in round 1 made its
readers the frame's; in round 2 they became lane work, and the frame must
not wait on them).

Removed: `voidLane`, `newLanes`, `freshGuesses`/`isFreshGuess`, the
round-start hook and the fast-drain guard. **Size:** core floor 7214 →
**7133 (−81 B br)**, 20534 → 20294 min (−240); `recompute` 2394 → 2369,
`read` 1054 → 1086 (the read-through check), `setSignal` unchanged.
**Suite:** 24 contracts pass; vs the first lanes build `passed → failed` 0,
`failed → passed` 1 (a visibility-oracle "override, ambient" cell); vs s4
`passed → failed` 0, fixed 66.

### 16.7 Consolidation pass and benchmark (2026-10-01)

**Built:** guess nodes are `_nodes` entries (`CONFIG_GUESS | CONFIG_HELD`)
with the base they cover in `_pendingValue` — the committed value, or the
truth already staged — and `_guesses` is gone with its pair-walks; one
`dissolveLane(l, into)` replaces the three end/undo paths (parent landed →
each guess commits its pending slot, truth or base, through
`commitPendingNode`; corrected while blocked → reverted and re-homed to
the parent; outliving the parent → reverted and continued as a
transaction); `parkLane`/`revealLane` became one `laneSeam` walk (a guess
swaps slots and toggles `OVERRIDE ↔ LANE_HELD`); `blocked` lost the
separate guess scan; lane-flagged signals take `read`'s slow path so the
lane arm has one site. The two equality gates that must judge a guess node
against the guess rather than its pending slot (`setSignal`'s landing,
`recompute`'s own pass — a confirmation is silent) live on the guess
branches only (`guessOf`), after a first placement on the hot paths cost
`diamond` 8.6 %.

**Size:** core floor 7133 → **7074 B br (−59)**, 20294 → 19729 min
(−565); lanes **+954 over C**, +1929 over the floor. The estimate for this
pass (−350…−450 B br) was wrong again, in the same direction as the lanes
estimate: brotli had already compressed the repetitive lane code, and the
minified savings (scheduler −500) translated to a tenth of that. Hot
functions (C → now): `read` 862 → 1050 (frame 88 → 96), `setSignal`
237 → 324 (the guess branch, not taken on the plain path), `recompute`
2081 → 2408.

**Benchmark** (`/tmp/carve/microbench.mjs` on the built prod dists, all
variants interleaved in one sitting, best of four):

| hz                    | s4     | L2     | lanes  | **now** | now vs L2 | now vs s4 |
| --------------------- | ------ | ------ | ------ | ------- | --------- | --------- |
| create1to1            | 14410  | 13964  | 13738  | 13470   | −3.5 %    | −6.5 %    |
| update1to1            | 14258  | 13559  | 13250  | 13547   | −0.1 %    | −5.0 %    |
| propagation:diamond   | 240514 | 224383 | 210234 | 209496  | −6.6 %    | −12.9 %   |
| propagation:avoidable | 135454 | 126466 | 121267 | 121875  | −3.6 %    | −10.0 %   |

L2 → now is the cost of 2a + 2b + C + lanes on the plain path: the
`passLane` save/restore in `recompute`, `txOf` at the join sites, the lane
mask in `read`'s fast-block condition and the pending-parent-flight check
after the pull. `diamond` is 1000 re-writes of one signal per flush and
reads the `setSignal`/`insertSubs`/`recompute` spine almost exclusively.

**Where this leaves the layer.** Lanes as ruled cost ~950 B br in this
architecture, with the verdicts (`isPending`/`latest`) and
`createOptimisticStore` still to add, against base's 1612 for the whole
optimistic + verdict layer. The structure held (two slots, per-pass
membership, zero regressions at every step), but it is not cheap, and the
consolidation found no large duplication left to remove — the bytes are
the rules. The one large lever is semantic: the blocked-lane state ("holds
itself if downstream async is hit" — `CONFIG_LANE_HELD`, the slot swap,
`laneRead`'s held branch, the void-on-correction and detach paths,
`blocked` for lanes) is roughly a third of the lane code; without it a lane
would always reveal and a derivation of the guess in flight would pend like
any node — tearing inside the optimistic frame, which A17 forbids. That is
the maintainer's call, not a code change.

---

## 17. Correctness pass (2026-10-01)

Maintainer: "right now is the right time to make sure we are correct, in
the same way we made sure we are small and performant." The question put
was whether, to our knowledge, nothing is broken and no core behavior is
missing that is not tied to a primitive still carved.

### 17.1 Defects fixed

- **Unbounded `_nodes` growth.** `laneStage` pushed on every lane pass,
  `holdNode` on every re-supersession. One `list(n, t)` helper now owns the
  invariant "a node's `_transaction` is the transaction whose `_nodes` it is
  on" and adds nothing when it already holds. Pinned: "a long-lived lane
  does not grow its bookkeeping with every pass" (50 ticks, list unchanged).
- **The manual-write mask is the frame's (A34 as amended, #3733).**
  `REACTIVE_MANUAL_WRITE` was lifted only by `commitPendingNode`, so inside
  a hold it lasted the whole hold and dropped later source changes — the
  #3733 regression, on this branch. Now the park clears it on the frame's
  nodes (the commit already did); a held writable memo re-written in a later
  frame is re-queued so the seam sees it (`suppressComputedRecompute`);
  `_manualWriteTime` and `refresh()`'s clock test are gone — a mask that
  exists only in its frame is its own timestamp. Pinned:
  `tests/a34-frame-mask.test.ts` (either order within a frame; a later
  frame re-derives with the write as `prev`; inside a hold the write joins,
  masks its frame only, and the next frame's source change re-derives under
  the hold — `a=3 b=300`; `refresh()` in the write's frame loses, in a later
  frame re-asks).
- **A34 (1): a same-value write to a held node joins its tick.**
  `setSignal`'s HELD join sat after the equality return. Moved before it.
  Fixed: `write-proposals-3494` "repeating a held value entangles the
  tick".
- **A32: children-forbidden readers see the frame.** The carve had left
  `read` throwing `NotReady` to a `createTrackedEffect`/`onSettled` reader
  of a pending node; A32 serves the committed value and throws only where
  there is none (uninitialized). The dev warning's text no longer says
  "will throw". Fixed: the visibility oracle's `childrenForbidden` cell over
  a pending initialized memo.
- **A15 shared-hole for two independent flights.** `notify` sent a
  pending render effect's re-pend into the transaction that _held_ it; a
  render effect's membership is its pass's (#3407), so two flights read in
  one hole merged. `notify` now joins the frame's (`joinFuture(null)`), and
  the one thing that had been riding on the old branch — #3443, pending
  propagating onto a _held memo_ enters the memo's transaction — is where
  the spec puts it, in `notifyStatus`'s dependent walk. Fixed:
  `overlapping-flights` "a shared render effect stays parallel"; #3443
  still passes.
- **An optimistic write of what the user already sees is no guess**
  (`optimisticWrite`, the node's comparator against the displayed value or
  the latest unflushed guess).

### 17.2 Tests added

`lane-contract.test.ts` hardening block (5): a lane pass that throws is
contained by a user effect's error arm and leaves the lane and parent
intact (a memo's error reaching a render effect with no boundary halts the
system by design — boundaries are carved, so the error arm is the only
container available); disposing the roots mid-lane, unblocked and blocked —
nothing runs, nothing lands; a nested guess written in a lane's own frame
(an owned write during the lane's landing round) has the lane as its parent
and ends with it; the growth pin. `a34-frame-mask.test.ts` (4). All pass.

### 17.3 Every non-carved failure, classified

139 tests fail without a `[CARVED]` throw. Each was run alone:

- **Pass alone — 31** (`createMemo` 16, `spec-async-semantics` 6,
  `createOptimistic` 4, `async-chain-supersession` 3, two singles). In
  every one of those files a `REACTIVITY_HALTED` precedes the first
  failure: a carved API thrown _inside a computation_ is an unhandled error
  and halts the reactive system for the rest of the worker — the measurement
  branch's artifact, verified per file, not state leaking between tests.
- **Rule reversed today — 17.** `createOptimistic` ×14 and
  `visibility-oracle` ×3 pin the one-flush flash of a no-parent optimistic
  write (`[1, 2, 1]`); `transitionEntanglement` ×2 pin the committed view
  of a parent's held write from inside a lane (`99:a`) against today's
  read-through (`99:b`) — **the second still needs the maintainer's
  confirmation**.
- **Carved reached by a non-throwing path — 25 + 12.** `isPending`/`latest`
  called after the lane behavior was asserted; the visibility oracle's
  `latest`/`isPending` cells, which catch the carved throw and report
  `throws:Error`.
- **Tooling — 43.** Attribution engine records, `rules-index`, `treeshake`,
  `dist-artifacts`.
- **A34 (2)/(3), not built — 2.** `held-derivation-3612` "the functional
  updater composes on the committed frame" (`rederiveHeld`),
  `write-proposals-3494` "a tick that nets to the committed value proposes
  nothing" (the equality drop).
- **Base's third slot — 1.** `settle-walk-invariant` "first landing
  displayed as a derived lane override" constructs a fake node around
  `CONFIG_DERIVED_OVERRIDE` + `_overrideValue`; a mechanism test, not a
  behavior pin.
- **Was "needs B" — resolved, see 17.5.** `posture-born-held-and-observation`
  P1 ("gating a render effect away from a never-landing memo releases the
  source's write") and `held-restore` #3372 looked like two maintainer pins
  on either side of per-pass render-effect membership. They were not: the
  #3372 test's shape was outside the rules. Both pass now.
- **Pre-existing on the floor and understood — 1.** `scheduler-livelock`
  "stale height-adjust entry" reaches the carved `zombieQueue`.

### 17.4 Where this leaves "correct"

- The hold model (L2 → C): the maintainers' own pins — 807 floor tests
  still passing, 69 revived, zero `passed → failed` against the floor at
  any step, and now the shared-hole, A32 and A34 (1) corrections. I'd stand
  behind it, with B as the one known semantic gap and the two A34 rules as
  known omissions.
- Lanes: 15 contracts plus ~35 revived pins; error, disposal, nesting and
  growth now covered. The contracts are my reading of the day's rulings,
  not yet reviewed; read-through vs the committed view is the open ruling.
- Not knowable here: boundaries, actions, stores, verdicts, and their
  interactions with lanes.

**Size:** the fixes cost +45 B br on the floor (7074 → **7119**; +81 min —
`list`, the frame-scoped mask, the A32 arm, the propagation join). `read`
1050 → 1078 bytecode (the A32 arm); `setSignal`/`recompute` unchanged.

### 17.5 The re-ask join, the zombie rule, and a creation-site diagnostic (2026-10-01, later)

**The finding re-examined.** P1 wants a write that re-asks a flight an
observer is already pending on to be held with it. The join is on the
dedupe path of `notifyStatus` (a re-ask the subscriber is already pending
on: `(sub._config & (HELD | LANE_HELD)) === HELD && globalQueue._running`
→ `joinFuture(txOf(sub))`). It had been backed out because `held-restore`
#3372 then landed at 4500 instead of 3000.

Reading #3372 as written: its `<Show>` helper created the child as a
**root inside the render effect's callback** — outside every owner, so
the frame that unmounts it never stages its removal, and the dedupe join
then holds that frame on the child's flight. Maintainer: "that is some
weird shit … now you are operating outside of all the rules". The
compiled `<Show>` creates the child in the pass; a re-pass parks it as a
zombie of a pass the frame's transaction holds.

**A15 (#3463) — a zombie's say is moot for the transaction staging its
removal.** `removalStagedBy(r, t)` walks `_parent` while ZOMBIE and checks
the owner is HELD in `t`. Applied in `blockedBy` to a pending node's
render-effect readers, and — found when #3372 was rewritten — to a listed
pending render effect itself: the unmount frame's re-ask lands its
pending on the zombie it unmounts, which is listed as a pending node of
the frame. The l2-contract twin had not hit the second position because
its `details` settles synchronously on unmount. Pinned:
`l2-contract` "a re-asked flight whose only reader is a zombie" (the
compiled twin, landing at once); `held-restore` #3372 rewritten to the
compiled shape — passes with its original expectation, "3000: Show:
true". P1 passes.

**`PRIMITIVE_IN_EFFECT_CALLBACK` (dev, error; new public diagnostic
code).** Maintainer: "since effect draining happens during flush I don't
think we should be creating roots during it … any reactive primitive
shouldn't be created there really", then scoped to the existing mechanism
("leave it at computeds … they could create a signal but it won't do them
any good") and narrowed to **ownerless** creation: "runWithOwner is
deliberate, createRoot not so much" — `Portal` (`runWithOwner(owner, () =>
createRoot(…insert…))` in its render-effect callback) and `createReaction`
(the re-arm from inside the reaction callback) are both deliberate and
pass; a bare `createRoot`/`createMemo`/`createEffect` in a callback with
no ambient owner throws. One helper, `assertNotInEffectCallback()`
(`callbackDepth > 0 && context === null`), called from
`setupComputedNode` and `createOwner`; signals untouched. Dev-only —
nothing of it survives in the prod or observe trees.

Three tests had the forbidden shape and were rewritten without changing
expectations: `held-restore`'s `show()` (compiled shape, above),
`attribution-graph-growth`'s leaks (moved to the mount pass under
`runWithOwner(null, …)` — the detached-root mistake GRAPH_GROWTH exists
to catch, placed where creation is legal), `createTrackedEffect` #3291
(Portal's actual shape: owner captured in the compute, `runWithOwner` in
the callback).

**Suite:** 0 regressions vs the floor; vs the previous run exactly one
change, #3372 as written `failed → passed`. **Size:** 7119 → **7176 B br**
(+57; +201 min) for the dedupe join, `removalStagedBy` and both zombie
checks; the diagnostic is free in prod.

## 18. A34 rule B — writes apply first, then derivations re-run (2026-10-01)

**The ruling** (maintainer, relayed with the CS-R31 and A34 amendment
texts; reverses #2692's "write trumps derivation on the same tick",
beta.11, and supersedes this morning's frame-scoped mask, §17.1 / #3740):
a manual write to a derived node stages at once, with any live
transaction. When a source changes — in the write's own flush or later,
under the transaction or on mainline — the derivation re-runs with the
staged write as `prev` (the draft, for a store) and decides what to keep.
A write on its own never re-runs the derivation. Under T the re-run is
under T and reveals with it. A second write is still (1)'s last-write-
wins. `REACTIVE_MANUAL_WRITE` keeps only its role of marking the staging
as a user proposal (the (1)/(3) discriminator, the commit's same-value
drop); it has no scheduling role. "We can't tell order anyway … so it
feels like an order-matters kind of thing but isn't"; an override that
must survive a source change is carried in the data.

**What came out.** Every scheduling site of the mask: the two heap
refusals (`insertIntoHeap`, `insertIntoHeapHeight`),
`suppressComputedRecompute` whole (`deleteFromHeap` + DIRTY/CHECK clear +
the re-queue arm — `setSignal` already queues the node for the seam),
`refresh()`'s same-frame return, and the park's mask clear in `settle()`.
`setMemo` is `setSignal` plus the proposal mark when the write staged.
The mark is lifted where it already was: by a pass that re-derives (the
pass wipe in `recompute`'s `finally`) or by the commit; a pull that
recomputed nothing keeps it (`updateIfNecessary`, #3612). No new
mechanism: `recompute` already took `_pendingValue` as `prev` when staged.
The spec files (`docs/SPEC-ASYNC-SEMANTICS.md`, `rules-mining/core-store.md`,
`RULES-INDEX.md`) are not edited here — this worktree's copies predate
#3740's paragraph the amendment is to follow; the rule lands on `next`.

**Tests.** `a34-frame-mask.test.ts` (this morning's, pinning the superseded
mask) replaced by `a34-writes-then-derivations.test.ts` (8): a write alone
never re-runs; a same-flush source change re-derives either order; a later
frame the same; a `prev`-reading fold honors the write (`max(prev, a*100)`);
last write wins among writes and is the re-run's `prev`; `refresh()` in the
write's frame re-asks; inside a hold, the re-run is under T and reveals with
it, for a later frame and for the same frame. Reversed pins rewritten with
their shapes kept and titled "rule B; was #2692": `createMemo` ×7 (the
same-value write no longer stops the re-run; `refresh` in the write's tick
re-asks; the intermediate-memo re-mark re-derives) — #2745 unchanged;
`held-derivation-not-a-proposal-3612` "#2692 preserved" ×4 → rule B
(`a=2 b=200` either order, no hold and under the hold) and the store twin
×2 (`s.v=200`; carved here, correct for when stores return).

**Suite:** 0 regressions vs the floor and vs §17.5's run (three
`dist-artifacts` flips in the full run were `STACK_TRACE_ERROR` aborts on a
loaded machine; the file passes alone but for its pre-existing carved
`slotSignal` case). **Size:** 7176 → **7147 B br** (−29; −99 min); hot-path
bytecode unchanged (`read` 1078, `setSignal` 324, `recompute` 2408).
Simpler rule, less code, and it closes the two A34 (2)/(3) items' nearest
neighbor: nothing on the write path decides scheduling any more.

**Checked against `next`'s PR [#3742](https://github.com/solidjs/solid/pull/3742)
(the same change there):** mechanism identical — the two heap refusals,
`suppressComputedRecompute`'s `deleteFromHeap` and DIRTY/CHECK clear,
`refresh()`'s arm and `_manualWriteTime` all go; their `markManualWrite` is
this branch's `setMemo` tail. Its 37-test contract
(`derived-write-then-derivation-3733.test.ts`) run against this build:
12 pass, 25 carved (store, action, `latest`), **0 fail**. Pin rewrites
agree in outcome (`2 → 1`, `99 → 10`, `0 → 1`, `b=101 → b=200`,
`s.v=101 → s.v=200`); one differs in shape — their "latest manual write
wins" drops the source change to keep the test about (1), mine keeps it
with a `prev`-reading memo. Either converges when the branch is ported.

### 18.1 A34 (3a) — a mainline updater onto a held derivation (2026-10-01)

Step (1) of the agreed order. The maintainer's pin (`held-derivation-
not-a-proposal-3612` "the functional updater composes on the committed
frame") was the one runnable A34 (3) case here; the other half — "a tick
that nets to the committed value proposes nothing" (#3494, #3519) —
asserts `isPending` in both its pins and belongs to the verdicts step; its
behavioral half (a coalesced toggle captures no tick) already passes.

Checked against rule B before building: no conflict. Rule B governs the
_re-run's_ `prev` (the staged write); (3) governs the _updater's_ base
when the staging is a held pass result — the committed frame the mainline
writer can see — and keeps the one write that does re-run: the staging it
replaces was derived from inputs the writer never saw, so the hold
re-derives over the write. #3742 says the same ("Unchanged: A34 (3)").

Built in `setMemo`, nothing elsewhere: `held = CONFIG_HELD && !MANUAL_WRITE
&& txOf(el) !== flushTransaction` (the writer is inside T exactly when the
flush has joined T — an owned write in a held pass; actions, carved, would
be the other case); a held write's updater composes on `_value`; after
`setSignal` (whose A34 (1) join still runs) the node is marked DIRTY and
heaped, so the next flush — already joined to T by the write — re-derives
with the write as `prev` and stages under T. Mirrors #3742's
`heldDerivation`/`rederiveHeld` (theirs tests `activeTransition`; this
branch has no such thing, the flush's transaction is the same fact).
Unchanged and still passing: a compute-phase owned write under T followed
by a mainline write (`b=101`, last-write-wins — the mark discriminates).

**Suite:** 0 regressions vs the floor; vs the rule B run, the updater pin
`failed → passed` (and the three `dist-artifacts` aborts of that run back
to passing — load, as suspected). **Size:** 7147 → **7181 B br** (+34;
+102 min), hot-path bytecode unchanged.

## 19. A lane sees the screen plus its own guesses (2026-10-01)

**The ruling.** Put as the open question from §16/§17 — lane work reading
a parent's held write: read-through (`99:b`, as built, from "yes read
through") or the committed view (`99:a`, the two `transitionEntanglement`
pins). Maintainer: `99:a`, "but for a different reason … S2 if written at
the same time is part of the same parent transition which means optimism
didn't escape … now that it is reading from the parent directly it's
either held or it sees committed values. Showing 'b' … would only hold up
if we knew S1 wasn't being read anywhere else on the page … we'd see 1
and b on the screen at the same time which is a contradiction. It's one
thing to opt into a prediction and showing that but we can't assume that
for things that don't have a prediction." A coherence rule, not a lane
rule: a held write is held because showing it would tear against the rest
of its frame; a lane revealing a derivation of it shows it anyway. The
guess is the one value the user opted into predicting.

**Rule text:** _a lane sees the screen plus its own guesses._ The screen =
committed values + revealed guesses (its own and any ancestor lane's,
which are displayed). Never a transaction's held writes — those are
visible to the transaction's own passes only. `latest()` is unchanged and
orthogonal: it is the explicit opt-in to see through, and answers the same
inside a lane as outside (above the async the pending value, below it
committed). `isPending` likewise. Verdicts need no lane-specific arm.

**The case read-through was built for.** Maintainer: "async → optimistic
→ async … when the parent has multiple async. if the parent async that
feeds into the optimistic resolves first and doesn't match it's important
that the downstream async can do its refetch (off screen now held by the
transition as it collapsed into it) immediately and not wait for the other
parent async … it was the whole why lanes aren't separate transitions
argument." Then: "since the optimistic guess has been removed and the
child has collapsed into the parent, it isn't really read-through anymore
it just is." Confirmed in the code: the correction dissolves the lane, the
refetching pass has no `passLane`, `read` takes the `joinPass` arm, the
truth is read as a member and the refetch is the parent's flight —
immediately, held with everything else. `laneSees` was only ever consulted
while the lane was alive, i.e. exactly the window in which seeing the
parent's held writes is a leak. It never served the case it was built for.
Pinned: lane contract 4 (second case) — two parent flights, the
guessed-over one lands first and differs, `fetched` goes `[0, 5, 7]`
before the other flight lands, nothing shows until the parent lands as one
frame.

**Does it change the structure? No.** Before, a lane was a sub-frame in
two senses — it _saw_ its parent's future and it _belonged_ to its parent.
The ruling removed the first and kept the second: a lane is a separate
transaction for visibility and a child for lifetime (ends with the parent,
collapses into it on correction, blocks it while its guess is pending,
does not exist without it). "Separate transitions" would need the parent
pointer, the no-merge rule and the two slots regardless;
`Transaction { _parent, _lane }` is that. What it changes for users: an
optimistic value is "the screen plus my guess", not "my transition's
future plus my guess" — a derivation of a guess that also reads a held
write shows `guess + old` now and `truth + new` at the landing.

**What was cut.** `laneSees` and its ancestor walk; the two `read` arms
that consulted it. Lane work reading a node some transaction holds now
takes the stale-reader path `frameRead` already gives render effects:
committed value, `REACTIVE_FRAME_READ`, re-derived from that transaction's
`_reruns` at its landing. One new condition found by tracing: a node T
holds re-enters T's pass when it re-runs (`recompute`'s head, membership
by who owns the staging), and that pass may then read a guess and become
lane work (membership by what it read) — `frameRead` saw
`t === flushTransaction` and served T's staging. Rule: **what the pass
read wins** — lane work is never the transaction's pass, whichever flush
runs it. The A31 arm (lane work reading a parent _flight_ → committed) is
the same rule's pending-node half and stays.

**Tests.** Lane contract 4 rewritten: "a lane pass reading the parent's
held write derives from the committed value; the landing re-derives it"
(`view:5/a`, then `view:0/b`) and the async → optimistic → async pin
above. `transitionEntanglement` ×2 revived unchanged (`99:a → 2:b`,
`2:a → 2:b`). **Suite:** 0 regressions vs the floor; vs §18.1's run
exactly those two `failed → passed`. **Size:** 7181 → **7132 B br** (−49;
−146 min); `read` 1078 → 1046 bytecode — the first hot-path shrink since
lanes.

**For the spec** (not written here; this worktree's spec predates #3740):
the rule text above; the membership sentence ("what the pass read wins");
and the retirement of "read-through" from the lane corollaries.

## 20. Verdicts — `isPending` and `latest` (2026-10-01)

### 20.1 The rulings

Maintainer: "Traditionally I treated them as optimistic state. Ie. they
make a prediction isPending → true or latest → pendingValue (if it exists),
and then everything downstream of them is optimistic, breaks out of the
transition." Confirmed, and made literal by the lane model: **a verdict is
a guess the system supplies** — "pending, until this lands"; "the proposal
is the value" — decided at the seam like a user's, and its readers break
out of the hold the same way: work of a lane under the holder (the
transaction's _verdict lane_), shown now, re-derived at the landing, ending
with it. Simpler than a user's lane: no write, no correction (the landing
flips `isPending`, confirms `latest`), nothing of its own to stage.

Three questions put, three answers:

1. _A pass that reads `isPending(x)` and `x()`._ Checked against `next`
   first (maintainer: "I think we might have done something interesting
   in the isPending(x) x() case") — A10, `[isPending(x), x()]` atomic
   within one scope (#2831, with #3028's refinement: the pairing covers a
   landed answer awaiting reveal; while the transaction's async still
   computes, the fresh value is an input and pending stays true for every
   reader). On this model A10 holds by construction: **a verdict reader is
   a frame reader** (`CONFIG_VERDICT`). Its plain reads of held nodes take
   the stale path a render effect's do — committed value, re-derived at
   the landing — and it never joins; so it never sees the fresh value and
   never pairs it with pending. In either order within the pass. The
   earlier framing ("the pass that also reads x is the transaction's") was
   dropped: it was unobservable only if the stale staging it produced
   never showed, and it did (through dependents staged from it inside T).
2. _A34 (2)._ "Did I make one decision then revert it?" No: (1) and (2)
   are two halves of the one 2026-09-16 sentence — "a write to the same
   signal already set to that value would entangle I think. **Unless it's
   committed**, both are suggesting a value." (1) was built (the join
   before the equality gate); (2) was not: the park loop held every staged
   node. Built now: a staging equal to the committed value is dropped at
   the park — not held, not stamped, pends nothing (`setShow(false);
setShow(true)` beside a held `count`); a node already held stays held
   when written back (A34 (1), the "stays the transaction's" pin).
3. _A verdict reader's own async._ "Yeah definitely it is held. Consistent
   with any optimistic update." Built as lane rule 3 reads for a guess:
   the transaction's verdict readers are **one optimistic frame**, as a
   guess and its derivations are; one of them in flight holds the frame's
   reveal, and the parent's own flight is not waited on. (A per-reader
   split was tried and reverted: `createMemo` A8's pin — `latest($id)` in
   an input beside `fetch(latest($id))` — holds the input until the fetch
   lands, as `next` does.)

Also ruled on the way: `latest` is the explicit opt-in to see through
(maintainer: "latest whole point is to see through"), the same inside a
lane as outside — above the async the pending value, below it committed;
and **inside a `latest` window, `isPending` asks whether the latest view is
final** (#3104: `latest(() => isPending(a))` is false for a held write —
the latest view _is_ the proposal — and true for a computing memo). That
is A10's letter with no per-scope bookkeeping.

### 20.2 What was built

`verdict.ts` (new; `isPending`, `latest` restored to the public surface
with `next`'s signatures, `isPending(fn)` / `latest(fn)`), installed as
`GlobalQueue._verdict` and dispatched from `read` only while a window is
open (`verdictMode`) — nothing of it reaches a program that never imports
them. One cold read path, `verdictValue`, that links and pulls like
`read` (`pullComputed`, extracted) and then answers for what the reader
sees: a guess (verdict lands with the parent; blocked → `latest` serves the
guess, not final where it differs from the base; revealed → the value on
its own slot, not final only while its own new question flies, A24); lane
work's staging (`laneRead`); a held node (`verdictRead` routes the pass to
the holder's verdict lane and registers the landing re-run for probes;
`latest` → `heldLatest`, `isPending` → `heldNotFinal`); a node staged this
flush and not yet held (`provisionalVerdict`: the flush already has a
transaction → it will be held; nothing joined → watch the seam) — or with
a newer question in flight (#3376, the stale first hop of a chain) its
flight's; a flight (`pendingVerdict`: `isPending` records it unless quiet,
`latest` serves committed; uninitialized throws NotReady — loading, A19
exc. 1, propagating from inside an owner (B5a, #2928) and swallowed
outside one; any other error inside a probe is simply "not pending").

In the core:

- `CONFIG_VERDICT` on a pass that entered a window: `frameRead` treats it
  as a frame reader; `recompute`'s stamped-node re-entry does not make it
  T's; a dependency going pending re-derives it instead of marking it
  (the verdict changed — the kept-tail precedent).
- `REACTIVE_STAGED_READ` on a pass served a node's ambient staging: if
  the flush parks, the pass is the frame's (same sync frame as the async)
  — `recompute`'s tail queues it with the frame instead of its lane, a
  verdict cannot break it out, and a verdict reader among them watches
  the seam (voided staging, re-derived against the held world it then
  sees committed). This closes the lane-work mirror case of §19 too.
- `REACTIVE_REASK` (a `refresh()` request) → `_x._reask` (the next pass's
  classification: quiet iff it went pending on the request); dies with
  the landed value's commit (#3178); `quietPending` for a node pending
  through others. A19 exc. 2 / A24, minus `affects()` (still carved).
- A28 for held nodes: a rewrite outside a flush keeps the staging the
  last flush left (`_x._flushed`, `stashFlushed`, cleared at the next
  flush start); `latest` serves it and a tracked reader is a late linker.
- A34 (2): the park-loop drop above.
- `Transaction._verdict`; `verdictLane`; `verdictWatchers` drained at the
  park with their provisional stagings voided; `dissolveLane` ends a
  lane's verdict lane; `reruns` drops the stale staging of a member it
  re-derives (a verdict reader that also derived from the future).

### 20.3 Tests

New: `verdict-contract.test.ts` (4: the spinner leaves in the frame that
lands; `latest`/plain/`isPending` in one hole — `latest=b plain=a
pending=true`, A10; the verdict frame held on its own async, not the
parent's; `latest` of a blocked guess). Revived from carved, all passing
as written: the pure verdict pins (`latest-repeated-writes`,
`latest-plain-write-purity`, `latest-probe-order-independence`,
`latest-created-inside-window`, `latest-async`,
`latest-lazy-companion-backfill`, `latest-pending-probe-mid-flight`,
`ispending-memo-unstamped-hold-3457`), `latest-held-till-flush` (A28 ×4),
`latest-isPending-consistency` (#3028 ×5, A10), `write-proposals-3494`
(A34 (2) ×2), `held-derivation-3612` "the report" (`latest(b)` = 200
throughout), the visibility oracle's `latest`/`isPending` cells (37), the
`createMemo` A8 block, `question-scoped-pending` #3178, `refresh-await`,
`async-chain-supersession` #3376, `strict-read-pending-store` #2928 and
~60 more. Three pins adjusted, each noted in place: #3519's writable-memo
frame drops a run `next` itself called redundant; `pending-gated-landing-
replay` loses a one-frame `idle:v0` between `pending` and `idle:v1`;
`latest-isPending-consistency`'s control (a plain read of the pending
`double()` throws as anywhere — the combining shape is `latest(double)`).

**Suite:** 0 regressions vs the floor at every step; fixed-vs-floor 241
(was 73 before verdicts); 161 formerly carved tests pass. The remaining
newly runnable failures are `spec-async-semantics`' in-file halt (each
verified passing alone), a carved boundary, and attribution tooling.

**Size:** core floor 7132 → **7378 B br** (+246; +807 min: core +444,
scheduler +363 — the rules that must live there: A34 (2), A28, the quiet
classification, frame-reader semantics, the staged-read mark, the verdict
lane plumbing). `+ isPending/latest` **7887 B br**: the two verdicts cost
509 B over the floor against 2,650 on `next` (its 12.16 KB line), and the
scenario sits 4.27 KB under it. Hot paths: `read` 1046 → 990 (the pull
extracted), `setSignal` 324 → 359 (the stash branch), `recompute` 2408 →
2566 (classification, the tail's frame check, the re-entry exclusion).
Not benchmarked. A consolidation pass, as after lanes, is the next size
step; the `recompute` growth is its first target.

**Open:** `affects()`; `isPending`'s interaction with actions (#3457's
open-action pairing — the one place `next`'s per-scope machinery does real
work; carved here) and boundaries; perf.

### 20.4 Consolidation (2026-10-01)

Three cuts, each a no-op on the suite (0 diffs at every step):

- The window flag and the hook were one thing: `read` now tests a single
  module variable (`verdict`, the cold path or null), which verdict.ts sets
  while a window is open — no `verdictMode`, no `GlobalQueue._verdict`,
  and verdict.ts has no module-evaluation side effect left.
- Dead under the frame-reader model: `joinPass`'s verdict-lane
  withdrawal and `isVerdictLane` (a verdict reader never reaches
  `joinPass`); `reruns`' stale-staging drop (a verdict reader is never a
  transaction member with a staging — removing it changed nothing). The
  `recompute` tail folds the staged-read case into the queue condition.
- A28's stash list is a clock stamp (`_flushedAt`): the carrying flush
  advances the clock, so nothing is reset at flush start; the stash goes
  with the landed commit.

Minor expression compressions in `frameRead` and the park loop. **Size:**
7378 → **7370 B br** (−8; −231 min) — brotli is sticky here, the remaining
bytes being the rules' structure; `recompute` 2566 → 2547. The quiet
classification could leave `recompute` for the status path (~25 bytecode)
but needs `clearStatus` to tell a landing from a sync settle — not worth
the risk now.

## 21. Pins vs rules — the evening's rulings (2026-10-01)

After verdicts, the family (verdicts, lanes, optimistic, the oracle) had
283 passing and 17 non-carved failures. Taken to the maintainer as "pins
possibly wrong"; the rulings, and what they changed.

**A blocked lane blocks its parent** (ruling 1 — the maintainer's
`createOptimistic` pin "pending source does not leak" against lane
contract 3's first form). Chain `source → firstAsync → optimistic →
secondAsync → effect`; the guess is confirmed while `secondAsync` (lane
work derived from it) still flies. The parent must not land: it would
commit `source=2` beside an effect still showing the `source=1`
derivation — A15 entanglement through the lane. `blocked()` recurses into
child lanes (the pending-guess check kept); `endLanes`' "a blocked lane
outlives its parent" branch became unreachable and went (core floor 7370
→ 7343). Found on the way: a _confirm_ while the lane is blocked demoted
the guess to a plain held node, so direct reads regressed to the base
until the landing — a confirmed guess now stays displayed-ahead for direct
reads, as the guess was (`supersede`). Lane-contract 3's pin rewritten;
and lane work in flight reads `isPending` true (`verdictValue`'s lane-work
branch — the orphaned-lane path that used to answer it is gone). Applies
to verdict lanes too: `fetch(latest(q))` in flight holds `q`'s
transaction — the same reasoning, flagged as a consequence.

**A corrected guess shows at the landing** (ruling 5, confirmed): the truth
is held, the base would be a flash back; the display keeps the guess.

**The 13 no-parent pins** (ruling 4) rewritten to lane contract 2 ("an
optimistic write in a frame that does not park is as if it never
happened"), shapes kept, a note on each. The two `categoryDetails` pins
("action pattern with mismatch", "rapid user actions") left for the
actions step: action-shaped, and the maintainer's concern — "spent a long
time removing random pending flicker of long parent hold with late
refresh" — is checked there. (Here `refresh` is a quiet re-ask, so
`isPending` cannot pulse on it; the no-parent rule governs the guess's
display.)

**Two frame sequences `next` emitted and this model does not** (ruling 3:
"feels like our new behavior is better but check they satisfy the original
reported issues"). `pending-gated-landing-replay` (#3041 follow-up): the
reported bug was `idle:v0` sticking after the landing — one value behind;
`next`'s fix replays the effect, hence its extra `idle:v0` frame between
`pending` and `idle:v1`; here the verdict and the value land in one frame
and the wrong frame never exists. `#3519` writable memo: the rule is that
the hide at 2500 publishes mainline — it does; the extra `Show: false` run
at 4000 is the contested-effect artifact the test disclaims. Both
originals satisfied; both pins keep the shorter sequences.

**A verdict reader's plain read of a flight** (ruling 2 — "our behavior is
what I expected, but B's behavior is more desirable. Wasn't sure it was
safely possible"). The compiled form `<div class={isPending(data) ?
"dim" : ""}>{data()}</div>` is two effects: dim now, old data kept. One
memo doing both threw on `data()` and was inert. Checked against the A10
pin `[isPending(asyncMemo), asyncMemo()]` → `[true, 10]` mid-flight — which
already passed, through the A31 arm (the probe had routed the pass into
the verdict lane, so the later plain read was "lane work reading a
flight": committed). In the other order the plain read came first and
threw: order-dependent. Built as one rule: **a frame reader sees the
screen, and for a flight the screen is the committed value** — a render
effect keeps its DOM by throwing, a memo has no DOM and is handed the
value (`read`'s A31 arm, `passLane !== null || CONFIG_VERDICT`).

Two things made it safe rather than merely possible:

- _The posture lasts as long as the probing does._ `CONFIG_VERDICT` was
  sticky; a memo like `mode() === "a" ? isPending(x) : x()` would have
  kept reading flights committed in mode `"b"`, its readers believing
  stale data final. `REACTIVE_PROBED` is set when a pass enters a window;
  a pass that did not clears `CONFIG_VERDICT` at its tail — one pass of
  memory, so the first probing pass is order-sensitive and every later
  one consistent, and a memo that stops probing suspends again after one
  pass. The maintainer's reading — "memos here would entangle so I guess
  that's why it is safe" — is the opposite: a probing memo does _not_
  entangle; what makes that safe is that the probe is an explicit opt-in
  to the frame-reader posture, bounded by the probing.
- _A committed read of a flight still observes it._ Before, the throw made
  the reader a pending effect, and that `notify` opened the transaction;
  served committed, nothing did, and the chain tore (A8's chained pin:
  `asyncA`'s landing committed ambiently while `asyncB` flew). A15's
  stale reader "derives from the flight all the same": `observeFlight`
  opens the hold if none has, routes the reader into its verdict lane and
  registers the landing re-run (`REACTIVE_FRAME_READ`) — and `blockedBy`
  counts a verdict reader as a frame reader only when it carries that
  mark (it read the value; a probe alone holds nothing). The watcher drain
  skips a reader a later read of the same pass already routed.

The control pin back to its original (`true` mid-flight); a new
verdict-contract pin for the plain-first order and the one-pass posture.
**Suite:** 0 regressions vs the floor; fixed-vs-floor 244. **Size:** 7343
→ **7400 B br** (+57): `observeFlight`, the A31 split (`read` 976 → 1006),
the posture reset (`recompute` 2547 → 2587), the `FRAME_READ` gate.

## 22. Lanes as a module — ambient growth returned (2026-10-01)

Maintainer: hello world with a signal "has no boundary, actions or stores
so it is ambient growth that would hurt us only — it doesn't have verdicts
either or the need for lanes but still takes the hit." Quantified on the
simple-app floor: of 9,903 B br, ~2.2 KB was machinery that app cannot
reach — the hold model (+497, the async-first core; stays), lanes
(+1,419), verdicts' core side (~+300). `createOptimistic` itself was
shaken; its engine was not, because `read`, `recompute` and `settle`
called it directly behind bits (`OVERRIDE | LANE_HELD | GUESS`,
`passLane`) that app never sets — dead at runtime, retained by the
bundler.

**Built:** `lanes.ts`, the pattern verdict.ts set — the engine installed on
`GlobalQueue` at module evaluation when something imports it
(`createOptimistic`; `verdict.ts` for its verdict lanes), core keeping the
bit tests and `passLane`. Moved: `optimisticWrite`/`pendingGuesses`/
`applyGuesses`, `laneRead`/`guessOf`, `laneStage`, `supersede`,
`dissolveLane`, `laneSeam`, `endLanes`, `lanesBlocked` (the lane half of
`blocked`), `verdictLane`, the `lanes` list (`newLane`), and the optimism
outcome of `recompute`'s tail (`laneOutcome`: a guess's truth supersedes;
a derivation that stopped reading the lane's world leaves it) and
`setSignal`'s GUESS branch (`guessWrite`). `verdict.ts` owns its watchers
(`verdictSeam`, installed) and `observeFlight`. Hooks: `_laneRead`,
`_laneStage`, `_laneOutcome`, `_guessWrite`, `_applyGuesses`,
`_laneSeams`, `_endLanes`, `_lanesBlocked`, `_verdictSeam`,
`_observeFlight`. Behavior-neutral: 0 regressions, 0 diffs vs the
previous run.

**Whole size suite, before → after (br):** core floor 7400 → **6777**
(−623); + createStore 7451 → 6821; **+ isPending/latest 7911 → 8077
(+166)**; simple-app floor 9903 → **9258** (−645); hydrating (no stores)
16624 → 15960; hydrating + every store family 17522 → 17636 (+114); CSR
11777 → 11154; CSR observe 13375 → 12734; CSR + attribution 27229 →
26572; page base 35213 → 34651; page live 37020 → 37207 (+187); frames and
server scenarios unchanged. The trade: scenarios that use verdicts or
optimism pay the hook plumbing (ten statics, the `!== null &&` call
sites) that used to be inline; everyone else stops paying ~620 for an
engine they never reach. Hot paths: `setSignal` 359 → **320** (frame 72 →
40 — the GUESS branch is one hook call), `recompute` 2587 → **2504**,
`read` 1006 → 1023 (+17, the `laneRead` hook).

Hello world with a signal: **9,258 B br, 742 under 10 KB** (was 97 under);
core floor 6,777 against `next`'s 9,508. Remaining in that app that it
cannot reach: the hold model (~500 — the price of an async-first core) and
`flatten.js` (550 min) via `render`. Boundaries get the same treatment
when built.

---

## 23. Boundaries as a module — `createLoadingBoundary` / `createErrorBoundary` (2026-10-02)

### 23.1 The rulings (maintainer, 2026-10-01, answering the four questions)

1. A33 confirmed: a fallback-caught flight holds nothing; an `on` reset
   moves the hold onto the boundary; a content-showing boundary forwards
   its readers' pending into the frame's hold. **Participation is reads in
   render effects, not ownership.** Optimistic lanes shield triggering:
   lanes are part of this only when held by further downstream async.
2. **An error is a loading boundary going back to its fallback.** The
   nodes behind it stop contributing to the hold unless read elsewhere
   (where they would error too); other, non-errored nodes that lose their
   only visible consumer that way stop contributing as well — "not just do
   the tear but more nuanced".
3. The error fallback counts as the display: readers behind it hold
   nothing.
4. Fallback only on the uninitialized first load and an `on` reset. A6
   stays warn-only ("rendering holds, so it's valid enough in CSR; SSR
   holds flushing so it is actually a by-design pattern").

### 23.2 What was built

`src/boundaries.ts` (restored path; ≈2,350 B min, in the bundle only when
something imports a boundary), the `lanes.ts` / `verdict.ts` pattern:
installed on `GlobalQueue` at module evaluation. Core carries three null
checks and one config bit.

**Membership** is the owner's context: the boundary owner gets
`_context[BOUNDARY] = b` (a symbol key; children inherit `_context` by
reference), so any node finds its nearest boundary in O(1) and the
enclosing ones through `b._parent`. No per-owner slot, no tree in core
(B3's ownership question answered by what owners already carry). The `on`
computed is created before the key is set — it lives outside the boundary,
as the condition of a `<Show>` around it would.

**Three computeds per boundary:** `c` (the body, run once), `tree`
(`flatten(read(c))`), `output` (fallback or content; `CONFIG_BOUNDARY`).
The output is the display and the decision point. Status reaching it from
the tree **re-derives** it instead of marking it (the propagation walk's
`CONFIG_BOUNDARY` term, the same arm as `CONFIG_VERDICT`, now for errors
too); its pass reads the tree's status without reading the tree — an
errored memo's reactive re-read retries it (`read`), and neither a
fallback re-rendering nor passing an error by may re-run the content; a
pending tree read as lane work would serve its committed value (A31) and
hide the swap — links it (`link`, so its recovery re-derives the pass),
and: own status + collecting → caught, fallback; own status + showing
content (loading) → recorded for `on`, rethrown — the output goes pending
and the frame holds through the outer render effect as for any reader;
other status → rethrown (a pending passes an Errored by, A6; an error
passes a Loading).

**Status protocol (B5).** `GlobalQueue.notify` asks `_catch(node, flags,
error)` first. For a frame reader's pending/error the module walks the
chain: a Loading on the way records a pending reader (its `on` may collect
it later); the nearest boundary of that type that is _collecting_ — an
Errored always; a Loading until it has shown content, or while re-armed —
records it, writes the error signal (`reportClientError` once per error),
re-derives its output, and returns `true`: the root never hears of it, no
transaction opens. Nothing collecting → `false` → the root's `joinFuture`
as before. A clear (flags 0) deletes the reader from the chain and
re-derives a fallback that was waiting on it — in the same pure phase, so
the content lands with the transaction the reader's value is held in
(`prune(b, pass=true)` joins it) and not a round after the held runs.
**An error boundary records the error's SOURCE** (`StatusError.source`),
not the reader: the reader recovers the moment a refetch starts (its
Loading catches the pending), while the error is settled only when its
source is neither errored nor in flight (#2701's "stays error while
refetching"; `reset` re-runs the same node).

**The hold.** `blockedBy` asks `_hidden(r)` in both positions through one
helper `onScreen(r, t)` (which also carries the zombie exemption): a frame
reader with a boundary on its chain whose last pass chose the fallback
(`_fallback`) is off screen and holds nothing. That one predicate gives
A33 (readers behind a Loading fallback), the error ruling (readers behind
an Errored fallback, including non-errored ones that lost their visible
consumer — `blocked` re-evaluates visibility per reader), and the lane
rule (lane work caught by a fallback does not hold the lane:
`lanesBlocked` → `blockedBy` → `onScreen`).

**Render once (maintainer, 2026-10-02).** The content is created once and
kept behind the fallback — a Loading's and an Errored's alike: `c`/`tree`
are children of the boundary owner, not of the output, so the output's
re-run disposes only the previous fallback; the output never reads the
tree while waiting (no retry-on-read, no re-run of the body); the reveal
reads the cached tree and attaches it. Only reactive re-derivations run:
a body that itself threw NotReady (nothing to keep), `reset()` re-running
the errored source, effects inside the content re-deriving off a recovered
source. **The fallback is instantiated once per show too** — that is why
`error` is an accessor: a second reader caught while the fallback shows
does not redraw the output (`caught` skips `redraw` when `_fallback`), and
a reader's clear redraws only when it was the last one; a later error
reaches the fallback through `err()`. Pinned by "instantiates the fallback
once per show" in both boundary test files.

**Reveal.** `prune(b)`: readers that settled or died leave; a loading
reader that landed but is HELD (value staged in a transaction) stays until
the commit — the content reveals with its run — except the tree, which the
output reads and thereby enters the transaction itself. The seam hook
(`_boundarySeam`, end of `settle()`) prunes every collecting boundary,
resolves arms, and re-derives a fallback with no readers left (next round;
within the same `flush()`). Dead boundaries leave the sweep; a zombie's
state is kept for its revival.

**`on`.** A pass of the `on` computed after the mount arms the boundary
(`_armed`, collecting until the seam); if any recorded reader is pending
now it flips (`_initialized = false`, redraw) — the forwarded readers of
#3375/#3459 — and anything going pending later in the heap is caught.
Nothing pending → the arm resolves at the seam as a no-op. The `on` node
carries `CONFIG_BOUNDARY` too: a source of it going pending re-runs it
(the pass catches the NotReady — a notification, it does not suspend the
parent — and re-arms). A display-ahead read in `on` (`latest`, `isPending`):
the arming pass's lane is handed to the swap pass (`_armLane` → `_lane`,
consumed in `fallback()` by `setPassLane`), so the swap is that lane's —
shown now beside the held frame (#3540 §4, #3528). An `isPending` arm whose
frame has no transaction yet opens one (`joinFuture(null)`, it lands at the
same seam if nothing holds it) and uses its verdict lane
(`GlobalQueue._verdictLane`, installed by lanes.ts).

**A29's boundary exemption (#3540).** A boundary mounted over a held value
(its output's first pass; the tree born held) shows its fallback now and
does not read the tree — entering would make the output itself born held
and nothing would show until the commit. The seam re-derives it once; by
then the fallback is its committed value and the next pass reads the held
tree and enters: the outside sees the committed fallback until the
landing. A boundary WITH a committed value reads a held tree and enters
directly — §2's "comments land first": the content staged under T replaces
the fallback staging ahead of the commit, and no fallback is ever shown.

**DEV:** `NO_OWNER_BOUNDARY` kept; `LOADING_ON_OUTSIDE_HOLD` at the seam
of the re-arm that flipped a boundary (not a display-ahead arm): a source
its readers wait on also read by a visible frame reader outside it — a
render effect or another boundary's tree, directly or through one pending
memo — once, naming the source.

**User effects wait behind a fallback (maintainer, 2026-10-02: "effects
need to be held, at least user — many depend on reading the DOM, something
that can't happen off screen"; "render effects run synchronous on create,
user always scheduled").** `GlobalQueue._heldRun(node)` is asked by
`runEffect` for `EFFECT_USER` runs and by the tracked runner: a run due
under a boundary showing its fallback (`hiddenBy`) is recorded on that
boundary (`_runs`, a Set — `_modified` stays set) and re-queued by the
reveal pass (`release`, into this flush's user phase, after the content
attaches). A boundary above still on its fallback holds it again then.
Render effects are untouched: the synchronous first run builds the
subtree, attached or not, and updates keep the detached subtree current
so the reveal is one attach, not a burst (`next` held render updates too
— `CollectionQueue.run` returned early for every type while disabled; the
difference is a deliberate choice, see 23.5 for the one case it costs).
Pinned: "holds user effects behind the fallback until the reveal; render
effects run with the frame" (Loading) and "holds user effects behind the
error fallback until recovery" (Errored).

**Not built:** `createRevealOrder` (next, separate step; `RevealOrder`
type kept, stub kept); the observe-tier `boundaryFallback` attribution
hook (the attribution engine's fallback/hold records are Transition-based
and already out of sync with Transactions — 5 attribution tests).

### 23.3 Core changes alongside (each flagged)

- `CONFIG_BOUNDARY = 1 << 15`; the propagation walk re-runs
  `CONFIG_BOUNDARY | CONFIG_VERDICT` dependents for **either** status
  (before: CONFIG_VERDICT for pending only). A verdict reader's probe of a
  source that errors re-runs and answers (`isPending` false; `latest`
  throws the error through its own read) instead of inheriting the error —
  `next`'s probe links carried none; web `errored.spec` "no infinite loop
  when the source fails again after reset" (a `<Show when={isPending(data)}>`
  in an Errored fallback halted the system).
- `GlobalQueue.notify` → `_catch` first; `onScreen` in `blockedBy`;
  `_boundarySeam` at the end of `settle()`; `_verdictLane` static.
- **Effect-run order at the seam** (`settle()`): lane reveals, then this
  flush's own runs, then the runs the landings held from earlier flushes
  (`releaseQueues` appends — `next`'s `restoreQueues` order). Before: held
  runs were prepended, and this flush's runs were stashed into `t` before
  the landing loop — a `t` landing at the same seam ran its old runs first.
  Pinned by #3540's log order (shell before the held swap) and #3528
  (display-ahead swap before the count). §21's note 3 ("no test observes
  it") no longer holds. One pin goes the other way: #3404 "children built
  under the hold are torn down on the next held re-run" now logs an extra
  `run 1.1/2` + `cleanup 1.1/2` (the frame's inner effect, re-run by c's
  landing, applies its run before the landing's re-derivation replaces it)
  — see 23.5.
- **Born held, creation-time form (L2):** a child is the transaction's when
  its own pass read the future OR its creator's pass did
  (`REACTIVE_JOINED`), no longer when the creator was merely running while
  the flush had a transaction (`RECOMPUTING_DEPS`). The old test made every
  child of a mainline mounting pass born held as soon as anything in the
  flush had joined — #3648 "shape A under a boundary": the boundary's
  output and its view effect were held by the content's own join, and
  nothing showed. Ruling A's words ("a held pass's children") read as the
  pass that joined. Born-held suites unchanged.
- `markRefresh`: `REACTIVE_REASK` only when the node is not already dirty
  (`next`'s guard, dropped in the consolidation): a `refresh()` in the tick
  of an input change is a new question, not a quiet re-ask
  ("publishes pending from persistent UI while a revealed branch loads the
  same source").
- **`mapArray` / `repeat`: `_parentComputed` wired per pass** (map.ts).
  `computed()` runs the first pass inside its constructor, so the
  post-construction `data._owner._parentComputed = node` came too late for
  it: a row callback's read of a pending async source had no reader to
  link (`c === null` → the uninitialized throw registers nothing), the map
  node sat pending with `_pendingSources` but no subscription, and was never
  retried. `next` had the same order; its boundary's commit-time source
  polling (`_sources` ← the node's `_pendingSources`, `_checkSources`)
  revived the output, which masked it. Now the top of each pass sets the
  owner's `_parentComputed` to the running node (`getOwner()`); the
  post-construction assignments are gone. `mapArray-notready-safety` case 3
  passes with and without a boundary.
- **`latest()` of a staged-but-unheld node settles the reader's membership
  at once** (verdict.ts `provisionalVerdict`): `joinFuture(null)` opens the
  frame's transaction and `verdictRead` routes the reader into its verdict
  lane — one pass. Nothing holds the frame at the seam: the transaction
  lands there and the lane dissolves into it (a plain commit); something
  does: the reader was lane work all along. Before, the reader ran a
  _provisional_ pass (frame work), the park voided it (`verdictSeam`) and
  re-ran it as lane work — everything downstream ran twice: a keyed
  `<Show when={latest(count)}>` mounted its child twice mid-flight (web
  `loading-on-keyed-boundary-3540` `[1,3,3]` vs `[1,2,2]`). **`isPending`
  keeps the watcher**: its answer _is_ the verdict (final unless the flush
  parks) and cannot be given before the seam — eager routing made a plain
  sync write glitch the wrapper true and made the probing `on` node a
  FRAME_READ blocker of T (#3528 fn-isPending). Companion rule in `read`
  (`stagedScreen`): a verdict reader's plain read of a staged node, once the
  frame has a transaction, sees the screen and re-derives when it lands
  (`_reruns`; the stale run is void, #3322 — a transaction landing at the
  same seam yields one run) — `[latest(q), q()]` is `[b, a]` (A10) without
  the re-run; a node born into the future keeps serving its staging (A29).
  Also fixes web `show.spec` variant B (`a()` before `isPending(a)` in a
  `Show` `when`).
- **`removalStagedBy(r, t)` accepts a removal staged by a transaction `t`
  ends with** (a lane's parent chain): a verdict-lane memo in flight whose
  only reader is a zombie the _parent_ unmounts no longer blocks the lane —
  and so the parent (`lane-outside-view` #3463 "a plain removal with nothing
  else holding still releases at once").

### 23.4 Tests

Full signals suite 4760: **passed 1364** (lanesmod 1113), carved 3328,
failed 66 (58 of them pre-existing: attribution/holds/navigation,
rules-index, treeshake, dist-artifacts, `resolveAsync`, scheduler-livelock,
`#3374` ×3, categoryDetails ×2…). Matrix vs lanesmod: **passed→not passed
0**; vs the s4 floor: passed→not passed 0. New pins this step: fallback
instantiated once per show (×2), user effects held behind the fallback
(×2), the keyed-Show remount count in the #3540 matrix. Web client suite
(built dist): **878 passed**, 186 carved, 9 failed (loading.spec #2700/#2701
— see 23.5; performance-tracks ×3 and the rest are attribution, server
functions and stores); solid: 670 passed, 139 carved, 10 failed
(client-hydration ×4 are createProjection, the rest are declaration-file
checks against a stale `types` build).

### 23.5 Open — pins vs this build

- **#3528 `on=memo-isPending`** ×2: `on` reads a MEMO of `isPending(m2)`.
  The memo is the verdict reader; with no transaction at its pass it is a
  watcher (frame work), so the `on` pass that reads it has no lane and the
  swap follows the frame (`['count=1','A=Loading',…]`; two boundaries: no
  fallback ahead). `fn-isPending` (the `on` pass itself probes) works
  through the verdict-lane arm. Pinned order is `next`'s "isPending's
  companion is always optimistic". Needs a ruling: is a memo over
  `isPending` display-ahead for its readers when nothing holds the frame?
- **#3404** (above): a frame child's own run vs the landing's commit —
  order question, same seam rule that fixed #3540/#3528.
- **web `loading.spec` #2700/#2701** (`Errored > Loading > async` that
  errored, then an input write refetches): `next` held the input write
  (`0Fetch error for 0`, `isPending(count)` true) because the error had made
  the Loading _initialized_ (its `_checkSources` cleared the swap on the
  error and the output read the stale tree), so the refetch's pending was
  forwarded. Under ruling 2/3 the Loading never showed content: it catches
  the refetch, nothing on screen derives from the flight, the write
  publishes beside the old error (`1Fetch error for 0`, then `1Fetch error
for 1`). Needs a ruling; the pins encode the accident.
- **Render updates behind a fallback run; `next` held them.** Chosen for
  the reveal frame (no burst) and the hot path (no `hidden()` walk on
  render runs). The one case that costs: `Portal` mounts through a
  `schedule: true` render effect (its first run queued, never synchronous
  — to stay out of the hydration walk) whose effect-half appends to the
  mount node. Under `next` that queued run waited in the disabled
  boundary's queue, so a Portal inside a Loading's content reached
  `document.body` at the reveal; here it mounts at once, beside the
  fallback, and its inserts keep updating the live body while hidden. The
  same applies to any head-tag library writing `document.head` from a
  render effect. Flipping to `next`'s rule is one gate (`runEffect`'s
  `type === EFFECT_USER`) plus `release` enqueuing by `_type`; it would
  also align with a future Activity/Offscreen boundary, which wants both
  held. Maintainer, 2026-10-02: fine with the current choice; Portal noted.
  Also noted: whether `heldRun` catches render runs can be a per-boundary
  flag, so Offscreen can differ from Loading/Errored without a global rule.
- **`reset()` re-runs against the committed frame (A28).** A `reset()`
  called synchronously after the write that fixes the input retries with
  the old input (the recompute is outside a flush — `unflushedValue`
  serves the committed value), fails again (caught; same error, the
  fallback is not rebuilt), and the flush that follows re-runs it with the
  write applied. Same as `next`'s `_retry`. Scheduling the retry instead
  of recomputing inline would spare the doomed pass; not changed.
- `createRevealOrder` ×38 and everything action/store-shaped stay carved.

### 23.6 Whole size suite, before (lanesmod) → after (br / min)

| scenario                                    | before br | after br  | Δ br  | Δ min |
| ------------------------------------------- | --------- | --------- | ----- | ----- |
| signals: core floor                         | 6777      | **6956**  | +179  | +711  |
| signals: + createStore                      | 6821      | 7003      | +182  | +711  |
| signals: + isPending/latest                 | 8077      | 8273      | +196  | +735  |
| app: render + one signal                    | 9258      | **9444**  | +186  | +711  |
| app: hydrating (no stores)                  | 15960     | 17094     | +1134 | +3637 |
| app: hydrating + every store family         | 17636     | 18798     | +1162 | +3736 |
| app: CSR with Show/For/Loading/Errored/lazy | 11154     | **12271** | +1117 | +3611 |
| app: CSR, observe tier                      | 12734     | 13831     | +1097 | +3575 |
| app: CSR, observe + attribution             | 26572     | 27718     | +1146 | +3664 |
| page: base SC                               | 34651     | 35770     | +1119 | +3727 |
| page: live SC                               | 37207     | 38367     | +1160 | +3755 |
| frames / server floor / renderToString      | =         | =         | 0     | 0     |

Floor residue +179 br, in two parts. The boundary seams (+132 at the first
measure): scheduler.js — four hook statics, the `notify` hook, `onScreen`,
the seam call, the three-way run ordering; core.js the `CONFIG_BOUNDARY`
walk term; effect.js the `_heldRun` gate. The fixes made alongside (+47):
`stagedScreen` and its two call sites in `read` (+29 bytecode on `read`,
off the hot path — reached only for a staged node), the ancestor walk in
`removalStagedBy`, map.ts's per-pass wiring (−2 lines there, net 0). CSR
pays the module (≈2.4 KB min), `error-hooks.js` back (457,
`reportClientError`), solid's `Loading`/`Errored` bodies no longer folding
around stubs, minus `carved.js`'s stubs. Against `next`: floor 6,956 vs
9,508; simple app 9,444 (556 under 10 KB) vs 11,970; CSR 12,271 vs 14,901
(cap 14.94 KB). Hot paths: `read` 1023 → 1052/88 (the staged-read arm),
`setSignal` 320/40, `recompute` 2504/384 unchanged.

---

## 24. `createRevealOrder` as a module (2026-10-02)

The last carved boundary piece. `src/reveal.ts` installs a three-method
hook object into boundaries.ts (`setRevealHooks`: `_register`,
`_unregister`, `_changed`) at module evaluation — present exactly when
something imports `createRevealOrder`; a Loading boundary without one pays
a null check. Not in the CSR bundle (no `<Reveal>` there).

**Model.** A controller owns each direct Loading slot (and each nested
controller) until it is _done_ — a boundary when it has shown content, a
nested group when it is ready — and forces on the slots it owns the state
the order dictates: `_gated` (the fallback, whatever the content's state)
and, in a collapsed sequential tail, `_collapsed` (nothing). The boundary's
output pass checks the gate first: gated → link the tree (so its settling
re-derives the pass), tell the controller the pass ran, and — if still
gated — return the fallback or `undefined`; the controller may release this
very slot in that call (it is the frontier whose content just settled) and
the pass goes on to show it (the redraw it asks for is refused mid-pass
and not needed). Readiness of a slot (`ready(b)`, boundaries.ts): shown
content, or nothing unready under it — tree neither pending nor born held,
no reader waited on. The boundary tells its controller when that changed:
`caught`, a reader settling (clear path and seam), the pass showing content
(graduation), disposal (`_unregister` from the owner's cleanup). A boundary
clears the `REVEAL` context key for its content, so only direct children
are slots. `order`/`collapsed` are tracked by a computed of the group's own.

**Two rules the old implementation left to its evaluation order,** made
explicit because this one re-evaluates whenever a gated pass runs:

- _A nested group released at the frontier stays the parent's frontier
  until it is ready._ The old code dropped `_parentController` on release;
  nothing re-evaluated the parent afterwards, so the slot behind the nested
  group stayed collapsed by accident. Re-evaluated, that slot became the
  first owned one and was ungated (`supports direct nested reveal as a
composite slot`). Now a nested controller graduates when `_ready`, as a
  boundary does when shown.
- _Readiness is judged over every slot, done ones as ready_ ("shown is
  shown"). The old `_isMinReady` looked at the first _owned_ slot; after
  that slot graduated the next, unready one made a sequential group
  "not minimally ready" again and an enclosing `together` re-gated
  everything it had released (`three-level minimal readiness`). Gating
  loops still walk owned slots only, so a re-arm of a graduated slot gates
  nobody (`nested on-reset does not re-gate revealed outer siblings`).

**One pin re-pinned (flagged):** `handles three-level nested reveal
progression`, first frame. Outer sequential+collapsed over
`[la, together(collapsed:false)[lb, sequential[lc, ld]]]` was pinned
`["la", ["lb", [undefined, undefined]]]` — `lb`'s fallback visible inside
the outer's collapsed tail while its sibling group's leaves were
collapsed. The old `_evaluate(disabled, collapsed)` forced the same state
on both kinds of slot; `lb` could only have stayed visible because the
`_collapsed` signal write was not seen by its first pass. Under "a
collapsed tail renders nothing" the frame is
`["la", [undefined, [undefined, undefined]]]`; the second frame (middle
released, holding `lb`/`lc`/`ld` on visible fallbacks) is as pinned.

**Tests.** `createRevealOrder` ×29 + `loading-on-rearm-reveal-3540` ×7 +
2 reveal cases elsewhere: carved→passed 38, carved→failed 0. Full suite
4760: **passed 1402**, carved 3290, failed 66 (unchanged set), 0
passed→not-passed vs the boundaries run and vs s4. Web 878 / solid 678
(+8: the `Reveal`-wrapped hydration cases), same failure sets as before.

**Size, boundaries → reveal (br / min):** floor 6956 → 6961 (+5 / +62,
mangler drift across untouched modules); simple app 9444 → 9450; CSR
12271 → **12369** (+98 / +355: `boundaries.js` 2640 → 2911 — the three
fields, the gate, `ready()`, the `_changed` calls, the `REVEAL` key;
`reveal.js` itself is not in the bundle); hydrating 17094 → 17192; pages
+109..+172 (`reveal.js` present where `<Reveal>` is used); frames/server 0. Against `next`: CSR 12,369 vs 14,901. Hot paths unchanged (`read`
1052/88, `setSignal` 320/40, `recompute` 2504/384).

**The boundary family is complete.** Public surface restored:
`createLoadingBoundary`, `createErrorBoundary`, `createRevealOrder`,
`RevealOrder` (type); `carved.ts` keeps stores, `action`, `affects`.

---

## 25. Scheduler consolidation pass (2026-10-02)

Deferred until the boundary family was complete, so the pass saw everything
`settle()` now carries. Behavior-neutral by construction — the full suite's
outcome is identical test for test (1402 / 3290 / 66, vs the reveal run) —
except one latent bug fixed on the way, flagged below.

- **`flush()` unified.** The `!__DEV__` fast drain (commit-only ticks:
  empty heap, empty queues) duplicated the full path's prologue and
  epilogue. What it skipped was `runHeap` over an empty heap (one bucket
  visit) and two `run()` calls on empty queues — nanoseconds. One path now;
  `passLane = null` and the dev quiescence check apply to every flush.
- **Hook statics as presence, not `null`.** The twenty `GlobalQueue`
  statics are `| undefined` with no initializer (a class field, no store),
  and the call sites test presence (`?.()`, `&&`) instead of `!== null`.
  Hooks are functions or absent, so the tests are equivalent; `external.ts`
  assigns `undefined` on reset.
- **One `_verdictSeam` call** after the park/commit branches, with the
  verdict (`t !== null`), instead of one per branch: the seam's `parked:
false` arm only drained the watcher list, so the order relative to
  `commitPendingNodes` is immaterial.
- **`append(a, b)`** for the six array-copy loops (`joinFuture` ×4,
  `releaseQueues` ×2) — `push(...b)` without the argument-count limit.
- **`txOf` via `resolveTx`**, and `joinFuture`'s two inline `_into` walks
  through it.
- **Fixed (flagged): `blockedBy` returned early on an off-screen render
  effect.** For a listed pending render effect it `return`ed the
  `onScreen` result — `false` for a zombie whose removal `t` stages, or a
  reader behind a fallback — ending the scan and releasing `t` even when a
  later node in `t._nodes` was a live blocker. It now skips that node and
  goes on. Pre-existing (from the zombie exemption's `return !(ZOMBIE &&
removalStagedBy)`); no pin caught it because the lists in the pins have
  the blocker first.

Not done, with reasons: the three-way effect-run ordering in `settle()`
(lanes, own, held) keeps its two scratch arrays — folding `own` in after
the landings would need a mid-array insert, which is not shorter; the
`joinFuture` merge stays array-concatenating (a union-find without
concatenation moves the cost to `blocked`'s scan of merged members);
`haltReactivity`'s console shape is pinned (`errorHalt`).

**Whole size suite, reveal → sched (br / min):** floor 6961 → **6867**
(−94 / −587; `scheduler.js` 4757 → 4288 min, core.js −47, effect.js −9);

- createStore 7012 → 6909; + isPending/latest 8282 → 8161; simple app 9450
  → **9349** (651 under 10 KB); hydrating 17192 → 17097; hydrating + stores
  18925 → 18825; CSR 12369 → **12277**; CSR observe 13921 → 13799; CSR +
  attribution 27820 → 27689; pages 35942 → 35826, 38476 → 38389; frames /
  server 0. Hot paths unchanged (`read` 1052/88, `setSignal` 320/40,
  `recompute` 2504/384). Web 878 / 9 / 186 unchanged.

Standing after steps 1–5 + this pass, against `next` 309b08730: floor
**6,867 vs 9,508** (−27.8 %), simple app **9,349 vs 11,970**, CSR **12,277
vs 14,901** (cap 14.94 KB), hydrating + every store family 18,825 vs 30,789
(stores still carved). Remaining carved: stores, `action`, `affects`.

---

## 26. Actions (2026-10-02)

`action` is back: `src/core/action.ts`, ~130 lines, on the hold model.

### 26.1 Model

An action is a transaction held open: `newTransaction(false)` with
`_open = 1`; `blocked(t)` is true while `_open !== 0`, and `merge` sums the
counts (two actions in one tick, or one called from another's body, share
a transaction and settle when the last returns — "should only complete
transition when ALL actions finish"). A slice of the body runs in the
transaction by `joinFuture(t)` before it: the flush that carries the
slice's writes parks into it (merging whatever the tick already joined —
O1, "an action that opens in a tick owns it"). A resumed slice
(`inTransaction`) drains at once; a nested action resuming synchronously
inside the outer body does not (`actionDepth`). `done` decrements `_open`
and schedules; the step's drain lands the transaction if nothing else holds
it. `flush()` inside a body is refused (dev throws `FLUSH_IN_ACTION`, prod
skips the drain) — the body's writes commit when it settles. The dev
`ACTION_CALLED_IN_OWNED_SCOPE` guard is kept. No per-transition action
list, no origin/provenance stamping (see 26.4).

### 26.2 What came with it

- **`until` / `resolve` settle from the pass, not an effect run.** `next`
  gave their root a `MicrotaskQueue` (#2930) so the run could fire while
  the action that `yield`s on the promise held the flush's queues; the
  per-owner queue went with B3. `watch(fn, onValue, onError)` is a
  `computed` whose body runs the expression and settles on a microtask —
  the heap runs a pass parked or not — marked `CONFIG_REDERIVE` so an error
  on the source re-runs it (it reads the error and rejects) instead of
  marking it. `CONFIG_BOUNDARY` is renamed `CONFIG_REDERIVE`: "a
  dependency's status is a question for this node's pass" — the boundary
  output, the `on` node, and now `watch`.
- **Authoritative reads (`until`).** `CONFIG_AUTHORITATIVE` (new bit): a
  read of displayed optimism serves the base the guess covers and makes the
  pass no lane's; `supersede` wakes such readers when the truth _confirms_
  the guess — the one case ordinary subscribers are deliberately not told
  (A17 silence). `next` had `CONFIG_AUTHORITATIVE_READ`; it went with
  transactions.
- **A guess over another frame's guess entangles the frames** (A34 (1) for
  guesses: two suggestions for one slot cannot finish apart) —
  `applyGuesses` merges the proposing transaction into the holder's;
  `settle()` re-resolves its transaction after `applyGuesses` so the park
  lists into the merged one. `merge(t, f)` is factored out of `joinFuture`.
- **A pass outside a flush joins its own transaction, not the tick's**
  (`passTx`, A29 creation-time form: "the entry is the pass's alone").
  A mainline mount's memo reading a held node used to set the tick's
  `flushTransaction`, so the next flush parked everything written in the
  tick into the action and a render effect mounted beside the memo stopped
  being a stale reader. Now: in a flush, or in a tick that has its
  transaction (an action's body), the frame joins; otherwise the pass's
  transaction is `passTx`, tick-scoped (cleared by the flush the join
  schedules — `recompute`'s frame is untouched). Two things this exposed:
  **born-held nodes keep `STATUS_UNINITIALIZED` until their commit** (the
  first pass cleared it; the "born into the future" arms in `read`,
  `frameRead`, `verdictValue` and `ready()` all assume it, and
  `commitPendingNode` already initializes at the commit — it only ever
  worked through the tick-transaction coincidence); and
  **`commitPendingNodes` skips `CONFIG_HELD` nodes** (a born-held node is
  also queued as pending; a flush with no transaction of its own committed
  it — unreachable before, for the same reason).
- **`latest()` in an action body entangles** (posture C, ruled
  2026-09-15): an untracked `latest` of another transaction's proposal
  inside a body joins the body's transaction to it.
- **`PRIMITIVE_IN_EFFECT_CALLBACK` is keyed on the effect callback**
  (`inEffectCallback`), not the shared `callbackDepth`: an action body is an
  imperative scope where `until`/`resolve` create roots deliberately, and
  the step suspends the effect-callback flag.

**Re-pinned (flagged):** posture B / O2 ("creation under a transaction
escapes — recorded, 'fine either way as long as consistent'"): a memo +
render effect created inside action U's body over a value action T holds
is born held into the merged transaction and reveals at the joint settle
(was: direct-committed the held value into the mainline frame). One rule
for creation during a hold, mainline or in a body.

### 26.3 Tests and size

Full suite 4760: **passed 2049** (+647 vs the scheduler pass: carved→passed
646, +1 new), carved 2536, failed 173 — 66 pre-existing and **107 in the
family below**; passed→not passed 0 vs the scheduler pass and vs s4.
`action.test.ts` 67/67; `flush-in-action`, `until`, `resolve`,
`root-dispose-pending-action-3561`, `born-held`, `posture-born-held`,
`l2-contract` all green. Web **886** (+8), 177 carved, 10 failed (one new:
`frames-optimistic-hold` "multi-flight: refresh inside the action" — the
family below).

Size, sched → actions (br / min): floor 6867 → **6917** (+50 / +168:
scheduler.js +172 — `_open`, `merge`, `passTx`/`joinPassTx`, `actionDepth`
and the `flush()` guard; core.js +9); simple app 9349 → **9411**;

- isPending/latest 8161 → 8307 (+146: `latest`'s body-entangle arm, the
  authoritative arm in `laneRead`, `supersede`'s wake); CSR 12277 → 12334;
  page live 38389 → **38682** (+293: `action.js` is used there); frames /
  server 0. `recompute` 2504 → 2545 (+41: the born-held
  `STATUS_UNINITIALIZED` store and the `passTx` term); `read`/`setSignal`
  unchanged.

### 26.4 Open — the optimistic-under-action family (107)

Every remaining failure is a pin written against `next`'s Transition model
for optimism inside actions; the lane model meets them here for the first
time. Sorted by rule, not by file:

- **Supersession provenance (A18, #3331)** — `createOptimistic` ×8
  (categoryDetails ×2, "second action while first still in flight", "rapid
  action: correction…", "shared async config…", "lanes stay separate",
  "isPending holds until merged lane completes", "should NOT
  double-flicker"), `spec-async-semantics` "provenance" ×2 and
  "same-batch source write and override". `next` stamped every flight with
  the action's sequence (`setOrigin`) so an _older_ action's late answer
  could not supersede a _newer_ action's guess ("a slow source does not
  leak back in over a newer intent"). Lanes have no provenance: `supersede`
  treats any landing on a guessed node as the truth. Needs: a question
  stamp on guesses and flights, and `laneOutcome` holding an older answer
  silently (stage as base, keep the override) — a rule to confirm first.
- **Held truth / stolen landing (#3164)** — `held-truth-lane-only` ×6,
  `until-entanglement` ×4 ("the transition that flips an awaited until()
  reveals with the action, not before"; "the stolen confirmation stays
  held"), `visibility-oracle` "held truth" / "stolen landing" rows,
  `refresh-await` "staged landing delivers, the override does not". A
  truth landing on a guessed node while the guessing action is still open
  is _held_ (staged under the action, the override kept on screen) and
  reveals with the action. `supersede` today stages it under the parent and
  notifies at once.
- **Lane holds under actions** — `lane-hold-on-observation` ×6 (an async
  memo created under the lane and observed holds it; merged lanes across
  transactions #3335), `lane-outside-view` ×6 (#3460/#3479 mounts
  mid-hold over lane-born memos), `optimistic-lane-release` ×2 (#3427
  body-end correction), `pending-companion-lane-parent`,
  `optimistic-read-lane-not-transaction-3698`, `lane-uninitialized-landing`
  shape B, `body-end-supersession-visibility`, `reveal-carve-out`,
  `superseded-before-first-commit`.
- **Verdict rows under actions** — `visibility-oracle` A18 (d)/A17/A32
  rows (×25 total with the above), `optimistic-settle-verdicts`,
  `isPending-memo-consistency`, `latest-isPending-consistency` A10 (the
  `[true, data-1]` pairing).
- **Error boundary under an action** — `createErrorBoundary` "should hold
  error boundary during transition when signal change clears error" /
  "…when reset is called": content shows before the action settles.
- **Tests of `next`'s internals** — `finalize-reentry` ×2 (`Queue`),
  `transition-corpse-revival` ×2 (`_done`), `transitionMerge`
  (`_optimisticNodes`): not semantics; to rewrite or drop.
- **Stores / `affects` through action shapes** — `affects-audit` ×7,
  `affects-propagation` ×5, `question-scoped-pending` ×2 reach a stub or
  assert on `affects` marks: the `affects` step.
- **Attribution** ×7: Transition-based records, as before.

Recommendation: provenance and held-truth are the two rules; confirm them
(they were ruled for Transitions — #3331, #3164 — and lanes may want them
stated differently) before building, then take the lane-holds group.

## 27. Rulings of 2026-10-02 (the open list, answered)

Maintainer answers to the §26.4 list and the carry-overs from §23.5/§24/§25,
taken verbatim where they decide something. These are the rules this step
builds to; the spec files are not edited on this worktree.

- **Q1 Supersession provenance (A18, #3331/#3347): (a), "even at the cost
  of bytes".** Two actions whose guesses entangled before the older one's
  answer landed: the older action's answer is a stale question — staged as
  the base, nothing moves (no downstream refetch, `latest` keeps the
  override, `isPending` true because the held value differs, A24); the
  override's own question (the newer action) supersedes. A same-value
  re-guess renews provenance. Mechanism: a question stamp on guesses and on
  flights (the step that started them), `laneOutcome` compares.
- **Q2 Held truth / `until()` flip-entanglement (#3164): (a).** The
  landing that flips an awaited `until()` predicate truthy is the
  confirming event by the user's own definition: it joins the awaiting
  action's transaction and reveals with it — never `saving=true` beside the
  confirmation. Non-flipping updates reveal freely. Lane passes keep the
  committed value under the stolen landing (no `saving=true` beside `v1`);
  memos and user effects deriving from it are held with it (A29, one staged
  world); untracked reads keep committed; `latest()` and the predicate
  tunnel. (b) — the same-family fold alone — is not an alternative: the
  until pins use a foreign source, and the fold comes with Q1 anyway.
- **Q3 Lane holds under actions: not rulings.** Maintainer: "Optimism is
  only cleared by landing of source or transition tear down so aren't these
  orthogonal?" — yes. These pins are INV-3 applied to lanes (#3289: a
  lane's reveal is held while async derived from its guess is in flight
  _and observed_) and "whose flight is it" for nodes that did not exist at
  the write (mounted by the lane's reveal, merged lanes #3335, mounted
  mid-hold #3460/#3479). All ruled; actions only keep the scenario
  observable. The failures are mechanism (the guess never shows in the
  GabbeV reduction; the second write never shows in "created under the
  lane"). The lane model already stages a guess as a proposal while the
  lane is blocked — no new representation.
- **Q4 Verdicts over a superseded override: as stated.** After the
  own-source truth lands under an open action: `latest(x)` is the truth,
  `isPending(x)` is true iff the truth differs from the displayed override,
  untracked and children-forbidden reads keep the override, a stale reader
  of a foreign transaction displays the override.
- **Q5 Boundaries under an action: "actions are just transitions."**
  Entering a fallback may happen ahead; leaving one falls with the rules
  (held with the transaction like any content). "For both directions do
  whatever feels more natural with the less code." The two
  `createErrorBoundary` pins observe the view effect's _compute_; re-pinned
  to observe the run (the DOM): `error` until the landing, `content` after.
  (Maintainer notes an earlier eager ruling may have been read from how a
  thing was said rather than what was said; mechanically the subject was
  holds and their removal.)
- **Q6 Tests of `next`'s internals: best effort, not critical.**
  `finalize-reentry` ×2 and `transition-corpse-revival` ×2 are rewritten
  against their scenario comments; `transitionMerge` (`_optimisticNodes`)
  is dropped.
- **7a `on` and a memo of `isPending` (#3528).** Maintainer asked for the
  original discussion to be walked (#3524/#3528/#3529/#3540 and #3575's
  final semantics) and the intent mapped rather than the pin chased. The
  arc: rc.8 value-compared key staged into the write (did nothing under any
  outside hold) → 2026-09-19 eager re-arm escaping the transaction
  (rejected: ProductPage A→B gave `[A] → [A + spinner] → [B + spinner] → [B
  - comments]`) → 2026-09-22 (#3575): dependency list, re-arm releases the
boundary's hold at once, the swap lands with the notifying write's frame,
display-ahead reads in `on` (`latest`, `isPending`, an optimistic signal)
are eager, same-source outside hold never shows the fallback (by design,
`LOADING_ON_OUTSIDE_HOLD`). Probe of this build: every row of #3575 holds
— shell-hold `on={id}`gives`[A] → [B + spinner] → [B + comments]`and no
spinner when comments land first;`on={latest(id)}`and a direct`isPending`in`on`are eager;`on={m2()}`under a same-source hold shows
nothing. The one gap is a *memo* between`isPending`and`on`: the memo is
the verdict reader (its pass is the verdict lane's) but its staging is not
marked as lane work, so `on`'s plain read follows the frame. **Resolution:
fix, not drop.** L2's own rule is "a reader of lane work is lane work"
(how a memo over `createOptimistic`carries the lane); a direct`isPending` eager but a memo over it frame-following would be the "second
    concept nobody would guess" the thread rejected, and the memo form is
    mizulu's component verbatim. A verdict reader's staging is lane staging;
    pins stand.
- **7b web `loading.spec` #2700/#2701: (a), re-pin to the build.** "What we
  can't have happen is the error fallback just clear and see some broken
  state underneath. As long as we keep the view consistent I'm ok." The
  build's frames: `0 | Fetch error for 0` → `1 | Fetch error for 0` → `1 |
Fetch error for 1`; the error stays until the new answer (a pending is not
  a value; the inner Loading's fallback is hidden behind it). Lost: the
  top-level `isPending(count)` affordance — "no one was expecting something
  that high in the parent scope to be isPending".
- **7c #3404 / #3444: mechanism.** #3404 now shows a _missing_ `cleanup
1.0/1@2600` when the outer effect re-runs mainline during the hold (a
  frame child not torn down — a bug, not an order question). #3444: "If a
  branch has been staged for removal it's a zombie.. latest is expected to
  peer through so it does see the 1." Pin stands.
- **7d three-level reveal first frame: "just match the rule"** — the new
  frame is "a collapsed tail renders nothing". **7e O2 posture B:**
  unobserved, fine; the only concern would be a waterfall — none: a
  born-held node computes at creation with the held input, only its
  publication waits. **7f `blockedBy` early return:** acknowledged.
- **7g Effects behind a fallback: FLIP to the queue rule.** Maintainer: "my
  understanding is we held the queue but let the sync renders through…
  we definitely shouldn't be showing portals early. Flip it." The build
  had held user/tracked runs only and let queued render-effect updates run
  off-screen (§23.5); `Portal`'s `schedule: true` render effect reached
  `document.body` while hidden. Now: every _queued_ run behind a fallback —
  render updates and user effects — waits in the boundary and is released
  at the reveal; the synchronous first render on creation goes through.
  No special case for `schedule: true`.
- **7h `reset()` retries inline (A28):** matches `next`'s `_retry`; leave.
- **7i Attribution: required.** "Attribution engine is very important…
  we will need to do it." Rebuilt on L2 after stores and `affects()` (it
  observes both). **Naming:** the internal rename Transition → transaction
  must not reach outward-facing language; user-facing docs, diagnostics and
  attribution records say **holds** ("I believe we call them holds instead
  of either term").

Build order (approved): Q1 → Q2 → lane mechanism group (incl. #3404, #3444,
7a) → re-pins (Q5 ×2, #2700/#2701) and the 7g flip → Q6 → whole-suite
measure.

### 27.1 What was built (2026-10-02)

**Q1 — provenance (A18, #3331/#3347).** `scheduler.question` is the
question being asked: an action's sequence (`nextQuestion()` per
invocation, set around each slice and the flush `inTransaction` runs; the
first slice's writes are stamped at the write), 0 otherwise. A guess is
stamped at `applyGuesses` (`_x._q`; a mainline guess takes a fresh
sequence), a flight at `handleAsync` (mainline = `MAINLINE_QUESTION`,
always current). `laneOutcome` (the guess node's own pass): the newest
stamped source that changed this round (`_time === clock`) is the answer's
question; older than the guess's → `staleAnswer`: the value stages as the
base the guess covers (`_pendingValue`) with **`CONFIG_HELD_TRUTH`** (new
bit, 1 << 18) and nothing is notified; else `supersede` as before. The
same-value re-guess goes to the seam (`optimisticWrite` no longer bails
when the node already carries a guess): `applyGuesses` renews the stamp
and entangles (`merge(parent, holder)`) without notifying, for displayed
and blocked lanes alike. `CONFIG_HELD_TRUTH` is also set when a guess
covers a truth already staged in the same frame (`applyGuesses`), read by
`isPending`'s guess arm ("not final while the held truth differs", A24),
cleared by `supersede`, and re-homed with the parent instead of dropped
when a never-shown lane reverts (`dissolveLane`).

**Q2 — flip-entanglement (#3164).** `until()` captures `flushTransaction`
(the awaiting action's) at the call; `watch` gained an in-pass hook; when
the predicate flips truthy inside a running flush and the action is still
open, the pass `joinFuture`s the action — the flush carrying the landing
parks into it. Lane passes already see held nodes as committed
(`frameRead`), so the owning lane keeps `v0` under `saving=true`. Two
mechanism fixes it exposed: a lane pass that read a staging of the frame
(REACTIVE_STAGED_READ) is the frame's — its **run goes to the frame's
queue** (`enqueue(type, fn, lane)`, `recompute` passes `null`), and a node
the lane had listed **leaves the lane** (`recompute`'s tail) so the seam
holds it rather than the lane revealing it; parked, such passes are stale
readers of the transaction (`laneStagedReads` → `_reruns`), not for a
verdict lane's work.

**Lane mechanism group.**

- `laneRead`'s lane-work tail serves the lane's own staging to a plain read
  (`plain` argument from `read`; a verdict read still falls through to the
  verdict's held arm) — a lane pass reading its blocked lane's staging is
  not a staged read of the frame.
- **REACTIVE_LANE_DIRTY** (1 << 16): a lane's re-staging (`applyGuesses`,
  lane work in `recompute`) marks its member subscribers (`laneDirty`); the
  member's next pass starts as the lane's (`recompute` sets `passLane`),
  not a stale reader re-run by an unrelated write (#3460) republishing
  the committed view.
- **Linked lanes** (#3335 / #2912): a pass reading two lanes' work links
  them (`enterLane` → `linkLanes`, shared `_links` array): one reveal unit
  (`linkBlocked` in `lanesBlocked`, `sameLane` for membership), lifetimes
  their own — each guess reverts with its own action. A nested lane reading
  through an ancestor's guess stays its own.
- **Body-end supersession** (#3427, A18 corollary): `Transaction._acted`
  (set by `action`); at a lane's seam, parent `_acted && _open === 0` with
  no authoritative flight (`ownFlights(p)`: `blockedBy` counting only
  pending readers whose pending source is the frame's own — not a lane's,
  `ownSource`; and no guess of the lane in flight, `guessFlights`) →
  every guess of the lane is superseded by the base it covers (no seam
  join: the re-derivations join through the held node). `_laneSeams`
  iterates a snapshot. Oracle "body ended" cells re-pinned (flagged): the
  never-shown guess is void at the correction — untracked / staleForeign /
  childrenForbidden read 0, not the override.
- **Verdict stale reader**: a render effect re-run or mounted outside a
  blocked verdict lane's flush reading `latest(held)` is served the
  committed value and re-derived at the reveal (verdict.ts, as
  `laneRead`'s #3460 arm).
- **#3404**: a mainline re-run of a held render effect clears
  `CONFIG_HELD` (it published mainline) so this flush's commit retires the
  committed frame the held pass had parked; `reruns` voids the queued runs
  of a stale reader's children (its frame is being replaced). The 3500
  order re-pinned (flagged): new frame's first run, then the replaced
  frame's cleanup at the commit — the same order the pin already had for
  the 2600 mainline replacement.
- **#3444**: a parked frame cancels dirtied zombies except verdict readers
  (CONFIG_VERDICT), which re-run at the seam as the holder's verdict lane's
  work — `latest()` in a branch a held Show is removing peers through.
- **REACTIVE_VERDICT_RERUN** (1 << 17) and `Transaction._parked`: a probe's
  re-derivation at a landing that is not a blocker (`blocker` argument of
  `verdictRead`); owed only by a transaction a frame parked into. (Built
  for the eager routing of flight probes below; kept — it is the right
  shape for the probe's rerun — though the eager routing was reverted.)
- `lane-hold-on-observation` "created under the lane" rewritten (flagged):
  its mount created a root inside a render effect callback, which is
  `PRIMITIVE_IN_EFFECT_CALLBACK` in this build; the child is now built by a
  memo reading the guess (a flow component's shape), so it is the lane's
  frame from the first guess — `shown` `[0]` → `[0, 2]`, `inner` `[20]`.

**7a — NOT resolved; reverted.** Eager routing of a flight probe
(`pendingVerdict` → `joinFuture(null)` + verdict-lane work) made the memo
form transitive and passed both #3528 memo pins, but regressed web
`frames-optimistic-hold` ("a refetch of a SHOWING call reads pending until
its content applies"): a probe routed into a transaction that never parks
re-derives at its immediate landing, opens another, and spins (5 s
timeout), or lands in a verdict lane whose queued run `dissolveLane`
drops at the parent's end. `isPending` keeps the watcher ("final unless
the flush parks", §23). The two #3528 memo-isPending pins stay red; the
next pass should either (a) make the watcher's lane re-derivation re-arm
the boundary into the lane (`arm` after a flip, re-homing the swap), or
(b) finish the eager path with `_parked`-gated reruns AND a lane end that
releases its queued runs (`dissolveLane(l, null)` → `releaseQueues`).

**Re-pins.** `createErrorBoundary` ×2 observe the run (Q5); web
`loading.spec` #2700/#2701 (`1 | Fetch error for 0` → `1 | Fetch error
for 1`, opacity never dims); `createLoadingBoundary` "holds every queued
run behind the fallback" (7g: `runEffect` holds any queued run under a
fallback, `release` re-queues by type; the synchronous first render goes
through); `finalize-reentry` ×2 rewritten with plain API (a user effect of
an unrelated tick writing into the hold; a tick writing a plain signal and
a held one); `transition-corpse-revival` rewritten (the landing clears
`_x._transaction`; a write after the landing holds nothing);
`transitionMerge`'s `_optimisticNodes` pin dropped.

**Tests.** Signals 4759: **passed 2096 → 2094 after the 7a revert**
(baseline 2049; +45), carved 2536, failed 125 (was 173): 66 pre-existing,
the rest below; passed→not-passed **0** vs the actions baseline and vs s4.
Web **888** (+2), 185 carved/failed, 0 regressions; solid 678, unchanged.

Still red in the family (for the next pass): `createOptimistic` checkout
×6 (`latest()` of a lane-held derivation served committed by a render
effect outside the lane — the LANE_HELD arm's stale-reader rule vs
"latest above async is the pending value"; `isPending` of a landed
lane-held node), `createOptimistic` mismatch/rapid ×2 (rule 2: a
no-parent write is void — pins to change, as §16's 12), #3528 memo ×2
(above), `lane-outside-view` #3479 boundary-over-lane-born-memo and
#3463, `optimistic-lane-release` #3427 pin 1 (`Pending: true` published a
round late), `lane-uninitialized-landing-3648` shape B,
`optimistic-read-lane-not-transaction-3698`,
`body-end-supersession-visibility`, `reveal-carve-out`,
`superseded-before-first-commit`, `pending-companion-lane-parent` #3379,
`isPending-memo-consistency`, `latest-isPending-consistency` A10,
`optimistic-settle-verdicts`, `held-truth-lane-only` precondition (the
`CONFIG_HELD_TRUTH` bit on the stolen landing — the bit now means the base
under a guess; the pin asserts `next`'s internal), `visibility-oracle` ×14
(A18 (d) rows and store rows), `refresh-await` (store), `spec-async`
×4 (stores / `affects`).

**Size, actions → rulings (br / min):** floor 6917 → **7201** (+284 /
+880: scheduler +623 min — `question`, `_acted`/`_links`/`_parked`,
`laneDirty`/`sameLane`, `ownFlights`/`ownSource`, `laneStagedReads`,
`reruns`' child voiding and probe gate, the zombie verdict re-run, the
enqueue argument; core +188 — `stagedRead`, the LANE_DIRTY start, the
lane tail's leave, the HELD head's un-hold; async +25; constants +40);
simple app 9411 → 9691; CSR 12334 → 12635; + isPending/latest 8307 →
**9005** (+698: lanes.ts provenance, links, body-end; verdict.ts arms);
page live 38682 → 39453 (+771). vs `next`: floor 9508 → 7201 (−24.3 %),
simple 11970 → 9691, CSR 14901 → 12635. Bytecode: `read` 1052 → 1049/112,
`setSignal` 320/40 unchanged, `recompute` 2545 → **2770**/384 (+225: the
LANE_DIRTY lane at the top, `laneDirty` after `insertSubs`, the lane tail,
the HELD head). The maintainer accepted bytes for Q1; the lane group's
share is the larger part and is a candidate for a consolidation pass
(`laneStagedReads` could ride `pendingNodes`; `ownFlights` is already
folded into `blockedBy`).

**Public surface touched (to flag in any PR):** none new — all internal
(`Transaction` fields, `CONFIG_HELD_TRUTH`, `REACTIVE_LANE_DIRTY`,
`REACTIVE_VERDICT_RERUN`, `scheduler.question`). Behavior: 7g (queued
render runs behind a fallback now wait for the reveal), the re-pins above.

### 27.2 The Gabriel thread, A24, N1, and the reds (2026-10-02, afternoon)

**Gabriel's kanban (Discord).** Reconstructed at the signal level: a plain
error-flag reset inside the action, read by a `<Show>` in a drag ghost
mounted mid-move. Probe: under A29 the mount's read joins the hold and the
unrelated `dragging` write is held with it (`drag=no ghost=(none)` until
the move lands); with `latest()` in the ghost, or the flag optimistic, both
show at once. His actual code (`GabbeV/solid-kanban`, `board/cards.tsx`)
already shadows the flag optimistically AND writes the plain truth at the
start — the entanglement there is the store layer joining a reader of an
_overridden_ leaf to the hold on the base beneath it (A17 says it must
not): a `next` store bug, for the store step, which inherits today's
"guess over a staged truth" representation (`CONFIG_HELD_TRUTH`). Fixture to
lift: plain truth + optimistic shadow on one leaf inside an action, a new
reader mid-action shows now and joins nothing.

**A24 — a confirmed guess is final (ruled, built).** `heldNotFinal`: a
staging equal to the display is not a value change in flight. One pin:
the oracle "body ended" `isPending` → `false` (its sibling cells were
re-pinned to the void guess yesterday).

**N1 — a mainline mount reads the screen (ruled, built, REVERTED).** Built
as a `frameRead` arm for creation passes (`REACTIVE_CREATING`) outside a
joined flush, excluding authoritative readers and content under a fresh
Loading (#3540). 20 pins flipped, all A29's own statement. Reverted on the
maintainer's "there must have been a reason": a memo is not a leaf — the
transaction's own later passes read it, so a mount's derivations must carry
the future; only its direct bindings (render effects) read the screen,
which they already do. The spec's A29 history confirms the sequence
(direct-commit of the staged value → born held); "create uses committed"
was never the thing replaced. Principle: **derivations see the future;
only leaves (render effects) and declared worlds (lanes) see the screen.**

**`until`'s first pass was not authoritative** (found via N1's `authoritative
→ 1` cells): `computed()` never read `_extraConfig` and runs the first pass
inside the constructor, so `watch` set the bit after it. A predicate created
in a later slice over an already-displayed guess was satisfied by the
action's own guess (`acked` before the truth; `saved → initial → saved`).
Fixed: `computed()` honours `_extraConfig`; `watch` passes
`CONFIG_AUTHORITATIVE` at creation (REDERIVE still after — at creation it
changed the reject path). New pin in `until.test.ts`; an oracle cell fixed.

**Checkout ×6 (`latest` independence).** A verdict reader of lane work was
made the _lane's_ work by `laneRead`'s `enterLane`, so a blocked lane held
its run — the opposite of display-ahead. `verdictValue`'s lane arm now
routes the reader to the holder's verdict lane (as for a guess) and serves
the lane's staging to `latest` (the staged landing a blocked lane holds has
answered the node's question — `isPending` false, A24). The six pins pass
with two re-pins: the `latest` text arrays compare the _shown_ sequence
(`shown()` collapses a render effect's re-application of the committed
value when a verdict re-derives it — effects have no comparator, by
design; a global `Object.is` gate was tried and broke 74/26 pins), and the
superseded-override reads use `latest()` (A18 (c): an untracked read is
display). Also the two rule-2 pins (mainline no-parent guess is void)
re-pinned as §16's twelve were.

**#3528 memo-isPending ×2 (7a) — resolved.** Two pieces: `arm` re-homes an
already-flipped boundary's swap into the lane when the `on` pass arms again
as lane work (the watcher memo's membership changed with no value change;
the frame-work staging is voided so the lane pass stages anew), and `arm`'s
"verdict-derived" test looks through the `on` node's deps for a
CONFIG_VERDICT memo (`verdictDerived`), so the memo form gets the same
display-ahead ordering as the direct `isPending`.

**Verdict rows.** Oracle rows re-pinned to lanes: "superseded" ×3,
"superseded before its first commit" ×4, "un-superseded" ×5, "held truth"
`preexisting` — a guess written in the frame that re-asked its source and
re-fetched its derivation was never displayed (its lane blocked), so the
correction voids it (§16); A18 (c)'s "the display keeps the override" is
about a displayed override. Never committed → direct reads throw NotReady
and `isPending` is false (A19 exc. 1). There is no override to
"un-supersede"; the later landing is a plain truth staged under the action.
`superseded-before-first-commit.test.ts` re-pinned likewise.
`isPending-memo-consistency` #3078: a verdict read of an _unflushed_ staging
outside a flush now watches the seam (nothing else would re-derive a memo
created after the write); the pin allows the watcher's round.
`latest-isPending-consistency` A10 re-pinned to the pairing invariant (a
user effect is a frame reader under L2; `next` made it "fresh").

**Tried and reverted:** eager verdict-lane routing of flight probes
(spins / loses a lane's queued runs — web `frames-optimistic-hold`), the
seam-time recompute of watchers (made probes blockers before the landing
loop), probes as non-blocking reruns by default (28 pins rely on a probe
of a held node holding), effects comparing by `Object.is` (74), render
effects only (26), and holding the parent one round after a body-end
correction (#3409; regressed a rapid-action pin without fixing it).

**Tests.** Signals 4759: **passed 2125** (rulings step 2094; +31), carved
2536, failed 97 — 66 pre-existing, **15 in the family** (below), the rest
store/`affects`-dependent; passed→not-passed **0** vs the rulings step. Web
888, solid 678, unchanged.

Still red: `lane-outside-view` #3479 (boundary mounted mid-hold over a
lane-born memo) and #3463; `lane-uninitialized-landing-3648` shape B;
`optimistic-read-lane-not-transaction-3698`;
`body-end-supersession-visibility`; `reveal-carve-out`;
`optimistic-settle-verdicts` #3409 (a body-end correction's re-derivations
are mainline flights — the parent lands at the correction seam; a cleaner
"the correction is the parent's" mechanism is needed); `spec-async` A15
"reveal of an existing LANE flight" ×3 and V5; `loading-on-rearm-reveal`
`on: () => latest(dep)`; `held-truth-lane-only` precondition (asserts
`next`'s bit on the stolen landing — rewrite to observables);
`refresh-await` (store); `createOptimistic` affects (carved).

**Size, rulings → reds (br / min):** floor 7201 → **7202** (min 19954 →
19927); CSR 12635 → 12677 (+42: `verdictDerived` and the re-home in
boundaries.ts); + isPending/latest 9005 → 9025; page live 39453 → 39519.
A24 + the `until` fix + the verdict arm are ~flat on the floor.

---

## 28. Replay — the lane layer from principles (design, 2026-10-02)

Maintainer, on the fifteen remaining reds: "I'm ok with a redesign if it
warrants it. Our process so far has done more than slight shifts have done
for months … replay the last couple days again with new understanding to
get the best results … This can take some time because it should last a
while." This section is the design, for ruling before any code. It replays
§16–§22 and the lane parts of §26–§27 with the rulings as the spec; it does
not touch the L2 core (§8–§15), boundaries (§23), reveal (§24) or the
scheduler consolidation (§25) except at the touch points listed in 28.10.

### 28.1 Why — the evidence that it is the design, not the pins

- Six reverts in one day (§27.2 "tried and reverted"), all in three sites —
  `recompute`'s head, `laneRead`, the seam order — each costing 10–74
  regressions. Fifteen reds, each with a clear ruling, each fixable by one
  more arm in the same sites. That is the signature of decisions made in
  the wrong place: every local fix fights a neighbour.
- **The representation infers a value's world from bits.** `guessOf(el)` is
  `LANE_HELD ? _pendingValue : _value`: `_value` means "committed" or "the
  guess" depending on one bit; `_pendingValue` means frame staging, lane
  staging, the base under a guess, or the truth held under a guess
  depending on `GUESS`/`OVERRIDE`/`LANE_HELD`/`HELD_TRUTH`. The seam
  _swaps the two slots_ when a lane blocks or unblocks (`laneSeam`). Eighty-
  one reads of those four bits across seven files, each reconstructing
  which world a value belongs to. The A18 sync-twin misreads (#3479,
  #3648 B, the oracle rows re-pinned in §27.2) are all this.
- **The seat is a side effect of reading.** `enterLane` with no `passLane`
  does `setPassLane(l)`: a read mutates the global seat mid-pass, so what a
  pass _is_ is decided by what it _touched_. Leaves (render effects) get
  converted into lane work and their own frame commits without them (the
  A15 LANE tear, `[true,false],'hidden'`). The lane tail then tries to undo
  it from evidence (`REACTIVE_STAGED_READ` → leave the lane).
- **Two display-ahead mechanisms** with parallel flags (`LANE_DIRTY` /
  `VERDICT_RERUN`), seams (`laneSeam` / `verdictSeam`), rerun paths and
  arms (`laneRead` ×6, `verdictValue` ×5).

### 28.2 What stays, what is replayed

**Stays.** The L2 core: `Transaction`, membership (`_x._transaction`,
`list`/`holdNode`/`merge`), `blocked`/`blockedBy`/`ownFlights`,
`frameRead` and the stale-reader rerun, born-held (A29 — confirmed by the
N1 episode, §27.2), parks, the seam loop, actions as transitions (Q5),
`_q` provenance, boundaries and reveal as consumers. ~2100 pins are its
test. Also the process: the rulings doc, `cmp.py`, `measure.sh`, the pins.

**Replayed.** `lanes.ts` and `verdict.ts` in full; the lane touch points
in `core.ts` (`recompute` head and tail, `read`'s lane gate, `stagedRead`),
`scheduler.ts` (`laneStagedReads`, `enqueue`'s lane argument, the
`_lanesBlocked` consult), `boundaries.ts` (`arm`'s re-home and
`verdictDerived`, which should become unnecessary). Built in place — the
core reaches the layer through the `GlobalQueue._*` hooks, which are the
interface already.

### 28.3 Principles — the spec

The rulings this replay is built from, stated as rules of the layer:

1. **Derivations see the future; leaves and lanes see the screen.** (§19,
   N1 revert §27.2.) A derivation reading held or pending work joins it —
   the intentional entanglement. A render effect or verdict reader reads
   committed and is re-derived at the landing. A lane sees committed
   values plus its own (and ancestors') shown guesses — never a
   transaction's held writes, _including the current flush's unparked
   staging_ (28.5 (c)).
2. **A value lives in its world's slot; its world is where it lives, not a
   bit pattern.** (28.4.)
3. **The seat of a pass is its node's state at the head; a derivation's
   reads may move it into a lane; a leaf's seat never moves.** (28.5.)
4. **A hold is on the thing read.** A derivation joins the world it read; a
   leaf reading a _shown_ lane value shows it and holds nothing; a leaf
   reading a _pending_ lane flight waits on that flight — its own frame
   blocks on the flight's landing, never on the lane's parent (#3334,
   A15). (28.6.)
5. **A lane displays ahead on its own account** (§16, §22): it shows when
   its own flights land, whatever its parent's `_open`; blocked, it holds
   its parent (A15 for lanes). Linked lanes (one reader reads two guesses)
   reveal together, live apart (#3335, #2912).
6. **A guess is final when confirmed (A24); a correction is the parent's
   (#3409); a guess never shown is void (§16, §21).** A truth older than
   the guess's question stages silently as the base (A18 provenance,
   #3331).
7. **Verdicts are the system's guesses** (§20): `isPending`/`latest`
   readers are leaves in the holder's display-ahead world — shown now,
   re-derived at the landing. One mechanism with lanes if the probe
   dimension fits (28.8).
8. **Actions are transitions** (Q5); outward language is _holds_.

### 28.4 Representation

Per node, three places, each meaning one thing always:

| place                 | meaning                                                                           | today                                       |
| --------------------- | --------------------------------------------------------------------------------- | ------------------------------------------- |
| `_value`              | the committed value — the screen's truth                                          | also "the guess" when shown (swap)          |
| `_pendingValue`       | the frame's staging (a transaction's future), `NOT_PENDING` if none               | also lane staging, the base, the held truth |
| `_x._lane` (new slot) | the lane's value for this node — a written guess or a derived one; `NONE` if none | spread over `_value`/`_pendingValue` by bit |

Per lane transaction, one flag: `_shown` — set at the seam when the lane is
not blocked, cleared when it is. _Shown vs held is the lane's state, not a
swap on each node._

`display(n)` — what the screen shows — is `n._x._lane !== NONE &&
n._x._transaction._shown ? n._x._lane : n._value`. Reached only behind the
one slow-path gate `read` already has (`CONFIG_OVERRIDE`, kept as "has a
lane value"); the hot path is untouched.

Consequences:

- `CONFIG_LANE_HELD` and `CONFIG_HELD_TRUTH` go. A held truth under a guess
  is simply `_pendingValue !== NOT_PENDING` on a node with a lane value; a
  blocked lane's staging is a lane value whose lane is not `_shown`.
  `CONFIG_GUESS` stays (written vs derived — `supersede` semantics);
  `CONFIG_OVERRIDE` stays as the gate.
- The seam swap, `guessOf`, and the four-way `laneRead` value selection go.
- **Revert is a drop.** `_value` was never touched by the guess; the lane's
  end on revert clears `_x._lane` and notifies. No base to record, no
  "un-supersede". A correction (truth differs) stages the truth in
  `_pendingValue` under the parent as any landing does.
- **Lane-derived values do not commit into `_value` at the reveal.** Today
  the reveal `commitPendingNode`s the lane's staging (so `_value` becomes
  the guess-derived value and the revert must re-derive it back). Proposed:
  the reveal sets `_shown`, applies the lane's _frames_ (children:
  `_pendingFirstChild`/`_pendingDisposal` — Owner-level staging is separate
  from the value slot) and releases the lane's queues; the lane value stays
  in its slot until the parent lands. The frame's own passes keep seeing
  the truth-world in `_value`/`_pendingValue`; the screen sees `display()`.
  At the parent's landing a confirmed guess's truth is already
  `_pendingValue` (commit as usual); a derived lane value is re-derived from
  the truth by the notification, as today.
- Memory: one slot on `_x` (lane nodes already allocate `_x` for
  `_transaction`), one boolean on `Transaction`. Code: expected negative —
  measured on the skeleton (28.12 S0) before anything else.

### 28.5 Seat and reads

(a) **Head seat from carriage.** `recompute` starts the pass in its node's
world: `passLane = el._x?._lane !== NONE || el._flags & LANE_DIRTY ?
el._x._transaction (a lane) : null`. A node carrying a lane value runs as
the lane's whoever dirtied it — a sync write (#3698), a boundary reset
(#3479), a frame rerun (#3648 B) — so its children are the lane's and its
result goes to the lane slot, not the frame's. (Today: `LANE_DIRTY` only;
the tail corrects afterwards, too late for side effects.)

(b) **A derivation's reads may move it.** A pass with no lane seat that
reads a lane value enters that lane (as today, §19 "what the pass read
wins"); a lane pass reading another lane's value links the two (as today).
Its result is a derived lane value; its children are the lane's from that
point. The ordering limitation this inherits — children created before the
first lane read are the frame's — is today's too (no pin fails on it);
28.13 Q2 asks whether to re-run in the discovered world instead.

(c) **A lane pass sees the frame's staging as committed — this flush's
unparked staging included.** Today only _held_ (parked) staging takes the
`frameRead` committed path; same-flush unparked staging is read through
(`stagedRead` → `REACTIVE_STAGED_READ`) and the tail then makes the pass
_the frame's_ ("writes this flush may yet hold") — so a guess's derivation
that also reads a frame write in the same tick does not display ahead at
all, and the result depends on which dep was read first. Proposed: one
rule for both — the lane pass reads `_value`, is marked `FRAME_READ`, and
is re-derived when that staging commits (the non-parking seam reruns the
list instead of clearing it; the parking seam moves it to `t._reruns` as
today). Order-independent; §19's "`guess + old` now, `truth + new` at the
landing" holds for same-tick writes too; `laneStagedReads` and the
`STAGED_READ` lane tail go. Lane contract 4 is already pinned to this.

(d) **Leaves never move.** A render effect or verdict reader reading a lane
value reads `display(n)` and stays its frame's: shown → the value, holds
nothing (28.6 says what its frame does if it is pending); not shown → the
committed value, `FRAME_READ`, rerun at the lane's reveal (the #3460 stale
reader, as today — but by rule, not by the `passLane`/`sameLane`/
`flushTransaction` triple test).

(e) **Authoritative readers** (`until`, `CONFIG_AUTHORITATIVE`) read the
base — `_pendingValue` if a truth is staged, else `_value` — and are no
lane's, as today, now a one-line arm.

### 28.6 Holds

- A derivation reading a held or pending node: `joinPassTx` / merge, as
  today (the core's rule).
- A leaf reading a pending lane flight (`display(n)` has nothing to show:
  the lane value is `NONE` and the node is `STATUS_PENDING`) throws
  NotReady as any pending read; the leaf is pending in _its own frame's_
  `_nodes`, `blockedBy` finds a pending on-screen render effect and the
  frame parks; the settle walk re-runs it when the flight lands
  (`_pendingSources`), it reads the now-shown lane value, the frame lands.
  **No new edge:** the only change is 28.5 (d) — the leaf is not converted
  into the lane, so its frame is the one that waits. The lane's parent's
  `_open` is never consulted (#3334). Expected to clear the A15 LANE trio;
  if `_pendingSources` does not re-run a reader whose source is lane work,
  the fallback is a frame↔lane link through the existing `_links` group
  with `blocked(t)` consulting it for frames (`lanesBlocked` minus the
  `t._lane &&`).
- **A zombie's flight is moot for the transaction whose commit disposes
  it** (#3463): `blockedBy` skips a pending node whose owner chain reaches
  a `REACTIVE_ZOMBIE` owner whose disposal is staged in `owner`. Small; the
  only reachability test in the layer.
- Blocked lane → blocks its parent; linked lanes block each other on their
  own flights only (`ownFlights`/`guessFlights`), as today.

### 28.7 Seams — the order

At `settle()`, after the park/commit decision:

1. **Guesses** written since the last seam open their lanes under the
   frame's transaction (as today; a committing frame has nothing to be
   optimistic over → dropped, §16).
2. **Corrections** — body-end supersessions (A18 corollary, #3427) and
   stale answers — run _and their re-derivations are run in the same pure
   round under `passTx = parent`_ before any landing is judged. The
   re-derivations read the superseded node (held by the parent) and join
   it; their flights are the parent's; the parent waits for them (#3409:
   the indicators clear together). Mechanically: `_laneSeams` reports a
   correction, the seam runs the dirty heap once more before the landing
   loop. (The reverted "hold the parent one round" was this with the wrong
   tool.)
3. **Lane verdicts** — each lane `_shown`/held by `blocked(l)`; a newly
   shown lane applies its frames and releases its queues, a newly held one
   parks; stale readers rerun (`_reruns`).
4. **Verdict seam** (28.8) — on the same `display()`; folded into 3 if
   unified.
5. **Landings** — every transaction not `blocked`; its lanes end with it
   (`endLanes` → confirm: commit `_pendingValue`; revert: drop `_x._lane`,
   notify; derived: drop, re-derived by the notification).
6. Effect phase: lane queues (display-ahead) first, then the flush's own,
   then the landings' held runs (as today, #3540/#3528 order).
7. Boundary seam (as today).

### 28.8 Verdicts

`isPending(n)` is "`n`'s world has an unanswered question": `STATUS_PENDING`
on `n`, or a lane value whose lane is not shown, or a `_pendingValue` that
differs from `display(n)` (A24: equal = answered). `latest(n)` is "the
answered value": `display(n)` if the question is answered, else the staging
that answered it (`_pendingValue` for a landed-but-held frame node; the lane
value for a blocked lane's landed derivation — §27.2 checkout).

The reader is a leaf in the holder's display-ahead world: it shows now, its
runs go now, it re-derives at the landing. Today that world is a _verdict
lane_ (`t._verdict`, a `newLane(t)` with no write and nothing to stage)
with its own dirty flag, rerun gate (`_parked`) and seam. **Hypothesis to
test in S2:** a verdict reader is exactly a lane leaf whose lane value is
computed rather than stored — the same `_shown`, `_reruns`, and queue
routing serve it, and `REACTIVE_VERDICT_RERUN`, `verdictSeam`,
`watchVerdict`, `provisionalVerdict` collapse into the lane seam. What does
not fit the lane shape is the **probe** dimension — whether a verdict read
of a held node makes the reader a blocker (28 pins say a probe of a held
node holds; `observeFlight`) — which stays a `blockedBy` rule
(`CONFIG_VERDICT` + `FRAME_READ`, as today). If the unification fails the
fallback is the shared seam and `display()` only; the five-arm
`verdictValue` is rewritten on `display()` either way.

### 28.9 Provenance and outcomes

Unchanged in substance from §27.1: `_q` stamps guesses (`applyGuesses`) and
flights (`handleAsync`); `laneOutcome` judges a node's own source
recomputing it — a stale answer (older `_q`) stages as the base silently,
the guess's own question answering supersedes (confirm: silent, A17;
correct: notify, dissolve the lane into the parent). With 28.4 the stale
answer is just `_pendingValue = value` on a node with a lane value — no
`HELD_TRUTH` bit; `isPending` reads it through A24.

### 28.10 Interface

Hooks, unchanged in name and arity: `_laneRead`, `_laneStage`,
`_laneOutcome`, `_guessWrite`, `_applyGuesses`, `_laneSeams`, `_endLanes`,
`_lanesBlocked`, `_verdictLane`, `_verdictSeam`, `_observeFlight`.
(`_laneSeams` gains a boolean return: "a correction notified".)

Core changes, each one site:

- `recompute` head: seat from carriage (28.5 a). Tail: the `STAGED_READ`
  lane branch goes (28.5 c); `laneStage` on lane work as today.
- `read`: the lane gate calls `display()`-based `laneRead`; `stagedRead`
  marks `FRAME_READ` for lane passes and lists for the commit rerun.
- `settle()`: the correction round (28.7 (2)); the non-parking branch reruns
  the list; `laneStagedReads` renamed to what it is.
- `blockedBy`: the zombie-relevance skip (28.6).
- `constants.ts`: `CONFIG_LANE_HELD`, `CONFIG_HELD_TRUTH`,
  `REACTIVE_STAGED_READ`'s lane use go; `REACTIVE_VERDICT_RERUN` goes if
  28.8 unifies.
- `types.ts`: `NodeExtension._lane` (the slot). `scheduler.ts`:
  `Transaction._shown`.
- `boundaries.ts`: `arm`'s re-home and `verdictDerived` removed if S2
  makes them unnecessary (the `on` pass arming as lane work is then just a
  lane leaf).

Public surface: none. Behaviour: the re-pins listed in 28.12.

### 28.11 Expected effect on the reds (hypotheses, with confidence)

| red                                         | principle                                                                                                    | confidence |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------- |
| A15 LANE "existing flight" ×3 (#3334)       | 28.5 (d) + 28.6 — the leaf is not converted                                                                  | high       |
| `reveal-carve-out` retired lane             | same, plus 28.4 (no retired swap state)                                                                      | medium     |
| #3479 boundary over a lane-born memo        | 28.5 (a) + 28.4 (no sync-twin misread)                                                                       | high       |
| #3648 shape B                               | 28.5 (a) + 28.4                                                                                              | high       |
| #3698 held lane / #3460 shape               | 28.5 (a) (c) — needs a trace; the failing assertion is before the sync write                                 | medium     |
| `body-end-supersession-visibility`          | 28.4 (display keeps the shown guess through the correction window: the slot is dropped only at the dissolve) | medium     |
| #3409 indicators clear together             | 28.7 (2)                                                                                                     | high       |
| #3463 zombie keeps holding                  | 28.6 zombie relevance                                                                                        | medium     |
| V5/A17 `20` vs `999`                        | 28.4 (a guess over a staged truth: `_pendingValue` untouched)                                                | medium     |
| `loading-on-rearm` `on: () => latest(dep)`  | 28.8 (verdict reader is a lane leaf; no `verdictDerived` dep walk)                                           | medium     |
| `held-truth-lane-only` precondition         | test asserts `next`'s bit — rewrite to observables either way                                                | n/a        |
| `refresh-await`, `createOptimistic` affects | store / `affects` — later steps                                                                              | n/a        |

### 28.12 Build order and acceptance

Each step: full signals suite vs the current baseline (`vs7-tests.json`:
2125 passed, 97 failed) with `cmp.py`, web/solid sanity, whole size suite
with `measure.sh`, recorded here. No step merges into the next with
unexplained passed→not-passed.

- **S0 skeleton — representation and seat.** `_x._lane`, `_shown`,
  `display()`; `laneRead` rewritten on it; the seam swap, `guessOf`,
  `LANE_HELD`, `HELD_TRUTH` removed; head seat from carriage; leaves never
  convert; lane pass sees unparked staging as committed with the commit
  rerun. **Gate:** bytes on the floor and on `+ isPending/latest` ≤ today
  (7202 / 9025 br), and the lane-contract tests green. If the slot costs
  more than the arms it removes, stop and report.
- **S1 holds and seams.** Correction round (28.7 (2)); zombie relevance;
  frame↔lane link only if 28.6's expectation fails.
- **S2 verdicts.** `verdict.ts` rewritten on `display()`; the unification
  attempted; `arm`'s re-home / `verdictDerived` removed if redundant.
- **S3 outcomes and provenance** on the new slot; `endLanes` as drop /
  commit.
- **S4 boundaries and reveal touch points**; web suite.
- **S5 matrix, size suite, this section's results; §27.2's re-pins
  revisited** — `shown()` dedupe in the checkout arrays, the "superseded"
  oracle rows, A10 — re-pinned back if the rebuilt layer produces the
  cleaner sequence (they were pinned to the mechanism, not the rule).

**Acceptance:** every current green stays green except explicit re-pins
listed with their rule; the thirteen lane-family reds pass (the two store
ones excluded); every size scenario ≤ today's; the remaining failures are
the pre-existing families (attribution, rules-index, treeshake,
dist-artifacts, store/`affects`). Target ≥ 2138 passed.

**Estimate:** two to three days at the §27 cadence; S2's unification is the
uncertain part (could be a day on its own, or fall out in an hour).

### 28.13 Open questions for ruling

- **Q1 — the slot.** One extra field on `NodeExtension` (lane nodes only
  allocate it) and a boolean on `Transaction`, in exchange for removing the
  seam swap and two config bits. Go, subject to the S0 byte gate?
- **Q2 — first-read conversion.** A plain derivation whose pass reads a
  lane value for the first time: (a) the pass moves into the lane mid-pass
  (today; children created before the read are the frame's — no pin fails
  on it); (b) the pass is re-run in the discovered world (order-
  independent; one extra pass in a rare case; double construction on
  creation passes, so (a) would stay for `create`). Recommendation: (a),
  with (b) held in reserve if a pin surfaces.
- **Q3 — lane values stay in the slot until the parent lands** (28.4, last
  bullet) rather than committing into `_value` at the reveal. User-
  visible: nothing I can find — `display()` serves the same value. Internal:
  revert is a drop; the frame's own passes see the truth-world. Confirm the
  intent: _the screen is `display()`; `_value` is the truth._
- **Q4 — lane passes see this flush's unparked staging as committed**
  (28.5 (c)). This is §19's rule applied one tick earlier; it changes
  behaviour where a guess's derivation also reads a same-tick plain write
  (today: held with the frame, no display-ahead; proposed: `guess + old`
  now, `truth + new` at the commit). Lane contract 4 already pins the
  held-staging half. Confirm the same-tick half.
- **Q5 — ambition on verdicts.** Attempt the unification (28.8) in S2, or
  limit S2 to rewriting `verdictValue` on `display()` with the seams
  shared?

**Rulings (2026-10-02, 2:42 PM).** Q1 (a) — "since the screen is identical
I'd go with the more idiomatic approach"; the third place is lane-only (a
hold has screen and future; a prediction is shown-but-not-truth — a state
no transaction has), and the shown/held machine is the lane transaction's,
not the node's. Q2 (a); the maintainer read (b) "with more concern … this
example presents identically but probably has implications on other
things." Q3 (a) — "all async downstream of optimistic questions. This was
the change that really made things confusing for me … the reason for the
extra slot is that authoritative truth needs to be readable which gives a
distinct 3rd state. Optimistic overrides are intentionally not part of
authoritative truth because they are optimistic — we pretend the thing is
there; `until` has to be able to see what actually lands (even if it isn't
committed yet)." Q4 (a) — "if you are adding optimistic and it isn't the
one triggering async it should appear sooner. The 3 distinct states make
sense. I think I misunderstood when making that decision originally and
thought the optimistic was part of the async dep chain." Q5 (a) — "unifying
sounds good. Let's try."

**Build note.** S0 and S2 merge: `verdict.ts` is coupled to `lanes.ts`
internals (`verdictLane`, `laneRead`'s `plain`, `_verdict`, `_parked`) and
cannot be left half-adapted while the suite runs, and adapting its five
arms to the slot only to rewrite them is waste. The skeleton is both files
on `display()`; the S0 byte gate reads the floor (core changes only) and
`+ isPending/latest` (both files) separately.

### 28.14 What would stop it

The S0 byte gate failing; the A15 LANE trio not clearing with 28.5 (d) +
28.6 _and_ the link fallback (would mean the hold model needs the second
edge after all — report, do not improvise); or S2's unification costing
more than it removes (then the fallback, not a deeper rewrite).

### 28.15 Execution log

**Method (maintainer, 2:48 PM: "lets go").** Checkpoint the tree, carve the
layer the way the original carve-outs were done, rebuild it piece by piece
against the carved floor — "nothing survives by inertia", and every rebuilt
piece has its own byte count.

**Checkpoint** `143c530be` — the state at §27.2 (all of it had been
uncommitted: 66 files, HEAD was `next`'s tip). Reference for anything the
replay wants back (`staleAnswer`, `supersede`'s confirm/notify,
`observeFlight`, `heldNotFinal`).

**Carve.** The layer entered the graph at two imports — `signals.ts`
(`optimisticWrite`) and `core/index.ts` (`isPending`, `latest`) — now
`carved()` stubs (CARVE 5); `lanes.ts` and `verdict.ts` deleted; the core's
lane touch points are dead, gated code until S0 rewrites them. Suite
(`carved-tests.json`): **1612 passed**, 2872 carved, 274 failed. Of the 513
pins that left "passed": 303 are `[CARVED]`; 210 are the _halt cascade_ — a
`[CARVED]` throw inside a render effect halts the scheduler, and every later
test in that file fails (no global `resetErrorHalt` in the harness;
`action.test.ts` from its `latest()` pin at line 588 onward is the clear
case). Not a core regression; both return with the layer. Comparisons from
here: against `carved-tests.json` for core regressions, against `vs7` for
recovery.

**The layer's cost as built** (reds → carved, br): `+ isPending/latest`
9025 → **7250 (−1775)**; `page: live` 39519 → **37710 (−1809)**; `hydrating +
every store` 19606 → 18410 (−1196; it pulls `isPending`); floor 7202 → 7193
(−9); CSR 12677 → 12671 (−6). So lanes + verdicts + their core arms were
~1.8 KB br / ~6.3 KB min. The rebuild is measured against 7250 / 37710.

**S0 — the skeleton (lanes.ts + verdict.ts rebuilt on the slot), 2026-10-02
evening.** Built in one pass from 28.3–28.9, then driven against the pins.
Result: signals **2128 passed** (pre-replay 2125; +3), carved 2536, failed
94; **0 passed→not-passed against both baselines** (carved and `vs7`); web
888, solid 678, unchanged. Two of the fifteen family reds fell on the way
(#3409 — the correction round; #3698 held-lane — children of a lane pass).

_What the code taught the design_ — amendments to §28, each a rule, not a
patch:

1. **28.5 (d) corrected.** A leaf never moves by reading a lane that has
   not shown — it is a stale reader of a held lane (#3460), or waits on a
   never-shown flight (A15, #3334). A leaf reading a lane that **has shown**,
   or one the seam has **not judged yet**, is the lane's work: its run is the
   lane's (released if the lane shows, held if it blocks). Without this a
   frame leaf dirtied by a guess inside a parked flush had its run parked
   with the frame and display-ahead was gone (the first infinite loop was
   this: a shown guess in flight re-registering as a stale reader every
   seam).
2. **A lane is judged from its first round of passes.** Born at a seam it is
   neither shown nor held (`judged` snapshot taken before guesses apply);
   `_held` records the seam's verdict so a frame leaf can tell a held lane
   from a fresh one. Verdict lanes are judged like any lane (not born
   shown): an outsider mounting over a blocked verdict lane sees the
   committed frame (#3479).
3. **A pending pass is listed in its lane** (`laneStage` before the error
   gate), or the lane's own flight is nobody's.
4. **A stale reader that computed what it last applied owes no run**
   (`REACTIVE_SCREEN_READ`): effects have no comparator, and the old design
   hid the duplicate by converting every leaf into lane work.
5. **A guess whose own pass is the lane's work is judged by the lane**
   (`laneStage(…, errored)`): confirmed or corrected by a derivation of
   another guess (`config().courier` under a country guess), it is a
   derivation of the lane from then on, no longer a written guess — its fate
   the lane's. A pass with no answer (pending, errored, a pending
   propagation) leaves the guess. Everything else makes the 3-node checkout
   refetch from the wrong world.
6. **The body-end correction runs at the seam, before the park decision,
   with one more pure round** (`_laneCorrections` → `runHeap`): the guesses'
   own passes have run (a pre-heap judgment caught a guess whose source had
   just landed but not re-derived), and the correction's re-derivations are
   the parent's flights before the parent is judged — #3409 clears together
   (the hack of §27.2 was this done with the wrong tool). Every guess first
   takes its truth beneath (the base), then corrections run, so a
   correction's dissolution re-homes the others as held truths.
7. **A dissolving lane's runs are dropped, not handed to the parent** (they
   show the void guess); its **pending derivations are retired and re-asked
   from the truth** — their landing is the void world's answer, and an
   input's truth equal to its committed value notifies nobody (#3479
   "never finished preparing" showed `0:1`).
8. **Q4's form.** Lane work reads this flush's unparked staging _through_
   (one pass when the frame commits — the common case; a `<Show>` reading
   an unrelated plain signal is not re-created on every sync write); if the
   frame **parks**, the seam repairs the leak: those passes re-derive on the
   committed world next round and their lanes' runs wait that round
   (`_laneSeams(laneStagedReads)`). Same semantics as 28.5 (c), without the
   extra pass on the commit path. (The first form — committed + rerun — cost
   #3698's pin a `cleanup 3`.)
9. **`merge` resolves both ends** (a stale holder pointer closed a
   `resolveTx` cycle — the hang in the rapid-action pin); **the death of a
   pending node held by a lane schedules a seam** (`owner.ts`, as for a
   transaction's — #3426); **`updateIfNecessary`'s pull-without-recompute
   keep-list includes the pass-verdict flags** (`FRAME_READ`, `STAGED_READ`,
   `LANE_READ`, `SCREEN_READ`) — a verdict reader pulled by a sibling before
   the landing lost its re-derivation (the web banner pins, #3041). The
   keep-list predates the replay; the loss was latent.
10. **`laneValueOf`/`display` fall back to the committed value on an empty
    slot** (a user `equals` was handed the sentinel — `async-lane-landing-
equals-order`).

_Re-pins (2):_ oracle "superseded before its first commit" childrenForbidden
→ `NOT_READY` (A32 / A19 exc. 1: nothing committed; the `0` was the old
representation committing the superseded first landing — `serve` now throws
for a children-forbidden reader of an uninitialized node, the rule `read`
already applied to pending ones); `held-truth-lane-only` precondition
asserts `CONFIG_HELD` + `_pendingValue` instead of the removed bit, and its
OWNING-lane pin is "pinned by membership, not count" (the file's own words).

_Size (br), reds → S0:_ floor 7202 → **7222 (+20)**; CSR 12677 → 12701
(+24); `+ isPending/latest` 9025 → **9213 (+188)**; page live 39519 → 39758
(+239). The S0 gate (floor ≤ 7202) is missed by 20: the slot itself is ~12
B; the growth is seam machinery that landed in the core while driving the
pins — the correction round in `settle`, the `SCREEN_READ` gate, the
`updateIfNecessary` keep-list, `merge`'s resolves. The layer (+188) is
`verdict.ts` still carrying the old five-arm `verdictValue` and the watcher
seam, plus the rules above in `lanes.ts`. **S2's unification is the planned
consolidation** (28.8); the floor's 20 go with the hooks review there.
Recorded rather than forced: the gate's purpose was to catch the slot
costing more than the arms it removed, and it did not.

_Process notes._ One `git checkout` of a working file by mistake, restored
from the session's backup and re-applied edits (no loss); orphaned vitest
workers from a hung run (a `resolveTx` cycle) — the timeout wrapper now kills
the worker tree. Fresh baselines: `s0-final3-tests.json`, `s0-final3.json`.

**S1 — holds and seams, 2026-10-02 evening.** The lane-family reds, each
by a rule. Signals **2138 passed** (S0 2128; the §28.12 target was 2138),
**0 passed→not-passed** vs S0 and vs the carved core; web 888, solid 678.
The family is down to the two store/`affects` pins.

1. **A15 LANE trio (#3334) — no new edge, as 28.6 predicted.** `laneRead`
   for a render effect in the frame's seat: a lane node **pending with no
   shown value** (`_x._lane === NOT_PENDING`) is nothing to show — the leaf
   waits on it (NotReady in its own frame; `blockedBy` finds the on-screen
   pending leaf; the frame parks on the flight, never on the lane's parent).
   At the landing the leaf's own pass (its frame's flush, joined by the
   settle walk) reads the lane's **landed staging** — the answer it waited
   on, revealed at this very seam — not the screen. Both reveals of one
   flight land as one frame; the screen never pairs `show=true` with the
   pre-flight value.
2. **Zombie relevance (#3463) — the judged transaction.** `blocked(t)`
   records `judge` (the top-level transaction being judged; a lane consulted
   on its behalf judges for it): a zombie whose removal `judge` stages is
   moot for it alone; it blocks every other judgment — a lane's reveal
   included — while visible. `removalStagedBy` no longer walks a lane's
   parent chain. With it: a landed lane's **held runs are released at the
   parent's landing** (a lane blocked on its own judgment alone), and a
   zombie dirtied by its lane's re-staging (`REACTIVE_LANE_DIRTY`) **runs
   now**, not deferred to the seam — a lane shows ahead of any park.
3. **#3648 shape B — published inputs.** A derivation whose lane value is
   committed at a dissolve and which re-derives (every one of a correction's
   lane; a revert's dirtied ones) gets `CONFIG_INPUTS_PUBLISHED`: what it
   shows is the lane's answer beside inputs that are the truth now, so a
   fresh render reader observes its flight (joins) rather than reading the
   lane's value as the screen (#3651); an untracked read still serves it
   (A18 (d)).
4. **`on: () => latest(dep)` re-arm (#3540).** `flip` lists the boundary's
   output in the arming lane at once (`_laneStage`), so its swap pass is the
   lane's from the head — a re-pass of the transaction holding its pending
   content joined that transaction to the arming frame's (the merge that
   kept `data 1` behind the action). The `_initialized` re-home branch goes
   through `flip` too.
5. **V5/A17 — a stale reader of a flight holds it, lane work included.**
   `blockedBy` counts any sub with `REACTIVE_FRAME_READ` (not only verdict
   readers): a guess over a held window re-derived the frame's only observer
   as lane work and the window's transaction landed with its flight still
   up (#3494's "derives from the flight all the same", applied uniformly).
   A pre-existing red since §20.
6. **Tried and reverted:** "a guess confirmed at birth adopts the truth's
   derivations" (no re-derivation, one fetch) — it is wrong under §19: the
   truth's derivations are the transaction's world, the lane's are the
   screen's plus the guess (#3330 `v=1 d=0` tore at once). Two flights for
   one input when the worlds coincide is the price; `reveal-carve-out`
   re-pinned to resolve both.

_Re-pins (3):_ `body-end-supersession-visibility` to the lane rulings the
oracle's "body ended" row already carries (a never-shown guess is void at
the correction: display, stale re-run and verdicts say the truth; a fresh
derivation is held); `lane-outside-view` #3479 "boundary mounted mid-hold"
→ `3500: Late: 0 0 | Node: 0` (the mount's content reads `latest(source)` —
the explicit display-ahead read — and the lane's node: it is the verdict
lane's work like the pre-existing reader and reveals with each landing;
`next` had one landing reveal at two times); `reveal-carve-out` gates (6).

_Size (br), S0 → S1:_ floor 7222 → **7212 (−10)**; CSR 12701 → 12712;
`+ isPending/latest` 9213 → **9269 (+56)**; page live 39758 → 39825. The
layer's growth is the rules above (`laneRead`'s leaf arms, `judge`, the
dissolve flag); the floor fell (the `blockedBy` condition simplified). S2
consolidates.

**S2 — verdicts and consolidation (with S3/S4 folded in), 2026-10-02
night.** Signals 2138, web 888, solid 678, 0 passed→not-passed throughout.

_The unification, as far as it goes._ What is lane-like about a verdict
reader was already the lane's: `verdictLane(t)` is a lane (judged at the
seam like any — S0 amendment 2), its readers' runs go through the lane's
queues, their reruns through `_reruns`. What S2 merged: the **watchers**
(`verdictWatchers`/`verdictSeam`/`_verdictSeam`) into `stagedReaders` —
the list lane work already used for "I read this flush's staging as the
screen; if the frame parks, re-derive me" (S0 amendment 8) — a verdict
reader before the frame's verdict is the same reader (one skip kept: a
watcher a later read of the same pass routed into a verdict lane answered
for itself — one run, #3322/#3540); the four copies of the stale-reader
registration into one `staleReader(c, t)` (scheduler.ts) used by
`frameRead`, `stagedScreen`, `laneRead` and the verdict routes;
`observeFlight` as `verdictRead(c, t, rerun)`; the verdict HELD arm's
stale-reader sub-arm on the lane's seam verdict (`_held`) instead of a live
`blocked()` walk; the OVERRIDE arm's tail on `display()`. **What stays
apart, and why:** `verdictValue`'s arms are value semantics (A24, quiet
re-asks, A19 exc. 1, A28's unflushed staging, A10's `stagedScreen`), not
membership — a "lane leaf whose value is computed" still needs each of
them; collapsing the guess/derivation/held predicates into one needs a
`(GUESS || !latestActive)`-shaped exemption that would be cleverness, not a
rule. `verdict.js` 2477 → **2091 min** (−386).

_lanes.ts consolidation._ `dissolveLane` restructured by outcome (landing /
a guess of a dissolving lane / a corrected derivation) — with one rule
generalized: **every guess of a dissolving lane is re-homed with its truth**
(a landing held beneath it, else the value it covered), not only those with
a landing — which removed `laneCorrections`' pre-staging loop (the body-end
case was the general one). `judged` as a prefix count of `lanes` (nothing
dissolves a lane between `applyGuesses` and the seam loop now that
corrections run before it). `lanes.js` 3496 → **4212 min** (+716 over the
pre-replay file; its rules: the leaf arms, `_held`/`_shown`, the
correction round, the leak repair, the dissolve outcomes, `laneWrite` for
landings on lane derivations, `laneStage`'s leave rule moved from
`recompute`'s tail).

_S4 checks._ `arm`'s `verdictDerived` branch is still load-bearing (#3528
one-boundary: the `on` probe of a pending-not-held memo cannot be routed
before the frame has a transaction) — kept; the `_initialized` re-home goes
through `flip`. The `shown()` dedupe in the checkout arrays is still needed
(`latest` verdict re-derivations re-apply equal values; effects have no
comparator — by design) — kept.

_Size (br), reds → S2:_ floor 7202 → **7208 (+6)**; render+signal +18; CSR
12677 → 12721 (+44); `+ isPending/latest` 9025 → **9212 (+187)**; page base
+19; page live 39519 → 39740 (+221). Against the S0 gate (7202 / 9025):
the floor is 6 over, the layer 187 over. The 187 is the rules S0/S1
added, each with its pin (above); the consolidation recovered 57 of S1's
peak. Recorded as the cost of the rulings, not forced: §28.14's stop
condition was the slot costing more than the arms it removed, and it did
not — the slot is ~12 B; the arms it removed came back as rules the old
representation could not express.

_State._ The lane family is green except the two store/`affects` pins
(`createOptimistic` declared reload; `refresh-await`). Remaining failures
are the pre-existing families (attribution, rules-index, treeshake,
dist-artifacts, store/`affects`). Next: stores (with Gabriel's kanban
fixture), `affects()`, attribution on L2.

## 29. `affects()` on L2 (2026-10-02, night)

**Ruling (maintainer, 9:28 PM: "let's build as is").** The record was laid
out first: A24 (4) and the #2893 audit corollaries — a mark lights up
pending on the marked node and everything derived from it, for the
surrounding transaction's lifetime; **not a hold** ("a mark never blocks its
own transaction's settlement"), **not an entanglement tool** (corollary (b):
"transaction-inert — concurrent actions don't merge into the marker's
transaction through the pend"), **not optimism** (A24 (3): optimistic
writes are verdict-inert, marks verdict-only; complementary declarations on
separate channels). The maintainer's own instinct ("it just lights up
pending") matched; the "entanglement tool" variant was considered in the
original convergence and rejected. Built as ruled.

**Mechanism** (`src/affects.ts`, 60 lines of code; signals half only — the
store half, `affects(store)` / `affects(record, key)`, returns with the
stores by construction). A mark is a count on the node (`_x._marks`) listed
with its scope: the transaction's `_marks` (released at `land`, merged with
`merge`) or the ambient list (released at the seam, after the landings —
"verdict-only, nothing to show"). Coverage of derivations is **pull-derived
at probe time**, as on `next`: `isPending`'s read asks `GlobalQueue._marked`,
which walks the probed node's current dependencies for a marked one (the
validated prefix mid-recompute; a real error outranks an inherited mark —
A24 (c)); nothing is stored downstream, so a mid-window recompute strands
nothing. The push half is `repoll`: at registration and at the last
release, the verdict readers downstream of the node (through derivations,
stopping at effects) re-derive — the mark's one notification. Three hooks on
`GlobalQueue` (`_marked`, `_releaseMarks`, `_releaseAmbientMarks`), one
line in `verdictValue`, one in `land`, one in `settle`, one in `merge`.

**One rule the pins forced:** a marked probe inside a transaction's flush
(the declaring action's body) is **the flush's verdict lane's work**
(`verdictRead(c, flushTransaction)`), not a staging the frame parks — the
action's own flush parks every staging into its transaction, and a verdict
is display-ahead ("a late mark wakes an already-materialized derived
verdict": the `isPending` memo flipped to `true` in the body's flush and the
frame held it to the landing). Same rule as a held node's probe.

**Not rebuilt:** `next`'s "boundary visual channel" (`notifyMarkBoundaries`:
a mark notifying Loading boundaries as pending for reveal ordering) — no
retained pin needs it, and "a mark does not flip an initialized Loading
boundary to its fallback" passes without it; INV-10's count-balance dev
assertion (nothing else enforces it today; cheap to add later).

**Tests.** Signals **2156 passed** (S2 2138; +18 — every signal-half
`affects` pin: `affects-propagation` ×6, `affects-audit-2893` ×7,
`question-scoped-pending` ×3, `action-done-window`, `resolve-in-action`,
the `createOptimistic` declared reload), **0 passed→not-passed** vs S2 and
vs the carved core; web 888, solid 678. The remaining `affects` failures
are store targets (carved).

**Size.** `affects.js` is a module behind the two-import pattern: it
appears in no scenario (none calls `affects`); the core residue measured
+51 min / +41 br on the floor — three uninitialized `static` hook
declarations among them, which led to the finding below. **Found while
measuring: `GlobalQueue`'s 23 hook statics emitted as `static X;` under
`target: esnext` (define semantics), ~10 B min each on every bundle.**
Changed to `declare static` — type-only, no emit; the hooks are assigned
by the modules that install them exactly as before. Net, S2 → here (br):
floor 7208 → **7189 (−19; −173 min)**, hello world 9710 → **9688**, CSR
12721 → **12684**, `+ isPending/latest` 9212 → 9206, page base −5, page
live +15 (brotli; −113 min). Both the floor and hello world are now below
the pre-replay tree (7202 / 9692) and the floor below the carved one
(7193).

## 30. Attribution on L2 (2026-10-02, late night)

**Scope.** The attribution engine (`core/attribution.ts`, observe tier) was
kept intact through the carve and the replay; what the carve removed was
its _feed_ — the hooks the lane and verdict layers fired and the census the
engine took of a hold. This step re-feeds it from L2. Nothing about the
engine's records, findings, or thresholds changed; the web
`performance-tracks` consumer is unchanged and its three hold/fallback pins
pass again.

**The feed, hook by hook.**

- _Holds._ `holdStart(t)` fires at the seam when the frame parks (the
  transaction the frame's stagings went into); `holdEnd()` after the
  effects of the next flush that parked nothing; `transitionSettled(t)` in
  `land`, before the reruns; `transitionMerged(from, into)` in `merge`.
  `Transition` is `Transaction` (type alias in `attribution-hooks.ts`).
- _The hold census_ (`censusHold`): the hold's nodes are `t._nodes`; its
  action is `t._open > 0`; its **blockers** are `blockersOf(t)` (scheduler,
  observe-only export): the pending non-effect nodes of the transaction
  that `blockedBy` still finds blocking — the reporter effect itself is not
  a blocker (it was listed as one in the first cut, as `view`/`page`).
  **Acknowledgements:** `optimistic` from `_laneGuesses(t)` (lanes.ts,
  observe-only hook: the written guesses of the lanes under `t`);
  `affects` from `t._marks`; `isPending`/`latest` from the verdict readers
  downstream of the hold's nodes — a pass that entered a window is
  `CONFIG_VERDICT`, and the observe tier notes _which_ window on the pass
  (`_devWindows`, bit 1 `isPending`, bit 2 `latest`; set in
  `markVerdictReader`, cleared at the top of each recompute). The reader
  credited is the sub itself when it is an effect, else the first effect it
  reaches. `isCompanion` (a node that is a lane pass's result, never a
  write anyone made — not an acknowledgement) is `CONFIG_OVERRIDE` without
  `CONFIG_GUESS`.
- _Optimistic reverts._ `optimisticReverted(node, shown, truth, how)` fires
  from `supersede` when a **shown** guess is replaced by a differing truth
  (`l._shown` — a guess the screen never showed reverts silently, as
  before), and from `dissolveLane`'s landing branch for a guess re-homed
  with a truth that differs from the slot. `how` is `"superseded"` when a
  landing displaces the guess and `"reverted"` when the correction round
  found nothing beneath it (the value it covered comes back). The label is
  observe-only state in lanes.ts (`reverting`, set around the correction
  round's `supersede`) — passing it as a parameter leaked ~46 min B into
  `lanes.js` for every lane consumer; moved off the signature.
- _Fallbacks._ `boundaryFallback(b, tree, shown, transition)` fires from
  `boundaries.ts`: on the swap to the fallback (with the transaction the
  swap lands with — the frame's `flushTransaction`, the pass's `passTx`,
  or `null` for lane work and no transaction) and on the swap back. A
  mount's synchronous first show has no drain of its own, and the engine's
  display instant for a show is the next `flushEnd` — one is scheduled
  (`schedule()` when nothing is running) so the record exists to close. The
  three fallback pins (`timeline` "one record per showing",
  `feedback` "how long each fallback showed, and counts flashes",
  `findings` FALLBACK_FLASH) were all this one missing drain.
- _Run posture._ `recomputeEnd(el, create, changed, optimistic, transition,
held)`: `optimistic` is `lane !== null` (the pass ran as lane work —
  overlay, never waste), `transition` is "the pass ran under a hold"
  (`flushTransaction`/`passTx` set, or the node `CONFIG_HELD`), `held` is a
  staged value as before.

**Re-pins (tests whose shape, not expectation, L2 changed) — flagged:**

- `attribution.test.ts` "tags optimistic runs with their phase": the guess
  is written in an action's hold (lane contract 2: a guess in a frame that
  does not park is as if it never happened — its effect runs are plain).
- `settle-walk-invariant.test.ts` ×2: the fake node's derived-override
  shape is `CONFIG_OVERRIDE` + `_x._lane` (was `CONFIG_DERIVED_OVERRIDE` +
  `_overrideValue`). **Found by it:** the `SETTLE_WALK_UNINITIALIZED_SOURCE`
  tripwire (dev) had no L2 exclusion for a lane derivation's first landing
  (sits in the slot until the lane shows) — added, `__DEV__` only.
- `untracked-read-after-await.test.ts` "names the source, not a bare
  shadow, for a latest() read": expects `a` (was `latest(a)`). L2's
  `latest` is a window over the read, not a shadow node — the diagnostic
  names the source itself; the pin's concern (a bare `computed`) cannot
  arise. A dev-only decoration to `latest(a)` would need a core↔verdict
  glue export; not worth it.
- `treeshake.test.ts` ×3 + two exclusion lists: `core/optimistic.ts` →
  `core/lanes.ts` (the verdict → engine coupling is now `verdictLane` /
  `display` / `laneValueOf` from lanes.ts — asserted positively as before).
- `createMemo.test.ts` "resolveAsync" and `async-chain-supersession` #3374
  ×3: `PRIMITIVE_IN_EFFECT_CALLBACK` shapes missed by the first sweep (they
  were in the "pass alone" bucket then — the files halted earlier). `resolve`
  is now called from the owning scope; the `<Show keyed>` remount is the
  compiled shape (`remount(key, children)`: the flow effect's compute owns
  the child). Expectations unchanged; all pass.
- `scheduler-livelock.test.ts`: `zombieQueue` import dropped (one heap on
  this tree, T10); the dirty-queue flag check and the remount livelock check
  stand.

**Tests.** Signals **2219 passed** (`affects` commit 2156; +63: attribution
×44, the re-pins above, and the fallback/perf families), **0
passed→not-passed** vs the `affects` commit and vs the carved core; web
**891** (+3: the three `performance-tracks` hold/fallback pins); solid 678.
Remaining non-carved signal failures: **6** — `rules-index` ×3 (src cites
plan sections §19/§28; resolves when the rulings move to the spec at PR
time), `dist-artifacts` observe-literals (`slotSignal`, a store-leaf
constructor — returns with stores), `refresh-await` (store),
`createStore` "Select Promise" (store). The non-store signal story is
otherwise green.

**Size (br / min).** Prod tiers unchanged except `+ isPending/latest`
9206 → 9209 (+3 br / +1 min: `markVerdictReader(1|2)`'s argument). Observe
tiers carry the feed: CSR observe 14235 → 14249 (+14 / +67), CSR observe +
attribution 28084 → 28470 (+386 / +1226) — against `next`'s 16421 / 30654.
Floor 7189, hello world 9688, CSR 12684, hydrating 17510, page base 36194,
page live 39737 (−18 br vs §29 — brotli noise on an identical-logic
`lanes.js`).

## 31. Stores on L2 — T0: inventory, design, questions (2026-10-03, night)

Maintainer: "stores are a large tricky one. Any plan on how to approach
it?" → plan laid out → "start". This section is the T0 deliverable: no code.
Sources read: `next`'s `store/` (dumped to `/tmp/carve/store-next/`),
`docs/INTERNALS-STORE-STATE.md` (the rewrite's own design + rulings),
`SPEC` A9/A22/A25, `target.ts`'s load-bearing notes, the carved corpus.

### 31.1 Inventory

**Code on `next`** (lines): `store/next/store.ts` 3118, `optimistic.ts`
827, `reconcile.ts` 439, `projection.ts` 310, `target.ts` 229;
`store/utils.ts` 1185 (`merge`/`omit`/views/source dispatch),
`storePath.ts` 232, `store.ts` 476 (types + legacy shallow dispatcher),
`index.ts` 98. ~6,900 lines.

**Size on `next`** (br): `+ createStore` 16848 vs floor 9508 = **+7340**;
`hydrating + every store family` 30789 vs hydrating 19663 = **+11126**;
page live's store share **≈ 8.4 kB** (the carve's Δ). Core carried ≈ 300
br / 1036 min for the store (1b) — already gone and not coming back as
slots unless a Q below says so.

**Carved corpus** (2534 tests in `/tmp/carve/attr4-tests.json`, by API):
`createStore` 1383, `createOptimisticStore` 986, `createProjection` 99,
`merge` 46, `omit` 18, `isStatic` 2. By family: `tests/store/*` 1489
(`optimistic-list-mutation-matrix` 899 alone), oracle/posture matrices 785
(`visibility-oracle-posture` 629, `visibility-oracle-store` 153), store
under holds / lane twins ≈ 200 (`adoption-unchanged-key-read-3706` 17,
`createProjection.draft-lifetime-3585` 17, `strict-read-pending-store`,
`held-truth-lane-only`, `late-pending-equality`, `latest-held-till-flush`,
`owned-scope-write-guard`, `question-scoped-pending` 32, …), attribution 11. Web: 177 carved (spread runtime → `viewOf`/`hasStaticKeys`/
`resolvedTable`/`merge`/`omit` ≈ 120; store fixtures ≈ 57). Web/solid
runtime imports, by count: `snapshot` 58, `merge` 41, `omit` 24,
`createStore` 18, `createProjection` 17, `reconcile` 16,
`createOptimisticStore` 12, `viewOf` 9, source dispatch (`sourceHas/
Keys/Get`) 19, `isWrappable` 7, `deep` 6, `resolvedTable` 5, `isStatic` 5,
`hasStaticKeys` 4, `storeIsShallow`/`storeHasFamily`/
`storeHasOptimisticFamily`/`storePath` 1 each.

### 31.2 What `next`'s store carries that L2 now owns

The rewrite's design doc is explicit about the intent (§1: "a real core
signal. Carries: subscriptions, and pending lane values (transition +
optimistic) via the same core machinery signals already use. **No
store-side override maps, no backup snapshots, no separate transactional
subsystem**"; O6 left open whether the node's slot mirrors committed
state). What shipped drifted from that, because the core it sat on could
not express a hold at the container level — so the store grew its own
copy of the hold model, in store vocabulary. Per target (`target.ts`):

| store-side state on `next`                                                                                                 | what it is                                                                        | on L2 it is                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `pb` (pending backing, overlay or clone)                                                                                   | the container's staging                                                           | a container node's `_pendingValue` (Q-A)                                                                                        |
| `hv` / `ht` (held committed view + holder)                                                                                 | screen vs staging under a hold                                                    | the container node's `_value` while its staging is parked — nothing extra                                                       |
| `ab` (adoption diff base)                                                                                                  | "the view the nodes were last told"                                               | the container node's `_value` (the diff base is the committed frame)                                                            |
| `foldOlds` / `foldBatches` / `drainFolds` polling node `_pendingValue` to learn when the hold settled                      | a second commit protocol                                                          | `land(t)` commits the container node like any node; `park` holds it                                                             |
| `heldFoldTransition` / `heldAdoptionTransition` / `stageHeldKey` (born-holding keys)                                       | a leaf created mid-hold learns both frames                                        | `getNode` reads committed from `_value` of the container, staged from `_pendingValue` — born-held is A29, already core          |
| `heldKeys` / `adoptionChangedKeys` (#3706: the hold's unit is the key)                                                     | which keys the adoption changed                                                   | the diff that emits node writes only touches changed keys — by construction                                                     |
| optimistic `overlaid` / `rt` (retaining transactions) / `ft` (flight-owned transaction) / `stagedTruthPB` / `heldMaskView` | "a landing under a guess stages beneath it", lane membership, who owns the flight | `supersede`'s unchanged branch / `laneOutcome` (A18), `txOf(node)`, `ownFlights` — all core                                     |
| `CONFIG_HELD_TRUTH`, `_overrideValue` arming (`fam.opt` → every node armed)                                                | the write channel chosen per node                                                 | chosen per **write** by the setter (`optimisticWrite` vs `setSignal`) — as `createOptimistic` already does on L2; no arming bit |
| `transitionHoldsOptimism` / `installNextBlockedHalf` (store half of `blocked`)                                             | store-aware settle gate                                                           | `blocked(t)` over nodes — the container node is a node                                                                          |
| `_firewall` on leaves + `_firewall \|\| el` in `read()`                                                                    | a leaf reads its projection's status/height/error                                 | **Q-B**                                                                                                                         |

What stays store-owned because it is the _membership dimension_ signals do
not have (R2): the proxy traps, the raw/owned backing graph and CoW path
copying, lazy node tables (`n`, `h`, `k`, `dk`), the key-set/presence/deep
witness nodes, `wk` (written-keys bound), the accessor scan (`a`/`sc`),
the overlay-vs-clone choice (`ovl`, thresholds), chained backings (§7b),
reconcile's keyed diff, and the **function-of-truth replay** of retained
optimistic setters (RUL-2 as re-ruled 2026-08-31b — a maintainer ruling
with a lot of weight; the replay stays a _semantic_, its representation
becomes lane membership).

### 31.3 Design (candidate — the Qs below decide it)

**A store is a tree of L2 nodes; nothing else carries reactive state.**

- _Leaf node per tracked-or-written key_ (lazy, as today): `_value` =
  committed, `_pendingValue` = this frame's staging, `_x._lane` = lane
  value. One literal (`slotSignal` returns: `_host`/`_key` back-refs,
  equals baked, no options object, no `_x` at birth — the create-floor
  diet; `dist-artifacts` pins the literal).
- _Container node per touched container_ (new; lazy — created by the
  first write that has no leaf to stage on, or the first structural
  subscription): `_value` = the committed backing object, `_pendingValue`
  = the pending backing (overlay or clone, the existing choice logic),
  `_x._lane` = the optimistic overlay object. It **is** today's key-set
  node `k` with a value: `ownKeys`/iteration/`$TRACK`/`length` subscribe
  to it; its commit swaps/flattens the backing; its park holds the
  backing. Unsubscribed keys written under a hold stage _here_. The
  hold's unit stays the key for _leaf_ readers (#3706: a leaf's own frames)
  and the container for keyless readers — exactly §3's rule, with no
  `heldKeys` bookkeeping.
- _Presence nodes_ `h` and the _deep witness_ `dk`: unchanged in role;
  structural optimism = guesses on presence nodes + the container node
  (§6, FINDING-2 by construction).
- _Writes_: the draft mutates the pending backing natively (today's
  O(written) path); setter exit emits node writes for written keys with
  leaves (`notifyWrites`, `wk`-bounded) and **one** write to the container
  node (its staging = the pending backing). Channel per write: a plain
  store's setter → `setSignal`; an optimistic store's setter →
  `optimisticWrite`; a projection's landing → `setSignal` under the
  derive's pass (lane work if the derive runs in a lane). Commit = the
  scheduler's `land`/`commitPendingNode`; the store's only commit work is
  the backing flatten / path copy, run from the container node's commit
  (a `_host` hook, or `CONFIG_PLUMBING`-style dispatch — size to be
  measured).
- _Adoption_ (`reconcile`, setter replacement, projection landing): a diff
  of incoming vs the container node's **committed** `_value`, emitting leaf
  writes for changed subscribed keys and staging the incoming object on the
  container node. Under a hold the staging parks; a leaf first read during
  the hold is born held from the two frames (A29). Lane view composition
  (§6b) = `display(container)` + `display(leaf)`.
- _Projections_: a computed whose pass writes the store through the draft
  (today's `runProjectionComputedNext` shape, R37 one-draft-per-run,
  A25 seed = draft). Its nodes' status: Q-B.
- _Optimistic stores_: an optimistic projection; nodes are plain L2 nodes;
  the setter chooses `optimisticWrite`; a landing is `laneWrite`/`supersede`
  on the leaf, the container's landing a lane-aware adoption (R28/R29:
  arrangement from the lane view, entity identity from committed). Retained
  setters `[t, fn]` live on the family and replay as ruled; `rt`/`ft` are
  replaced by `txOf`/`ownFlights` of the family's nodes.
- _Utilities_ (`merge`/`omit`/views/source dispatch, `storePath`,
  `snapshot`/`deep`): independent of the above; `snapshot` reads
  `display(container)`/pending explicitly (R27), zero-copy when settled.

**Expected to disappear:** `pb`-lifetime polling, `hv`/`ht`, `ab`,
`foldBatches`, `heldKeys`, `stageHeldKey`, `heldMaskView`,
`stagedTruthPB`, `rt`/`ft`, the blocked store-half, `CONFIG_HELD_TRUTH`,
per-node arming, `projectionWriteActive` as a global (the pass's lane says
it). **Expected to stay:** everything in the R2 list above.

### 31.4 Performance contracts (not re-derivable from tests)

From `target.ts` and INTERNALS §5/§5b — treated as **contracts** unless
ruled otherwise (Q-E):

1. **Lazy nodes.** No permanent node from proxy creation, untracked reads,
   or observer-less writes; teardown ∝ tracked surface. (The container
   node is created by a write or a structural subscription, never by a
   read — R1: node existence unobservable.)
2. **One literal per leaf** (`slotSignal`): no options object, no `_x`,
   no post-construction expandos; accessor-ness resolved once.
3. **O(written) per setter**: the written-keys bound `wk` decides notify
   and commit work; fallbacks (`WK_ALL` on length writes, accessors,
   non-plain prototypes) stay.
4. **Overlay drafts** (`Object.create(v)`) for plain-data containers;
   clone otherwise; the `OVERLAY_MIN_KEYS` / rebuild thresholds are
   tunables, the mechanism is a contract (#3044: O(written) per flush).
5. **Array targets: no new named fields.** V8 dictionary-mode flip at
   named-field counts ≡ 0 mod 3 from 18 (uibench −15%). A container node
   is one pointer on the target (`k` already exists) — net zero fields.
6. **Zero allocations for adopted-but-unread objects**; one target + one
   proxy + one lookup entry per read-through object; `$OWNER` stamp
   instead of two weak-collection registrations per draft (#3360).
7. **Shallow stores** exist only for performance (O4: "if I could retire
   it I would") — a retirement candidate, not a port target (Q-F).
8. **Benchmarks** (`~/Development/octane-dbmon-local`,
   `~/Development/solid-uibench`, CodSpeed) only when asked (standing
   constraint); the perf gate is at the end state.

### 31.5 Phases and gates

Same discipline as §28: carve stays; each step measured on the full
matrix vs the carved core and the previous step (0 passed→not-passed),
web/solid, the size suite; re-pins flagged individually; a Q-list ruled
before each step that needs one.

| step    | scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | gate                                                                                                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T0**  | this section; rulings on Q-A…Q-G                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | rulings                                                                                                                                                                       |
| **S-U** | `utils.ts` back: `merge`/`omit`/views/source dispatch/`isWrappable`/`isStatic`/`resolvedTable`/`hasStaticKeys`, with the proxy branch targeting the store's trap contract (stubbed until S1); `storePath`                                                                                                                                                                                                                                                                                                                    | web ≈ 1,010 (+120); floor +0; own module line                                                                                                                                 |
| **S1**  | plain store, sync: target + traps + lazy leaf/presence/container/deep nodes; `slotSignal`; draft/setter; CoW path copy; overlay/clone; `snapshot`/`deep`; `$TRACK` back in `mapArray`; `createStore` sync pins + `optimistic-list-mutation-matrix`'s plain rows                                                                                                                                                                                                                                                              | `+ createStore` **≤ floor + 4.0 kB br** (next: +7.3); `createStore.test` / `overlay` / `write-floor` / `native-collections` / `enumerator-presence-nodes` / `storePath` green |
| **S2**  | stores under holds: setter writes in actions; container staging; adoption as diff + container staging; born-held leaves; `latest`/`isPending` on leaves; **Gabriel's fixture** (plain truth + optimistic shadow on one leaf in an action; a new reader mid-action shows now, joins nothing — A17) as the first new pin; `adoption-unchanged-key-read-3706`, `store-unchanged-read-independent-write-3688`, `held-derivation-3612`, `latest-held-till-flush`, `owned-scope-write-guard`, `visibility-oracle-store` plain rows | 0 regressions; A17 fixture; no store-side hold state                                                                                                                          |
| **S3**  | projections / derived stores: `createProjection`, `createStore(fn, seed)`, `reconcile` (the adoption channel), draft lifetime (R37, #3585), A25 seed gate, chained backings (§7b), the `read()` firewall seam resolved per Q-B; `createProjection*`, `reconcile*`, `projection-*`, `fold-*`, `late-pending-equality`, `loading-value`, `strict-read-pending-store`                                                                                                                                                           | firewall either returns as one bit or does not return; `reconcile`/`projection` shed from plain bundles stays as ruled (API symmetry — they do not)                           |
| **S4**  | `createOptimisticStore`: lanes on nodes; structural optimism on presence/container; retained-setter replay (RUL-2 re-ruling); `optimistic-list-mutation-matrix` optimistic rows (336), `visibility-oracle-posture` (629), `question-scoped-pending`, lane twins; web F1/3706 fixtures                                                                                                                                                                                                                                        | optimistic module sheds from plain-store bundles; `every store family` **≤ hydrating + 7 kB br** (next: +11.1)                                                                |
| **S5**  | store half of `affects`; store attribution (path names, `storeOwners`); `dist-artifacts` literal pin; `shallow` decision executed (Q-F); web/solid store fixtures; **PR #3761 assessed** against the built thing; final matrix vs `next`                                                                                                                                                                                                                                                                                     | page live target; perf gate request                                                                                                                                           |

**Risk, named.** S2 is the bet: if container-node staging cannot express
adoption diffs and held views at `next`'s perf, the fallback is `next`'s
per-target `pb` with its _lifetime_ derived from the hold model (the
container node still exists, but holds the backing by reference rather
than being the staging). Two representations again — better than today,
but seams. Find out in S2 with S1's ~1,400 pins green, not in S4.

### 31.6 Questions for the maintainer (T0)

- **Q-A — The container node.** (a) _Recommended:_ the pending backing
  **is** the container node's `_pendingValue` (one representation; the
  hold model parks/commits/dissolves it; `hv`/`ht`/`ab`/fold polling go).
  Cost: one node per _touched_ container (reuses `k`'s pointer — no new
  target field); the backing flatten runs from the node's commit.
  (b) Keep `pb` as store staging with its lifetime bound to the
  transaction via the container node holding it (fallback above).
- **Q-B — Projection status on leaves.** `read()`'s last store seam
  (`_firewall || el`): a leaf's pending/error/height came from its
  projection computed. (a) _Recommended:_ status lives on the **leaf**
  (and the container node): a derive's pass that pends marks the nodes it
  would write — the store's traps gate on the container node's status
  (§6c's "one field on the root target" becomes that node's
  `_statusFlags`); `isPending(leaf)` reports the derive's new-question
  refetch (A9) because the leaf is `_pendingSources`-linked to the derive,
  as any node downstream of an async memo is. No core slot. (b) Bring back
  `_firewall` as a leaf field + the `||` in `read()` (≈ 60 br on the
  floor, every read pays a load).
- **Q-C — Draft visibility under a hold.** A setter running inside an
  action reads its own transaction's staging (A25's write-visibility
  corollary; RUL-1 "drafts read pending explicitly"). _Recommended:_ keep
  — the draft reads `display`-of-staging for its own transaction, the
  screen for a foreign one (A17: a reader of an overridden leaf never joins
  the hold on the base). Gabriel's fixture pins the foreign half.
- **Q-D — Optimistic landing semantics.** (a) _Recommended:_ keep the
  RUL-2 re-ruling verbatim (equal landing holds; contradicting
  continuation rebases via retained-setter replay; contradicting
  replacement consumes and drops) — the representation changes (lane
  membership instead of `rt`/`ft`), the ruling does not. (b) Simplify to
  "a landing on a guess stages beneath it" only (A18) and drop structural
  replay — fewer bytes, but overturns a ruling with 899 matrix pins.
- **Q-E — Perf contracts.** Confirm the eight in §31.4 as contracts
  (thresholds tunable), and that benchmarks run only when asked, at S1
  end (create/commit floor) and S5 (end state).
- **Q-F — Shallow stores.** (a) _Recommended per O4:_ do not port the
  legacy shallow implementation; `createStore(v, { shallow })` becomes a
  flag on the same target (`s`, values served raw — as `next`'s rewrite
  already does: `storeIsShallow` is one field), and the dbmon shallow
  column is the retirement bar at S5. (b) Port legacy shallow as is.
- **Q-G — Order.** `utils.ts` first (S-U) — independent, unblocks ~120 web
  pins and the spread runtime. Confirm, or start at S1.

### 31.7 Rulings (maintainer, 2026-10-03, 1:13–2:20 AM) — amend §31.3–31.6

Talked through one by one. Where a ruling corrects T0's text, the
correction is stated here and §31.3/§31.5 are read as amended.

**Why firewalls exist (maintainer).** "Projections exist so writes to
signals in a pure computation are safe. … It is important that before
reading any value within, the parent computation is up to date, without
making it a hard dependency of the reader." And: "firewall being
projection-only makes sense" — a generic pure-signals firewall API (Milo /
R3) never became ergonomic and had no use case outside projections; the
perf-critical shapes (`mapArray`) are made safe by construction instead.
**Pinned as the invariant:** every read served _through_ a projection
first brings the derive up to date — **pull, don't link.**

**Q-A — container node: (a), ruled**, with the benchmark as the gate
("we go with it for A but we need to benchmark this carefully up front").
Clarifications recorded during the discussion: it _is_ the `$TRACK`
(key-set) node given a value; arrays are where both its roles (structural
notification, tear-free `length`) matter, objects mostly the staging role
(un-noded keys under a hold, adoption, optimistic key add/delete); **at
creation it adds nothing** (lazy, replaces `k`); at write time it replaces
the per-batch side tables (`foldOlds`, `foldBatches`, `heldKeys`, `hv`
clones, `ab`, `tentativePBs`, `stagedTruthPB`) with one slot; the one new
allocation is a node for a written container no read asked for — created
once per container, persistent, measured at S1 (escape hatch: materialize
only when a hold is live or a subscriber exists). The draft overlay stays
(RUL-1 parity: context-free reads see committed until flush); direct
write-through into an owned backing for plain sync writes would remove it
at the price of that parity — **a ruling, listed, not taken.**
**jsfb's selection pattern** (a record keyed by id; each row reads
`selection[id]` — n 1:1 subscriptions, no `selected` on the row model, no
1→n fan-out; the live key set slides as ids grow) was walked through:
absent-key reads make leaves (R1), writes are O(written) via `wk` with the
overlay (never the clone) for large records, deleted keys behave as
signals, and **release on unmount is non-negotiable** (below).
_Benchmark plan:_ two-arm A/B with the existing harnesses
(`octane-dbmon-local/ab-dbmon.mjs` builds `iso-dbmon-deep` + `-shallow`
per Solid root and alternates rounds; `iso-jfb-deep`/`-shallow`/`-signal`;
`solid-uibench` headless two-arm) — arm A = `next` @ 309b08730, arm B =
this branch after S1; **both shapes for every scenario** ("shallow might
overshadow it anyway? We'd need to compare both versions for each");
creation first. **No third arm** (maintainer, 2:26 AM: "don't need a
`next` port if we still have octane / vue-vapor to test against —
comparatively it only needs to be approximate; we are competing with them
as much as ourselves"): the references are **vue-vapor and octane-tsrx**
(the harness's same-machine references; "we recorded comparative numbers
geomean previously"), `next` is the second column, and approximate
attribution is enough. _Metric, as recorded before:_ `run.mjs`'s per-op
ratio vs vue-vapor, and `analyze-iso.mjs`'s per-scenario **geomean** vs a
baseline under the no-default-regression rule (12 % noise band).
_Reference points on record:_ 2026-08-17 shipped rebaseline
(`baselines/`), dbmon vs vue-vapor — octane-tsrx 1.07× mount / 1.22× tick;
`solid-next` **3.61× mount / 5.15× tick** / 1.95× tick_partial / 2.52×
remount / 1.64× sort / 3.68× unmount; `solid-shallow` 1.54× / 0.97× / 0.70×
/ 1.20× / 0.90× / 2.70×; diff-skip ratio (tick_partial ÷ tick) next 0.162
vs vue-vapor 0.430 — the fine-grained strength in numbers, the thing not to
lose. 2026-09-15 `results-iso/a28ab-next-r3`: dbmon-deep mount 19.6 ms /
tick 9.2 vs shallow 8.2 / 1.9 (2.44× / 4.33×). **The bar for S1/S4:**
deep's mount and tick vs vue-vapor/octane close from there, diff-skip
held. **Order of benchmarking (maintainer, 2:32 AM): signals first** —
"that is at the core of everything; if signals are slow this will be too"
— then stores; **not overnight**: "focus on building over benchmarks …
we don't have the new version to compare against yet. Build it out now;
we benchmark starting with signals later." Runs only when asked.

**Q-B — firewall link: (a), ruled** — and T0's (a) was underspecified:
status was never the hard part; **height ordering and the freshness pull**
are. Corrected mechanism: the firewall is `fam.node`, reached target →
family at the **trap**; before serving _any_ read through that target
(tracked, untracked, `in`, enumeration, `length`) the trap does
`updateIfNecessary(fam.node)` (freshness), throws the derive's status
(uninitialized/pending/errored), bumps the reader's height past the derive
(scheduling), and links **only the leaf**. No `_firewall` on the leaf
literal (14 fields, was 15), no `||` in core `read()`, no firewall child
chain (`_child`/`_nextChild`/`_prevChild`, `CONFIG_FW_CHILDREN`) — the
family enumerates live leaves through its targets' `n` tables for pending
propagation (A9), and a released leaf is gone from the only index that
knew it, so the #3351/#3503 retention class cannot recur. The owned-scope
write exemption is `ownedWrite` on the literal + the user guard at the
setter — `mapArray`'s pattern. Chained backings compose (inner trap does
the inner pull). S3 audits for any path that reads a projection leaf
without the trap (attribution naming, the `affects` resolver).
**One core seam returns, flagged now:** the slot-node dispatch at the
last-one-out site (`CONFIG_SLOT_NODE` bit test → store hook) — a leaf has
`_x: null` by design and cannot carry `_unobserved`; without the dispatch
jsfb leaks one node per row ever rendered. Tens of bytes on the floor; the
only core slot stores get back. The container node follows the same
release rule (deferred while it holds staging or a lane value; released at
its commit if still unobserved — `next`'s `deferSlotRelease`).

**Q-C — draft visibility: ruled as proposed.** A setter's draft reads its
own transaction's staging (A25 corollary, RUL-1); a foreign transaction's
staging is the screen (A17). Gabriel's kanban fixture pins the foreign
half.

**Q-D — optimistic landing: identity through the landing is the
contract; replay decided on evidence.** Maintainer: "ultimately the value
of optimistic stores is reference stability when backend data changes. An
optimistic new item that matches the server returning a new object with
the same id in the same position means we don't run `For` again. We
reconcile the truth against the optimistic projected override on
landing." On L2 that is one rule applied per node — _a landing on a guess
stages beneath it and confirms it when equal (A18/A24)_: the array
container's guess (the optimistic arrangement in `_x._lane`) is confirmed
by the derive's rows when keys and positions match (RUL-2's key-set
predicate) → silent, `For` stays; the key-matched row target adopts the
server object as its backing behind the same proxy; row leaves write only
where values differ. A contradicting landing is `supersede` on the
container — truth replaces the arrangement, equality-gated. Diff baseline
for key matching is the lane view (R28). **Retained-setter replay (the
2026-08-31b continuation-rebase half) is built _after_ the matrix says
which rows need it:** S4 ships the table above without replay, runs
`optimistic-list-mutation-matrix` (899), and the maintainer rules on the
failing rows.

**Q-E — perf contracts: defaults kept unless a measurement says
otherwise** (the maintainer did not want to rule blind). Lazy nodes; the
sweep bit; O(written) via `wk`; overlay drafts for large records;
**reachability-pruned diffs (§6d — "our reconcile focuses on only diffing
the listened path and not every cell")**; zero-allocation adoption for
unread subtrees. Thresholds tunable. The S1/S4 benchmarks are the ruling;
none changes on size grounds alone.

**Q-F — deep is the design center; §31's premise inverted.** Maintainer:
"keyed `For` by id is very not us. Even if shallow is winning benchmarks I
want to endeavor to do better. Most benchmarks are these immutable data
swaps which favor the shallow pattern, but fine-grained updates favor our
typical non-shallow approach." Recorded: (1) deep primary; shallow stays
as the flag on the same target (values served raw — `next`'s `s`), no
legacy port, **no retirement bar either way**; default and docs unchanged.
(2) Plain `reconcile` keeps its character — reference-skip on unowned
equal pairs, key matching, reachability-pruned descent, leaf writes only
for listened changed cells; the R28/R29 split is S4's. (3) "Do better" has
a target: **deep's cost on the immutable-swap shape** — (a) wrap-on-read
per rendered row (the creation hit: target literal, per-row lookup entry —
`$OWNER` covers owned objects, user objects still pay the WeakMap, O8's
cached-wrapper slot is the candidate — and proxy creation) and (b) the
adoption walk, already O(listened). The deep-vs-shallow gap on jfb
create/append in the S1 A/B is the number to shrink.

**Q-G — flexible**; order settles as the work does. Default reading: S1
first (critical path; earliest benchmark evidence), S-U at the first
natural pause.

## 32. Stores on L2 — S1: plain stores (2026-10-03, 2:34–3:30 AM)

Built per §31.3 as ruled in §31.7. `src/store/` is new (`types.ts` —
symbols, options, `isWrappable`, raw marking, write override; `target.ts`
— the target shape, `$OWNER`, lookup, descendants flag; `store.ts` — the
module; `storePath.ts` verbatim; `index.ts`). Ported function by function
from `next`'s `store/next/store.ts` with the hold, optimistic, projection,
chained-backing and affects paths left out (they return on S2–S5 on the
new representation), and the container node put in.

**Core (the two seams §31.7 named, and nothing else).**

- `slotSignal(v, equals, host, key, acc)` — the one-literal slot node
  (`CONFIG_SLOT_NODE | CONFIG_OWNED_WRITE`; `_host`/`_key` back-refs, the
  wrap cache `px`/`pxv`, `acc`; 14 fields prod, 16 observe — `_name` and
  `_owner` are slots, so the attribution stamp is never a write after).
  Used for leaves, presence nodes, the container node and the deep witness
  — one shape, no closures, no `_x` at birth.
- The last-one-out dispatch in `unlinkSubs` (`CONFIG_SLOT_NODE` →
  `slotUnobservedHook`, a live binding in graph.ts the store installs) and
  `GlobalQueue._storeCommit?.()` after `commitPendingNodes()`. `stagedRead`
  and `ownedScopeWriteMessage` exported. `CONFIG_SLOT_NODE = 1 << 12`.
- `mapArray` reads `$TRACK` again (a store array's container node).
- Found by the dist-artifacts literal pin while here: the attribution
  step's `_devWindows` was a post-construction write on every computed in
  the observe tier — now a slot in the computed/effect observe literals
  (pin re-pinned: `computed`/`effect` slots are `_name` + `_devWindows`;
  `slotSignal`'s are `_name` + `_owner`).

**The container node, as built.** `t.k` holds it (no new target field).
Created by the first structural subscription (`$TRACK`, `ownKeys`,
`deep`) with `_value = t.v`, or by `ensurePB` — the first draft write of a
batch — which stages the pending backing on it (`queuePendingNode` +
`_pendingValue = pb`, no notification) so the scheduler owns `pb`'s
lifetime. `materializePB` re-points the staging when an overlay downgrades
to a clone. Setter exit (`notifyWrites`) writes leaves/presence/deep as
before and, when the container has subscribers and the store's structural
compare (`arrayStructureChanged` / `membershipChanged` / the overlay
own-keys scan) says membership changed, `setSignal(k, pb)` — the node's
`_equals` is `false`; the compare is the store's, against the committed
frame, never the node's (a mutable backing has no "previous value" to
compare). `setSignal` re-stages and walks the subscribers, and on later
steps routes a held/lane-owned container like any node. The fold
(`drainFolds`, from `_storeCommit`): a target whose container is still
staged waits (held — S2); otherwise flatten/clone-swap/path-copy as on
`next`, then `k._value = t.v` — or, **if nothing subscribed, `t.k = null`**:
the write-created container was a transient staging home (INTERNALS §5:
an observer-less write holds a transient record until the fold, discarded
with it), so laziness pins hold (`enumerator-presence-nodes` "births
exactly one presence node and no key-set node"). Cost: one literal per
written container per batch while unsubscribed; one persistent node once
subscribed. Deferred releases (last subscriber left while staged) run at
the same fold.

**Three rules settled by pins during the port:**

1. _Staging visibility is the pass's_ (`stagingReader()`): `context`, not
   the owner — a handler, an effect callback or `onSettled` has an owner
   and no pass and sees the committed frame (`effect-phase-writes`
   "onSettled store write-then-read returns the settled value"); frame
   readers (children-forbidden) see committed; the pass that reads a
   staging is `stagedRead`-marked (the seam's hook for S2). Applied to the
   backing (`readSource`) and to an existing leaf's untracked read
   (`nodeValue`) alike.
2. _Adoption notifies at adoption time_ (#3296): a setter's returned
   replacement diffs against the view the nodes were last told — the
   draft's pending backing when one preceded it in the batch, else
   committed — and writes the nodes **then**, so a draft write followed by
   a replacement back to the committed value cancels (the effect never
   sees the draft's value). `next` deferred this diff to the fold (`ab`);
   on L2 the fold's commit of the leaf would have published the draft's
   value first. `ab` is gone with it; the fold keeps only the path copy.
3. _The enumerator check is per pass_: a descriptor read tracks presence
   unless **this pass** already holds the container (`_gen === _depGen`
   while recomputing) — a link left from a previous pass is stale.

**Tests.** Signals **2821 passed** (§30: 2219; +602 — `createStore`,
`overlay`, `write-floor`, `native-collections`, `storePath`,
`enumerator-presence-nodes`, `shallow`, `snapshot`, `overlay-rebuild-3689`,
`fold-slot-identity`, the plain rows of `optimistic-list-mutation-matrix`
and the oracle matrices, …), **0 passed→not-passed** vs §30 and vs the
carved core; carved 1963 (was 2536). Remaining non-carved failures 47:
**holds, S2** — `posture-store-parity` ×16, `visibility-oracle-store` ×8,
`latest-held-till-flush` ×5, `store-unchanged-read-independent-write-3688`
×3, `spec-async-semantics` "a plain store written in a transition pends
exactly the touched leaves", `fold-scheduling`, `lane-authority-twins`;
**affects' store half, S5** — `question-scoped-pending` ×6,
`affects-audit-2893`, `affects-propagation`; `rules-index` ×3;
`refresh-await` (projection). Web **924** (0 passed→not-passed; +33 — the
spread/`For`/store fixtures that only needed `createStore`); solid 691
(+13).

**Size (br / min).** Floor 7189 → **7215 (+26 / +30)**: the sweep
dispatch, the commit hook call and the `$TRACK` symbol — the two seams'
whole cost. `+ createStore` 7243 → **11134** = floor **+3919 br** (gate
was ≤ +4000; `next`: +7340), `store/store.js` 11505 min + `types.js` 664

- `target.js` 225. Hello world 9712 (+24), CSR 12726 (+42; `mapArray`'s
  `$TRACK`), hydrating 17521 (+11), every store family 23704 (+3820;
  `next` 30789 — projections/reconcile/optimistic still out), page base
  36219 (+25), page live 39809 (+72). Observe +31/+32.

**Process note.** A full-suite comparison mid-step showed 79 "regressions"
in files that pass alone; the command had used `timeout`, which macOS
lacks, so nothing ran and the JSONs compared were yesterday's (§28 S1's
labels `s1c`/`s1d` collided). Labels are now `st<step><letter>`.

**Next.** S2 (holds) — the bet: the container node already stages through
`queuePendingNode`, so the park/`land`/`blocked` paths see it; the work is
the held leaf (`CONFIG_HELD` on writes under a transaction), born-held
first reads from the two frames, `latest`/`isPending` on leaves, and the
A17 kanban fixture.

## 33. Stores on L2 — S2: plain stores under holds (2026-10-03, 3:00–3:40 AM)

**The bet paid.** The park loop already held every staged node of a joined
flush — the container node and the leaves included, since they stage
through `queuePendingNode` — and `land` commits them; nothing in the hold
model needed a store case. The store's work was to make every read answer
through core:

- **Every read of a key with a leaf is core's `read(leaf)`**, tracked or
  not (`nodeValue` is `read` + the accessor sentinel; the hot inline path
  no longer requires an observer). `read` applies the hold rules — a
  render effect outside the parking flush sees committed and is re-derived
  at the landing, a memo joins the future, a frame reader sees committed,
  A28 for unflushed writes — and the store stops restating them
  (`next`'s `nodeValue`/`pendingBackingVisible`/`heldMaskView` twins).
- **A node is born from the two frames** (`bornStaged`): `_value` from the
  committed backing, a staging from the pending one when they differ
  (slot equality), **held by the container's transaction** when the
  container is held — A29 born-held and #3706's "the unit of the hold is
  the key" with no `heldKeys` ledger: an unchanged key stages nothing and
  holds no one. Leaves and presence nodes alike.
- **Structural reads take the container's frame**: `ownKeys`, an
  enumerator's descriptors and `deep()` read `read(k)` — the node's value
  IS the backing, chosen by the hold rules. A lone descriptor read is
  gated by its presence node's answer and describes that frame.
- **Untracked reads of un-noded keys by a pass ask the container** —
  `read(k)` with no link: the frame rules and the staged-read mark, from
  core. A verdict window with no reader (a top-level `isPending`/`latest`)
  judges the container **only for a key the batch changed** (`keyChanged`;
  A22: pending is per key) and reads committed for the rest.
- **Adoption is staged, not eager**: a setter's returned replacement is
  the container's `_pendingValue` and the pending backing until the fold
  (a handler reads committed until the flush; a hold keeps it staged with
  the rest); the draft clones an adopted unowned object before writing it.
- **Snapshot**: R27's "sees pending" is the batch's own staging; a held
  one (another transaction's future) only from its draft.
- The fold hook moved **after the landings** (`settle`), so a landing's
  commits fold in the same seam.

**Core (one change, flagged):** `read()`'s held arm — `frameRead` /
`joinPass` — now applies to **untracked** reads by a pass too, in the fast
block and the slow path (`untrack` is about dependencies, not about which
world a pass derives from). Pinned by `posture-store-parity` S4/S5's
_signal_ twins, which had never run on L2 (the file was carved at
collection): a memo created mainline during a hold that `untrack`s a held
signal is born held and publishes nothing until the commit; a render
effect's untracked read of a foreign hold is served committed and replays
at the landing. Cost: +2 min B, −2 br on the floor.

**Re-pins (flagged):** `posture-store-parity` S6 — the pin recorded a
_divergence_ ("store publishes the pending 1 (CURRENT; rule says 0) …
flip it to `[0]` then"); the store now follows the signal by construction,
flipped as instructed. `visibility-oracle-store` structure rows — the
`latest` cell was a pinned **violation** ("latest() sees the parked VALUE
but not the parked STRUCTURE — the structural channels have no latest()
tunnel", 2026-09-17); structure rides the presence and container nodes,
which `latest` tunnels like any node, so the rule holds; re-pinned to the
rule.

**Tests.** Signals **2849 passed** (S1 2821; +28), **0 passed→not-passed**
vs S1 and vs the carved core. Green: `latest-held-till-flush`,
`store-unchanged-read-independent-write-3688`, `spec-async-semantics` A22
(plain store in a transition pends exactly the touched leaves),
`visibility-oracle-store`'s plain rows (value and structure channels),
`posture-store-parity` S1–S7 for signal / store / store+node,
`fold-scheduling`. Remaining non-carved 19: `posture-store-parity` ×6 and
`lane-authority-twins` (`reconcile` — S3), `refresh-await` (projection —
S3), `question-scoped-pending` ×6 + `affects-*` ×2 (affects' store half —
S5), `rules-index` ×3. Web 924, solid 691 (unchanged). The A17 kanban
fixture needs the optimistic store — S4.

**Size (br / min).** Floor 7215 → 7213 (−2 / +2); `+ createStore` 11134 →
**11269 (+135 / +237)** = floor +4056 (born-held, `keyChanged`, the
descriptor gate); every store family 23787 (+83); hello world 9697 (−15),
CSR 12703 (−23), page live 39780 (−29) — brotli noise on the ±2 min
elsewhere.

## 34. Stores on L2 — S3a: projections, derived stores, reconcile (2026-10-03, 3:40–4:00 AM)

`src/store/projection.ts` (family, draft, derive pass, `createProjection`,
`createStore(fn, seed)`) and `src/store/reconcile.ts` (the adoption-channel
diff, ported with the optimistic branches out) are new; `store.ts` grew the
family hooks. Committed as **S3a** with 19 projection reds still open
(below) — 0 regressions and the solid suite's store-dependent half came
back, so the checkpoint is worth having.

**The firewall, as built (Q-B (a)).** Every read through a family target
first `pullFamily`s: core's `read()` of the derive. **Settled derive →
untracked** (`untrack(() => read(fw))`): the pull, the height, no link —
the barrier. **Derive with a flight up or errored → tracked**: the reader
observes the flight exactly as a reader of a memo does (linked, so it
re-runs at the landing — its next settled pass pulls without linking and
the stale link trims; a verdict reader registers; a tracked pass
suspends). The derive's own draft ops are exempt (write override). No
`_firewall` on leaves, no `||` in core `read()`, no child chain.

**Pending propagation (A9).** The leaves do not subscribe to the derive, so
when its pass goes pending the family does what `notifyStatus` does for a
memo's dependents — `wakeFamily`, over the family's live index: a verdict
or re-derive reader re-runs, any other reader is pending **derivatively on
the derive** (`notifyStatus(sub, PENDING, theDeriveNotReady)`); at the
landing `settleFamily` runs core's settle walk from each leaf
(`settlePendingSource(leaf, fw)`), since the derive's own walk does not
reach them. Fired from the pass's `catch` with the thrown NotReady (the
derive's own, source = the derive — the status is not set yet at that
point), never for the creation run.

**A render effect outside the flight's own flush is the frame:** it keeps
what it shows and learns of the landing from the leaves the landing
changes; it is not a stale reader of the derive (`pullFamily` skips the
pull for `EFFECT_RENDER` when the derive is held by a transaction that is
not the flush's). Inside the flush it suspends like any reader. (The
`notifies only changed paths` pin: an unchanged leaf's render effect does
not re-run at the landing.)

**A projection's writes are its derive's.** A staging made while the
derive is held — a continuation's write after an `await`, a callback's
late write — joins the derive's transaction (`holdWithDerive`:
`holdNode(node, txOf(fw))` for the leaf, presence and container stagings)
and reveals with it, never drained early. **The creation run commits
directly** (`runDirect`: a memo's first value is its `_value`, not a
staging — the draft still writes a clone of the seed, nothing is staged on
the nodes, the setter's exit folds the touched containers at once); every
later run — a re-derive in a flush, an async landing — stages and commits
with the flush like a memo's recompute. A batch written inside a pass
outside a flush (a creation-time derive) is promoted (A28 (4):
`notePromotedWrite` on the container, inherited by a late-materialized
leaf). **A projection's unheld staging is ahead for a handler**
(`familyAhead`): a context-free reader sees the derive's writes before the
flush — the derive is the authority, nothing it writes is a proposal
(`next`'s family rule; the `resolves async draft` pin reads a post-await
draft write one tick before the landing commits).

**Adoption is eager (INTERNALS §3, "eager by contract")** — corrects S2's
"staged" reading, which the `Reconcile a simple object` pin (a handler read
right after `setState(reconcile(…))`, no flush) refuted: the backing swaps
now (`t.v = incoming`) while the **container node keeps the committed
frame** (`k._value`, what readers a hold keeps on it see — `hv` without a
field) and stages the adoption for the fold's path copy; `committed(t)`
(the node's `_value` while staged, `t.v` otherwise) is what nodes are born
from and what `keyChanged` compares against; an eager adoption nothing
wrote after folds without a clone (shared ownership). `reconcile`'s
per-node notifications replace the full diff (`adoptPB(t, incoming,
false)`); its reachability-pruned descent is `next`'s.

**Chained backings (§7b)** came with it: the hot inline path is for
unchained targets; a chained read serves the inner store's value (the
outer node is a subscription point); `resolveChainedRaw` for inner-owned
raws; `$TRACK` reads through; `deep()` walks the chain's containers and
witnesses.

**Core (two seams, flagged):** (1) `recompute`'s _self-registered flight_
probe is back (`prevInFlight` / `selfRegistered`): a projection's body
registers its flight through `handleAsync` with the commit as setter, so
its `undefined` return is not a sync answer and must not clear the loading
window or clobber the registration — 1b had carved it as store-only; it
is. (2) `verdictValue`'s uninitialized-pending throw links an untracked
reader as `read()` does ("an untracked read of a pending node still
re-runs its reader when the node settles") — the pull reads the firewall
untracked inside a verdict window.

**Re-pins (flagged):** `createStore.test.ts` #2692 trio → **A34 rule B
store twins** ("manual setStore wins the tick" was reversed for memos on
2026-10-01 — `a34-writes-then-derivations`; the derived store follows: a
source change or `refresh()` in the write's tick re-derives over the
written draft, the write on its own never re-runs the derive); the
store's behaviour already matched. `projection-slot-release` helper counts
the family's live index instead of the firewall child chain (assertions
unchanged, all six pass — removed rows release their slots).

**Tests.** Signals **3185 passed** (S2 2849; +336), **0 passed→not-passed**
vs S2 and vs the carved core; carved 1616. Web 931 (+7); **solid 789
(+98)** — the projection-dependent half of its suite. Open, S3b (19):
`adoption-unchanged-key-read-3706` ×3 (prototype swap / enumerability /
fresh-node rows), `finalize-reentry` ×2, `held-derivation-3612`,
`late-pending-equality` 1, `latest-isPending-consistency`,
`question-scoped-pending` 3.4-held-write, `refresh-await`,
`visibility-oracle-store` staleForeign (projection row),
`child-companion-walk`, `createProjection.async` ×4 (async-generator
`isPending`, rejection → retry ×2 — the memo twin behaves the same on L2
today, a core question, not the store's — and `notifies a leaf reader
behind a memo`), `createStore` "isPending sees a derived store update
held by async work", `lane-authority-twins` #3334, `draft-lifetime-3585`
never-resolving workaround. Plus affects' store half ×8 (S5), rules-index.

**Size (br / min).** Floor 7213 → **7257 (+44 / +98)** — the recompute
probe and `read()`'s restructured held arm; to be re-measured per
function. `+ createStore` 11269 → **13302 (+2033 / +6893)** = floor +6045
with projections and reconcile statically coupled (API symmetry; `next`:
+7340 with optimism too). Every store family 25764 (`next` 30789 — the
gate is hydrating +7 kB = 24520; over by 1.2 kB with optimism still out:
a size pass follows S4). Page base/live **+5.7 kB** — the page fixtures
use projections and reconcile, 0 B as stubs until now; 41926 / 45540 vs
`next`'s 46193 / 50442.

### 34.1 S3b — holds on derived stores (4:00–4:15 AM)

Three rules, all pinned by `adoption-unchanged-key-read-3706`,
`store-unchanged-read-independent-write-3688` and
`held-derivation-not-a-proposal-3612`:

- **A pass reading a key the batch left unchanged reads committed and
  holds no one** (#3706; the unit of the hold is the key); a changed key
  reads the container's frame by core's rules — `read(k)` untracked (a
  memo joins, a stale render effect is served committed and re-derived at
  the landing). `keyChanged` now covers presence, enumerability,
  accessor-ness, and treats a swapped or non-plain prototype, or a chained
  backing, as changing every key (the "whole container" cases).
- **Two writers, one container.** A mainline setter on a derived store
  whose adoption another transaction holds: the HELD staging stays the
  adoption (the container node's `_pendingValue`), the draft is a mainline
  layer above it (`t.pb`, a clone); a key the held staging left unchanged
  reads the ambient view (the mainline write publishes mainline, #3688),
  a key it changed reads the frame (`heldKeyChanged` vs `keyChanged`). A
  derive's own continuation writes still join its hold (`holdWithDerive`,
  now keyed on the setter's author, not the write override).
- **A34 (3) for derived stores** (`setMemo`'s twin): a user setter's write
  to a key whose staging is a derivation another transaction holds is
  nobody's proposal — it becomes the draft's prior state and **the hold
  re-derives over it** (the derive is marked dirty and re-run; its writes
  land under the hold). A write made under the hold is a proposal and
  keeps last-write-wins: `CONFIG_MANUAL_WRITE` (1 << 18, constants.ts — a
  store-only bit, the leaf twin of `REACTIVE_MANUAL_WRITE`), set by a user
  setter's leaf write, cleared by the derive's.

Signals **3188 passed**, 0 passed→not-passed vs S3a and the carved core.
Still open (S3c, 12): `3706` enumerability-descriptor row,
`finalize-reentry` ×2, `late-pending-equality` 1,
`latest-isPending-consistency`, `question-scoped-pending` 3.4-held-write,
`refresh-await`, oracle staleForeign (projection row),
`child-companion-walk`, `createProjection.async` ×4 (async-generator
`isPending`; rejection → retry ×2 — the memo twin behaves the same on L2;
sync-recompute-supersedes-flight behind a memo), `createStore` "isPending
sees a derived store update held by async work", `lane-authority-twins`
#3334, `draft-lifetime-3585` never-resolving workaround.

---

## 35. Stores on L2 — S4: optimistic stores on lanes (2026-10-03, 4:00–5:40 AM)

`src/store/optimistic.ts` (new, ~430 lines; `createOptimisticStore` out of
`carved.ts`). No store-side layer, no backup snapshots, no retaining
ledger: **a user write to an optimistic store is a guess on the written
key's node** (`optimisticWrite` — the same write `createOptimistic`'s
setter makes), a presence guess on its presence node, and, when membership
or arrangement changed, an **arrangement guess on the container node**
(`LaneView { rows, base }` — the rows the setter left, over the committed
backing it is shown over; the container's comparator `containerEquals`
judges a landing against it by row identity, by key when the family has
one). Lanes do the rest: the guess shows under the action's hold, a landing
beneath stages as truth and confirms it when equal (A18/A24), the action's
settle dissolves it. The committed backing is never touched by a guess.

**The store side (store.ts, late-bound through `OptHooks` — a plain store
pays nothing: `treeshake` "plain stores shed … lanes.ts" holds):**

- `ensurePB`: a user's draft on an optimistic family is a clone of the
  **writer's view** (`committed(t)` with the lanes' values and the tick's
  own unflushed guesses over it — #3665, `pendingGuessOf`); a staging
  already on the target (a landing adopted this flush) is set aside
  (`optStaged`) for the setter's duration and restored at its exit. A read
  inside the setter before its first write births the draft (read-your-
  writes across setters in one tick).
- `notifyWrites` → `optHooks.writes` (`notifyOptimisticWrites`): the
  per-key diff of the draft against the writer's view becomes guesses;
  the draft is discarded. A returned replacement on an optimistic family
  is the same channel (`next` parity); so is a user's `reconcile(...)` —
  the keyed diff is written INTO the draft (`reconcileDraft`: a matched
  row keeps its proxy, its changed leaves become its guesses).
- Reads compose per key, never per object: a guessed key always has its
  node and the node serves it (`nodeValue` → core `read`, the lane's
  rules); `has`/descriptor compose the presence guess (`optimisticHas`,
  `optimisticOwnDescriptor`); enumeration and `snapshot` compose the view
  (`optimisticView`). A guessed key's read does not consult the container
  (no stale-reader registration on its hold). `fam.overlaid` is the hint
  set; it is swept at the flush's commit (`_storeCommit`), never on the
  read path (a guess is pending between the setter and the seam).
- **The pull under an in-flight derive**: an optimistic family carrying
  guesses stands in for its flight (A17) — a reader is served the leaves
  (committed plus guesses) and does not suspend on the derive; a verdict
  window still asks it (`isPending` true while the flight is up).
- **Chained views** (`createOptimisticStore(base)`, §7b): the outer's
  nodes are links; their committed value now follows the inner store on
  every read-through (and before every guess), so core's reveal/revert
  compares judge against the inner's truth (#3672); a chained read serves
  the outer node only when it carries a guess; `has`/descriptor read
  through; when a chained view's lanes end, `rebaseChained` re-derives the
  readers whose shown value the inner's truth is not (the "re-base when
  the base changes shape" rule the matrix asked for; F7 unpinned).
- A node carrying a lane's value is never released (`releaseSlot`
  deferred, like a staging). The store never re-homes a lane's node into
  a transaction (`holdWithDerive`/`bornStaged` skip `CONFIG_OVERRIDE`).
  Write-override reads (a derive's draft) serve the backing only — never a
  lane's or a hold's frame (the continuation composes on the truth).
- Function leaves are guessed by value (`() => nv`, #3017).

**Core seams (flagged):**

- `lanes.ts` `inFlight(n)`: a guess's own truth is in flight when the node
  is pending OR, a slot node's, when `GlobalQueue._slotFlight(n)` says its
  family's derive is (`scheduler.ts` declares the hook; `optimistic.ts`
  installs it). Used by `applyGuesses` (a no-frame guess opens a
  transaction for the flight — #2864, A17) and `guessFlights` (the lane's
  parent waits for the landing; the lane shows).
- `laneRead`: an **untracked read inside lane work** derives from the lane
  like a tracked one, minus the subscription (`enterLane` → the lanes a
  pass reads link): `untrack` is about dependencies, not about which world
  a pass derives from (a mapper's row reads under its root).
- `enterLane`: a pass that read a held write before its first lane read
  (`REACTIVE_JOINED`) is a staged reader — the seam re-derives it on the
  screen next round (the park's repair; `held-truth-lane-only`'s owning-
  lane row computes once torn, publishes once coherent).
- `linkBlocked`: `blocked(k)` without the group recursion — `guessFlights`
  no longer blocks the group (a guess whose flight is up blocks its
  parent, not the lane; two linked lanes over one in-flight family were
  both held).
- `supersede`: the lane's parent is **resolved** (two actions guessing one
  slot merge their transactions; the truth is held by the one that lands
  — `#2899` same-key entangle left `b` staged under the merged-away one).
- `guessedValueOf` / `pendingGuessOf` exported (the writer's view).

**Re-pins (each noted in place):** the 15 no-parent "flash" pins of
`createOptimisticStore.test.ts` → lane contract 2 (the signal twins'
wording), with three action-wrapped twins added so the draft-composition
shapes (`13`, pushes, filter chains) stay covered; `shallow` optimistic
replacement, `deep-chained-view` ×2 (action-wrapped), `#2899` ambient,
`question-scoped-pending` "writes display and revert" — the same rule;
`posture-store-parity` S8 and the store oracle's `supersede` state → the
signal oracle's lane rules (a never-shown guess is void at the
correction); `held-truth-lane-only` owning-lane row: one repaired compute;
`fold-scheduling` #3089: a derived store's re-derive over a guess is lane
work and shows ahead (rails coherent at 2/["0","1"]); `3706` "CHANGED
still holds": the first move's landing is its own action's;
"a real write mid-refetch" restructured so the refetch is actually up at
the write (`await setup()` yielded the landing its microtasks).

**Results.** Signals **4707 passed** (+1513 vs S3b), **0 passed→not-passed
vs S3b and vs the carved core**; carved 76 (utils). Web **998** (+67, 0
regressions), solid **812** (+23). Size (br): floor 7250 (−7),
`+ createStore` **13968** (+666 — the optimistic seams in the plain store
paths; `next` 16848), `+ isPending/latest` 9322 (+54), every store family
**27800** (`next` 30789; the gate is a size pass), page base/live
42566/46227 (`next` 46193/50442). lanes.ts stays out of the plain-store
bundle.

**Open after S4 (the matrix evidence for Q-D's replay half):**

- **Overlapping actions on one array where the first landing contradicts
  the combined arrangement** — matrix `update text (c) + swap a<->b,
resolved A then B` ×2 (keyed/index), `#2951 compose half` (A's truth
  lands under B's +1: on lanes a landing that differs from the guessed
  slot is a correction and voids B's guess until B lands; `next` replayed
  B's increment / kept B's positional override). This is exactly the
  "replay decided on matrix evidence" item: the lane model has one slot
  per node, so two actions' structural guesses on one array entangle and
  the first landing judges them together. Options for the ruling: (a)
  accept (B's guess re-shows when B lands — one frame of truth in
  between), (b) per-question arrangement entries on the container
  (`LaneView[]` keyed by `_q`, the landing confirms its own question's
  entry; a positional entry re-based on the new truth needs the delta —
  replay), (c) retain setters and replay (RUL-2's continuation half).
- `direct-commit-readers-posture` ×2 (`until`/`resolve` over an optimistic
  family's held landing — actions-step territory), `lane-frame-deferred-
run-3662` ×1, `question-scoped-pending` quiet-refetch ×2 (a quiet
  `refresh` landing pulses an `isPending` memo once; a re-refresh under a
  new question reads settled — projection verdict windows, S3c class),
  `optimistic-chained-revert-3672` "delete and re-add of the same inner
  row" one spurious re-run, web `optimistic-for-index-frame-f1` ×5
  (chained view + index `For` + a differing landing committed INSIDE the
  action: the DOM keeps 6 rows after settle — the landing's rerun order
  against the inner's commit; the signals matrix twin passes).
- S5 as planned: `affects` store half (`question-scoped-pending` ×14,
  `createOptimisticStore` ×6 affects contrasts, `affects-propagation` ×2,
  `affects-audit`), store attribution, the size pass, `rules-index` ×3.
- Gabriel's A17 kanban fixture as the first new pin (not yet written).

### 35.1 Store size pass (8:20–8:45 AM) — attribution, a seam trim, and a finding

**Where the store layer's bytes are.** Store layer over the floor, br /
min: `next` 7340 / 25484; now **6718 / 22947** (−8.5%); S3b 6045; S1
(plain only) 3919. Per-function, `store/store.js` as retained in
`+ createStore` (rolldown's rendered module, each piece minified alone;
`/tmp/carve/fnattr.mjs`): proxy traps **4140** (`get` 1695, `set` 692,
`getOwnPropertyDescriptor` 552, `has` 431, `defineProperty` 408,
`deleteProperty` 258); `notifyWrites` 1643; `foldTarget` 926;
`storeSetter` 815; `readSource` 566; `ensurePB` 557; `notifyKeyDiff` 545;
`adoptPB` 536; `serveDataKey` 532; `scanAccessorsOnce` 495;
`changedBetween` 461; `notifyFold` 416; `drainFolds` 406; `cloneRaw` 387;
`TargetShape` 357; `createTarget` 331; `visibleKeys` 324;
`notifyContainer` 308; `releaseSlot` 306; `overlayRebuilds` 306;
`materializePB` 306; `getNode` 290; `pullFamily` 284; … Three clusters
account for most of it: **the accessor/clone machinery** (`scanAccessorsOnce`,
`cloneRaw`, `wideClone`, `copyOwn`, `isOwnAccessor`, `hasAccessorFlag`,
the accessor arms in `get`/`notifyWrites`/`changedBetween`; ~1.6k min),
**the overlay draft** (#3044: `ovl`/`del` in every trap and in
`visibleKeys`/`visibleDescriptor`/`changedBetween`/`foldTarget`, plus
`materializePB`/`overlayRebuilds`/`flattenOverlay`; ~1.3k min), and **the
hold model per key** (`readSource`, `changedBetween`/`keyChanged`/
`heldKeyChanged`, `bornStaged`, `releaseSlot` deferral, `pullFamily`,
`holdWithDerive`, `heldDerivation`; ~1.6k min). `reconcile.js` 2679 and
`projection.js` 1761 are in the `+ createStore` bundle by the API-symmetry
ruling (#2883: the derived overload).

**The seam trim** (this pass): `writeOverride` is a live export binding
(the eight `getWriteOverride()` calls, one on the `get` hot path, are a
variable read); the optimistic draft and its set-aside staging move into
the hooks (`OptHooks.draft`, `writes` returns the staging; `optStaged`
leaves store.ts); one `optRead(target)` predicate for the five "compose
the lanes' view" sites. `+ createStore` 13968 → **13939** (−29 br / −169
min), every store family 27800 → **27783**, page live 46227 → 46216.
Signals 4707 / web 998, 0 regressions.

**Finding.** The S4 seams were not where the bytes are: the dispatch
points cost ~30 br once the draft moved out. The store layer's remaining
~6.7 kB br is feature surface — overlay drafts, accessor keys, deletes,
chained views, per-key holds, projections+reconcile by ruling — each of it
pinned. The every-store gate (hydrating + 7 kB = 24520) is 3.3 kB away
and is not reachable by trimming seams; reaching it means dropping a
feature (the overlay draft is the obvious candidate — the maintainer's own
ambivalence about it is on record in §31 — ~400 br) or revisiting the
#2883 symmetry ruling (projection+reconcile out of the plain
`createStore` bundle: ~1.3 kB br). Both are the maintainer's calls; no
further size work in this step without one.

---

## 36. Stores on L2 — S-U: `utils.ts` back; the carve is closed (2026-10-03, 8:45–9:00 AM)

`src/store/utils.ts` is `next`'s file verbatim (1185 lines: `merge`/`omit`,
`MergeView`/`OmitView`, `mergeSources`/`viewOf`/`sourceKeys`/`sourceHas`/
`sourceGet`/`hasStaticKeys`/`isStatic`/`resolvedTable`/`sourceOwners`, the
`SOURCE_*` kinds) with three import edits: `$PROXY`/`$RECORD`/`$TARGET`/
`ownEnumerableKeys` from `./types.js` (they moved there in S1),
`SUPPORTS_PROXY` from `../core/constants.js`, and the dead
`pendingCheckActive` import dropped (nothing in the file read it). Exported
from `store/index.ts` as `next` did. **`carved.ts` has no stubs left** —
every carved capability is back.

**Results.** Signals **4783 passed** (+76: the last carved pins), 0
regressions; web **1109** (+111; the `dynamic.spec` ×4 reds were
utils-dependent and are green), 0 carved; solid **813**, 0 carved. Size
(br): page base 42566 → **43402** (`next` 46193), page live 46216 →
**46969** (`next` 50442) — utils enters the page bundles through `dynamic`
and spread; every other scenario unchanged.

**Open after S-U (whole-suite, non-carved):** signals 51 (§35's list),
web 7 (`frames-optimistic-hold` multi-flight timeout,
`optimistic-for-index-frame-f1` ×5, `call-driven-lifecycle` mid-flight
switch), solid 6 (`internal-surface` ×3, `published-declarations` ×3 — the
dist/declarations pass, S5).

---

## 37. Stores on L2 — S5: the store half of `affects()`; declarations (2026-10-03, 9:00–9:45 AM)

**`src/store/affects.ts`** (new, ~150 lines; installed by `store/index.ts` —
a program with stores carries it, one without pays nothing; `affects.ts`
asks `GlobalQueue._storeMarks`). A mark on a store is a mark on nodes
(§29's count-on-the-node, probe-time dependency walk): `affects(record,
key)` marks the slot's leaf; `affects(record)` marks a carrier (the
record's `$AFFECTS` leaf — a key no read serves) and every live node in the
record's subtree (leaves, presence, container, deep witness — the edges
existing readers subscribed through). Coverage is by **raw identity**
(#2882, #2904), as on `next`: the identities reachable at the declaration
are the mark's scope (the draft's and the committed backing both while a
setter is open; an optimistic family's **writer's view** — the tick's own
unflushed guesses are in motion too), so a node born inside the window on a
covered record **inherits** the mark (`noteNode` is the one birth seam;
released with the carrier's last registration through
`_releaseMarkScope`), and an **untracked probe** through a record with no
node is witnessed into the verdict (`_witnessMark`, verdict.ts: `probeFound
= true`; the witness runs before the family pull, so a mark on an
uninitialized derived store reads pending while the pull throws — #2910).
Chained backings are followed to the base raw. `affects()` itself gained
`next`'s dev diagnostics (extra keys are not a path; keys only on stores).

**One rule the store pins forced on the signal half (flagged).** §29 built
ambient marks as "released at the next seam". The six `createOptimisticStore`
contrasts (`affects(state); refresh(state); flush()` with no action) and
the signal pin "affects with no transaction and no async releases at flush
end" ("nothing async below ⇒ no window") together say: **something async
below ⇒ the window is the flight's.** So `_releaseAmbientMarks(parked)`:
if the carrying flush parked, the ambient marks join its transaction (as
`next`'s `shiftAffectsMarks`); else a mark whose node's own flight is up
(STATUS_PENDING — or, a slot node's, its family's derive: `_slotFlight`,
now installed by store.ts for lanes and marks alike) stays ambient to the
seam after the landing; the rest release. Core: `settle` passes the parked
transaction (if still live) to the hook; `GlobalQueue._mark` (a bare
registration, for inheritance), `_storeMarks`, `_releaseMarkScope`,
`_witnessMark`.

**Declarations.** The solid `internal-surface` ×3 / `published-declarations`
×3 reds were stale generated `types/` (Sep 28) plus one real gap: **`StoreNode`**
— a public type on `next` (re-exported by `solid-js`) — had no export. It is
back as `export type { StoreTarget as StoreNode }` (public API, flagged:
the name is kept; its shape is the L2 target's, the symbol-keyed legacy
record being gone with S1's representation). `pnpm types` regenerated for
signals/solid/web: solid **819 / 819**.

**Results.** Signals **4808 passed** (+25: every store `affects` pin —
`question-scoped-pending` ×15, the six optimistic deep/length contrasts,
`affects-propagation` ×2, `affects-audit` flagship,
`latest-isPending-consistency`'s store row), 0 regressions; web 1109
(unchanged); solid 819 (+6). Size (br): floor 7250 → **7265** (+15: the
seam's parked-transaction argument), `+ isPending/latest` +14,
`+ createStore` 13939 → **13988** (+49: store/affects.js, the birth seam,
the witness gates), every store family 27783 → **27745** (−38), page live
46969 → 47012.

**Open after S5** (signals 26, non-carved): the S3c/verdict class
(`createProjection.async` ×4, `createStore` isPending-held-derived, QSP
quiet-refetch ×2, `late-pending-equality`, `child-companion-walk`,
`finalize-reentry` ×2, `refresh-await`, oracle store `staleForeign`,
`draft-lifetime-3585`), the §35 Q-D rows (matrix ×2, `#2951 compose half`,
`3672` one re-run), `3706` enumerability contrast, `direct-commit-readers`
×2, `lane-frame-deferred-run-3662`, `lane-authority-twins` #3334, and
`rules-index` ×3 — the check flags `§NN` plan-section citations in src
comments (`§19 §28 §29 §31 §32 §35 §37`) as unresolved rule IDs; for PR
time, per the standing rule that spec files are not edited here. Web 7
(§36's list).

---

## Appendix — ledger (verbatim)

### Carve ledger — size/carve-step1 off next @ 309b08730 (2026-09-30)

Measurement loop: `/tmp/carve/measure.sh <label>` (signals build:js must run
UNSANDBOXED — rollup never exits under the sandbox) → size.mjs all scenarios →
attribute.mjs floor/simple/hydrating/CSR → bc.sh hot-function bytecode.
Self-check `base0` reproduced every baseline byte.

#### Baseline (next)

| scenario                            | br    | min    | signals min |
| ----------------------------------- | ----- | ------ | ----------- |
| signals: core floor                 | 9508  | 27013  | 26967       |
| signals: + createStore              | 16848 | 52497  | 52439       |
| signals: + isPending/latest         | 12160 | 35870  | 35813       |
| app: render + one signal            | 11970 | 34567  | 28671       |
| app: hydrating (no stores)          | 19663 | 59152  | 35404       |
| app: hydrating + every store family | 30789 | 99009  | 73780       |
| app: CSR                            | 14901 | 43197  | 36022       |
| page: base SC                       | 46193 | 150972 | 69897       |
| page: live SC                       | 50442 | 165362 | 81375       |

Floor per-module (min): core.js 8922, scheduler.js 8051, async.js 4277,
owner.js 1469, heap.js 1017, effect.js 826, graph.js 767, lanes.js 627,
constants.js 477, error.js 268, signals.js 266. (No store/optimistic/verdict/
action/boundaries module reaches the floor — those are shaken as modules;
the carve measures what core RETAINS for them.)

Bytecode (prod dist): readNodeFast 229/16, read 1001/128, setSignal 473/56,
recompute 4708/512 (length/frame).

Tests: 766 files, 4800 tests (4798 pass, 2 skipped), 12 s.
Posture matrix report: /tmp/carve/baseline-posture.md (1248 rows).
Oracle report: /tmp/carve/baseline-oracle.md (violations/unspecified lists).

#### Steps

#### Step 1 — store family (1a: module removal, 1b: core slot removal)

1a = `git rm -r src/store`, throw-stubs in `src/carved.ts` for every store
export (solid/web dists re-export them; 0 B unless reached), `$TRACK` read
dropped from `mapArray`, `affects()` store overload/branch dropped.
1b = removal of everything core carried FOR the store that the bundler
cannot fold (node-literal slots, `_firewall || el` owner reads, CONFIG-bit
gated branches, Set-size checks, GlobalQueue hook slots).

| scenario                                    | base br | 1a br | 1b br | Δ 1a  | Δ 1b (core slots) | Δ total  | Δ min total |
| ------------------------------------------- | ------- | ----- | ----- | ----- | ----------------- | -------- | ----------- |
| signals: core floor                         | 9508    | 9473  | 9174  | −35   | −299              | **−334** | −1036       |
| app: render + one signal                    | 11970   | 11934 | 11647 | −36   | −287              | −323     | −1037       |
| app: hydrating (no stores)                  | 19663   | 19616 | 19335 | −47   | −281              | −328     | −1127       |
| app: CSR                                    | 14901   | 14862 | 14555 | −39   | −307              | **−346** | −1073       |
| signals: + isPending/latest                 | 12160   | —     | 11661 |       |                   | −499     | −1568       |
| signals: + createStore (now = floor + stub) | 16848   | 9522  | 9226  | −7326 |                   | −7622    | −26427      |
| app: hydrating + every store family         | 30789   | 21923 | 21560 | −8866 |                   | −9229    | −33085      |
| page: base SC                               | 46193   | 38396 | 38066 | −7797 |                   | −8127    | −29850      |
| page: live SC                               | 50442   | 42500 | 42046 | −7942 |                   | −8396    | −30691      |

(1a's −35…−47 is almost entirely the mangler-nameCache shift from removing
files; the real 1a payload on the floor is the `mapArray` `$TRACK` read and
`affects()` branch — tens of bytes.)

Floor per-module (min) base → 1b: core.js 8922 → 8684 (−238), scheduler.js
8051 → 7584 (−467), async.js 4277 → 4103 (−174), owner.js 1469 → 1444 (−25),
heap.js 1017 → 949 (−68), graph.js 767 → 747 (−20), constants.js 477 → 425
(−52), effect.js 826 → 829, lanes.js 627 → 629, error.js 268, signals.js 267.

Bytecode (prod dist, length/frame): read 1001/128 → 962/104; setSignal
473/56 → 420/48 (1a already: Rollup folded `projectionWriteActive` once its
only writer module was gone); recompute 4708/512 → 4643/496; readNodeFast
gone (it was the store's fast path — never compiled by non-store code).

Gates: typecheck clean. Tests (all files incl. tests/store — the exclude
glob did not bite, classification by message instead): 4713 run, 2172 pass,
2539 fail of which 2534 throw `[CARVED] <storeApi>` (1383 createStore, 986
createOptimisticStore, 99 createProjection, 46 merge, 18 omit, 2 isStatic),
1 STACK_TRACE_ERROR in tests/store/createStore.test.ts, and 4 meta-tests:
dist-artifacts "observe literals are the prod literals plus their slots"
(calls `core.slotSignal` — removed on purpose) and rules-index ×3
(docs/RULES-INDEX.md stale because rule-ID citations in src/store are
gone). **Zero non-store test regressions.** Posture matrix: the 14
signal-side sections (590 lines) are byte-identical to baseline; the 6 store
sections are empty (removed cells). Oracle: signal-side violations/
unspecified identical; store oracle sections empty.

Coupling inventory — what core carried for the store (every 1b edit):

| #   | core site                                                                                                                                                                                                                                                                                                     | what it was                                                                                                            | kind                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| C1  | types `NodeExtension._child`, `_companionChildren`; `FirewallSignal` type (`_firewall/_nextChild/_prevChild`)                                                                                                                                                                                                 | slot signals hang off their projection computed via a child chain so pending/latest companions and markNode reach them | node-literal slots (observe/prod literal shape)                         |
| C2  | constants `CONFIG_CHILD_COMPANIONS`, `CONFIG_FW_CHILDREN`, `CONFIG_SLOT_NODE`, `STORE_SNAPSHOT_PROPS`                                                                                                                                                                                                         | config bits gating the child walks / slot dispatch; snapshot prop list                                                 | flag bits                                                               |
| C3  | core.ts `slotSignal`, `linkFirewallChild/unlinkFirewallChild`, `slotUnobservedHook/setSlotUnobserved`, `readNodeFast`/`READ_SLOW`, `signal(v, opts, firewall)` 3rd param                                                                                                                                      | the store leaf constructor and its fast read path                                                                      | separable (moves with store)                                            |
| C4  | core.ts `read()`: `owner = el._firewall \|\| el` for status/height/error; `serve(el, c, owner)`; `unflushedValue(el, committed)`; `enterStagedRead(null)` for backings; `_pendingCheck(el, c, owner, firewall)`                                                                                               | a store leaf answers for its projection's status                                                                       | **needs seam** — hot path (`read` frame 128→104)                        |
| C5  | core.ts `recompute()`: `prevInFlight/inFlightChanged` probe                                                                                                                                                                                                                                                   | createProjection self-registers a flight, recompute must not clobber it                                                | needs seam (recompute frame 512→496)                                    |
| C6  | core.ts `setSignal`: `projectionWriteActive` → `_landOnOverride` arm; dev store-setter guards (`ASYNC_STORE_SETTER_MESSAGE`, `devGuardStoreSetterWrite/Result`); captureWriteSnapshot firewall check                                                                                                          | authoritative store landing through the projection-write channel                                                       | separable (Rollup folded the arm itself in 1a; dev guards are dev-only) |
| C7  | core.ts `heldDerivation`: `el._firewall \|\| el` for the MANUAL_WRITE test; `updateIfNecessary` `dep._firewall \|\| dep`                                                                                                                                                                                      | same owner resolution in the hold rules                                                                                | needs seam                                                              |
| C8  | scheduler.ts `transientStoreNodes`/`deferSlotRelease`/`sweepTransientStoreNodes` (+ `canUseSimpleSyncFlush` terms)                                                                                                                                                                                            | deferred release of slot nodes created mid-flush                                                                       | separable (hook)                                                        |
| C9  | scheduler.ts `withheld`/`scheduleWithheld` (schedule() → plain `queueMicrotask(flush)`)                                                                                                                                                                                                                       | projection writes withheld until the store batch closes                                                                | separable                                                               |
| C10 | scheduler.ts `Transition._optimisticStores` (+ createBatch/merge/fresh/initTransition adoption), `_clearOptimisticStores`, `_trackOptimisticStore`, `endOptimism` size check, attribution census                                                                                                              | optimistic store roots tracked per transition                                                                          | separable (Set on every transition literal)                             |
| C11 | scheduler.ts `storeCommitHook/setStoreCommitHook`, `_releaseAffectsScope`, `_updateChildCompanions`, `setProjectionWriteActive`, reporterBlocksSource `_firewall === source`                                                                                                                                  | GlobalQueue hook slots the store installs into                                                                         | hook slots (cheap each, ~10 statics)                                    |
| C12 | heap.ts `markNode` CONFIG_FW_CHILDREN child walk; `adjustHeight` `dep._firewall \|\| dep`                                                                                                                                                                                                                     | propagation reaches slot leaves through the projection                                                                 | needs seam (r3 heap — kept pins intact, only the walk went)             |
| C13 | graph.ts unobserved dispatch `CONFIG_SLOT_NODE ? slotUnobservedHook : _x._unobserved`                                                                                                                                                                                                                         | slot leaves' release path                                                                                              | hook                                                                    |
| C14 | owner.ts `CONFIG_CHILD_COMPANIONS` companion snap on dispose                                                                                                                                                                                                                                                  | companion cleanup for slot children                                                                                    | slot                                                                    |
| C15 | async.ts `retryReaches` `_firewall`, `forEachDependent` `_child` walk, two `_updateChildCompanions` blocks                                                                                                                                                                                                    | async landing reaches slot leaves / repolls their companions                                                           | needs seam                                                              |
| C16 | verdict.ts `markFirewallChildCompanions`, `updateChildCompanions`, `_child` walk in `repollDownstreamVerdicts`, `_firewall` owner in `collectPendingSources`/`markWalk`/`computePendingState`/`uninitializedSource`/`latestRead`/`latestShadowWithInitializedParent`, `pendingCheckRead(el,c,owner,firewall)` | isPending/latest verdicts answer through the projection for store leaves                                               | needs seam (but verdict itself is carve 2)                              |
| C17 | map.ts `$TRACK` read; affects.ts `Store` overloads + `$TARGET` branch + `_x._child` test                                                                                                                                                                                                                      | public API touch points                                                                                                | separable                                                               |

Verdict for step 1: **~330–350 B br on the floor/CSR** for the store's core
residue, plus ~7.8–7.9 KB br module cost when the store is actually used
(SC pages). Separable outright: C3, C6, C8, C9, C10, C11, C13, C14, C17
(module + hook slots). Needs a seam (a store node must answer for its
projection in read/hold/height/verdict): C4, C5, C7, C12, C15, C16 — i.e.
the `owner` resolution is the single structural coupling; everything else
is registration.

#### Step 2 — optimistic + verdict (2a: module removal, 2b: core residue)

2a = `git rm src/core/optimistic.ts src/core/verdict.ts src/affects.ts`,
throw-stubs for `createOptimistic`, `isPending`, `latest`, `affects`,
`createOptimistic` body dropped from `signals.ts`. The engine was already
lazily installed (`installOptimisticEngine()`), so 2a only moves the
scenarios that REACH it; the floor delta is the mangler shift + folded
flags.
2b = removal of everything core carried FOR the lanes/overrides/verdicts
that the bundler cannot fold: ~30 `GlobalQueue` hook statics, CONFIG-bit
gated arms, NodeExtension slots, `Transition._optimisticNodes/_affectsNodes`,
`currentOptimisticLane` routing, `src/core/lanes.ts` (627 B min that DID
reach the floor), `REACTIVE_OPTIMISTIC_DIRTY`/`REACTIVE_REASK`,
`CONFIG_HELD_TRUTH` + the `heldRevealed` post-revert wake, the
`Link._pendingObserver` label, `getObserver()`'s `PENDING_OWNER` arm.

| scenario                                         | base br      | 1b br | 2a br | 2b br | Δ 2a (modules) | Δ 2b (core residue) | Δ step 2 | Δ cumulative br | Δ cumulative min                        |
| ------------------------------------------------ | ------------ | ----- | ----- | ----- | -------------- | ------------------- | -------- | --------------- | --------------------------------------- |
| signals: core floor                              | 9508         | 9174  | 9121  | 7562  | −53            | **−1559**           | −1612    | **−1946**       | −5847                                   |
| app: render + one signal                         | 11970        | 11647 | 11618 | 10070 | −29            | −1548               | −1577    | −1900           | −5849                                   |
| app: hydrating (no stores)                       | 19663        | 19335 | 19309 | 17630 | −26            | −1679               | −1705    | −2033           | −6209                                   |
| app: CSR                                         | 14901        | 14555 | 14489 | 12824 | −66            | **−1665**           | −1731    | **−2077**       | −6133                                   |
| signals: + isPending/latest (now = floor + stub) | 12160        | 11661 | 9189  | 7626  | −2472          | −1563               | −4035    | −4534           | −14578                                  |
| signals: + createStore (floor + stub)            | 16848        | 9226  | 9171  | 7609  | −55            | −1562               | −1617    | −9239           | −31238                                  |
| app: hydrating + every store family              | 30789        | 21560 | 20227 | 18584 | −1333          | −1643               | −2976    | −12205          | −42659                                  |
| page: base SC                                    | 46193        | 38066 | 38030 | 36382 | −36            | −1648               | −1684    | −9811           | −34942                                  |
| page: live SC                                    | 50442        | 42046 | 39500 | 37829 | −2546          | −1671               | −4217    | −12613          | −44113                                  |
| server: floor / renderToString                   | 1331 / 20372 | =     | =     | =     | 0              | 0                   | 0        | 0               | 0 (server dist does not import signals) |

Reading: the optimistic/verdict MODULE costs ≈2.5 KB br where reached
(+isPending/latest −2472, live SC −2546; the store scenario's −1333 is
createOptimisticStore's share). The CORE RESIDUE — paid by every consumer,
floor included — is **≈1.55–1.68 KB br** (≈4.7 KB min), i.e. ~5× the
store's residue and 16–17 % of the baseline floor. Step 1 + 2 together:
floor 9508 → 7562 br (−20.5 %), CSR 14901 → 12824 (−13.9 %).

Floor per-module (min) base → 1b → 2b: core.js 8922 → 8684 → 6881
(−1803 in 2b), scheduler.js 8051 → 7584 → 6069 (−1515), async.js 4277 →
4103 → 3468 (−635), lanes.js 627 → 629 → 0, constants.js 477 → 425 → 209
(−216), graph.js 767 → 747 → 725, owner.js 1469 → 1444 → 1433, heap.js 1017
→ 949 → 957, effect.js 826 → 829 → 832, error.js 268 → 273, signals.js 266
→ 271. Signals total 26967 → 25929 → 21118 min. CSR additionally:
boundaries.js 2964 → 2888 (−76: `_rearmLane`/`_swap(lane)`), map.js 3276 →
3271 (`_laneSlots` write dispatch).

Bytecode (prod dist, length/frame) 1b → 2b: read 962/104 → **776/104**
(−186 B: override/gated-read arms, `latestRead`/`pendingCheck` branches,
`laneSuspends`); setSignal 420/48 → **301/48** (−119: `CONFIG_OPTIMISTIC`
dispatch, companions sync, `reaskArmed` term); recompute 4643/496 →
**3384/424** (−1259 B, frame −72: lane resolution at entry, lane-scoped
`currentOptimisticLane` save/restore, `_laneOverride` publish arm,
`_supersedeOverride`/companion arms after the equals check, `_applyReask`,
override-aware `compareValue`). Cumulative vs base: read −225, setSignal
−172, recompute −1324/−88 frame. Correctness of the trimmed frames is
covered by the gates below; whether the smaller `recompute` is also faster
is for the perf gate at the end state (CodSpeed + Octane), not asserted here.

Gates: typecheck clean. Full suite 4713 run, 1299 pass, 3412 fail. Direct
`[CARVED]` throws: 3280 (1383 createStore, 985 createOptimisticStore, 556
createOptimistic, 117 isPending, 99 createProjection, 71 latest, 46 merge,
18 omit, 3 affects, 2 isStatic). Remaining 140 non-`[CARVED]` failures in 39
files, triaged three ways:

1. 27 fail IN ISOLATION too, every one a removed cell reached indirectly:
   `isPending`/`latest`/`affects` called inside an effect/memo/action body
   so the throw surfaces as the effect's missing output (`expected [] to
equal [1]`, `resolveIt is not a function` = the action generator threw
   at `affects()` before assigning), plus `settle-walk-invariant` "derived
   lane override (#3648)" which constructs a fake node with
   `CONFIG_DERIVED_OVERRIDE` by hand.
2. 82 PASS in isolation — cross-test pollution: a `[CARVED]` throw aborts a
   test mid-flight and its unflushed queue / in-flight async leaks into the
   next test in the same file (action.test.ts ×14, createMemo.test.ts ×29,
   createLoadingBoundary ×4, createErrorBoundary ×5, …). Confirmed at FILE
   level: re-running the 15 affected files with only the removed-cell tests
   excluded by name → **235 passed, 0 failed** (/tmp/carve/s2b-filelevel.log).
3. Meta/removed-cell tests: treeshake ×3 (fixtures expect
   `core/optimistic.ts`/`core/verdict.ts` to load), dist-artifacts
   (`core.slotSignal`), rules-index ×3, visibility-oracle ×14 (all
   `throws:Error` cells for the `latest`/`isPending` readers or
   createOptimistic sections), posture-born-held "latest() entangles",
   posture-store-parity, tests/store ×7 STACK_TRACE_ERROR.
   **Zero retained-test regressions.** In particular `until-entanglement`,
   `held-truth-lane-only` (name confirms HELD_TRUTH is "masked from lane
   passes only"), refresh/`markRefresh`, action, boundary (3540/3648) and
   scheduler-livelock suites all pass minus their `isPending`/`latest` cases —
   which validates the three judgment calls in 2b (HELD_TRUTH + heldRevealed,
   REACTIVE_REASK/`_applyReask`, `Link._pendingObserver`) as optimistic/verdict-
   only. Posture matrix: the 8 retained signal-side sections (committed,
   staged-ambient, held-by-action, pending-own-async ×2, uninitialized, loading
   window ×2) are row-identical to baseline once the removed readers
   (`latest`, `isPending`), the removed posture (`foreignLane`) and the
   `isPending` component of the after-gate column are dropped (22 rows each);
   the 7 optimistic sections + 17 store sections are empty. Oracle: violations
   empty (as baseline); the one retained "unspecified" line (pending own async
   × staleForeign, #3305) is identical; the 6 dropped lines were all
   override/superseded/held-truth cells.

Coupling inventory — what core carried for optimistic/verdict (every 2b edit):

| #   | core site                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | what it was                                                                                                            | kind                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| O1  | scheduler.ts `GlobalQueue` ~30 null statics (`_recomputeLane`, `_laneOverride`, `_supersedeOverride`, `_overrideRead`, `_gatedRead`, `_laneSuspends`, `_laneLive`, `_laneReadsCommitted`, `_laneAsyncPending/Settled`, `_optimisticWrite`, `_landOnOverride`, `_resolveOptimistic`, `_endOptimism`, `_transitionBlocked`, `_cleanupLanes`, `_runLaneEffects`, `_syncCompanions`, `_snapCompanions`, `_updatePendingSignal`, `_latestRead`, `_pendingCheck`, `_recordFresh`, `_applyReask`, `_repollVerdicts`, `_markAffects`, `_releaseAffectsMark(s)`, `_witnessAffects`, `_wakeSuppressedProbes`, `_drainPatchOptimistic`, `_verdictPull`) | the install surface the engine writes into; each has a call site in core guarded by a CONFIG bit or `activeLanes.size` | hook slots — separable, but the CALL SITES are the residue (see O3–O8)                                   |
| O2  | constants: `REACTIVE_OPTIMISTIC_DIRTY`, `REACTIVE_REASK`, `CONFIG_OPTIMISTIC`, `CONFIG_HAS_COMPANIONS`, `CONFIG_HAS_LANE`, `CONFIG_AUTHORITATIVE_OBSERVED`, `CONFIG_HELD_TRUTH`, `CONFIG_OVERRIDE_SUPERSEDED`, `CONFIG_DERIVED_OVERRIDE`, `CONFIG_LANE_FRAME`, `LANE_RUN`, `OVERRIDE_UNDEFINED`/`unwrapOverride`                                                                                                                                                                                                                                                                                                                             | 10 flag bits + the override-undefined sentinel                                                                         | flag bits (cheap alone; they gate O3–O8)                                                                 |
| O3  | core.ts `recompute()`: lane resolution at entry (`_recomputeLane` ×3 arms), `currentOptimisticLane`/`latestReadActive` save-restore, `compareValue` reading the visible override, `_laneOverride` publish vs `_value =`, `hasOverride`/`prevVisible` insertSubs condition, `_supersedeOverride` on equal/held landings, `_syncCompanions`, `_applyReask`, `laneFrame` term in `needsPendingCommit`, `LANE_RUN` passed to `recomputeEnd`                                                                                                                                                                                                      | the recompute hot path speculates per lane and reconciles override vs truth                                            | **structural** — hot path (recompute −1259 B / frame −72)                                                |
| O4  | core.ts `read()`/`serve()`: `hasActiveOverride` → `_overrideRead`/`unwrapOverride`/`CONFIG_AUTHORITATIVE_OBSERVED`; `_gatedRead` under a lane; `latestReadActive`/`pendingCheckActive` arms (`_latestRead`, `_pendingCheck`); `_laneSuspends` before the NotReady throw; `heldRevealed`/`CONFIG_HELD_TRUTH` arm of `readerSeesCommitted`; `enterStagedRead`'s `_laneLive`/`_laneReadsCommitted` arms                                                                                                                                                                                                                                         | reads answer with the override, and verdict probes route through the same `read`                                       | **structural** — hot path (read −186 B)                                                                  |
| O5  | core.ts `setSignal()`: `CONFIG_OPTIMISTIC → _optimisticWrite` dispatch, companion sync + `unflushedCompanions` resync, `reaskArmed` term; `markRefresh` REASK marking                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | optimistic writes fork at the setter                                                                                   | hot path (setSignal −119 B); dispatch itself is one bit test — separable if the companion/reask terms go |
| O6  | core.ts module state `currentOptimisticLane`, `notifyOnLane`, `pendingCheckActive`/`latestReadActive` + setters, `optimisticSignal`/`optimisticComputed`, `unflushedOverride`/`hasActiveOverride`/`visibleOverride`, `unflushedCompanions`                                                                                                                                                                                                                                                                                                                                                                                                   | the lane channel + verdict glue                                                                                        | separable (moves with the engine)                                                                        |
| O7  | types `NodeExtension`: `_overrideValue`, `_overrideTime`, `_optimisticLane`, `_pendingSignal`, `_latestValueComputed`, `_parentSource`, `_reask`, … (11 slots) → `ext()` literal shrank from 22 to 11 fields; `Link._pendingObserver`; `Transition._optimisticNodes`, `_affectsNodes`                                                                                                                                                                                                                                                                                                                                                        | per-node / per-link / per-transition slots allocated for every consumer                                                | node-literal slots (allocation shape, not just bytes)                                                    |
| O8  | scheduler.ts: `insertSubs(node, optimistic)` 2nd arg + `REACTIVE_OPTIMISTIC_DIRTY` marking, `laneZombie` in `zombieQueue._update`, `enqueue(type, fn, lane)` 3-arg routing, `activeLanes.size` terms in `canUseSimpleSyncFlush`/`run`, `_runLaneEffects` ×2, `_endOptimism`/`_resolveOptimistic`/`_releaseAffectsMarks`/`heldRevealed`/`_cleanupLanes` in `finalizePureQueue`, `_transitionBlocked` in `transitionComplete`, lane-frame arm in `reporterBlocksSource`, `mergeTransitionState` lane/optimistic/affects merges, `activeAffectsMarks`/`shiftAffectsMarks`, dev `devCheckActiveOverrides`/`devCensusCompanions`                  | the flush has a lane phase and an optimism-ending step                                                                 | **structural** in `finalizePureQueue`; the rest is routing (separable)                                   |
| O9  | async.ts `asyncWrite`: override branch (land into `_pendingValue` + `_supersedeOverride`) and lane branch (`_laneOverride` + `insertSubs(el, true)`); `waitingTransition` for lane-owned flights; `notifyStatus` `_pendingObserver` short-circuit; `clearStatus` `_reask`/companions                                                                                                                                                                                                                                                                                                                                                         | async landings under a lane or over an override                                                                        | needs seam (landing path forks 3 ways)                                                                   |
| O10 | effect.ts `LANE_RUN` on creation, `_optimisticLane` exemption in `runEffect`'s ownership gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | lane effects apply ahead of their transaction                                                                          | separable (one term)                                                                                     |
| O11 | graph.ts `link(dep, sub, pendingObserver)` label + AND-combining on repeat touches                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | isPending probes must not relabel value deps                                                                           | separable (verdict-only)                                                                                 |
| O12 | owner.ts `getObserver()` `PENDING_OWNER` arm; `disposeChildren` `_snapCompanions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | verdict probes own no children; companions snapped on dispose                                                          | separable                                                                                                |
| O13 | map.ts `_laneSlots` write dispatch (`_landOnOverride` vs `setSignal`); boundaries.ts `_rearmLane`, `_swap(lane)` + `notifyOnLane`, `_settled._affectsCount`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | list slots and boundaries re-arm on the lane channel                                                                   | separable (one dispatch each)                                                                            |
| O14 | attribution.ts `isCompanion`, `censusRegistrations`, companion acknowledge; invariants.ts INV-1/2/4/5/6 (override/companion/lane invariants)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | dev-only observers of the same slots                                                                                   | dev-only (0 B prod)                                                                                      |

Verdict for step 2: **≈1.55–1.68 KB br on the floor/CSR** for the
optimistic/verdict core residue (≈4.7 KB min), plus ≈2.5 KB br module cost
when reached. This is the largest single residue so far and it is NOT
registration: O3, O4, O8 are the hot paths (`recompute`, `read`/`serve`,
`finalizePureQueue`) carrying a second value channel (override) and a
second notification channel (lane) through every branch. Separable
outright: O1 (slots), O6, O10–O14 (~a few hundred bytes together). Needs a
seam: O5, O9 (setter/landing fork). Structural: O3, O4, O7, O8 — a
speculative value channel cannot be bolted on from outside without
recompute/read/finalize knowing about it, so a modular build would need the
"second channel" to be a pluggable strategy at exactly those four points.

#### Step 3a — transactions: the implicit transition layer (holds, parks, zombies, entanglement) + `action`

Scope. Everything the scheduler/core carried for "a write (or the batch a
pending read lands in) is held until the flights it caused settle": the
`Transition` object and set, the ambient batch as a transaction,
`initTransition`/`runInTransition`/`restoreTransition`, the verdict
(`transitionComplete` + `reporterBlocksSource` + `_asyncReporters`),
`stashQueues`/`restoreQueues` (`IQueue._stash/_restore`), `mergeTransitionState`,
`wokenTransitions` + the wake loop, `finalizePureQueue`'s three arms,
`zombieQueue`/`queueFor`, `heldTrims`, `flightOrigin`, `actionStepDepth`,
`patchCommitHook`; in core the stamped-memo re-entry, `markDisposal`/zombies
(`_pendingFirstChild`/`_pendingDisposal`, `REACTIVE_ZOMBIE`,
`CONFIG_HELD_CHILDREN`), A29 staged-read entry (`enterStagedRead`/`stagedEntry`,
born-held), A28-across-holds (`unflushed`/`unflushedRewrites`/`stashHeldRewrite`,
`heldDerivation`/`rederiveHeld`, `CONFIG_ADOPTED_UNFLUSHED`), A34 `batchJoins`,
authoritative reads (`installAuthoritativeRead`, `notifyAuthoritativeObservers`,
`recordStaleReplay`), `_valueTransition` + `runEffect`'s ownership gate,
`Effect`/`refresh()`/`resolve()` queue swaps (`MicrotaskQueue`); plus
`src/core/action.ts` (throw-stub `action`). **Kept verbatim:** async core
(NotReady, status propagation, landings, settle walk), heap r3, same-flush
staging (`_pendingValue` → `queuePendingNode` → `commitPendingNode(s)`,
A28's one-flush purity, #3009) — 3b would measure that separately.
**Design calls in the carve:** effects commit directly (`create || isEffect`);
`recompute` disposes previous children at the pass (no zombies); an unchanged
pass trims deps at once (no `heldTrims`); `GlobalQueue.flush()` collapsed to
sweep → heap → rearms → commit → boundary children → late heap → effects.
**Seam introduced (listed separately, T12):** `CollectionQueue._forwarded`, a
per-`on`-boundary set of the readers it forwarded while initialized, read by
`_rearm` through `_pendingSources` — the boundary used to borrow the
transaction's reporter registry for this.

| scenario                                   | base br      | 2b br | 3a br     | Δ 3a br   | Δ cumulative br     | Δ 3a min | Δ cumulative min |
| ------------------------------------------ | ------------ | ----- | --------- | --------- | ------------------- | -------- | ---------------- |
| signals: core floor                        | 9508         | 7562  | **5426**  | **−2136** | **−4082 (−42.9 %)** | −6388    | −12235           |
| app: render + one signal                   | 11970        | 10070 | 7889      | −2181     | −4081               | −6390    | −12239           |
| app: hydrating (no stores)                 | 19663        | 17630 | 15486     | −2144     | −4177               | −6401    | −12610           |
| app: CSR                                   | 14901        | 12824 | **10724** | **−2100** | **−4177 (−28.0 %)** | −6380    | −12513           |
| signals: + isPending/latest (floor + stub) | 12160        | 7626  | 5497      | −2129     | −6663               | −6388    | −20966           |
| signals: + createStore (floor + stub)      | 16848        | 7609  | 5478      | −2131     | −11370              | −6388    | −37626           |
| app: hydrating + every store family        | 30789        | 18584 | 16463     | −2121     | −14326              | −6401    | −49060           |
| page: base SC                              | 46193        | 36382 | 34231     | −2151     | −11962              | −6419    | −41361           |
| page: live SC                              | 50442        | 37829 | 35504     | −2325     | −14938              | −7161    | −51274           |
| server: floor / renderToString             | 1331 / 20372 | =     | =         | 0         | 0                   | 0        | 0                |

Reading: **≈2.1 KB br (≈6.4 KB min) on every scenario**, floor and pages
alike — the largest single step, and all of it residue in the sense of step
2: no module left the floor (action.js was never in it — it is shaken as a
module at baseline, so the `action` API's floor cost is its hooks only:
`Transition._actions`, the `_actions.length` term of the verdict,
`actionStepDepth`, `origin`). The −2.1 KB is the IMPLICIT transition layer
as built. Live SC pays ≈0.2 KB more (its `action` call site reaches the
module). Cumulative: floor 9508 → 5426 br, CSR 14901 → 10724.

Floor per-module (min) 2b → 3a: scheduler.js 6069 → **2347** (−3722),
core.js 6881 → **4799** (−2082), owner.js 1433 → 1124 (−309: `markDisposal`,
the zombie chain walk in `disposeChildren`/`runDisposal`, the #3372 wake
push), async.js 3468 → 3319 (−149: `settleTransition`/`waitingTransition`,
origin, the pre-throw `initTransition`s), constants.js 209 → 131 (−78: 6
bits), effect.js 832 → 781 (−51: `_valueTransition`, ownership gate),
heap.js 957 → 936 (−21: `queueFor`), graph.js 725 → 735, error.js 273 → 280,
signals.js 271 → 278 (mangler shift). Signals total 21118 → **14730 min**.
CSR: web.js +169, map.js +95, boundaries.js +58, solid.js +40 — the
name-cache shift, as in every step (boundaries also carries the +`_forwarded`
seam, ≈30 B br).

Bytecode (prod dist, length/frame) 2b → 3a: read 776/104 → **687/80** (−89,
frame −24: the `activeTransition` fast-path term, staged-read entry,
authoritative/replay arms, `readerSeesCommitted`'s hold arms); setSignal
301/48 → **201/32** (−100, frame −16: `batchJoins`, stamping,
`stashHeldRewrite`, `CONFIG_ADOPTED_UNFLUSHED`); recompute 3384/424 →
**1704/336** (−1680, frame −88: stamped re-entry, `queueFor`, the
zombie/`markDisposal` branch, `stagedEntry` save/restore, `wasLoading`,
`heldTrims` vs trim, the `needsPendingCommit`/`held`/`CONFIG_HELD_CHILDREN`
tail, the contested re-run under `runInTransition`). Cumulative vs base:
read 1001 → 687 (−314), setSignal 473 → 201 (−272), recompute 4708 → 1704
(−3004, frame 512 → 336). `recompute` is now 36 % of its baseline length.

Gates: typecheck clean (29 files; `Transition` survives as a type in
attribution-hooks.ts for the observe tier; no downstream reference to any
removed internal — `solid`/`web` `action` re-exports resolve to the stub).
Full suite 4711 run, 1005 pass, 3706 fail. Direct `[CARVED]` throws: 3533
(1383 createStore, 984 createOptimisticStore, 542 createOptimistic, **298
action**, 103 isPending, 99 createProjection, 57 latest, 46 merge, 18 omit,
2 isStatic, 1 affects). Remaining 173 non-`[CARVED]` failures:

1. 109 fail IN ISOLATION (/tmp/carve/s3a-isolated.json), all removed cells:
   - 23 carved-indirect (`isPending`/`latest`/`action` inside an effect or
     memo body — createMemo ×11 incl. "not pending between yields" whose
     effect callback calls `isPending`, latest-\* ×5, createEffect, spec A19,
     settle-walk derived-lane, ispending-in-boundary-on, untracked-read-after-
     await, scheduler-livelock `isPending(() => latest(x))`, affects-propagation);
   - 57 hold-model cells, under the reclassification agreed 2026-09-30
     (hold-model = removed regardless of whether `action` appears): A15
     entanglement/stale-reader carve-out (overlapping-flights ×3,
     ispending-combined-atomic control, reveal-carve-out ×2,
     first-observer-stale-reader, shared-effect-no-entangle ×2,
     superseded-source-blocks-3462 ×2, stale-read-uninitialized-cross-
     transition ×2), A26/A29 ambient adoption (late-pending-equality,
     router-transition-error-commit, loading-value A27, boundary-not-born-
     held-3540 ×4, held-conditional-memo A29), A30 kept tail / held children
     (async-landing-deps-3461 ×2, held-conditional-effect, held-conditional-
     memo A30, held-frame-dependencies ×2, pending-source-repark ×2), A33/A34
     (async-chain-supersession ×5, write-proposals-3494 ×2, held-derivation-
     3612 ×2, loading-reset-collects-forwarded-3459, loading-on-frame-
     following-3540 ×4 incl. the LOADING_ON_OUTSIDE_HOLD dev diagnostic),
     zombies (createMemo zombie auto-dispose, nested-render-effect-async-
     cleanup #3404 ×4, transition-orphan-recompute, zombie-rerun-after-
     commit-3546 ×2, scheduler-livelock's `zombieQueue` import), contested
     effects #3322 ×2, held-restore/#3372 wake ×3;
   - 29 attribution hold hooks (observe tier: holdStart/holdEnd/
     transitionSettled, held navigations, SILENT_HOLD/STACKED_HOLDS/
     LONG_HOLD, HeldWrite previews, `feedback().holds`).
     The retained half of router-transition-error-commit (async error reaches
     the `Errored`, the write and its user effect land) was re-run as a
     throwaway test with the hold assertion dropped: passes.
2. 43 PASS in isolation — cross-test pollution as in step 2. Confirmed at
   FILE level: the 11 affected files with only removed-cell tests excluded
   by name → **116 passed, 0 failed** (/tmp/carve/s3a-filelevel.log).
   createLoadingBoundary 13/13, createErrorBoundary 24/24, createMemo 43/43.
3. 21 meta/removed-cell: treeshake ×3, dist-artifacts, rules-index ×3,
   visibility-oracle ×12 (HELD/`throws:NotReady` cells for action-held and
   entangled postures), posture-born-held P1, store/ STACK_TRACE.
   **Zero retained-test regressions.** `createLoadingBoundary.on` 7/7 and
   `createRevealOrder` 38/38 pass on the `_forwarded` seam (its first draft
   tested the reader's status flag, which a boundary tree consumes on itself;
   liveness is the reader's `_pendingSources`, as `reporterBlocksSource` had it).

Posture matrix (/tmp/carve/s3a-posture.md vs s2b): 110 rows removed — the
`foreignAction` posture in every section, and the whole sections "held by a
live action", "override active/ambient", "superseded ×2", "body ended",
"un-superseded", "held truth", "loading window over a held input". **One
flip class, 8 rows, reported as a semantic delta rather than a removal:** in
"pending own async (initialized memo refetching on a new question, flight
up)", the `effect`/`effectUntracked` readers × mainline/behindFallback/
disposedReader go from served `0` / pass `0` (A15's render-effect stale-
reader carve-out: served the pre-write committed world because the write
was held) to **`HELD` / `throws:NotReady`** (no hold: the write committed,
the memo is pending on the new question, the effect blocks until it lands);
and the `gatedAway` after-gate column's SOURCE reading goes `0 → 1` (the
source write is no longer held behind the flight). After the flip the
section is row-identical to "pending own async, observed only by the matrix
reader (fuzzer P1)" — the hold model distinguished "observed by others" from
"observed only by me"; without it the two postures are the same posture.
Oracle: violations empty before and after; the single `unspecified` cell
(pending own async × staleForeign, #3305) moves `0 → HELD`, the same flip.

Semantic deltas of 3a (user-visible; the explicit list the reclassification
requires — none of these is a regression against a retained rule, each is
the implicit transition layer's absence):

- **S1 (headline) a mainline write whose downstream goes async commits at the
  flush instead of being held** — `route()` reads `/plugins` while the lazy
  route is in flight; `B: 1` publishes at t=0 beside `Slow: 0`; the posture
  source column above. Readers of the in-flight memo block (NotReady) rather
  than being served the pre-write frame; sibling effects that read only the
  source publish — the tearing a no-implicit-hold model accepts.
- **S2 the old frame goes dead at the pass** (the tab test fails as the
  "ghost": `disposeChildren` at recompute, `onCleanup`s run before the new
  frame lands, a parked owner's children stop reacting). #3404 ×4, #3463,
  #3546, transition-orphan-recompute. The zombie primitive is the fix and
  is NOT in this floor — see "learning cost" below.
- S3 overlapping flights sharing a reader reveal at their own landings; no
  entanglement (A15), no re-park (#3456), no A34 proposal/tick-mate holds.
- S4 render-effect run ownership is gone (#3319/#3322): a run applies in the
  flush that computed it.
- S5 **public surface on the branch:** `action` removed (stub);
  `installAuthoritativeRead` (core/index internal) removed; DEV diagnostic
  `LOADING_ON_OUTSIDE_HOLD` no longer emitted; observe-tier hooks
  `holdStart`/`holdEnd`/`transitionSettled`/`transitionMerged` and the
  `transition` arg of `boundaryFallback` are typed but never fire;
  `feedback().holds`/SILENT_HOLD/STACKED_HOLDS/LONG_HOLD never report.
- Kept: A28 one-flush purity (untracked reads during a flush serve committed
  values; writes land at flush end), NotReady/status propagation, boundary
  `on` re-arm semantics (7/7), reveal order (38/38), error routing (24/24).

Coupling inventory — what core carried for the transition layer (every 3a edit):

| #   | core site                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | what it was                                                                                                                                      | kind                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | scheduler.ts: `Transition` (`_time`, `_pendingNodes`, `_queueStash`, `_asyncReporters`, `_actions`, `_acted`, `_done`), `transitions`, `activeTransition`, `_batch`-as-transaction, `initTransition`/`runInTransition`/`restoreTransition`, `transitionComplete` + `reporterBlocksSource` (the verdict), `stashQueues`/`restoreQueues` + `IQueue._stash/_restore`, `mergeTransitionState`, `wokenTransitions` + finally-loop wake, `finalizePureQueue` ×3 arms, `zombieQueue`/`queueFor`, `heldTrims`, `flightOrigin`/`setOrigin`, `actionStepDepth`, `patchCommitHook`, reporter registration in `GlobalQueue.notify`, `_markVisual` | the flush had a verdict phase (complete → commit, else park) and a park/restore phase; every queue is stashable                                  | **structural** in `flush()` (−3.7 KB min); the Transition object + stash/restore are separable IF the flush exposes one seam — "end of pure phase: commit or park"   |
| T2  | core.ts `recompute()`: head — stamped-memo re-entry, `queueFor`, the `markDisposal`/zombie branch keyed on `CONFIG_HELD_CHILDREN`/`CONFIG_LANE_FRAME`; body — `stagedEntry` (born-held) save/restore, `wasLoading`, `REACTIVE_ZOMBIE` carried through three `_flags` wipes; tail — `heldTrims` vs trim, `needsPendingCommit`/`held`/`CONFIG_HELD_CHILDREN`, the contested re-run under `runInTransition` with `_valueTransition` ownership, effect direct-commit vs staged, `recomputeEnd(…, inTransition, …)`                                                                                                                        | a pass decides AFTER computing which frame it produced (implicit entry) and parks/releases its children accordingly                              | **structural** — hot path (recompute −1680 B / frame −88); the "decide after" shape is the implicit contract, not the primitive                                      |
| T3  | core.ts `read()`/`serve()`: `activeTransition` fast-path term, `enterStagedRead`/`stagedEntry` (A29 entry on a tracked read), the pending-branch `initTransition` before the NotReady throw, `readerSeesCommitted`'s `ownsHold`/`heldFromStale`/`underFreshLoadingBoundary` arms, `unflushed`/`unflushedRewrites`/`heldDerivation`/`rederiveHeld` (A28 across holds, #3612), `installAuthoritativeRead`/`CONFIG_AUTHORITATIVE_READ`/`notifyAuthoritativeObservers`/`recordStaleReplay`                                                                                                                                                | a read can ENTER a transaction, and must know which of two staged worlds it is served                                                            | **structural** for the staged-read entry (read −89 B / frame −24); authoritative read + replay were already behind CONFIG bits — separable                           |
| T4  | core.ts `setSignal()`/`setMemo()`: `batchJoins` (A34: a write to a stamped node joins its transaction; a same-value write nets to none), `_transition` stamping, `stashHeldRewrite`, `CONFIG_ADOPTED_UNFLUSHED`                                                                                                                                                                                                                                                                                                                                                                                                                       | the setter routes a write to the hold that owns the node                                                                                         | hot path (setSignal −100 B / frame −16); one branch on the stamp — separable if the stamp is the only seam                                                           |
| T5  | constants: `REACTIVE_ZOMBIE`, `CONFIG_AUTHORITATIVE_READ`, `CONFIG_DIRECT_COMMIT`, `CONFIG_HELD_CHILDREN`, `CONFIG_INPUTS_PUBLISHED`, `CONFIG_ADOPTED_UNFLUSHED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 6 bits                                                                                                                                           | flag bits (gate T2–T4)                                                                                                                                               |
| T6  | types: `RawSignal._transition`, `Effect._valueTransition`, `NodeExtension._pendingDisposal`/`_pendingFirstChild`/`_flushedStaged` (11 → 8 slots), `IQueue._stash/_restore`                                                                                                                                                                                                                                                                                                                                                                                                                                                            | per-node stamp + two parked-frame slots + per-queue stash                                                                                        | node-literal slots (the stamp is on EVERY signal)                                                                                                                    |
| T7  | owner.ts: `markDisposal` (flag the subtree, move it to `_pendingFirstChild`), `disposeChildren(node, self, zombie)` walking the parked chain, `runDisposal(node, zombie)` draining `_pendingDisposal`, `queueFor` on heap delete, the `wokenTransitions` push when a pending stamped node dies (#3372)                                                                                                                                                                                                                                                                                                                                | **the zombie primitive proper** — a deferred `disposeChildren` plus a side chain, ≈300 B min; zero allocation (the parked nodes already existed) | the primitive is separable and is the piece to keep; the wake push is a coupling to the verdict (disposal telling the transaction it may be complete)                |
| T8  | async.ts: `settleTransition`/`waitingTransition` (a landing settles the transaction holding the node), `flightOrigin`, `initTransition` before each NotReady throw (A29 for async reads), `notifyStatus` tail (`_pendingNodes` push vs `queuePendingNode`), `CONFIG_INPUTS_PUBLISHED` clear on landing, `REACTIVE_ZOMBIE` in `releaseIfSettledUnobserved`                                                                                                                                                                                                                                                                             | a landing must find "which hold do I settle"                                                                                                     | needs seam (one lookup at the landing)                                                                                                                               |
| T9  | effect.ts `_valueTransition` + `runEffect` ownership gate (#3319); signals.ts `MicrotaskQueue` + `installAuthoritativeRead` in `refresh()`/`resolve()`/`until()` queue swaps                                                                                                                                                                                                                                                                                                                                                                                                                                                          | a run can be owned by a hold other than the flush that computed it                                                                               | separable                                                                                                                                                            |
| T10 | heap.ts `queueFor`/`zombieQueue`; `adjustHeight` inserting into the flag-chosen heap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | zombie reruns scheduled on a second heap, routed by the POSITION bit                                                                             | separable — and an implementation gap (position and scheduling conflated; #3543, scheduler-livelock)                                                                 |
| T11 | graph.ts `queueFor` on `deleteFromHeap`, `REACTIVE_ZOMBIE` checks in `unlinkSubs`/`sweepDormant`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | zombies excluded from unlink/sweep                                                                                                               | separable                                                                                                                                                            |
| T12 | boundaries.ts `_rearm` reading `transitions[*]._asyncReporters` through `reporterBlocksSource`, `reportUnseen`/LOADING_ON_OUTSIDE_HOLD, `_judgeHeld`, `_settled`'s born-held clause, `boundaryFallback(…, transition)`, `REACTIVE_ZOMBIE` in `_holds` → **replaced by `_forwarded: Set` per `on`-boundary (seam introduced by this carve)**                                                                                                                                                                                                                                                                                           | an `on` boundary needs a memory of the readers it forwarded while showing content; it borrowed the transaction's reporter registry               | **needs seam** (the boundary feature is retained; its registry must be its own)                                                                                      |
| T13 | attribution-hooks.ts/attribution.ts: `Transition` type, `holdStart`/`holdEnd`/`transitionSettled`/`transitionMerged`, `boundaryFallback`'s transition arg, reads of `_actions`/`_asyncReporters`/`_pendingNodes`/`_done`                                                                                                                                                                                                                                                                                                                                                                                                              | observe-tier view of holds                                                                                                                       | dev/observe only (0 B prod) — but public observe-tier surface                                                                                                        |
| T14 | action.ts (module, never in the floor) + its hooks: `Transition._actions`, `_actions.length` in the verdict, `actionStepDepth`/`enterActionStep`/`exitActionStep` (dev owned-scope check), `origin`                                                                                                                                                                                                                                                                                                                                                                                                                                   | the explicit API over the implicit layer                                                                                                         | separable as a module; its floor cost is the hooks (tens of bytes) — "actions aren't primary, layered on later" (maintainer, 2026-09-30) is what the inventory shows |

Learning cost (approximate — two methods). The G-ruling pass (2026-09,
dist-stubbing on the then-`next`, floor 9953 br) measured every mainline
hold rule added since rc at **≈0.8 KB br** together and "no implicit holds
anywhere, action-only transactions" at **≈1.2 KB br**. This carve removes
the whole layer for **2.1 KB br**. Read together: the machinery (Transition

- stash/restore + verdict + wake + zombie queue + action hooks) is ≈1 KB and
  the rules that arrived by issue number (A15/A29/A30/A34, contested, held
  children, kept tail, #3372 wake, authoritative replay) are ≈1 KB — about
  1:1, on a primitive (T7) that is ≈0.3 KB min by itself. The split is
  indicative, not exact (different base, different method).

Verdict for step 3: **≈2.1 KB br on floor/CSR (≈6.4 KB min)** for the
implicit transition layer; the explicit `action` API is a shaken module plus
tens of bytes of hooks and is not where the cost is. Structural: T1 (the
flush's verdict/park phase), T2 (recompute deciding its frame after the
pass), T3 (a read entering a transaction) — all three are the IMPLICIT-entry
shape: not knowing at write/read/pass time which frame you are in. The
primitive to keep is T7 (zombies: defer the doomed frame's disposal, zero
allocation — the tab test's answer), minus its wake coupling. Needs a seam:
T4 (setter stamp), T8 (landing → hold), T12 (boundary's own forwarded
registry). Separable: T5/T6 bits & slots, T9–T11, T13–T14. The floor that
remains — 5426 br — is L0+L1: sync graph (heap r3, owner, effects) + async
values (NotReady, propagation, landings, settle walk, same-flush staging),
with no frame concept beyond "committed vs this flush's staged".

Semantic-delta tests to carry into step 2's L2 contract (the one-line
intents the removed cells reduce to): the tab test (two tabs, tab 1's
counter on `setInterval`, navigate to tab 2 which has its own async: tab 1
keeps ticking until tab 2 lands, then the swap is atomic with tab 1's
cleanups at the swap); the ownership invariant (every node, parked or live,
reachable from a live owner at every instant; owner disposal is total —
Solid 1's `tOwned` failure, #3543's near-miss); O2 (creation under a hold)
ruled before any rule about visibility.

#### Step 4 — boundaries (4a: module removal + scheduler queue tree, 4b: core residue)

Scope. `src/boundaries.ts` (`BoundaryComputed`, `CollectionQueue`,
`RevealController`, `createLoadingBoundary`/`createErrorBoundary`/
`createRevealOrder`, `flattenArray`) → throw stubs for the three
constructors; `RevealOrder` kept as a type. **`flatten` is not a boundary** —
it is the children resolver `web`/`universal`/`solid` walk through — so it
moved verbatim to `src/flatten.ts` (550 B min, stays in every app
scenario). 4a also strips what the scheduler carried for the queue tree:
`Rearmable`/`pendingRearms`/`queueRearm`/`drainRearms` (#3540 re-arm between
heap and commit), `IQueue.addChild/removeChild/created/_parent/
_collectionType/_initialized`, `Queue._children/_ranAt/addChild/removeChild`

- the run-token child loop in `Queue.run`, `GlobalQueue.flush()`'s
  fast-path terms (`_children.length`, `pendingRearms.size`), the re-arm drain
- second heap pass, `checkBoundaryChildren` (the commit's `_checkSources`
  sweep) and the late heap/commit block it fed. 4b removes the core residue
  whose only reader was the boundary: the per-owner `_queue` pointer (6
  creation literals in core.ts/owner.ts + `Disposable._queue`; effects
  enqueue/notify `globalQueue` directly), `Queue` folded into `GlobalQueue`
  (one queue; `IQueue` stays as the public type), `NodeExtension._notifyStatus`
  (the boundary's per-node status channel; `statusNotifierOf` is now
  `el._type ? effectStatusNotify : undefined`). **Kept:** `GlobalQueue.notify`
  (root absorbs pending, refuses errors — the effect protocol and the web
  mount contract), `enforceLoadingBoundary`/`_hitUnhandledAsync`/
  `resetUnhandledAsync` (dev; `web/src/client.ts`), `haltReactivity`,
  `ROOT_ERROR_HOOK`, effect.ts's notify/escalate protocol verbatim.
  `spectate` (core.ts) and `reportClientError` (error-hooks.ts) lose their
  only caller; left in source (both already shaken from every scenario at
  s3a — 0 B marginal; error-hooks.js as a MODULE leaves CSR, see below).

| scenario                            | base br      | 3a br | 4a br | **4 br** | Δ 4 br (4a / 4b)        | Δ cumulative br     | 3a min | 4 min     | Δ 4 min |
| ----------------------------------- | ------------ | ----- | ----- | -------- | ----------------------- | ------------------- | ------ | --------- | ------- |
| signals: core floor                 | 9508         | 5426  | 5193  | **5145** | **−281** (−233 / −48)   | **−4363 (−45.9 %)** | 14778  | **13723** | −1055   |
| app: render + one signal            | 11970        | 7889  | 7654  | 7606     | −283                    | −4364               | 22328  | 21270     | −1058   |
| app: hydrating (no stores)          | 19663        | 15486 | 14334 | 14343    | −1143 (−1152 / +9)      | −5320               | 46542  | 42502     | −4040   |
| app: CSR                            | 14901        | 10724 | 9551  | **9498** | **−1226** (−1173 / −53) | **−5403 (−36.3 %)** | 30684  | **26671** | −4013   |
| signals: + isPending/latest         | 12160        | 5497  | 5256  | 5212     | −285                    | −6948               | 14904  | 13849     | −1055   |
| signals: + createStore              | 16848        | 5478  | 5246  | 5198     | −280                    | −11650              | 14871  | 13816     | −1055   |
| app: hydrating + every store family | 30789        | 16463 | 15241 | 15190    | −1273                   | −15599              | 49949  | 45820     | −4129   |
| page: base SC                       | 46193        | 34231 | 33054 | 32990    | −1241                   | −13203              | 109611 | 105476    | −4135   |
| page: live SC                       | 50442        | 35504 | 34328 | 34315    | −1189                   | −16127              | 114088 | 109951    | −4137   |
| server: floor / renderToString      | 1331 / 20372 | =     | =     | =        | 0                       | 0                   | =      | =         | 0       |

Stub-cost bracket. The CSR/hydrating apps call `Loading`/`Errored`/`Reveal`,
so from this step the `carved.js` stubs are REACHED (module inventory shows
954 B min, but that inventory build does not shake the stub calls the way
the scenario build does). Measured directly — carved.ts temporarily
rewritten as pure aliases of one shared thrower (`s4-nostub`): CSR 9477 br /
26577 min (−21 br / −94 min vs s4), hydrating 14291 (−52), pages −55/−84,
floor unchanged. So the stub tax in the authoritative numbers is ≤ 55 B br;
the honest boundary marginal is CSR **≈ −1.25 KB br**, hydrating ≈ −1.2 KB.

Reading. The floor never contained boundaries.js, so its −281 br is the
CORE RESIDUE of the feature: ≈230 br for the queue tree in the scheduler
(4a) and ≈50 br for the per-owner `_queue` slot + per-node status channel
(4b) — the boundary feature cost every owner a field and every effect
dispatch a chain walk. CSR/hydrating pay the module too: boundaries.js
2946 / 2722 min, plus two modules that leave the CSR bundle entirely once
no boundary pulls them — error-hooks.js (458 min; `reportClientError`) and
context.js (271 min; the boundary context is CSR's only `createContext`
user — hydrating keeps 116 B of it for other reasons). Floor per-module
(min) 3a → 4: scheduler.js 2347 → **1679** (−668: queue tree, rearms,
sweep, second heap pass, `Queue` class), core.js 4799 → **4598** (−201:
four `_queue` literals, `statusNotifierOf`'s own-channel arm, the ext
slot, mangler), async.js 3319 → 3243 (−76, name cache), owner.js 1124 →
1078 (−46: two `_queue` literals + the `globalQueue` import), heap 936 →
904, graph 735 → 700, effect.js 781 → 791 (**+10**: six `node._queue.x`
property loads became `globalQueue.x` — a module binding reference is the
same or one byte longer per site after mangling; the per-dispatch
`_parent` chain walk it replaced lived in scheduler.js). Signals total
14730 → **13674 min**. CSR per-module: web.js −151, map.js −82, solid.js
−36 (shift); hydrating solid.js −412 (the `Loading`/`Errored`/`Reveal`
component bodies fold around opaque stubs — downstream, not core).

Bytecode (prod dist, length/frame) 3a → 4: read **687/80 → 687/80**,
setSignal **201/32 → 201/32**, recompute **1704/336 → 1705/336** (+1:
a constant-pool index). The boundaries touched none of the three hot
functions; their hot-path cost was in effect dispatch (`notifyEffectStatus`
→ `_queue.notify` → `_parent.notify` …) and in `flush()`, which the harness
does not bytecode-diff. Cumulative vs base unchanged: read −314, setSignal
−272, recompute −3003, frame 512 → 336.

Gates: typecheck clean (`tsc -p tsconfig.build.json`); no downstream
reference to any removed internal (`solid`/`web`/`universal` import
`flatten` — resolves to the new module; `solid/src/server/signals.ts`
imports `IQueue` as a type — still exported, narrowed; `web/src/client.ts`'s
`enforceLoadingBoundary` — kept). Full suite 4713 run, 807 pass, 3904 fail,
2 skipped. **Transition matrix vs 3a (every test, by name):**
passed→passed 807, carved→carved 3532, **passed→carved 198**,
**fail→carved 41**, fail→fail 132, **passed→fail 0, fail→passed 0**. The
198 newly-stubbed tests are the boundary users: visibility-oracle-posture
×42 (the `behindFallback` posture), createRevealOrder ×38,
createErrorBoundary ×17, falsy-error-identity ×15, mapArray-notready-safety
×9, createLoadingBoundary ×8 + `.on` ×7, syncThenable ×8,
error-silent-recovery ×7, client-error-hook ×6, loading-on-rearm-reveal-3540
×4, equals-comparator-errors ×4, effect-mainline-ownership-3412 ×3,
snapshot ×3, createMemo ×3 (boundary-wrapped cases), enforceLoadingBoundary
×2 (the dev FYI's positive case needs a boundary to NOT fire), errorHalt ×2,
effect-error-phases ×2, … The 41 fail→carved are 3a hold-model tests that
also construct a boundary (now thrown before the hold assertion). The 132
fail→fail is the 3a hold-model set unchanged (173 − 41). Direct `[CARVED]`
by stub: createStore 1383, createOptimisticStore 984, createOptimistic 542,
action 287, **createLoadingBoundary 157**, createProjection 99, isPending
89, **createErrorBoundary 76**, latest 50, merge 46, **createRevealOrder
38**, omit 18. **Zero retained-test regressions; zero new non-carved
failures.** (No isolation pass needed: nothing moved into "fail".)

Posture matrix (/tmp/carve/s4-posture.md vs s3a): 42 rows removed — every
`behindFallback` row in every section (7 readers × 6 sections); **no other
row changed** (`diff` filtered to non-behindFallback lines is empty). Oracle:
violations empty before and after; the single `unspecified` cell (pending
own async × staleForeign, #3305) unchanged at `HELD`. (The s3a oracle file
had the report twice — two writers; s4 once. Content identical.)

Semantic deltas of 4 (user-visible, measurement branch):

- **S6 no fallback posture.** Pending reaching the root is absorbed (the
  mount defers) — unchanged for trees that had no boundary; a tree that HAD
  a `Loading` now defers the whole mount instead of swapping a fallback. An
  error reaching the root halts (`haltReactivity` + throw) — unchanged for
  the no-`Errored` case; with an `Errored` it used to route to the nearest
  boundary's fallback. The dev FYI `ASYNC_OUTSIDE_LOADING_BOUNDARY` still
  fires (there is no boundary to suppress it).
- S7 `Reveal` order (sequential/together/natural) gone; `flatten`'s
  NotReady re-throw unchanged (`mapArray-notready-safety` ×9 are
  `Loading`-wrapped and stubbed, not flatten failures).
- S8 **public surface on the branch:** `createLoadingBoundary`/
  `createErrorBoundary`/`createRevealOrder` → stubs (`RevealOrder` type
  kept); **`IQueue` (public type, `solid/src/server/signals.ts`) narrowed to
  `enqueue/run/notify`** — `addChild`/`removeChild`/`created`/`_parent`/
  `_collectionType`/`_initialized` removed; `Queue` class removed from
  core/index (internal; `GlobalQueue` kept). `flatten`'s export path is
  unchanged. Observe-tier `boundaryFallback` hook typed but never fires.
- Kept: effect notify/escalate protocol (`notify(STATUS_PENDING) → true`,
  `notify(STATUS_ERROR) → false → halt`), user-effect error arm (#2840),
  `enforceLoadingBoundary` dev contract, same-flush staging (A28), the whole
  async core.

Coupling inventory — what core carried for boundaries (every 4a/4b edit):

| #   | core site                                                                                                                                                                                                                                                                                                                                                                                                           | what it was                                                                                                                                    | kind                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| B1  | scheduler.ts: `IQueue._parent/_collectionType/_initialized/created`, `Queue._children` + `addChild/removeChild`, `Queue.notify` forwarding to `_parent`, `Queue.run`'s child loop with `_ranAt`/`queueRunToken` (idempotent rescan after a child disposes mid-pass), `checkBoundaryChildren` (commit-time `_checkSources` sweep), the late heap+commit block after the sweep, the `_children.length` fast-path term | the global queue was the ROOT of a queue tree; every effect's status climbed it to the nearest boundary; the flush swept the tree at commit    | **separable** (−≈500 B min; all removed cleanly). If boundaries return as a module they need three hooks, not a tree in core: "run my queue after the parent's at phase N", "sweep me at commit", and "my status consumer" — see B5                                          |
| B2  | scheduler.ts: `Rearmable`/`pendingRearms`/`queueRearm`/`drainRearms`, the drain + second `runHeap` between heap and commit, the `pendingRearms.size` fast-path term                                                                                                                                                                                                                                                 | an `on` boundary notified inside a pass re-arms after the heap and before the commit so its fallback swap lands with the write's frame (#3540) | **separable**, but it is a FLUSH PHASE ("between heap and commit") — the same seam T1 wants ("end of pure phase")                                                                                                                                                            |
| B3  | core.ts/owner.ts: `_queue: context?._queue ?? globalQueue` ×6, `Disposable._queue`; effect.ts `node._queue.enqueue/notify` ×7 → `globalQueue.*`                                                                                                                                                                                                                                                                     | every owner inherits the nearest boundary's queue at creation — the boundary membership test is a pointer on every node                        | **needs seam** (≈50 B min + one slot per owner). Without the pointer, membership must be found another way (context walk at notify time, or the boundary registers its subtree) — this is the ownership question again (which frame/queue owns a node), answered at creation |
| B4  | types.ts `NodeExtension._notifyStatus` + core.ts `statusNotifierOf` own-channel arm, ext literal slot                                                                                                                                                                                                                                                                                                               | the boundary computed's per-node status channel (effects share one `this`-dispatched notifier)                                                 | **separable** (one slot, two lines)                                                                                                                                                                                                                                          |
| B5  | effect.ts `notifyEffectStatus`/`runEffect`: `notify(STATUS_PENDING, 0)` before the error arm, `notify(STATUS_ERROR) → false → haltReactivity`, render-effect `notify(PENDING                                                                                                                                                                                                                                        | ERROR, flags, error)`; `GlobalQueue.notify`root absorption;`\_enforceLoadingBoundary`/`\_hitUnhandledAsync`                                    | the status PROTOCOL between a display consumer and whatever is above it                                                                                                                                                                                                      | **kept** — this is the seam itself (≈100 B min). The root implementation is 5 lines; a boundary is another implementer |
| B6  | core.ts `spectate` (bookkeeping read that neither tracks nor enters); error-hooks.ts `reportClientError`; `createContext/getContext/setContext` as CSR's only context users                                                                                                                                                                                                                                         | boundary-only callers                                                                                                                          | dead source, 0 B marginal in the floor; module-level −458 (error-hooks) / −271 (context) in CSR                                                                                                                                                                              |
| B7  | boundaries.ts itself: `BoundaryComputed` (a computed whose `_notifyStatus` collects into a `CollectionQueue`), `CollectionQueue` (`_sources` Set, `_pending`/`_initialized`/`_fallback`, `_swap`, `_checkSources`, `_rearm`, `_holds`, the T12 `_forwarded` seam), `RevealController`, `flattenArray` sharing                                                                                                       | the feature                                                                                                                                    | 2.9 KB min as a module — CSR's marginal is the module + B1/B2 residue + the two shaken modules                                                                                                                                                                               |
| B8  | T12 (`_forwarded`)                                                                                                                                                                                                                                                                                                                                                                                                  | the seam carve 3 introduced for the boundary's own reader registry                                                                             | gone with the module; records that a transaction-free boundary needs ≈30 B br of its own registry                                                                                                                                                                            |

Verdict for step 4: **≈0.28 KB br on the floor (core residue), ≈1.25 KB br
on CSR/hydrating (module + residue + two shaken modules)**. Nothing
structural: B1/B2/B4 lift out cleanly, B5 is already the seam (the effect
protocol is five lines at the root and the boundaries are another
implementer of it), B3 is the one real coupling — a per-owner pointer that
answers "which queue owns this node" at creation, the same ownership
question the zombie primitive (T7) and O2 ask. A boundaries module built on
the 4 floor needs: the status protocol (B5, kept), a flush-phase hook for
"run children after me" + "sweep at commit" + "re-arm between heap and
commit" (B1/B2 — one seam, shared with T1's "end of pure phase"), and an
ownership answer for B3. The floor that remains — **5145 br / 13723 min** —
is L0+L1 with no display-consumer tree: sync graph (heap r3, owner, one
queue, effects) + async values (NotReady, propagation, landings, settle
walk, same-flush staging).

Cumulative after four carves: floor **9508 → 5145 br (−45.9 %)**, CSR
**14901 → 9498 br (−36.3 %)**; signals min 27013 → 13723 (−49.2 %). Step
attribution (floor br): store 1946 (1a 1655 + 1b 291) · optimistic/verdict
≈0 at the floor (2a) / 2b residue (see Step 2) · transactions 2136 ·
boundaries 281. The remaining 5145 is the async floor to report, pending
the perf gates (CodSpeed, Octane, fuzzer on retained cases) on this end
state.

#### Gates on the end state (s4 = floor 5145 br)

All three perf gates were run A/B on this machine, base = `next` 309b08730
built from a detached worktree (`/tmp/carve/wt-base`, own `node_modules`
so `@solidjs/signals` resolves to the base dist), carve = this worktree.
Compiler and babel-plugin are byte-identical between the two (the carve
touches `packages/signals/src` only) and were shared.

##### Fuzzer (semantic fuzzer, `~/Development/solid-fuzzer` fuzz/6b, seed 3289, 1000 cases, ordinary cohort)

Harness drift first: the fuzzer branch predates three observe-tier hooks
(`flushStart`, `optimisticReverted`, `currentOrigin`); against ANY current
`next` every case errors with `attrHooks.flushStart is not a function`. The
harness was copied to /tmp (`/tmp/carve/fuzz*`), its `quietHooks` given the
three no-ops, and run against (a) the fuzzer worktree's own src — 994 pass /
6 policy, the recorded baseline reproduces — (b) `next` 309b08730 — **995
pass / 5 policy** — and (c) the carve.

| scenario class (regenerated from the seed; 0 mismatches vs recorded) | n   | next 309b08730     | carve s4                               |
| -------------------------------------------------------------------- | --- | ------------------ | -------------------------------------- |
| sync-only, no boundary (**retained**)                                | 69  | 69 pass            | **69 pass**                            |
| sync-only, boundary reader                                           | 64  | 64 pass            | 64 `[CARVED] createLoadingBoundary`    |
| async, no boundary                                                   | 448 | 448 pass           | 89 pass, **359 fail: S1 ×337, S2 ×22** |
| async, boundary reader                                               | 419 | 414 pass, 5 policy | 419 `[CARVED] createLoadingBoundary`   |

The 359 are one rule family: S1 "published pure values describe the same
published input" (a reader's published tuple must equal
`f(published input)` at every flush end) and S2 (a published `show` toggle
agrees with its gated reader's view). Both are the hold invariant stated as
an oracle — case 2 is the headline S1 delta verbatim: one async node over
the input, reader shows `[1]` (input 0) while the input has published 2.
Every S1/S2 failure is in an async scenario; the 89 async passes are the
scenarios in which no write landed under a flight. **No failure outside the
hold family, no runtime error other than the boundary stub, 69/69 on the
retained class.** The fuzzer is a hold-model oracle for ~¾ of its cohort —
re-usable for step 2 once its S1/S2 are re-stated against the L2 contract.

##### CodSpeed benches (`vitest bench`, in-repo; store benches are carved and excluded)

Two prod-tier runs in each order (base→s4, s4→base) and one dev-tier run
(CodSpeed's tier); µs mean, prod = min of the two runs.

| bench                                                       | base µs | s4 µs | Δ prod                             | Δ dev     |
| ----------------------------------------------------------- | ------- | ----- | ---------------------------------- | --------- |
| reactivity › propagation:avoidable                          | 75.0    | 42.4  | **−43 %**                          | −41 %     |
| reactivity › propagation:diamond                            | 76.6    | 43.9  | **−43 %**                          | −39 %     |
| reactivity › updateSignals:update1to1000                    | 163.9   | 106.5 | −35 %                              | −37 %     |
| reactivity › updateSignals:update1to1                       | 4432    | 3111  | −30 %                              | −29 %     |
| reactivity › createComputations:create0to1                  | 3466    | 2440  | −30 %                              | −22 %     |
| reactivity › createComputations:create1to1                  | 4811    | 3662  | −24 %                              | −15 %     |
| reactivity › createSignals                                  | 688     | 666   | −3 %                               | −8 %      |
| creation › createDispose:memoTree                           | 5117    | 3291  | −36 %                              | −26 %     |
| creation › createRenderEffects:create1to1                   | 6027    | 4538  | −25 %                              | −11 %     |
| creation › createOwners                                     | 782     | 610   | −22 % (noisy: 610/854 across runs) | −3 %      |
| mount-rows › 1000 rows, memo + render + user effect (#3350) | 2696    | 2035  | −25 %                              | −23 %     |
| mount-rows › 1000 rows, memo + render effect only           | 1462    | 1144  | −22 %                              | −17 %     |
| mount-rows › 4000 rows, memo + render + user effect         | 10371   | 8200  | −21 %                              | −25 %     |
| mount-rows › 4000 rows, memo + render effect only           | 5337    | 4693  | −12 %                              | −21 %     |
| **geomean time ratio s4/base (14 benches)**                 |         |       | **0.729**                          | **0.767** |

Order-independent (both orders agree within noise). The propagation benches
are `recompute`/`read`/`setSignal` in a loop — their −43 % is the 3 KB of
bytecode that left `recompute` (4708 → 1705) and the stamp/entry arms that
left `read`/`setSignal`. Disposal-heavy (`createDispose:memoTree` −36 %) is
`disposeChildren` without the zombie chain walk and no `_queue`/transition
slots on the literal. `createSignals` barely moves: a signal literal lost
one slot (`_transition`).

##### Octane board (`~/Development/octane-fork`, Solid target only, A/B)

Setup: the fork's `link:` overrides pointed at `/tmp/carve/wt-base` (base)
then at this worktree (carve), `pnpm install --no-frozen-lockfile` each
time; each Solid fixture vite-built and served (`pnpm --filter <fixture>
preview`), the suite's own `run.mjs` run with `TARGETS=[solid]` at the
board's normal iteration count. **The override/lockfile files were restored
afterwards; the fork's `node_modules` currently resolves Solid to this
worktree** (the previous `solid-next-bench` link target no longer exists on
disk — the links were already dangling).

Suite eligibility: the Solid fixtures of **js-framework** (and
js-framework-reorder) and **effectful-list** build their rows with
`createStore` → `[CARVED]` at mount (js-framework: `#run` never visible;
effectful-list: `page.evaluate: Error: [CARVED]`). They are removed cells
for this branch, not failures — the board's headline suite is a STORE
fixture. Five suites are store/boundary/transition-free and ran on both:

| suite             | timed ops | geomean s4/base median | min       | notes                                                                                              |
| ----------------- | --------- | ---------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| memo-wall         | 7         | 0.944                  | 0.973     | mount −7 %, ctx_through_wall −5…−7 %                                                               |
| signal-favoring   | 2         | 0.939                  | 0.935     | mount −12 %; the rest sub-resolution by design                                                     |
| portal-swarm      | 5         | 0.868                  | 0.890     | mount_closed −27 %, open_all −18 %, open/close cycles −9…−11 %                                     |
| recursive-context | 3         | 0.842                  | 0.600     | mount −11 %, update_root −33 %, unmount min −50 %                                                  |
| uibench (solid)   | 96        | 0.922                  | 0.864     | render −2…−10 %; `removeAll` −15…−29 % median / −24…−76 % min; `no_change` −15 %; reorder ops ±2 % |
| **all five**      | **113**   | **0.919**              | **0.864** |                                                                                                    |

No op regresses outside harness resolution: the "worst" ratios (uibench
`anim/100/4` +32 % min, `activate/16` +23 %) are 2–8 µs ops where one 40 ms
idle tick flips the sign; their medians are −1…+5 %. The pattern matches
the micro-benches: DOM-bound ops move a few percent, creation/mount
10–27 %, disposal 20–76 %. Reorder ops (keyed reconcile in map.js) are flat
— map.js was not carved.

##### Bytecode (prod dist, V8 length/frame)

read 1001/128 → 687/80 · setSignal 473/56 → 201/32 · recompute 4708/512 →
1705/336. The whole delta landed in step 3a (steps 1, 2, 4 did not touch
the three hot functions); `readNodeFast` is inlined at both ends.

##### Verdict on the gates

Retained tests: zero regressions at every step (transition matrices in
Steps 1–4). Posture/oracle: removed cells only, plus the one 8-row flip
class reported in 3a. Fuzzer: 69/69 retained, the rest sorted into stubbed
(483) and hold-oracle (359) with nothing left over. Perf: faster everywhere
a retained path runs — micro 0.73×, Octane 0.92× (median) — so the 4.4 KB
br was not bought with speed; the removed layers were costing both.
