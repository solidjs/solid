/**
 * Bundle-fixture guard for pay-for-use tree-shaking (#2883).
 *
 * Bundles small entry fixtures against src/ with production defines and
 * asserts (a) feature modules that must shake out of lean bundles actually
 * shake, and (b) the minified core floor stays under a byte ceiling. The
 * ceilings have ~8% headroom over the sizes measured when this test landed —
 * a failure here means a change re-coupled a feature into the core (usually a
 * new direct import or an unshakeable top-level side effect), not that a few
 * bytes drifted.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, transformWithEsbuild, type Rollup } from "vite";
import { afterAll, describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

async function bundleFixture(code: string): Promise<{
  minifiedBytes: number;
  retained: string[];
}> {
  const dir = mkdtempSync(join(tmpdir(), "solid-treeshake-"));
  tempDirs.push(dir);
  const entry = join(dir, "entry.ts");
  writeFileSync(entry, code);
  const result = (await build({
    configFile: false,
    logLevel: "silent",
    define: { __DEV__: "false", __OBSERVE__: "false", __TEST__: "false" },
    resolve: { alias: { sigsrc: join(SRC, "index.ts") } },
    build: {
      write: false,
      minify: false,
      target: "esnext",
      lib: { entry, formats: ["es"], fileName: "out" }
    }
  })) as Rollup.RollupOutput[];
  const chunk = result[0].output[0];
  const retained = Object.entries(chunk.modules)
    .filter(([, mod]) => mod.renderedLength > 0)
    .map(([id]) => id.replace(SRC + "/", ""));
  // Vite lib-mode ES output is not truly minified; match the #2883 harness
  // (esbuild minify + `_`-prefixed property mangling, as the dist build does).
  const minified = await transformWithEsbuild(chunk.code, "out.js", {
    minify: true,
    mangleProps: /^_/
  });
  return { minifiedBytes: Buffer.byteLength(minified.code), retained };
}

function retainedFrom(retained: string[], names: string[]): string[] {
  return names.filter(name => retained.some(id => id.includes(name)));
}

describe("pay-for-use tree-shaking (#2883)", () => {
  it("core floor sheds every optional feature module", async () => {
    const { minifiedBytes, retained } = await bundleFixture(
      `export { createSignal, createMemo, createEffect, createRoot, flush } from "sigsrc";`
    );
    // Explicitly-imported APIs are the opt-ins: none of their modules may be
    // reachable from the five core primitives.
    expect(
      retainedFrom(retained, [
        "store/",
        "boundaries.ts",
        "map.ts",
        "affects.ts",
        "core/verdict.ts",
        "core/optimistic.ts",
        "core/action.ts",
        "core/context.ts"
      ])
    ).toEqual([]);
    // Ceiling: 18,214 bytes measured at landing (vite/rollup bundle +
    // esbuild minify with `_`-property mangling) + ~7% headroom.
    // CONSCIOUS BUMP (stage-3 §11b, 2026-08-21): +~120B for hot-path shape
    // alignment — optional-machinery slots moved into the node literals and
    // presence bits on _config, killing megamorphic missing-property reads
    // in setSignal/recompute/commit (measured at 19,570 post-change).
    // CONSCIOUS BUMP (stage-3 §12, 2026-08-21): +~740B for the cold-field
    // extension split (`_x`) — 11 optional-machinery fields moved off the
    // node literals into a lazily-allocated extension, shrinking every memo
    // from 553B to 429B (-22%) and cutting create/update churn 10-19% in the
    // reactivity benchmark. The `_x?.` access chains and the ext()
    // initializer are the byte cost (measured at 20,313 post-change).
    // CONSCIOUS BUMP (stage-3 §12b, 2026-08-21): +~300B for the zombie-pair
    // move into _x (computed literal 29 -> 27 fields) and the plain-commit
    // fast drain in GlobalQueue.flush — update1to1 -12% on top of §12
    // (measured at 20,610 post-change).
    // CONSCIOUS BUMP (2026-08-27): +~350B for the shared effect status
    // notifier (statusNotifierOf + install seam). Storing the SHARED
    // notifyEffectStatus per node via ext() allocated the full 19-field
    // NodeExtension on EVERY effect at creation — +127 B/node heap and +23%
    // effect creation time (shipped unnoticed with stage 3; caught by the
    // creation benches). Measured at 20,956 post-change.
    // CONSCIOUS BUMP (stage-2, 2026-08-27): +~180B in mergeTransitionState —
    // the held-patch stash move + coalescing-stamp retarget (re-audit 5:
    // merged-away stashes double-applied their records' patches at commit).
    // Core-retained by necessity: transition merging cannot be pay-for-use.
    // Measured at 21,134 post-change.
    // NOTE (2026-08-29, no bump): +~100B for until()/resolve()'s seams — the
    // read() A17 carve-out (checks CONFIG_AUTHORITATIVE_READ on the reading
    // computation directly; no ambient flag), the createEffectNode
    // _extraConfig arm, recompute's CONFIG_DIRECT_COMMIT clause (promise
    // effects commit values on their microtask-delivery schedule), the
    // silent-ack notify in recompute, and the
    // GlobalQueue._notifyAuthoritativeObservers slot. Inline in retained hot
    // functions by necessity; the wakeup walk itself is hook-installed at
    // first until() call and shakes with it. Measured at 21,235 post-change.
    // NOTE (2026-08-29, no bump): awaitable refresh() adds ONE term to
    // clearStatus's dispatch gate (CONFIG_QUIESCENCE_OBSERVED — the waiters'
    // settle seam; the registry itself lives in core/quiescence.ts and
    // shakes out with refresh()). Paid for by converting three
    // `slot !== null && slot(...)` gates to `slot?.(...)`.
    // CONSCIOUS BUMP (2026-08-31): +~96B for flight-identity iterator
    // cancellation (#3122) — the `_flightTeardown` ext slot, its
    // registration in consumeIterator, and recompute's supersede release.
    // Core-retained by necessity: supersede happens in recompute, and the
    // async-iterable machinery is already part of the memo floor. Measured
    // at 21,331 post-change.
    // CONSCIOUS BUMP (2026-09-01): +~92B for the pending twin of the #2949
    // silent-recovery sweep (#3181) — recompute captures pending SOURCE-hood
    // and runs settlePendingSource when a synchronous settle supersedes the
    // flight that parked dependents. Core-retained by necessity: the
    // supersede happens in recompute, and settlePendingSource is already
    // part of the async floor. Measured at 21,423 post-change.
    // CONSCIOUS BUMP (2026-09-01): +~155B for the held-truth reveal
    // machinery (#3164: store fold + until() flip-entanglement, unified on
    // CONFIG_HELD_TRUTH) — the read() mask arm, commitPendingNodes'
    // unmask-and-collect, and finalizePureQueue's post-revert wake pass.
    // Core-retained by necessity: read masking and settle ordering cannot
    // be pay-for-use. Paid for by the unification itself (it deleted the
    // GlobalQueue._heldTruthMasked hook slot, a second read() arm, and the
    // Transition._entangled flag plumbing); the arming sites
    // (entangleConfirmingTransitions/stealEntangledCargo, the store fold)
    // still shake out with until()/createOptimisticStore. Measured at
    // 21,536 post-change (with the #3181 bump above).
    // Tracked-effect wakes ride the heap (#3291, 2026-09-06): -75 B. The
    // tracked special case in enqueueSub is deleted; GlobalQueue._update
    // gains a four-line branch that hands a tracked node's callback to the
    // user queue instead of recomputing it. Measured at 21,461 post-change.
    // CONSCIOUS BUMP (2026-09-09): +~242B for contested-effect re-derivation
    // (#3322) — effects have one value slot and do not entangle
    // transactions, so a second live transaction (or mainline) recomputing a
    // shared effect overwrote a value the first still owed a run for, and
    // the silent commit then published it. Effect._valueTransition stamps
    // the owner, recompute records the effect on the owed transaction(s),
    // finalizePureQueue re-dirties them ahead of the heap run; the signal
    // fast path in read() gains the stale-reader mask for foreign staged
    // writes the slow path already had. Core-retained by necessity: the
    // clobber happens in recompute and the fix is the commit ordering itself.
    // Measured at 21,765 post-change.
    // CONSCIOUS BUMP (2026-09-09): +~166B for effect ownership on finalize
    // re-entry (#3319) — finalizePureQueue captures the batch it started
    // with and does not commit/revert one an entered transaction adopted
    // (while a completing transaction still settles its own separate
    // containers), and runEffect leaves runs owned by a still-held
    // transaction queued for the next gate when the flush's finalize entered
    // one, applying only what was computed mainline. The coarse alternative
    // (park the whole flush) is ~70B but splits reads from the DOM for the
    // write that caused the flush. Measured at 21,931 post-change.
    // GOLF (2026-09-09): -41B. The #3319 `parkHeldOwners` flag was set from
    // `activeTransition !== null` at the very point the ordinary runs start,
    // so runEffect reads activeTransition directly; the lane exemption moved
    // to where lanes live (optimistic.ts ORs LANE_RUN into the run `type`,
    // as does effect()'s creation-time immediate run). contestEffect inlined
    // into its single call site in recompute. Measured at 21,890 post-change.
    // (`next` @ 4935c7dd measures 21,994 after #3350/#3351.)
    //
    // CONSCIOUS BUMP (2026-09-11, lane authority on `next`): +463 B over
    // `next`'s 21,994 for the lane-authority fixes (#3335, #3334, #3331,
    // #3330, the A15 re-rule; ported from #3347, which sat on #3337's A28
    // write path — here the landing branch dispatches eagerly, as `next`
    // does). Reveal-hold: read()'s pending branch
    // drops the stale/foreign-transaction carve-out (-), asyncWrite's
    // settleTransition routes a lane-owned landing to the waiting transaction
    // (waitingTransition, which laneHeld shares). Override supersession: the
    // landing branch and recompute's two override branches each collapse to
    // one engine hook call (the authoritative-observer wake moved into the
    // hook), read()'s override arm gains a bit test plus a hook call for
    // tracked readers of a superseded node, runEffect's owner gate learns
    // that a lane runner for a lane-less effect belongs to the still-held
    // transaction, and the ext literal gains `_overrideTime` and
    // `_overrideStamp`. Two GlobalQueue hook slots. INV-11 adds one term to
    // recompute's compare-slot select. Supersession provenance: the scheduler
    // carries the running action's sequence (`origin` + setter, cleared at
    // the end of flush()), handleAsync captures it per flight and asyncWrite
    // re-arms it for the landing's propagation. Core-retained by necessity: read visibility, the landing branch, the
    // effect gate, and the provenance carrier are the seams themselves; the
    // decision logic (equality, ordering, provenance comparison, lane
    // demotion, value selection, replay gating) lives in optimistic.ts and
    // shakes out. Store twins (#3330/#3331): setSignal's
    // CONFIG_OPTIMISTIC dispatch gains the authoritative-write case — an
    // override test plus one engine hook call (`_landOnOverride`, one
    // GlobalQueue slot); the landing itself (staging, companions,
    // supersession) lives in optimistic.ts and shakes out. The
    // stale-reader term of read()'s three value selections becomes
    // `heldFromStale`: a reader served the committed value of a node another
    // live transaction staged is recorded for that transaction's commit
    // replay unless the transaction computed it — the commit is silent, and
    // a reader that linked after the staging walk otherwise never learns of
    // the reveal (the record is core-retained because the read visibility
    // seam is). A settle that reverts optimism re-derives its contested
    // effects (#3322) after the revert, not ahead of the heap run
    // (finalizePureQueue): between commitPendingNodes and _resolveOptimistic
    // the truth is committed but the overrides still display, and a
    // re-derive there composed the two (the #3164 tear — surfaced by deep()
    // over an optimistic store whose held adoption was eagerly visible to
    // the committing transaction's own readers). A15 re-rule: the reveal
    // carve-out returns, gated on input visibility (A15 reveal corollary,
    // re-ruled): read()'s pending branch tests three node bits
    // (uninitialized, CONFIG_INPUTS_PUBLISHED, CONFIG_HAS_LANE → one engine
    // hook call, `_laneLive`) before `heldFromStale` serves the committed
    // value and records the reader; commitPendingNode's computed branch marks
    // a still-pending node's inputs published, notifyStatus clears the mark
    // on a fresh flight; recompute drops an effect's stale replay recording
    // when it recomputes under the recording transaction (one Set.delete).
    // The lane predicate itself (`resolveLane`) shakes out. On the #3337
    // stack the same fixes measured +485 B (22,381 -> 22,866). Measured at
    // 22,457; 43 bytes of headroom.
    // Conditional pending recovery adds 191 B over next at b5bd6fba
    // (22,457 → 22,648 B), including the alternate dependency path guard
    // and the self-source skip that leaves the #3181 sweep as the one walk.
    // Second write while an async chain is in flight (#3373/#3376, #3375,
    // #3374): a landing retires only its own pending entry (`landStatus` —
    // the partial branch keeps the node pending on an input re-asked
    // mid-flight), a fresh flight drops inherited entries at registration,
    // transitionComplete tests a source's own flight by its self entry
    // instead of `_error.source`, and the stale-reader carve-out joins the
    // reporters of a node the transaction already waits on (one Map lookup
    // in heldFromStale). +132 B (22,648 → 22,780).
    // Boundary reset ends the hold (#3375 ruling): a reporter whose queue
    // chain passes through a collecting loading boundary does not block
    // (`reporterBlocksSource` walks `_queue._parent`), and a parked
    // transaction can be woken for re-judgement — `wokenTransitions`,
    // deduped, entered from the finally of an idle pass (`!scheduled`: no
    // dirty, staged or optimistic ambient work to adopt); the fast drain
    // defers to the full path while a wake is outstanding. +135 B
    // (22,780 → 22,915).
    // Held reader disposed / lane direct-commit over a stale hold (#3372,
    // #3377): disposing a pending reader parked in a transaction wakes it
    // (`wokenTransitions`, deduped), and a lane recompute (OPT-dirty,
    // override or not) drops the transaction hold it supersedes. +58 B
    // (22,915 → 22,973).
    // Companion lane parented (#3379): `notifyStatus` assigns the node's lane
    // before poking its companions — a reorder, -4 B (22,973 → 22,969).
    // Held children (#3404): recompute defers a node's children as zombies
    // unless the pass that built them never committed (CONFIG_HELD_CHILDREN,
    // set at recompute's tail, cleared by commitPendingNode) — a
    // transaction-owned node's committed children previously died on the
    // spot — and a contested effect's mainline pass releases its zombies
    // itself. +102 B (22,969 → 23,071).
    // Settle verdicts (#3409, #3411): `assignOrMergeLane` follows a merged
    // lane to its root like any other (the stale-lane shortcut that skipped
    // the parent/child check is gone), -33 B (23,091 → 23,058); the
    // unowned `onSettled` fire's heap-drain wait shakes out with onSettled.
    // Lane release (#3426, #3427): the hold check prunes dead reporters
    // itself (`sourceObserved`, shared with completion), and the action
    // body's end starts the correction (`_acted`, the `_endOptimism` hook
    // from flush — the engine's own gating rides the optimistic module).
    // +78 B (23,058 → 23,136).
    // Shared hole (#3407): an effect's recompute never re-enters its stamp
    // (the pass belongs to whoever dirtied it), so a landing folds in every
    // transaction waiting on the flight itself (`enterWaiting`) — a
    // stampless node's fresh batch included. +59 B (23,136 → 23,195).
    // CONSCIOUS BUMP (2026-09-14): +123 B for the two held-input rules of
    // #3408/#3410 — a tracked reader served a live transaction's staged value
    // enters the transaction (`enterStagedRead`, the read twin of setSignal's
    // and recompute's stamped entry), and a staged pass leaves the previous
    // pass's dependency tail for `commitPendingNode` to trim (deps are the
    // committed frame's, like its children). Core-retained by necessity:
    // both sit on read()'s value selection and recompute's tail. Measured at
    // 23,318 on top of #3434 (23,195 → 23,318).
    // NOTE (2026-09-14, no bump): +35 B for the effect arm of A30 (#3438) —
    // recompute's tail keeps an effect's dependency tail while a run is owed
    // (`_modified`), and runEffect trims it once the run applies. Measured
    // at 23,353 post-change.
    // NOTE (2026-09-14, no bump): +12 B for memo lane posture (#3442) — one
    // assignment at recompute's head runs a memo plain unless it owns or
    // adopts a lane. Measured at 23,365 on top of #3438 (23,353 → 23,365).
    // CONSCIOUS BUMP (2026-09-14): +54 B for two overlapping-flight rules —
    // pending propagation onto a memo another live transaction holds enters
    // that transaction (A15 shared derivation, #3443; one ternary at the
    // propagation site), and a zombie dirtied through the lane channel runs
    // instead of being cancelled when the parking batch is the transaction
    // (#3444; one guard in cancelZombieRecompute). Measured at 23,419 on top
    // of #3442 (23,365 → 23,419).
    // CONSCIOUS BUMP (2026-09-14): +316 B for A29's creation-time form —
    // "born held". A memo or effect created from MAINLINE code while a
    // transaction holds a value it reads used to direct-commit its creation
    // pass (`create ||`) — publishing the held value into the mainline frame
    // beside readers showing the committed one — and `enterStagedRead`
    // entered the transaction ambiently from creation code, so an unrelated
    // write made after the mount was swallowed into the action. Now the pass
    // records the transaction (`stagedEntry`) and is staged INTO it: stamped,
    // pushed to its pending nodes, `STATUS_UNINITIALIZED` kept until its
    // commit, effects skipped on creation and replayed by the commit
    // (`_gatedSubs`); read() holds readers of a node with a staged value and
    // no committed one. Core-retained by necessity: recompute's create arms,
    // read()'s selection, commitPendingNode. Measured at 23,681 on top of
    // #3442; 23,753 rebased over #3443/#3444 (23,419 → 23,753, +334 — the
    // two land on the same notifyStatus/recompute seams).
    // CONSCIOUS BUMP (2026-09-15): A28 — writes become visible at flush, as a
    // READ-SIDE rule (supersedes #3337's deferred walk; +572 B vs its +387,
    // with the plain write path untouched — no per-write list, no promotion
    // pass). Core-retained pieces: `unflushedValue` (the structural test and
    // its exemptions), the selection arms that serve the flushed value and
    // latch the late linker, `_flushedStaged` for a rewrite of a held node,
    // CONFIG_PROMOTED for writes inside a creation-time recompute, the
    // companion re-sync at flush start, and the override arm's flush gate.
    // The write-path arms are cold helpers gated on loads the write already
    // pays (`_transition`, `context`) and the read sites test one module flag
    // (`unflushedStaged`) instead of `_running`: inline, they cost ~140 B of
    // setSignal bytecode and 10–20% on the write-loop benches (+156 B here).
    // Measured at 24,478 rebased over #3464–#3471 (`next` 23,750 → 24,478).
    // CONSCIOUS BUMP (2026-09-15): five hold-consistency seams (#3456 #3458
    // #3460 #3463 #3469), all core-retained: recompute's re-park sweep over
    // the sources a pass stopped carrying; `heldFromStale` notifying a first
    // observer's pending up its queue chain; `reporterBlocksSource` walking a
    // zombie's owner chain to the transaction staging its removal (+ the
    // `verdict` argument through `sourceObserved`); `heldTrims` deferring an
    // unchanged pass's dep trim to the flush verdict; and the one
    // read()'s override arm folded to one engine hook (`_overrideRead`,
    // absorbing `_supersededRead` and carrying the lane outside-view rule,
    // whose body lives in lanes.ts and sheds with the engine). Measured at
    // 24,836 (24,478 → 24,836, +358; 24,873 before the fold).
    // A pending reporter recovering without its flight landing wakes its
    // parked transaction (fuzzer #3446 P1, spec O3, 2026-09-16): +100 B
    // (24,478 -> 24,578), `wasPending` and the wokenTransitions site at
    // recompute's tail.
    // Lanes stage (#3479 review, 2026-09-16): +139 B core-retained — recompute's
    // publish arm routing an optimistic-dirty memo through `_laneOverride`, its
    // override test admitting a derived one, and the derived-override posture
    // branch (every pass over a live lane member is the lane's pass, fuzzer
    // latest-1 #2481). Measured at 25,075 over #3488's 24,936.
    // One `unflushed` for signal and store (spec O4, 2026-09-16): a staging
    // adopted before any flush is marked CONFIG_ADOPTED_UNFLUSHED at adoption
    // and cleared by the carrying flush; +56 B (25,193 -> 25,249).
    // Move 3b, 2026-09-17: shared read predicates (+13 B, readerSeesCommitted),
    // the stale-reader replay helper recordStaleReplay (+31 B), enterStagedRead's
    // null-node form (+1 B), and one ownership relation ownsHold for the
    // stale-of-foreign clause, the lane arm and the store's backing holds
    // (+44 B minified, -4 B brotli: the function is not inlined by esbuild).
    // 25,249 -> 25,338.
    // serve() — Rule 1's one slow implementation (move 3b step 6c, 2026-09-17):
    // read()'s slow tail extracted with the committed value as a parameter so the
    // store's untracked node path selects through the same function (its
    // backing as committed, O6). +88 B: the wrapper, the parameter, and the
    // auto-dispose sweep guard that preserves the inline arm's early return.
    // 25,338 -> 25,426. The additive half; the twins it makes deletable
    // (overrideRead's wrapper, nodeValue, the verdict re-derivations) are the
    // deletion half — see docs/DESIGN-CONSOLIDATION.md §0.
    // A write is a proposal (A34, #3494 / #3519 review, 2026-09-17): +234 B
    // core-retained (25,426 -> 25,660 over move 3b) — `batchJoins` (setSignal records a
    // held node's join and schedules; drained inside flush's try; the fast
    // sync path defers while one waits), initTransition's no-proposal drop
    // for an unstamped signal or writable memo staged at its committed value
    // (through commitPendingNode), notifyStatus re-deriving a subscriber
    // instead of marking it over a kept-tail link (`_gen`, A30), and
    // reporterBlocksSource following a dep's `_pendingSources` one hop.
    // Born held exempts boundaries (A29, #3540, 2026-09-18): +169 B
    // core-retained (25,660 -> 25,829) — `underFreshLoadingBoundary` (the
    // queue-chain walk to the nearest pending-collecting boundary),
    // enterStagedRead taking the staging path inside a flush for a pass under
    // a fresh boundary, recompute's born-held arm telling that boundary
    // (queue.notify with a NotReadyError) and restaging a re-pass instead of
    // re-queuing it, and `spectating` refusing the entry and the staged-only
    // value in enterStagedRead / serve (the boundary's priming read).
    // `on` re-arms at the finalize (#3540, 2026-09-20): +58 B core-retained
    // (25,829 -> 25,958) — the scheduler's `pendingRearms` set, `queueRearm`
    // (the on-node's notification), `drainRearms` at the top of
    // finalizePureQueue, and the simple-sync-flush gate on the set. The set
    // is the scheduler's because the drain point is: the re-arm must run
    // mainline, past the transaction park, which only the flush knows.
    // `on` follows the frame (#3540, 2026-09-21): +26 B core-retained
    // (25,958 -> 25,984) — the drain point moves from finalizePureQueue into
    // flush, after the heap and before the verdict (`drainRearms()` plus the
    // heap re-run that stages the boundary's output pass with the frame), and
    // `notifyOnLane` (the display-ahead swap's lane-channel notification).
    // A pending fallback's boundary is judged before the verdict (#3540,
    // 2026-09-22): +63 B core-retained (25,984 -> 26,047) — the flush's
    // pre-verdict `checkBoundaryChildren(this, true)` walk (`_judgeHeld`,
    // boundaries.ts) plus the heap re-run that lets the output drop the
    // fallback's read ahead of the verdict it was parking.
    // A reawakened lazy memo rejoins its owner's chain (#3554, 2026-09-22):
    // +63 B core-retained (26,054 -> 26,117) — `linkChild`, the one head link
    // shared by createOwner, setupComputedNode and prepareComputed's
    // auto-dispose reawaken, with its zombie guard; the reawaken freezing a
    // dormant node whose owner is dead instead of recomputing it, the strip
    // in disposeChildren having missed it off the chain (#3024); and
    // disposeChildren detaching the chain before its loop, each child's
    // splice pointed at itself and its next read after its disposal, so a
    // node a cleanup links mid-drain survives the drain without cutting the
    // drain short.
    // Held truth masks lane passes only (#3164 ruling, #3568; 2026-09-22):
    // +10 B core-retained (26,117 -> 26,127) — readerSeesCommitted's
    // CONFIG_HELD_TRUTH arm gains a `currentOptimisticLane !== null` term, so
    // a deriving reader of held truth takes the A29 arm.
    // A parked frame dies with its owner (#3561, 2026-09-22): +63 B
    // core-retained (26,130 -> 26,193) — disposeChildren's death path drains
    // the owner's `_pendingFirstChild` / `_pendingDisposal` (the previous
    // frame parked as zombies, #3404) before setting REACTIVE_DISPOSED, since
    // the commit's drain returns on that flag. Gated on `self` and not
    // `zombie`: a rerun's `disposeChildren(el)` leaves the frame rendering.
    // A node disposed during its own pass stays disposed and the pass is void
    // (#3621, 2026-09-23): +72 B core-retained (26,193 -> 26,265) — recompute's
    // `finally` mask (and updateIfNecessary's) carries REACTIVE_DISPOSED, and
    // recompute returns on it after the body: `clearDeps` (the reads after the
    // `dispose()` call re-linked the dead node), the flight retire, and the
    // lane restore. The mask bits are free; the bytes are the void-pass arm.
    // A held derivation is not a proposal (#3612, 2026-09-23): +150 B
    // core-retained (26,265 -> 26,415) — `setMemo` asks `heldDerivation`
    // (stamped by another transaction, no REACTIVE_MANUAL_WRITE on the node
    // or its `_firewall`) before the write, resolves an updater against the
    // committed value on a hit, and `rederiveHeld`s (DIRTY + enqueue) in
    // place of the mask; updateIfNecessary's post-pull wipe carries the mask.
    // `setMemo` is core-retained through createSignal's derived overload.
    expect(minifiedBytes).toBeLessThan(26_450);
  });

  it("plain stores shed the verdict layer, affects, boundaries, and map", async () => {
    const { retained } = await bundleFixture(
      `export { createStore, createSignal, createEffect, createRoot, flush } from "sigsrc";`
    );
    // reconcile.ts/projection.ts stay: the derived createStore overload keeps
    // them statically coupled by design (API symmetry ruling, #2883).
    expect(
      retainedFrom(retained, [
        "core/verdict.ts",
        "core/optimistic.ts",
        "affects.ts",
        "boundaries.ts",
        "map.ts"
      ])
    ).toEqual([]);
  });

  it("createOptimistic loads the optimistic engine; the floor ceiling reflects its absence", async () => {
    const { retained } = await bundleFixture(
      `export { createSignal, createEffect, createRoot, flush, createOptimistic } from "sigsrc";`
    );
    expect(retainedFrom(retained, ["core/optimistic.ts"])).toEqual(["core/optimistic.ts"]);
  });

  it("isPending/latest load the verdict layer and nothing else new", async () => {
    const { retained } = await bundleFixture(
      `export { createSignal, createEffect, createRoot, flush, isPending, latest } from "sigsrc";`
    );
    expect(retainedFrom(retained, ["core/verdict.ts"])).toEqual(["core/verdict.ts"]);
    // The verdict layer brings the optimistic engine WITH it, by design
    // (verdict.ts's module-scope installOptimisticEngine()): companions
    // (pending signals / latest shadows) are optimistic nodes — their flips
    // route through the optimistic write path and their reversion rides
    // lanes, which is what lets a companion wake escape an incomplete
    // transition's effect stash (#2887; also #2898/#2912). Asserted
    // POSITIVELY so the cost is named instead of invisible: an isPending
    // consumer pays verdict + engine (~1.6 kB gz), and if a future round
    // decouples companion writes from the engine this expectation is the
    // one to flip to an exclusion.
    expect(retainedFrom(retained, ["core/optimistic.ts"])).toEqual(["core/optimistic.ts"]);
    expect(retainedFrom(retained, ["store/", "boundaries.ts", "map.ts", "affects.ts"])).toEqual([]);
  });

  // ---- dist-artifact assertions ----
  //
  // Everything above bundles against src/, which cannot see a coupling the
  // PACKAGING introduces (a build transform reordering imports into side
  // effects, a lost PURE annotation, a bundler bug). These fixtures bundle
  // against the built dist/prod artifact — what apps actually resolve — and
  // assert it retains no module the equivalent src bundle doesn't. Skipped
  // when dist/prod hasn't been built (it is gitignored; run `pnpm build`).
  const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/prod/index.js");

  async function bundleDistFixture(code: string): Promise<string[]> {
    const dir = mkdtempSync(join(tmpdir(), "solid-treeshake-dist-"));
    tempDirs.push(dir);
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, code);
    const result = (await build({
      configFile: false,
      logLevel: "silent",
      resolve: { alias: { sigdist: DIST } },
      build: {
        write: false,
        minify: false,
        target: "esnext",
        lib: { entry, formats: ["es"], fileName: "out" }
      }
    })) as Rollup.RollupOutput[];
    const chunk = result[0].output[0];
    const distRoot = dirname(DIST) + "/";
    return Object.entries(chunk.modules)
      .filter(([, mod]) => mod.renderedLength > 0)
      .map(([id]) => id.replace(distRoot, ""));
  }

  describe.skipIf(!existsSync(DIST))("dist artifact (dist/prod)", () => {
    it("isPending-only fixture retains the same module set as src — packaging adds no coupling", async () => {
      const fixture = `export { createSignal, createEffect, createRoot, flush, isPending, latest } from "SPEC";`;
      const distRetained = await bundleDistFixture(fixture.replace("SPEC", "sigdist"));
      const { retained: srcRetained } = await bundleFixture(fixture.replace("SPEC", "sigsrc"));
      // The by-design verdict -> engine coupling, mirrored from the src test.
      expect(retainedFrom(distRetained, ["core/verdict.js"])).toEqual(["core/verdict.js"]);
      expect(retainedFrom(distRetained, ["core/optimistic.js"])).toEqual(["core/optimistic.js"]);
      expect(
        retainedFrom(distRetained, ["store/", "boundaries.js", "map.js", "affects.js"])
      ).toEqual([]);
      // No dist-only re-coupling: every module the dist bundle retains, the
      // src bundle retains too (src may retain MORE — dev-only modules that
      // the dist build's own defines already stripped).
      const srcNames = new Set(srcRetained.map(id => id.replace(/\.ts$/, ".js")));
      const distOnly = distRetained.filter(id => id.includes("/") && !srcNames.has(id));
      expect(distOnly).toEqual([]);
    });

    it("core-floor fixture keeps every optional feature module out of the dist bundle", async () => {
      const distRetained = await bundleDistFixture(
        `export { createSignal, createMemo, createEffect, createRoot, flush } from "sigdist";`
      );
      expect(
        retainedFrom(distRetained, [
          "store/",
          "boundaries.js",
          "map.js",
          "affects.js",
          "core/verdict.js",
          "core/optimistic.js",
          "core/action.js",
          "core/context.js"
        ])
      ).toEqual([]);
    });
  });

  // ---- the attribution engine's folds ----
  //
  // `costs()` and `feedback()` are named exports whose modules register their
  // accounting with the engine on evaluation. That only pays for itself if a
  // consumer that never imports them ships neither the tables nor the
  // registration — which rests on the package's `sideEffects: false`: a
  // bundler drops a module none of whose exports are used, registration
  // included. `moduleSideEffects: false` is that flag's Rollup spelling for
  // a fixture that aliases the files directly instead of resolving the
  // package.
  const ATTR_SRC = join(SRC, "attribution.ts");
  const ATTR_DIST = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../dist/observe/attribution.js"
  );

  async function bundleAttribution(code: string, entryFile: string): Promise<string[]> {
    const dir = mkdtempSync(join(tmpdir(), "solid-treeshake-attr-"));
    tempDirs.push(dir);
    const entry = join(dir, "entry.ts");
    writeFileSync(entry, code);
    const result = (await build({
      configFile: false,
      logLevel: "silent",
      define: { __DEV__: "false", __OBSERVE__: "true", __TEST__: "false" },
      resolve: { alias: { attr: entryFile } },
      build: {
        write: false,
        minify: false,
        target: "esnext",
        lib: { entry, formats: ["es"], fileName: "out" },
        rollupOptions: { treeshake: { moduleSideEffects: false } }
      }
    })) as Rollup.RollupOutput[];
    const chunk = result[0].output[0];
    const root = dirname(dirname(entryFile)) + "/";
    return Object.entries(chunk.modules)
      .filter(([, mod]) => mod.renderedLength > 0)
      .map(([id]) => id.replace(root, ""));
  }

  const RECORDS_CONSUMER = `
    import { attribution } from "attr";
    attribution.enable({ log: false });
    attribution.subscribe(e => console.log(e.nodeName));
    export const holds = attribution.holds;
  `;
  const FEEDBACK_CONSUMER = `
    import { attribution, feedback } from "attr";
    attribution.enable({ log: false });
    export const tables = () => feedback();
  `;
  const FOLDS = ["attribution-costs", "attribution-feedback", "attribution-queries"];

  describe("attribution engine: folds are pay-for-use", () => {
    it("a records-only consumer ships the engine and none of the folds (src)", async () => {
      const retained = await bundleAttribution(RECORDS_CONSUMER, ATTR_SRC);
      expect(retainedFrom(retained, ["core/attribution.ts"])).toEqual(["core/attribution.ts"]);
      expect(retainedFrom(retained, FOLDS)).toEqual([]);
    });

    it("importing feedback ships the feedback fold and nothing else (src)", async () => {
      const retained = await bundleAttribution(FEEDBACK_CONSUMER, ATTR_SRC);
      expect(retainedFrom(retained, FOLDS)).toEqual(["attribution-feedback"]);
    });

    it.skipIf(!existsSync(ATTR_DIST))(
      "a records-only consumer ships none of the folds (dist/observe)",
      async () => {
        const retained = await bundleAttribution(RECORDS_CONSUMER, ATTR_DIST);
        expect(retainedFrom(retained, ["core/attribution.js"])).toEqual(["core/attribution.js"]);
        expect(retainedFrom(retained, FOLDS)).toEqual([]);
      }
    );

    it.skipIf(!existsSync(ATTR_DIST))(
      "importing feedback ships the feedback fold (dist/observe)",
      async () => {
        const retained = await bundleAttribution(FEEDBACK_CONSUMER, ATTR_DIST);
        expect(retainedFrom(retained, FOLDS)).toEqual(["attribution-feedback"]);
      }
    );
  });
});
