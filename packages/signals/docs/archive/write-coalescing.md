# Design: write coalescing — a tick's writes propagate as one net change

> Status: **icebox** (ruled 2026-07-08: not worth the opportunity cost for
> 2.0 — the problem has a working userland answer in memo-gating, and as an
> optimization rather than a semantic guarantee it fixes nothing promised).
> Revisit only on perf evidence, and weigh against pull-time commit
> validation (the Alien Signals approach), which would obsolete this.
> Behavior verified reproducible in 2.0; approach agreed, not started.

## The feature

Solid 2.0 already treats the tick as the unit of truth for **values**: plain
writes stage in `_pendingValue` and commit to `_value` at flush — values
don't show until the next tick. But **notification** doesn't follow that
model yet: subscribers are marked dirty at write time, eagerly, per write.
The result is that observers can hear about states that never existed at any
tick boundary.

This design finishes the model. Subscribers hear about the tick's **net
change**, once:

- **Revert elision** — write a value and write it back within a tick, and no
  observer ever knows (#1421). Today the effect still fires:

```ts
const [x, setX] = createSignal(0);
createEffect(x, v => log(v));
flush();
setX(1);
setX(0); // net no-op for this tick
flush(); // effect re-runs anyway — the tick changed nothing, yet it spoke
```

- **Write coalescing** — N writes to one signal per tick currently walk the
  subscriber list N times; with notification at the tick boundary it's once,
  for free.

Why #1421 happens today: effects are created with `equals: false`, so any
dirty recompute fires the effect phase regardless of the compute result.
Memo-gating is the userland workaround. (Alien Signals gets elision from
lazy pull-time commit validation — subscribers validate at pull, while our
writes mark dirty eagerly — a whole different propagation strategy, not
portable piecemeal.)

## The insight: only one step is still eager

The staging half of this feature already exists. Plain writes stage in
`_pendingValue` (`setSignal`, `core.ts`), written nodes are already
collected via `queuePendingNode` into `_pendingNodes`, and
`commitPendingNodes` (`scheduler.ts`) commits at flush. The **only** eager
step left is `insertSubs(el, ...)` at write time — the sole reason a
reverted write still notifies. The change is one move: take that call out of
the write path and run it at flush start, behind a divergence check.

## Approach

At flush start (before the heap drain), for each staged write node:

- if `_equals` exists and `_equals(_pendingValue, _value)` → **skip
  insertion**: drop the stage, no subscriber ever hears about it;
- else `insertSubs(node)` once.

## Scope (round one)

Everything in Solid is a transition, so transition writes **cannot be
exempt** (ruled 2026-07-08) — the write-time dependency is not the
transition itself but the lane context `insertSubs` reads at call time.
Deferral therefore **captures the lane at staging time** (stashed alongside
the node in `_pendingNodes`) and the flush-start insertion uses the stored
lane. One rule for all writes; elision behavior does not depend on what
context the write ran in.

| Case | Treatment | Why |
| --- | --- | --- |
| All plain/transition writes | **deferred**, lane captured at staging | uniform net-change rule; no context-dependent elision |
| Optimistic writes (`_overrideValue` branch) | **stay eager** (round one) | A17: the override is THE value immediately; equal-value optimistic writes already short-circuit at write time |
| `equals: false` signals | **always insert** (still deferred once) | user opted out of equality; every write propagates |
| Writes during an active flush (effects writing signals) | **insert eagerly when staged mid-drain** | the flush's insertion pass already ran; re-scanning is the alternative and likely not worth it — riskiest area, see abort criteria |
| Computed recomputes | untouched | this design covers `setSignal` staging only; computed dirty propagation is a separate mechanism |

## Validation

- Full signals suite + solid + solid-web (transition/optimistic tests are the
  canary for lost write-time context).
- New microbenches: set/revert per tick (elision win), set/set/set per tick
  (coalescing win), single set per tick (regression check on the common
  path — the deferral adds one flush-start pass over `_pendingNodes`).
- Minified + gzipped size diff; CodSpeed (note: `merge-merge-mixed` benches
  in `utilities.bench.ts` are bistable under instrumentation — see 2026-07-08
  release notes — don't chase them).
- Pin #1421 as a regression test on success.

## Rulings (settled 2026-07-08)

1. **Optimization, not semantic guarantee.** Elision is optimization with
   intent — the remaining carve-outs (mid-flush, `equals: false`, eager
   optimistic) are accepted, not debt. #1421 is "elided on the deferred
   path," not a documented invariant. Revisit after round-one coverage is
   known.
2. **Transition writes are in scope.** Everything is a transition, so they
   cannot be exempt; the write-time lane context is captured at staging time
   instead (see Scope). Elision behavior must not depend on the context the
   write ran in.
3. **Notification order is unguaranteed.** Deferred insertion may reorder
   same-height effects relative to today; re-pin tests that notice. Same
   posture as the effect-cleanup refactor.
4. **Mid-tick observability is correct as-is** — with a sharpening: the
   "never existed" claim covers notification only, and in practice
   `isPending` reports through *reactive* update, not the sync read at
   creation — a probe's companion flips on the tick's flush, by which point
   an elided revert has already settled it back. The transient window is
   real but effectively unobservable through the reactive channel; A19/A22
   pins should assert the settled outcome, not the transient.

## Abort criteria

If mid-flush write handling turns into special-cased re-entry logic (rather
than "writes during a drain insert eagerly, same as today"), stop and
report — that complexity signals the model wants Alien-style pull-time
validation instead, which is a bigger architectural conversation.

## Notes

- `read()` already returns `_pendingValue` for pre-flush reads on the paths
  that need it, and staged values are committed before effects run, so
  read-consistency is unchanged by deferring the *notification*.
- Companion updates (`syncCompanions` in `setSignal`) fire at write time
  today and pin `isPending` behavior (A19 cause (i)); elided reverts must
  also settle companions back — a reverted stage never was pending. Check
  `spec-async-semantics.test.ts` A19/A22 pins.
