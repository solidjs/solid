# Performance Experiments

Working notes for Solid 2 performance investigations. Numbers are benchmark medians unless noted.

For the workflow, two-tier model, doctrine, and guardrails this journal
operates under, see [`benchmarking-strategy.md`](./benchmarking-strategy.md).

## Reactivity Lane

### `flush(fn)` / scheduler cleanup

- Replaced the temporary `_runSync` API with a `flush(fn)` overload.
- Added tests for scoped synchronous flushing.
- Kept the plain signal read fast path because removing it regressed creation-heavy benchmarks.
- Full external reactivity runs showed no persistent `createComputations` regression after focused A/B checks.

### `merge` / `omit`

- Re-ran store utility benchmarks after the scheduler and `flush(fn)` changes.
- Finding: no meaningful movement from those changes.
- Follow-up: exact before/after output was not copied into these notes before this log existed.

## DOM Lane: `js-framework-benchmark`

Setup:

- `solid-next` benchmark package is wired to local Solid packages via `file:` dependencies.
- CPU comparisons use medians.
- Focused runs generally use:
  - `01_run1k`
  - `03_update10th1k_x16`
  - `04_select1k`
  - `07_create10k`
  - `08_create1k-after1k_x2`

### Baseline Shape

Main regression under investigation: `07_create10k` script time for Solid 2 compared with Solid 1.

Baseline observations gathered so far:

- Normal Solid 2 store selection: `07_create10k` script around `55.1ms`.
- No selection/dependency in rows: `07_create10k` script around `44.9ms`.

Finding:

- Removing selection recovers roughly `10ms` of script time on `07_create10k`.
- This points at per-row dependency/binding work as the major creation cost, not only store machinery.

### Store Selection vs Signal Selection

Probe:

- Replaced benchmark selection state with `createSignal` plus selector-style lookup.

Result:

- `07_create10k` script improved only slightly, from roughly `55.1ms` to `52.4ms`.
- Update/select behavior is expected to differ, but this probe was mainly for creation cost.

Finding:

- `createStore` selection is not the main source of the creation gap.

### Object Result vs Tuple Result

Probe:

- Patched generated row render-effect output from object result shape:
  - `{ e: className, t: label }`
- To tuple result shape:
  - `[className, label]`

Result:

- No improvement; tuple shape was slightly worse in the focused probe.

Finding:

- Object allocation/destructuring in the row effect result is not currently the main creation cost.

### No Selection / Dependency Cost

Probe:

- Removed all selection state and class binding from rows.
- Rows only reacted to their own label.

Result:

- `07_create10k` script improved from roughly `55.1ms` to `44.9ms`.

Finding:

- The extra per-row selected-class dependency/binding accounts for most of the observed creation gap.

### Per-Key Signal Reverse Selector

Probe:

- Added a benchmark-local `createLocalSelector` using `Map<key, [signal, setter]>`.
- The selector updated only previous and next selected keys.

Result:

- `04_select1k` script improved to about `0.7ms`.
- `07_create10k` script worsened to about `57.0ms`.

Finding:

- Reverse-triggering helps selection updates, but per-key signal allocation is bad for creation.

### Solid 1-Style Listener Map Selector

Probe:

- Patched the generated `solid-next` bundle with a benchmark-local listener map:
  - key -> set of subscribed row computations
  - selection change dirties only old/new key subscribers
  - no per-key signals
- Several intermediate patches failed for non-performance reasons:
  - render-effect back-half notification was too late for benchmark checks
  - `String.replace` collapsed `$$click` to `$click`
  - normal cleanup semantics removed listeners at the wrong time for this diagnostic patch
- Final successful diagnostic patch kept row computation listeners in the map and manually scheduled/flushed dirty rows.

Result:

- `01_run1k`: script `4.7ms`
- `03_update10th1k_x16`: script `2.1ms`
- `04_select1k`: script `0.7ms`
- `07_create10k`: script `53.9ms`
- `08_create1k-after1k_x2`: script `4.5ms`

Comparison:

- Normal store selection: `07_create10k` around `55.1ms`.
- Per-key signal reverse selector: `57.0ms`.
- No selection/dependency: `44.9ms`.
- Solid 1-style listener map selector: `53.9ms`.

Finding:

- Exact listener-map selection recovers only about `1ms` on `07_create10k`.
- The larger gap is not mostly store property nodes or lack of reverse-triggering.
- The cost appears to be broader per-row selected-class work in the render-effect compute path.

### Memo-Style Render Effects

Question:

- What if generated render effects behaved more like `createMemo`, running the DOM write from the same computation instead of using the split compute/effect wrapper?

Patch:

- Temporary generated-bundle patch only.
- Replaced bundled `createRenderEffect` helper with a memo-style computation that:
  - runs `compute(prev)` in a tracking scope
  - immediately calls the DOM-write callback with `(next, prev)`
  - stores `prev`

Smoke test:

- `run` created 1,000 rows.
- Selecting row 5 produced one `danger` row.

Result:

- `01_run1k`: script `4.9ms`
- `03_update10th1k_x16`: script `1.8ms`
- `04_select1k`: script `0.8ms`
- `07_create10k`: script `48.5ms`
- `08_create1k-after1k_x2`: script `4.5ms`

Follow-up total-time rerun:

- Re-ran only `07_create10k` with the normal benchmark app shape (`class={...}` and
  `textContent={row().label()}`), changing only the internal DOM `effect` wrapper to the
  memo-style diagnostic implementation.
- Median result: total `373.5ms`, script `47.4ms`, paint `314.5ms`.

Full CPU scripting rerun with memo-style DOM effect:

- `01_run1k`: script `4.9ms`
- `02_replace1k`: script `9.3ms`
- `03_update10th1k_x16`: script `2.0ms`
- `04_select1k`: script `0.8ms`
- `05_swap1k`: script `1.9ms`
- `06_remove-one-1k`: script `0.6ms`
- `07_create10k`: script `47.4ms`
- `08_create1k-after1k_x2`: script `4.7ms`
- `09_clear1k_x8`: script `14.2ms`

Compared with the latest normal Solid 2 baseline (`01`-`09` script:
`5.0`, `8.7`, `2.3`, `0.8`, `2.0`, `0.7`, `51.7`, `5.2`, `14.4`):

- Improves `01`, `03`, `06`, `07`, `08`, and `09`.
- Neutral on `04`.
- Regresses `02` and slightly `05` in this run.
- Overall it is a broad scripting improvement, but still a semantic diagnostic only because it
  collapses the render-effect split phase.

Comparison:

- Normal store selection: `07_create10k` around `55.1ms`.
- No selection/dependency: `44.9ms`.
- Solid 1-style listener map selector: `53.9ms`.
- Memo-style render effects: `48.5ms`.

Finding:

- Collapsing render effects into a memo-style computation recovers roughly `6.6ms` on `07_create10k`.
- This is the largest successful creation improvement so far, but it intentionally violates the split compute/effect phase model and is only a diagnostic patch.
- Since it still trails the no-selection result by about `3.6ms`, selected-class dependency/binding work remains a real part of the cost even without the render-effect wrapper.

### Static Row / No Render Effect

Question:

- How much of `07_create10k` is per-row render-effect creation/initialization overhead, independent of selected-class dependency cost?

Patch:

- Temporary generated-bundle patch only.
- Kept row objects and label signals.
- Removed the generated per-row render effect entirely.
- Read `row().label()` once during row creation and assigned the text node directly.
- This intentionally makes update/select behavior invalid; only creation and append rows are meaningful.

Smoke test:

- `run` created 1,000 rows.
- First row label was rendered.

Result:

- `01_run1k`: script `2.8ms`
- `07_create10k`: script `33.0ms`
- `08_create1k-after1k_x2`: script `3.0ms`

Comparison:

- Normal store selection: `07_create10k` around `55.1ms`.
- No selection/dependency but still label render effects: `44.9ms`.
- Memo-style render effects: `48.5ms`.
- Static row / no render effect: `33.0ms`.

Finding:

- Effect creation/initialization is a very large part of creation cost.
- The no-selection probe did not remove effect creation; it only removed selected-class work from the per-row effect.
- Rough decomposition from current probes:
  - selected-class dependency/work: about `10ms` (`55.1ms -> 44.9ms`)
  - split render-effect wrapper/queue shape: about `6.6ms` (`55.1ms -> 48.5ms`)
  - remaining label render-effect creation/initialization cost: roughly `12ms` (`44.9ms -> 33.0ms`)

## Effect Optimization Iterations

### Iteration 1: Stable Effect Runner

Question:

- Does avoiding repeated `runEffect.bind(node)` scheduling reduce split-effect overhead?

Patch:

- Added a `_run` field to effect nodes.
- Reused `node._run` when enqueueing effects instead of allocating `runEffect.bind(node)` at enqueue sites.

Validation:

- Solid Signals test suite passed.

Result:

- `01_run1k`: script `5.2ms`
- `03_update10th1k_x16`: script `2.4ms`
- `04_select1k`: script `0.8ms`
- `07_create10k`: script `55.8ms`
- `08_create1k-after1k_x2`: script `5.2ms`

Comparison:

- Normal store selection: `07_create10k` around `55.1ms`.
- Iteration 1 stable runner: `55.8ms`.

Finding:

- Negative or neutral result.
- The stable runner adds a bound function allocation per effect at creation time, which hurts creation-heavy rows.
- Repeated `.bind()` during update is not the relevant bottleneck for these focused DOM rows.
- Reverted instead of keeping this change.

### Iteration 2: Remove Per-Effect Equals Closure

Question:

- Does moving effect invalidation out of the per-node `equals` closure reduce split-effect creation overhead?

Patch:

- Created effects with `equals: false`.
- Moved render/user effect `modified + enqueue` handling into the shared recompute path.
- Added a stable `_run` field so recompute could enqueue the effect callback.

Validation:

- Initial version failed because the old `equals` closure also marked effects modified during initial creation.
- After restoring that initialization behavior, Solid Signals test suite passed.

Result:

- `01_run1k`: script `5.2ms`
- `03_update10th1k_x16`: script `2.4ms`
- `04_select1k`: script `0.9ms`
- `07_create10k`: script `55.0ms`
- `08_create1k-after1k_x2`: script `5.0ms`

Comparison:

- Normal store selection: `07_create10k` around `55.1ms`.
- Iteration 2 equals removal: `55.0ms`.

Finding:

- Neutral to negative result.
- Removing the `equals` closure is offset by adding a bound runner field per effect.
- This does not address the dominant creation cost and was reverted.

### Iteration 3: Shared Effect Status Notifier

Question:

- Does replacing the per-effect `_notifyStatus` closure with a shared function reduce creation overhead?

Patch:

- Replaced the closure assigned to `node._notifyStatus` in render/user effects with a shared `notifyEffectStatus` function that uses `this`.
- Preserved user effect error handling and render effect async/loading notifications.

Validation:

- Solid Signals test suite passed.

Result:

- `01_run1k`: script `5.0ms`
- `03_update10th1k_x16`: script `2.1ms`
- `04_select1k`: script `0.9ms`
- `07_create10k`: script `51.3ms`
- `08_create1k-after1k_x2`: script `5.1ms`

Comparison:

- Normal store selection: `07_create10k` around `55.1ms`.
- Iteration 3 shared status notifier: `51.3ms`.
- Memo-style render effects diagnostic: `48.5ms`.

Finding:

- Useful shared creation win: roughly `3.8ms` on `07_create10k`.
- Does not help append rows in this run, so the result should be validated in a later full baseline.
- Kept for now because behavior tests pass and it removes a real per-effect allocation.

### Iteration 4: Lazy Effect Cleanup Registration

Question:

- Does avoiding cleanup-disposer closure registration for effects that never return cleanup reduce render binding creation cost?

Patch:

- Removed the unconditional `cleanup(() => node._cleanup?.())` registration during effect creation.
- When an effect callback returns a cleanup function for the first time, register the owner cleanup lazily.
- DOM render effects in the benchmark normally return no cleanup, so they skip this closure entirely.

Validation:

- Solid Signals test suite passed.

Result:

- `01_run1k`: script `5.1ms`
- `03_update10th1k_x16`: script `2.0ms`
- `04_select1k`: script `0.6ms`
- `07_create10k`: script `50.0ms`
- `08_create1k-after1k_x2`: script `5.1ms`

Comparison:

- Normal store selection: `07_create10k` around `55.1ms`.
- Iteration 3 shared status notifier: `51.3ms`.
- Iteration 4 lazy cleanup registration: `50.0ms`.
- Memo-style render effects diagnostic: `48.5ms`.

Finding:

- Additional useful creation win on `07_create10k`, now roughly `5.1ms` recovered from shared effect cleanup.
- Append remains worse/noisy in these focused runs, so this must be rechecked in a fresh baseline.
- Kept for now because behavior tests pass and compiler-generated render effects do not need cleanup registration.

### Iteration 5: Omit Cleanup Registration Flag Field

Question:

- Does leaving `_cleanupRegistered` absent on no-cleanup effects improve object shape or creation cost?

Patch:

- Removed the initial `_cleanupRegistered = false` assignment from effect creation.
- Effects only get the field if a cleanup is returned.

Validation:

- Solid Signals test suite passed.

Result:

- `01_run1k`: script `5.0ms`
- `07_create10k`: script `52.0ms`
- `08_create1k-after1k_x2`: script `5.1ms`

Comparison:

- Iteration 4 with explicit `_cleanupRegistered = false`: `07_create10k` `50.0ms`.
- Iteration 5 omitted field: `52.0ms`.

Finding:

- Negative result.
- Keeping the field initialized appears better for object shape in this benchmark.
- Reverted to the explicit `false` initialization from Iteration 4.

### Iteration 6: Internal Stale Compute Flag

Question:

- Does removing the render-effect compute wrapper `p => staleValues(() => compute(p))` reduce creation overhead?

Patch:

- Added an internal `_stale` option/field on computed nodes.
- Ran the computation under stale reads inside `recompute()` instead of wrapping render-effect compute at creation time.

Validation:

- Solid Signals test suite passed.

Result:

- `01_run1k`: script `5.0ms`
- `03_update10th1k_x16`: script `2.3ms`
- `04_select1k`: script `0.8ms`
- `07_create10k`: script `51.7ms`
- `08_create1k-after1k_x2`: script `5.0ms`

Comparison:

- Iteration 4 retained state: `07_create10k` `50.0ms`.
- Iteration 6 stale compute flag: `51.7ms`.

Finding:

- Negative result.
- The wrapper closure is not the dominant cost, and adding a special computed-node field/branch worsens this benchmark shape.
- Reverted.

### Retained Effect Changes

- Kept Iteration 3: shared `notifyEffectStatus` function instead of per-effect status closures.
- Kept Iteration 4: lazy cleanup registration for effect callbacks that actually return cleanup.
- Reverted Iterations 1, 2, 5, and 6.
- Current best retained focused result for `07_create10k`: `50.0ms` script median.

### Full CPU Baseline After Retained Changes

Run:

- `solid-next`
- CPU rows `01` through `09`
- Playwright, headless Chrome, `--count 5`

Median result:

- `01_run1k`: total `37.3ms`, script `5.0ms`, paint `31.5ms`
- `02_replace1k`: total `41.3ms`, script `8.7ms`, paint `32.0ms`
- `03_update10th1k_x16`: total `26.6ms`, script `2.3ms`, paint `19.5ms`
- `04_select1k`: total `8.2ms`, script `0.8ms`, paint `5.0ms`
- `05_swap1k`: total `29.9ms`, script `2.0ms`, paint `23.2ms`
- `06_remove-one-1k`: total `21.1ms`, script `0.7ms`, paint `18.2ms`
- `07_create10k`: total `392.2ms`, script `51.7ms`, paint `327.8ms`
- `08_create1k-after1k_x2`: total `43.0ms`, script `5.2ms`, paint `36.4ms`
- `09_clear1k_x8`: total `17.5ms`, script `14.4ms`, paint `1.4ms`

Finding:

- `07_create10k` script remains improved versus the original Solid 2 baseline (`55.1ms` -> `51.7ms` in this run), but not as good as the best focused retained run (`50.0ms`).
- `07_create10k` total is worse than the earlier focused retained run (`358.6ms`) and original quick baseline (`385.3ms`), almost entirely from paint variance (`327.8ms` here).
- Treat total-time conclusions as requiring a same-session A/B; script is the more stable signal from this run.

### Full CPU Baseline With Vanilla And Solid 1

Run:

- `vanillajs`, `solid` v1.9.12, `solid-next`
- CPU rows `01` through `09`
- Playwright, headless Chrome, `--count 5`
- Initial all-in-one run hung at `solid-next` `03_update10th1k_x16`; completed by rerunning that row and then running remaining rows in smaller chunks.

Median totals:

- `01_run1k`: Vanilla `35.2ms`, Solid 1 `37.1ms`, Solid 2 `37.8ms`
- `02_replace1k`: Vanilla `41.4ms`, Solid 1 `42.3ms`, Solid 2 `41.6ms`
- `03_update10th1k_x16`: Vanilla `21.3ms`, Solid 1 `25.2ms`, Solid 2 `26.6ms`
- `04_select1k`: Vanilla `7.6ms`, Solid 1 `8.4ms`, Solid 2 `8.0ms`
- `05_swap1k`: Vanilla `26.8ms`, Solid 1 `30.6ms`, Solid 2 `30.5ms`
- `06_remove-one-1k`: Vanilla `19.1ms`, Solid 1 `19.8ms`, Solid 2 `19.6ms`
- `07_create10k`: Vanilla `341.8ms`, Solid 1 `365.3ms`, Solid 2 `382.4ms`
- `08_create1k-after1k_x2`: Vanilla `41.7ms`, Solid 1 `43.7ms`, Solid 2 `45.3ms`
- `09_clear1k_x8`: Vanilla `15.4ms`, Solid 1 `18.4ms`, Solid 2 `18.0ms`

Median scripts:

- `01_run1k`: Vanilla `2.5ms`, Solid 1 `3.9ms`, Solid 2 `5.0ms`
- `02_replace1k`: Vanilla `6.2ms`, Solid 1 `8.4ms`, Solid 2 `8.7ms`
- `03_update10th1k_x16`: Vanilla `0.9ms`, Solid 1 `1.9ms`, Solid 2 `2.5ms`
- `04_select1k`: Vanilla `0.5ms`, Solid 1 `0.8ms`, Solid 2 `1.0ms`
- `05_swap1k`: Vanilla `0.1ms`, Solid 1 `1.7ms`, Solid 2 `2.0ms`
- `06_remove-one-1k`: Vanilla `0.4ms`, Solid 1 `0.5ms`, Solid 2 `0.8ms`
- `07_create10k`: Vanilla `29.8ms`, Solid 1 `44.2ms`, Solid 2 `52.9ms`
- `08_create1k-after1k_x2`: Vanilla `2.4ms`, Solid 1 `4.0ms`, Solid 2 `5.0ms`
- `09_clear1k_x8`: Vanilla `12.0ms`, Solid 1 `16.2ms`, Solid 2 `14.6ms`

Finding:

- Same-session `07_create10k` gap is now Solid 2 vs Solid 1: `+17.1ms` total, `+8.7ms` script.
- Solid 2 total is close to Solid 1 on most rows, and slightly better on `02`, `04`, `06`, and `09`.
- Solid 2 script remains consistently above Solid 1 on rows `01` through `08`; `09_clear1k_x8` is the exception where Solid 2 script is faster.

Official-style weighted geometric mean:

- Total-time factors: Vanilla `1.000`, Solid 1 `1.084`, Solid 2 `1.098`
- Script-time factors: Vanilla `1.000`, Solid 1 `1.653`, Solid 2 `2.017`

Finding:

- Using the benchmark's CPU weighting and per-row fastest normalization, Solid 2 is about `1.3%` worse than Solid 1 on total time (`1.098 / 1.084`).
- On script time, Solid 2 is about `22.0%` worse than Solid 1 (`2.017 / 1.653`).

### Row Accessor Cache Probe

Question:

- How much overhead comes from Solid 2's `<For>` item accessor shape in the generated row effect?

Observation:

- Solid 1 generated row code reads the row object directly: `row.label()`.
- Solid 2 generated row code reads through the accessor in the effect: `row().label()`.

Probe:

- In the `solid-next` benchmark harness, cached `const rowItem = row()` once while creating the row.
- Changed label reads from `row().label()` to `rowItem.label()`.

Result:

- `01_run1k`: script `5.0ms`
- `03_update10th1k_x16`: script `2.1ms`
- `07_create10k`: script `51.2ms`
- `08_create1k-after1k_x2`: script `5.2ms`

Comparison:

- Latest same-session Solid 2 baseline:
  - `01_run1k`: `5.0ms`
  - `03_update10th1k_x16`: `2.5ms`
  - `07_create10k`: `52.9ms`
  - `08_create1k-after1k_x2`: `5.0ms`

Finding:

- Caching the row accessor recovers about `1.7ms` on `07_create10k` and helps `03_update`.
- This is a meaningful integration-shape cost, but not the main source of the Solid 2 vs Solid 1 DOM gap.
- It points toward a possible keyed/static row API or compiler optimization, not a core reactivity primitive issue.

### Class Binding Property Probe

Question:

- How much of the remaining row creation cost comes from Solid 2's generalized class helper path?

Probe:

- Kept the row accessor cache probe.
- Changed the row class binding from `class={...}` to `prop:className={...}` in the benchmark harness.

Result:

- `01_run1k`: script `5.0ms`
- `03_update10th1k_x16`: script `2.5ms`
- `04_select1k`: script `0.9ms`
- `07_create10k`: script `50.8ms`
- `08_create1k-after1k_x2`: script `5.1ms`

Comparison:

- Row accessor cache probe: `07_create10k` `51.2ms`.
- Class property probe: `07_create10k` `50.8ms`.

Finding:

- The class helper path may contribute a small creation cost, but it is not the main lever.
- The update/select rows did not improve, so this is not an obvious standalone benchmark-harness fix.

### Initial Render Effect Inline Probe

Question:

- Can render-effect initial creation avoid some setup overhead while preserving split compute/effect semantics for updates?

Probe:

- Kept normal `solid-next` benchmark harness.
- In `effect()`, replaced the initial `runEffect.call(node)` path for immediate render effects with a guarded `runInitialRenderEffect(node)`.
- The first version failed async/optimistic tests because it ran unresolved pending render effects with `undefined`.
- Added the same `!_modified || disposed` guard as `runEffect`; the full Solid Signals test suite then passed.

Result:

- `01_run1k`: script `5.0ms`
- `03_update10th1k_x16`: script `1.8ms`
- `07_create10k`: script `52.2ms`
- `08_create1k-after1k_x2`: script `5.3ms`
- `09_clear1k_x8`: script `14.4ms`

Comparison:

- Latest same-session Solid 2 baseline:
  - `01_run1k`: `5.0ms`
  - `03_update10th1k_x16`: `2.5ms`
  - `07_create10k`: `52.9ms`
  - `08_create1k-after1k_x2`: `5.0ms`
  - `09_clear1k_x8`: `14.6ms`

Finding:

- Behavior can be preserved with the pending/modified guard.
- Performance is mixed: update and clear improve, create10k barely moves, append worsens.
- Not a clear keeper without a full aggregate run and code cleanup; likely too small to be the main DOM-lane fix.

### Non-Transparent Web Effect Probe

Question:

- Is the `@solidjs/web` DOM binding wrapper paying meaningful overhead by always passing `{ transparent: true }` to `createRenderEffect`?

Probe:

- Temporarily changed `packages/solid-web/src/core.ts` so `effect(fn, effectFn, options)` directly called `createRenderEffect(fn, effectFn, options)`.
- This removed the shared `transparentOptions` path for normal generated DOM bindings.

Result:

- `01_run1k`: script `5.0ms`
- `03_update10th1k_x16`: script `2.6ms`
- `04_select1k`: script `0.8ms`
- `07_create10k`: script `53.1ms`
- `08_create1k-after1k_x2`: script `5.1ms`

Finding:

- Negative/neutral. `07_create10k` and `03_update` both worsened versus the retained baseline.
- The transparent wrapper should stay; it is not the source of the DOM-lane gap.

### Recompute-Level Effect Specialization Probe

Question:

- Can render/user effects avoid the per-effect comparator closure by moving effect-specific
  `_modified` marking and back-half enqueueing into `recompute()`?

Probe:

- Changed effect nodes to use `equals: false`.
- Added a queued-effect branch in `recompute()` that marks `_modified` and enqueues a stored
  `_runEffect` callback after the compute half changes.
- The first version accidentally treated `createTrackedEffect` as queue-backed and failed tests by
  enqueueing type `3`; narrowing to render/user effects passed the full Solid Signals suite.

Result:

- `01_run1k`: script `4.9ms`
- `03_update10th1k_x16`: script `2.5ms`
- `04_select1k`: script `0.9ms`
- `07_create10k`: script `52.3ms`
- `08_create1k-after1k_x2`: script `4.9ms`
- `09_clear1k_x8`: script `14.7ms`

Finding:

- Test-clean but not worth retaining.
- `07_create10k` improved only marginally versus the latest retained baseline (`52.9ms -> 52.3ms`),
  while update/select/clear did not improve.
- The extra core branching and stored callback are not justified by this amount of movement.

### Compiler Binding Granularity Probe: Child Text Instead Of `textContent`

Question:

- Is the grouped `{ class, textContent }` dynamic object hurting updates enough that the compiler
  should split bindings more aggressively?

Compiler output observation:

- Normal Solid 2 row output groups the dynamic row class and text into one split effect:
  - compute: `() => ({ e: selected[rowId] ? "danger" : "", t: row().label() })`
  - effect: destructure `{ e, t }`, update class and text.
- The relevant compiler path is `wrapDynamics$2` in `babel-plugin-jsx-dom-expressions`.
  - For `dynamics.length > 1`, it emits the object-result split effect.
  - For `dynamics.length === 1`, it emits a scalar split effect.

Probe:

- Changed the benchmark row label from `textContent={row().label()}` to child text:
  - `<a onClick={[setSelectedId, rowId]}>{row().label()}</a>`
- This forced compiler output to split binding granularity:
  - `insert(_el$12, () => row().label())`
  - separate scalar class effect: `effect(() => selected[rowId] ? "danger" : "", ...)`

Result:

- `01_run1k`: script `4.8ms`
- `03_update10th1k_x16`: script `2.4ms`
- `04_select1k`: script `0.8ms`
- `07_create10k`: script `58.0ms`
- `08_create1k-after1k_x2`: script `5.9ms`

Finding:

- Splitting binding granularity is worse for creation and append.
- Update/select do not improve enough to justify the extra per-row binding machinery.
- The compiler's current grouped dynamic effect is the right creation tradeoff for this benchmark,
  even though the grouped compute path couples unrelated dependencies.

### Compiler Grouped Dynamic Scratch Variables Probe

Question:

- Can the compiler keep grouped dynamic bindings but avoid per-run object allocation and
  destructuring in the split-effect compute/effect pair?

Probe:

- Locally patched `babel-plugin-jsx-dom-expressions` diagnostic output for grouped DOM dynamics.
- Replaced:
  - compute: `() => ({ e, t })`
  - effect args: `({ e, t }, _p$ = { e: undefined, t: undefined }) => ...`
- With closure scratch variables:
  - declare `var _v$, _p$, _v$2, _p$2`
  - compute: `() => (_v$ = selected[rowId] ? "danger" : "", _v$2 = row().label())`
  - effect: compare/update using `_v$`, `_p$`, `_v$2`, `_p$2`.

Result:

- `01_run1k`: script `5.1ms`
- `03_update10th1k_x16`: script `2.6ms`
- `04_select1k`: script `0.8ms`
- `07_create10k`: script `52.2ms`
- `08_create1k-after1k_x2`: script `4.8ms`

Finding:

- Valid compiler shape, but not a step-change.
- It slightly improves `07_create10k` and append script versus the latest retained baseline, but
  update worsens and total time is noisy/worse due to paint variance.
- This is a possible low-priority cleanup/optimization direction if implemented cleanly upstream,
  but it is not enough to explain or recover the Solid 2 DOM gap.

### Binding Cost Decomposition: Label vs Selection

Question:

- Apart from Solid 1's `createSelector`, should Solid 1 and Solid 2 have the same row binding
  count and therefore mostly the same creation cost?

Same-session anchors:

- Solid 1 normal: total `369.3ms`, script `44.7ms`, paint `310.9ms`.
- Solid 2 normal: total `377.8ms`, script `52.4ms`, paint `312.5ms`.
- Vanilla: total `344.8ms`, script `29.0ms`, paint `303.5ms`.

Probes:

- Label-only:
  - removed selected-class binding from `<tr>`
  - kept reactive label binding: `textContent={row().label()}`
  - result: total `367.7ms`, script `43.3ms`, paint `310.0ms`
- Selection-only:
  - kept selected-class binding
  - read label once during row creation and assigned static text
  - compiled output confirmed only one row effect for class
  - result: total `376.5ms`, script `47.7ms`, paint `313.8ms`
- Static row:
  - removed selected-class binding
  - read label once during row creation and assigned static text
  - result: total `356.8ms`, script `32.5ms`, paint `311.2ms`

Finding:

- Paint is mostly invariant around `310-314ms`; the meaningful differences are scripting.
- Static row shows pure row DOM creation is about `32.5ms` script in this setup.
- Label-only adds about `10.8ms` over static (`43.3 - 32.5`).
- Selection-only adds about `15.2ms` over static (`47.7 - 32.5`).
- Normal adds about `19.9ms` over static (`52.4 - 32.5`), less than the sum because the compiler
  groups class and label into one effect.
- Label-only Solid 2 (`43.3ms`) is slightly faster than normal Solid 1 (`44.7ms`) in this same
  session, so the base label render binding is not worse than Solid 1 here.
- The remaining normal Solid 2 vs Solid 1 create gap is concentrated in selection/class work and
  the split async-aware render-effect implementation around the grouped binding, not a higher
  number of row bindings.

### Store Missing-Property Read Fast Path Probe

Question:

- How much of the selected-class creation cost is generic store proxy overhead for
  `selected[rowId]` when every key is absent during create?

Probe:

- Added a guarded fast path in the store `get` trap for tracked reads of absent properties on plain
  stores with no override, optimistic state, snapshot state, custom prototype, proxy source, or
  write-only scope.
- The fast path still creates the normal per-property store node through `getNode`, preserving
  cleanup and `isEqual` semantics. It only avoids the generic descriptor/prototype/value/wrapping
  path before subscribing the missing key.

Results:

- First diagnostic, no-cleanup missing node: selection-only `07_create10k` script `47.0ms`
  vs earlier selection-only anchor `47.7ms`.
- Plain-object absent fast path plus no-cleanup missing node: selection-only script `46.2ms`.
- Normal grouped row, no-cleanup missing node: script `50.8ms` vs earlier normal anchor `52.4ms`.
- Cleanup-preserving missing node: normal grouped row script `51.0ms`.
- Behavior-compatible `getNode`/`isEqual` version: normal grouped row script `50.9ms`, total
  `369.4ms`, paint `306.3ms`.

Finding:

- The generic absent store read path is a real but modest part of the selection-class create cost:
  roughly `1.3-1.5ms` script on `07_create10k` in these runs.
- The larger remaining gap is still per-key subscription/effect machinery, not descriptor lookup
  alone.
- The behavior-compatible version is the only retainable shape from this probe; the no-cleanup and
  `equals: false` variants were diagnostic only.

### Selection Shape Diagnostics: Signal vs Selector

Question:

- Since Solid 2 still lags Solid 1 on `07_create10k`, how much of the gap is specifically Solid 1's
  `createSelector` shape?

Probes:

- Single selected signal:
  - changed selection from `selected[rowId]` store reads to `selected() === rowId`.
  - This avoids per-key store subscriptions during create but makes every row depend on the same
    selected signal.
- App-local selector polyfill:
  - source signal plus a `Map` of normal per-key boolean signals.
  - Selection updates only previous and next keys.
- Reverse-trigger selector diagnostic:
  - temporary internal primitive with keyed subscriber nodes and manual `insertSubs`/`schedule`.
  - Avoids normal signal/store nodes for each key, closer to Solid 1's reverse-trigger concept.

Results:

- Single selected signal:
  - `04_select1k`: script `2.2ms`
  - `07_create10k`: script `48.7ms`, total `372.8ms`, paint `311.9ms`
- App-local selector polyfill:
  - `04_select1k`: script `0.5ms`
  - `07_create10k`: script `54.0ms`
- Reverse-trigger selector diagnostic:
  - `04_select1k`: script `0.7ms`
  - `07_create10k`: script `51.7ms`, total `379.3ms`, paint `315.3ms`

Finding:

- A single selected signal helps create more than the store path, but it destroys select scaling.
- A selector built out of normal per-key signals is not the Solid 1 create shape; it is fast for
  select but worse for create.
- Even the reverse-trigger diagnostic does not recover Solid 1 create. That leaves the row class
  binding/render-effect creation path as the more likely remaining source of the Solid 1 gap.

### Render Effect Stale Wrapper Probe

Question:

- Is render-effect creation paying meaningful overhead for the `p => staleValues(() => compute(p))`
  wrapper, specifically the inner closure allocated for each compute run?

Probe:

- Added an internal `staleCompute(fn, prev)` helper that enters stale-read mode and invokes
  `compute(prev)` directly.
- Changed non-user effects from `p => staleValues(() => compute(p))` to
  `p => staleCompute(compute, p)`.

Result:

- `04_select1k`: script `0.8ms`
- `07_create10k`: script `52.3ms`, total `377.8ms`, paint `314.5ms`

Finding:

- Not useful. It does not improve creation versus the retained store-fast-path runs and may slightly
  perturb the runtime shape.
- Reverted.

### Empty Class Binding Diagnostics

Question:

- Is `07_create10k` paying meaningful DOM cost because the initial selected class expression returns
  `""`, causing `className()` to set an empty `class` attribute on all 10k rows?

Probes:

- App-source expression shape:
  - changed `class={selected[rowId] ? "danger" : ""}` to
    `class={selected[rowId] && "danger"}`.
  - This keeps the selected store dependency but returns `false` for unselected rows.
- Helper-level behavior:
  - temporarily patched `dom-expressions` `className()` to skip `value === "" && prev == null`.
  - Kept the benchmark source unchanged.

Results:

- App-source `&&` shape:
  - `04_select1k`: script `0.8ms`
  - `07_create10k`: script `50.6ms`, total `376.3ms`, paint `312.5ms`
- Helper-level empty-string skip:
  - `04_select1k`: script `0.9ms`
  - `07_create10k`: script `51.9ms`, total `387.9ms`, paint `319.0ms`

Finding:

- Avoiding initial empty-class writes is at best a small app/compiler-shape win and not a core
  runtime lever.
- The direct helper change was noisy/negative, so there is no clear upstream `dom-expressions`
  change from this probe.
- Reverted both diagnostics.

### Render Effect Status Registration Upper Bound

Question:

- Does eagerly assigning `_notifyStatus = notifyEffectStatus` on every render effect explain the
  remaining create gap?

Probe:

- Temporarily skipped `_notifyStatus` registration for render effects while leaving user effects
  unchanged.
- This intentionally breaks async render-effect status behavior and was used only as a DOM
  benchmark upper bound.

Result:

- `04_select1k`: script `0.9ms`
- `07_create10k`: script `51.7ms`, total `381.5ms`, paint `316.3ms`

Finding:

- Not a useful lever. Removing the status notifier does not improve create in this benchmark.
- Reverted.

### Full CPU Checkpoint After Retained Changes

Setup:

- Rebuilt local `@solidjs/signals`, `solid-js`, and `@solidjs/web`.
- Rebuilt `js-framework-benchmark` keyed entries for `vanillajs`, `solid`, and `solid-next`.
- Ran CPU benchmarks `01`-`09` with `--count 5`; values below are medians.

Median scripting:

- `01_run1k`: Vanilla `2.5ms`, Solid 1 `3.8ms`, Solid 2 `4.7ms`
- `02_replace1k`: Vanilla `6.0ms`, Solid 1 `8.1ms`, Solid 2 `8.2ms`
- `03_update10th1k_x16`: Vanilla `0.9ms`, Solid 1 `1.7ms`, Solid 2 `2.6ms`
- `04_select1k`: Vanilla `0.5ms`, Solid 1 `0.7ms`, Solid 2 `1.0ms`
- `05_swap1k`: Vanilla `0.1ms`, Solid 1 `1.3ms`, Solid 2 `2.3ms`
- `06_remove-one-1k`: Vanilla `0.2ms`, Solid 1 `0.5ms`, Solid 2 `0.6ms`
- `07_create10k`: Vanilla `28.9ms`, Solid 1 `45.3ms`, Solid 2 `52.4ms`
- `08_create1k-after1k_x2`: Vanilla `2.6ms`, Solid 1 `4.1ms`, Solid 2 `4.8ms`
- `09_clear1k_x8`: Vanilla `12.0ms`, Solid 1 `16.1ms`, Solid 2 `14.2ms`

Median total:

- `01_run1k`: Vanilla `35.2ms`, Solid 1 `37.3ms`, Solid 2 `36.4ms`
- `02_replace1k`: Vanilla `42.5ms`, Solid 1 `42.0ms`, Solid 2 `42.3ms`
- `03_update10th1k_x16`: Vanilla `20.5ms`, Solid 1 `25.6ms`, Solid 2 `26.6ms`
- `04_select1k`: Vanilla `7.2ms`, Solid 1 `8.2ms`, Solid 2 `8.3ms`
- `05_swap1k`: Vanilla `27.4ms`, Solid 1 `30.4ms`, Solid 2 `31.0ms`
- `06_remove-one-1k`: Vanilla `19.4ms`, Solid 1 `19.7ms`, Solid 2 `20.8ms`
- `07_create10k`: Vanilla `347.3ms`, Solid 1 `382.9ms`, Solid 2 `387.0ms`
- `08_create1k-after1k_x2`: Vanilla `42.7ms`, Solid 1 `46.9ms`, Solid 2 `45.5ms`
- `09_clear1k_x8`: Vanilla `15.8ms`, Solid 1 `19.0ms`, Solid 2 `16.8ms`

Geometric means of factors vs Vanilla:

- Scripting: Solid 1 `2.030x`, Solid 2 `2.517x`, Solid 2 / Solid 1 `1.240x`.
- Total: Solid 1 `1.104x`, Solid 2 `1.100x`, Solid 2 / Solid 1 `0.996x`.
- Paint: Solid 1 `1.034x`, Solid 2 `1.003x`, Solid 2 / Solid 1 `0.970x`.

Finding:

- Solid 2 still loses to Solid 1 on scripting in every CPU test except `09_clear1k_x8`.
- The largest Solid 2 / Solid 1 scripting regressions are `05_swap1k` (`1.769x`),
  `03_update10th1k_x16` (`1.529x`), `04_select1k` (`1.429x`), and `01_run1k`
  (`1.237x`).
- `07_create10k` is still slower on scripting (`52.4ms` vs `45.3ms`), but total time is close
  (`387.0ms` vs `382.9ms`) because paint dominates and Solid 2 paint is slightly better.
- Overall total-time geometric mean is effectively tied with Solid 1, but the scripting profile is
  still too far behind. The next useful direction is not more create-only probes; it should focus
  on update/swap/select scripting and compiler-generated binding update shape.

### Update Slowdown First Pass

Question:

- Why is Solid 2 slower than Solid 1 on `03_update10th1k_x16` when the underlying signal update
  path should be faster?

Source/codegen differences:

- Solid 1 benchmark wraps the label update loop in `batch(...)`; Solid 2 benchmark did not wrap the
  loop in the equivalent `flush(fn)`.
- Solid 1 generated DOM binding is single-phase:
  - one `createRenderEffect(_p$ => { ... })`
  - reads `isSelected(rowId)` and `row.label()`
  - mutates class/text inline
  - stores previous values by mutating `_p$`.
- Solid 2 generated DOM binding is split:
  - compute: `() => ({ e: selected[rowId] ? "danger" : "", t: row().label() })`
  - effect: receives current and previous objects, then calls `className(...)` and updates text.

Probes:

- Wrapped Solid 2 update loop in `flush(fn)` for parity with Solid 1 `batch(...)`.
- Removed only the selected-class binding, keeping the label text binding and `flush(fn)`.
- Switched selection to a single `createSignal` while keeping the grouped class+label binding.

Results:

- Baseline full-suite Solid 2: `03_update10th1k_x16` script `2.6ms`.
- `flush(fn)` parity probe: `03` script `2.3ms`; `05_swap1k` script `2.2ms`.
- Label-only with `flush(fn)`: `03` script `1.9ms`; `05` script `2.0ms`.
- Single selected signal with `flush(fn)`: `03` script `2.7ms`; `04_select1k` script `2.2ms`.

Finding:

- Part of the update regression is a benchmark parity issue: Solid 1 uses `batch`, Solid 2 should use
  `flush(fn)` for the same loop shape.
- The remaining `03` gap is mostly grouped binding invalidation, not the store itself. Updating
  `row().label()` also re-runs the selected-class expression because the compiler groups class and
  text into one split render effect.
- A single selected signal is worse because it destroys select scaling and does not improve label
  update.
- The next promising compiler direction is not simply "split everything" (the previous child-text
  split hurt create), but a better generated shape for independent scalar `textContent` and class
  bindings that avoids coupling label updates to selection reads without adding expensive insertion
  machinery.

### Compiler Independent Scalar Dynamics Probe

Question:

- Can the compiler recover Solid 1-style update performance by emitting independent scalar DOM
  effects for each dynamic binding instead of one grouped `{ class, textContent }` split effect?

Probe:

- Temporarily patched `babel-plugin-jsx-dom-expressions` `wrapDynamics$2` multi-dynamic path.
- Replaced the grouped object split effect:
  - compute: `() => ({ e, t })`
  - effect: destructure/update both class and text.
- With one scalar effect per dynamic binding:
  - one effect for `selected[rowId] ? "danger" : ""`
  - one effect for `row().label()`.
- Kept the normal benchmark source; no child-text insertion fallback.

Results:

- `03_update10th1k_x16`: script `1.8ms`, total `22.8ms`, paint `15.7ms`.
- `04_select1k`: script `0.9ms`, total `7.5ms`, paint `4.8ms`.
- `07_create10k`: script `56.4ms`, total `365.7ms`, paint `297.2ms`.
- `08_create1k-after1k_x2`: script `5.2ms`, total `42.4ms`, paint `35.8ms`.

Finding:

- This confirms the update regression diagnosis: independent scalar effects avoid re-running the
  selected-class read on label updates and bring `03` back to roughly Solid 1 scripting.
- The naive split is not retainable because create cost regresses badly (`07` `52.4ms -> 56.4ms`)
  from doubling row effects.
- The compiler target should be a hybrid shape: preserve one effect/node per row for creation, but
  avoid grouped dependency coupling on update. Possible directions:
  - grouped creation followed by scalar subscriptions after mount;
  - a multi-output effect primitive that tracks dependencies per output while sharing one owner/node;
  - compiler analysis that splits only when a dynamic is known to update independently and the create
    cost is acceptable.
- Reverted the compiler patch.

### Compiler Previous-Value Init Branch Probe

Question:

- Can grouped dynamic bindings avoid the default previous-value object allocation by treating a missing
  previous value as the initialization case?

Probe:

- Temporarily patched `babel-plugin-jsx-dom-expressions` `wrapDynamics$2` multi-dynamic path.
- Baseline generated shape used a default previous object parameter:
  - `(_p$ = { e: undefined, t: undefined })`
- Variant generated shape passed the previous object directly and branched in the effect callback:
  - `if (!_p$) { initialize all bindings } else { compare/update bindings }`
- Ran from a fresh restarted session with the benchmark server restarted.
- Focused benchmarks: `01_run1k`, `03_update10th1k_x16`, `04_select1k`, `07_create10k`,
  `08_create1k-after1k_x2`.
- Each run used `--count 5`; `04_select1k` still ran 15 samples because of its benchmark-level
  `additionalNumberOfRuns`.

Median results:

| Benchmark | Baseline total | Variant total | Baseline script | Variant script | Baseline paint | Variant paint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `01_run1k` | `36.3ms` | `35.7ms` | `5.1ms` | `5.0ms` | `30.7ms` | `30.0ms` |
| `03_update10th1k_x16` | `19.5ms` | `20.4ms` | `2.2ms` | `2.0ms` | `15.0ms` | `15.1ms` |
| `04_select1k` | `6.7ms` | `7.0ms` | `1.0ms` | `0.9ms` | `4.0ms` | `4.3ms` |
| `07_create10k` | `365.2ms` | `362.7ms` | `51.0ms` | `50.2ms` | `302.4ms` | `300.1ms` |
| `08_create1k-after1k_x2` | `41.8ms` | `42.8ms` | `5.1ms` | `5.0ms` | `35.3ms` | `36.4ms` |

Focused geometric mean of variant / baseline:

- Total: `1.018x`
- Script: `0.950x`
- Paint: `1.016x`

Finding:

- The init-branch shape does reduce scripting in this focused set, mostly through small wins on
  creation-like tests (`01`, `07`, `08`) plus noise/small wins on `03` and `04`.
- The total/paint medians were mixed in this small focused run, but `03`/`04` are noisy and paint is
  less reliable for this probe than scripting. The important signal is that script improved across the
  whole focused set.
- `07_create10k` is the cleanest positive signal: script `51.0ms -> 50.2ms`, total
  `365.2ms -> 362.7ms`, paint `302.4ms -> 300.1ms`.
- This is the most plausible CPU probe so far because it improves script without increasing effect
  count or changing dependency shape.
- Reapplied the compiler patch for broader validation.

### Full CPU Checkpoint With Init-Branch Compiler Variant

Setup:

- Reapplied the previous-value init-branch compiler variant.
- Rebuilt `vanillajs`, `solid`, `solid-next`, `react-hooks`, and `svelte`.
- Ran keyed CPU benchmarks `01`-`09` with `--count 5`.
- Ran keyed memory benchmarks `21`, `22`, `23`, `25`, and `26` with `--count 5` for Vanilla,
  Solid 2, Solid 1, and React Hooks. Startup was skipped because this checkout's selected startup
  runner path writes empty files unless the full suite runner path is used.

CPU median script:

| Benchmark | Vanilla | Solid 2 | Solid 1 | Svelte 5 | React Hooks |
| --- | ---: | ---: | ---: | ---: | ---: |
| `01_run1k` | `2.7ms` | `5.2ms` | `4.1ms` | `3.8ms` | `12.0ms` |
| `02_replace1k` | `6.2ms` | `8.8ms` | `8.5ms` | `7.1ms` | `17.7ms` |
| `03_update10th1k_x16` | `0.7ms` | `2.1ms` | `1.5ms` | `1.5ms` | `5.2ms` |
| `04_select1k` | `0.4ms` | `0.8ms` | `0.7ms` | `0.9ms` | `2.3ms` |
| `05_swap1k` | `0.4ms` | `1.9ms` | `1.3ms` | `1.4ms` | `26.3ms` |
| `06_remove-one-1k` | `0.4ms` | `0.6ms` | `0.5ms` | `0.5ms` | `1.6ms` |
| `07_create10k` | `29.4ms` | `49.9ms` | `43.3ms` | `42.5ms` | `229.4ms` |
| `08_create1k-after1k_x2` | `2.7ms` | `4.9ms` | `3.9ms` | `3.8ms` | `10.2ms` |
| `09_clear1k_x8` | `11.8ms` | `14.0ms` | `15.5ms` | `13.6ms` | `22.5ms` |

CPU geometric means of factors vs Vanilla:

- Script: Solid 2 `1.960x`, Solid 1 `1.646x`, Svelte 5 `1.627x`, React Hooks `5.849x`.
- Total: Solid 2 `1.067x`, Solid 1 `1.035x`, Svelte 5 `1.053x`, React Hooks `1.597x`.
- Paint: Solid 2 `0.975x`, Solid 1 `1.003x`, Svelte 5 `1.024x`, React Hooks `1.237x`.

Relative to Solid 1:

- Script: Solid 2 `1.191x`.
- Total: Solid 2 `1.030x`.
- Paint: Solid 2 `0.972x`.

Memory median:

| Benchmark | Vanilla | Solid 2 | Solid 1 | React Hooks |
| --- | ---: | ---: | ---: | ---: |
| `21_ready-memory` | `0.885MB` | `1.008MB` | `0.923MB` | `1.499MB` |
| `22_run-memory` | `2.065MB` | `3.329MB` | `2.988MB` | `4.779MB` |
| `23_update5-memory` | `2.208MB` | `3.437MB` | `3.111MB` | `5.255MB` |
| `25_run-clear-memory` | `1.009MB` | `1.480MB` | `1.012MB` | `2.411MB` |
| `26_run-10k-memory` | `12.428MB` | `21.547MB` | `20.431MB` | `30.970MB` |

Memory geometric means of factors vs Vanilla:

- Solid 2 `1.487x`, Solid 1 `1.285x`, React Hooks `2.234x`.
- Solid 2 / Solid 1: `1.157x`.

Finding:

- The init-branch variant improves the earlier Solid 2 scripting profile but does not close the gap to
  Solid 1. Solid 2 remains `19.1%` slower than Solid 1 on CPU scripting geometric mean.
- Total time is much closer than script (`3.0%` behind Solid 1), and Solid 2 paint is slightly better
  than Solid 1 in this run.
- Remaining CPU scripting gaps are still concentrated in `05_swap1k`, `03_update10th1k_x16`,
  `07_create10k`, `08_create1k-after1k_x2`, and `01_run1k`.
- Svelte 5 is currently slightly ahead of Solid 1 on script geometric mean in this run and close on
  total, so it is a useful external comparison point.
- Memory is the next clear area to investigate: Solid 2 is `15.7%` higher than Solid 1 on memory
  geometric mean, with especially large relative pressure in `25_run-clear-memory` and meaningful
  absolute pressure in `26_run-10k-memory`.

### Memory 25 Clear-Retention First Pass

Question:

- Why does Solid 2 retain much more memory after repeated create/clear cycles than Solid 1?

Baseline:

- `21_ready-memory`: Solid 2 `1.008MB`, Solid 1 `0.923MB`, Vanilla `0.885MB`.
- `25_run-clear-memory`: Solid 2 `1.480MB`, Solid 1 `1.012MB`, Vanilla `1.009MB`.
- Delta from ready to post-clear:
  - Solid 2: `+0.472MB`
  - Solid 1: `+0.089MB`
  - Vanilla: `+0.124MB`

Probe:

- Temporarily removed the row selected-class binding from the Solid 2 benchmark:
  - `<tr class={selected[rowId] ? "danger" : ""}>` -> `<tr>`
- Rebuilt `solid-next`.
- Re-ran `21_ready-memory` and `25_run-clear-memory` with `--count 5`.

Results:

- No-class `21_ready-memory`: `1.007MB`.
- No-class `25_run-clear-memory`: `1.355MB`.
- No-class delta: `+0.349MB`.

Finding:

- Removing the selected-class binding reduces the retained `25 - 21` delta by about `0.123MB`,
  roughly one quarter of the original Solid 2 residual.
- The selected store/class path contributes to memory retention, but it is not the majority.
- The remaining `+0.349MB` points at broader row owner/render-effect/list disposal overhead or retained
  scheduler/store bookkeeping after row disposal.
- Restored the benchmark source after the probe.

Follow-up lifecycle instrumentation:

- Temporarily instrumented Solid 2 in the browser bundle to count owner/effect/store/map lifecycle
  events and printed `window.__solidMemDiag` from the memory runner after forced GC.
- Ran `21_ready-memory` and `25_run-clear-memory` with `--count 1`.

Diagnostic output:

- `21_ready-memory`:
  - owners created: `2`
  - render effects created: `2`
  - memory: `1.006MB`
- `25_run-clear-memory`:
  - owners created: `5002`
  - owners disposed: `5000`
  - render effects created: `5002`
  - render effects disposed: `5000`
  - map creates: `5`
  - map clears: `5`
  - map clear disposed nodes: `5000`
  - store nodes created: `5000`
  - store nodes unobserved: `5000`
  - final map lengths after clear: `_len = 0`, `_nodes = 0`, `_items = 0`, `_mappings = 0`
  - memory: `1.471MB`

Finding:

- The obvious counts balance. `mapArray` clears its arrays, row owners are disposed, row render effects
  are disposed, and selected store nodes are unobserved.
- The persistent `+~0.46MB` over ready memory is therefore not explained by a simple row owner/effect
  or store subscriber leak.
- The next memory investigation needs either heap snapshots/retainer paths or more targeted counters
  for allocation pressure that remains reachable outside these lifecycle structures.

Direct same-page create/clear series:

- Instead of running benchmark `25` in separate benchmark pages only, loaded each framework once,
  measured clean memory after forced GC, then repeated:
  - click `#run`
  - wait for 1000 rows
  - click `#clear`
  - wait for rows to disappear
  - force GC and measure memory
- Ran 3 fresh-page samples, 6 create/clear cycles each, for Solid 2 and Solid 1.

Solid 2 samples:

- Clean `0.993MB`; deltas `+0.016`, `+0.397`, `+0.084`, `+0.136`, `+0.105`, `+0.516`.
- Clean `1.027MB`; deltas `-0.027`, `-0.033`, `+0.434`, `+0.385`, `+0.084`, `+0.091`.
- Clean `1.023MB`; deltas `-0.020`, `-0.013`, `+0.071`, `+0.462`, `+0.111`, `+0.078`.

Solid 1 samples:

- Clean `0.892MB`; deltas `-0.094`, `-0.097`, `-0.018`, `-0.000`, `-0.020`, `+0.011`.
- Clean `0.887MB`; deltas `+0.251`, `+0.319`, `-0.017`, `-0.032`, `+0.347`, `+0.379`.
- Clean `0.960MB`; deltas `-0.139`, `+0.275`, `-0.105`, `-0.068`, `+0.318`, `-0.088`.

Median by cycle:

- Solid 2 clean median `1.023MB`; cycle deltas `-0.020`, `-0.013`, `+0.084`, `+0.385`,
  `+0.105`, `+0.091`.
- Solid 1 clean median `0.892MB`; cycle deltas `-0.094`, `+0.275`, `-0.018`, `-0.032`,
  `+0.318`, `+0.011`.

Finding:

- Same-page memory measurements are noisy by cycle even after forced major GC.
- Both Solid 1 and Solid 2 have occasional post-clear jumps; this reduces confidence that benchmark
  `25`'s higher Solid 2 value is purely a stable leak.
- Solid 2 still has a consistently higher clean baseline than Solid 1 (`~0.13MB` in this run).
- Final-cycle median retained delta is small for both (`Solid 2 +0.091MB`, Solid 1 `+0.011MB`).
- Heap snapshots should compare selected high/low same-page points instead of assuming every post-clear
  memory jump is retained framework state.

Benchmark-compatible five-cycle check:

- To explain why official `25_run-clear-memory` can show a larger gap than the per-cycle loop, ran a
  closer shape to the benchmark:
  - fresh page per sample
  - measure clean memory after forced GC
  - run 5 create/clear cycles without measuring between cycles
  - force GC and measure once at the end
  - 5 samples each for Solid 2 and Solid 1

Results:

- Solid 2:
  - clean samples: `1.030`, `1.004`, `1.029`, `1.110`, `1.118MB`
  - after-five-clear samples: `1.497`, `1.332`, `1.499`, `1.509`, `1.490MB`
  - median clean: `1.030MB`
  - median after five clears: `1.497MB`
  - median delta: `+0.398MB`
- Solid 1:
  - clean samples: `0.950`, `0.958`, `0.957`, `1.038`, `0.958MB`
  - after-five-clear samples: `1.241`, `1.265`, `1.269`, `0.848`, `0.848MB`
  - median clean: `0.958MB`
  - median after five clears: `1.241MB`
  - median delta: `+0.291MB`

Finding:

- This closer-to-benchmark shape reproduces the official direction: Solid 2 remains higher after five
  clears on a fresh page.
- The large `25 - 21` gap is partly methodological. Measuring only once after five cycles captures a
  high post-clear point and does not show the per-cycle variance seen in the direct loop.
- Solid 1 had two fresh-page samples where the final post-clear measurement compacted below the initial
  clean baseline (`0.848MB`), while Solid 2 did not show a comparable low compaction sample in this run.
- The difference therefore appears to be a combination of Solid 2's higher clean baseline, higher
  post-clear allocation residue, and Chrome memory-measurement/compaction variance rather than an
  obvious unbalanced lifecycle leak.

Warmed one-cycle heap snapshot comparison:

- User note: the useful shape is to perform a trial add/clear before recording the baseline and after
  states, so first-interaction compilation/setup noise is mostly out of the diff.
- Protocol:
  - load each framework page
  - run one warm `#run` -> `#clear`
  - force GC
  - record warmed baseline memory and heap snapshot
  - run one recorded `#run` -> `#clear`
  - force GC
  - record after-clear memory and heap snapshot
- Snapshot files were written under `/tmp/solid-warm-one-cycle-heaps`.

Aggregate memory API results:

- Solid 2 warmed baseline: `0.964MB`
- Solid 2 after second clear: `0.973MB`
- Solid 2 delta: `+0.009MB`
- Solid 1 warmed baseline: `0.776MB`
- Solid 1 after second clear: `1.142MB`
- Solid 1 delta: `+0.366MB`

Heap snapshot self-size deltas:

- Solid 2 total JS heap self-size delta: `+12.5KiB`
- Solid 2 node delta: `+94`
- Solid 2 edge delta: `+786`
- Solid 1 total JS heap self-size delta: `+32.5KiB`
- Solid 1 node delta: `+174`
- Solid 1 edge delta: `+1093`

App-shaped retained buckets:

- Solid 2 app-ish deltas were tiny:
  - `HTMLTableCellElement`: `+4` objects, `+0.1KiB`
  - `Array`: `+3` objects, `+0.0KiB`
  - `Object`: `+2` objects, `+0.0KiB`
  - no owner/effect/store-shaped bucket stood out
- Solid 1 app-ish deltas were also tiny:
  - `Array`: `+6` objects, `+0.1KiB`
  - `Object`: `+4` objects, `+0.1KiB`
  - `HTMLTableCellElement`: `+4` objects, `+0.1KiB`
  - `closure`: `+2` objects, `+0.1KiB`

Finding:

- With a trial add/clear before recording, the one-cycle JS heap diff does not support a Solid 2 retained
  JS object leak. Solid 2's JS heap self-size delta is smaller than Solid 1's in this sample.
- The much larger movement in `performance.measureUserAgentSpecificMemory()` is not mirrored by retained
  JS heap objects. This points toward renderer/browser allocator behavior, DOM/native memory, code/hidden
  metadata, or memory accounting variance rather than obvious retained framework objects.
- For memory `25`, the actionable investigation should not be another one-cycle JS-heap leak hunt. If we
  continue memory work, the next useful shape is warmed five-cycle snapshots matching `25`, or native/DOM
  memory accounting if Chrome exposes enough detail.

Warmed five-cycle heap snapshot comparison:

- Protocol:
  - load each framework page
  - run one warm `#run` -> `#clear`
  - force GC
  - record warmed baseline memory and heap snapshot
  - run five recorded `#run` -> `#clear` cycles
  - force GC after each cycle and measure aggregate memory
  - record heap snapshot after the fifth recorded clear
- Snapshot files were written under `/tmp/solid-warm-five-cycle-heaps`.

Aggregate memory API results:

- Solid 2 warmed baseline: `1.363MB`
- Solid 2 recorded clear cycle memory: `1.375`, `1.470`, `1.079`, `1.465`, `1.419MB`
- Solid 2 after five clears: `1.419MB`
- Solid 2 final delta: `+0.056MB`
- Solid 1 warmed baseline: `1.102MB`
- Solid 1 recorded clear cycle memory: `1.169`, `0.855`, `0.889`, `1.264`, `0.865MB`
- Solid 1 after five clears: `0.865MB`
- Solid 1 final delta: `-0.237MB`

Heap snapshot self-size deltas:

- Solid 2 total JS heap self-size delta: `+130.1KiB`
- Solid 2 node delta: `+836`
- Solid 2 edge delta: `+4372`
- Solid 1 total JS heap self-size delta: `+99.4KiB`
- Solid 1 node delta: `+812`
- Solid 1 edge delta: `+3868`

Dominant retained buckets:

- Solid 2 was dominated by V8/browser execution metadata:
  - anonymous `code`: `+35.7KiB`
  - `TrustedByteArray`: `+17.6KiB`
  - `FeedbackVector`: `+6.4KiB`
  - `instruction stream for flush`: `+6.4KiB`
  - app-ish buckets were tiny (`HTMLTableCellElement +20`, `HTMLAnchorElement +10`, small arrays/objects)
- Solid 1 was similarly dominated by V8/browser execution metadata:
  - anonymous `code`: `+23.0KiB`
  - `TrustedByteArray`: `+12.6KiB`
  - `BASELINE instruction stream`: `+6.7KiB`
  - `FeedbackVector`: `+5.2KiB`
  - app-ish buckets were tiny (`HTMLTableCellElement +20`, small arrays/objects/closures)

Finding:

- The warmed five-cycle shape does not reveal a large Solid 2 retained JS object bucket either.
- Solid 2 has somewhat more JS heap self-size growth than Solid 1 in this sample (`+130.1KiB` vs
  `+99.4KiB`), but the difference is small relative to the official `25 - 21` aggregate-memory gap and is
  mostly V8 code/feedback metadata rather than row owners/effects/store nodes.
- The aggregate memory API remains highly phase-sensitive even with forced GC: Solid 2's recorded cycle
  values bounced between `1.079MB` and `1.470MB`, while Solid 1 bounced between `0.855MB` and `1.264MB`.
- Current memory conclusion: no obvious Solid 2 JS-heap leak has been found in one-cycle or five-cycle
  warmed snapshots. The `25_run-clear-memory` difference is more likely dominated by native/DOM memory
  accounting, renderer allocator state, V8 execution metadata, or benchmark sampling phase than by retained
  framework JS objects.

### CPU Broad-Tax Probe: Cache `<For>` Row Accessor

Question:

- Since Solid 2 is slower across most CPU benchmarks, is some of the broad tax from repeatedly calling the
  `<For>` row accessor in the benchmark row template?

Probe:

- Temporarily changed the Solid 2 benchmark row factory from:
  - `let rowId = row().id`
  - `<a ... textContent={row().label()} />`
- To:
  - `const rowData = row()`
  - `let rowId = rowData.id`
  - `<a ... textContent={rowData.label()} />`
- Rebuilt `solid-next`.
- Ran focused CPU benchmarks `01`, `03`, `05`, `07`, `08`, and `09` with `--count 5`.
- Restored the original benchmark source and reran the same focused set in the same session for a baseline.

Median results:

| Benchmark | Baseline total | Variant total | Baseline script | Variant script | Baseline paint | Variant paint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `01_run1k` | `37.1ms` | `37.2ms` | `5.0ms` | `4.9ms` | `31.0ms` | `31.1ms` |
| `03_update10th1k_x16` | `21.2ms` | `25.5ms` | `2.3ms` | `2.5ms` | `15.3ms` | `19.5ms` |
| `05_swap1k` | `22.8ms` | `24.7ms` | `1.9ms` | `1.7ms` | `18.2ms` | `19.9ms` |
| `07_create10k` | `371.9ms` | `368.1ms` | `50.4ms` | `49.4ms` | `305.5ms` | `305.4ms` |
| `08_create1k-after1k_x2` | `43.8ms` | `43.1ms` | `5.1ms` | `4.9ms` | `36.9ms` | `36.5ms` |
| `09_clear1k_x8` | `16.8ms` | `16.5ms` | `14.4ms` | `14.2ms` | `1.7ms` | `1.4ms` |

Focused geometric mean of variant / baseline:

- Total: `1.038x`
- Script: `0.980x`

Finding:

- Small positive scripting signal on creation/clear-like benchmarks, especially `07` and `08`, but not a
  broad enough win to explain the Solid 2 vs Solid 1 gap.
- `03` and `05` total/paint moved badly in this run; both are noisy, but the variant is not compelling
  as an application-shape change.
- The broad CPU tax is unlikely to be primarily from extra `row()` accessor calls in the benchmark source.
- Restored the benchmark source after the probe.

### CPU Broad-Tax Diagnostic: Raw `<For>` Row Value

Question:

- How much of the broad Solid 2 CPU tax is from the v2 `<For>` API shape itself: a per-row accessor
  closure plus `row()` calls, compared with Solid 1's direct row value?

Diagnostic probe:

- Temporarily changed `mapArray`'s no-index keyed path to pass the raw item to the mapper instead of
  passing `() => item`.
- Temporarily changed the Solid 2 benchmark row callback to use Solid 1-like raw row reads:
  - `row.id`
  - `row.label()`
- Rebuilt `@solidjs/signals` and `solid-next`.
- Ran focused CPU benchmarks `01`, `03`, `05`, `07`, `08`, and `09` with `--count 5`.
- Restored `mapArray`, restored the benchmark source, and rebuilt both packages afterward.

Median results:

| Benchmark | Baseline total | Variant total | Baseline script | Variant script | Baseline paint | Variant paint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `01_run1k` | `37.1ms` | `37.3ms` | `5.0ms` | `4.9ms` | `31.0ms` | `31.5ms` |
| `03_update10th1k_x16` | `21.2ms` | `20.8ms` | `2.3ms` | `2.2ms` | `15.3ms` | `15.0ms` |
| `05_swap1k` | `22.8ms` | `25.5ms` | `1.9ms` | `1.7ms` | `18.2ms` | `19.6ms` |
| `07_create10k` | `371.9ms` | `361.9ms` | `50.4ms` | `49.0ms` | `305.5ms` | `301.2ms` |
| `08_create1k-after1k_x2` | `43.8ms` | `42.0ms` | `5.1ms` | `4.9ms` | `36.9ms` | `35.7ms` |
| `09_clear1k_x8` | `16.8ms` | `16.2ms` | `14.4ms` | `13.8ms` | `1.7ms` | `2.0ms` |

Focused geometric mean of variant / baseline:

- Total: `0.999x`
- Script: `0.953x`

Finding:

- Passing raw row values is a clearer broad scripting win than merely caching `row()` in the app:
  roughly `4.7%` script improvement across the focused set.
- Total time is neutral in this run because `05_swap1k` total/paint moved badly, but creation/append/clear
  totals improved.
- This suggests that the v2 accessor-row shape has measurable cost in this benchmark, especially through
  per-row accessor closure creation/calls and generated binding shape.
- This is not directly retainable as-is because v2 intentionally exposes row values as accessors for
  consistency/stale-read protection. A practical direction would need a compiler/runtime fast path for
  keyed `<For>` bodies that provably do not need reactive row replacement or index tracking.

### Effect Cleanup Write Fast Path Probe

Question:

- Most benchmark render effects do not return a cleanup. Does avoiding `_cleanup = undefined` writes in
  no-cleanup `runEffect` executions improve the broad CPU tax?

Probe:

- Temporarily changed `runEffect` from:
  - always calling `this._cleanup?.()`
  - always assigning `this._cleanup = undefined`
  - always assigning `this._cleanup = nextCleanup`
- To:
  - only call and clear `_cleanup` when one exists
  - only assign `_cleanup` when the effect callback returns a cleanup
- Rebuilt `@solidjs/signals` and `solid-next`.
- Ran focused CPU benchmarks `01`, `03`, `05`, `07`, `08`, and `09` with `--count 5`.
- Because `03` and `05` are noisy, also ran a high-count `--count 15` A/B on only `03` and `05`.

Initial focused median results:

| Benchmark | Baseline total | Variant total | Baseline script | Variant script | Baseline paint | Variant paint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `01_run1k` | `37.1ms` | `36.7ms` | `5.0ms` | `5.0ms` | `31.0ms` | `31.1ms` |
| `03_update10th1k_x16` | `21.2ms` | `23.1ms` | `2.3ms` | `2.5ms` | `15.3ms` | `17.6ms` |
| `05_swap1k` | `22.8ms` | `24.0ms` | `1.9ms` | `2.1ms` | `18.2ms` | `19.4ms` |
| `07_create10k` | `371.9ms` | `363.5ms` | `50.4ms` | `49.9ms` | `305.5ms` | `302.2ms` |
| `08_create1k-after1k_x2` | `43.8ms` | `41.7ms` | `5.1ms` | `4.8ms` | `36.9ms` | `35.5ms` |
| `09_clear1k_x8` | `16.8ms` | `16.3ms` | `14.4ms` | `13.7ms` | `1.7ms` | `1.8ms` |

Initial focused geometric mean of variant / baseline:

- Total: `1.005x`
- Script: `1.010x`

High-count `03`/`05` rerun:

| Benchmark | Baseline total | Variant total | Baseline script | Variant script | Baseline paint | Variant paint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `03_update10th1k_x16` | `21.7ms` | `21.1ms` | `2.1ms` | `2.3ms` | `16.1ms` | `15.7ms` |
| `05_swap1k` | `24.1ms` | `23.9ms` | `1.8ms` | `1.9ms` | `19.4ms` | `19.6ms` |

Finding:

- Mixed/negative. The fast path improves creation/append/clear totals in the small run but does not
  improve the broad focused script geomean.
- The high-count rerun confirms `03`/`05` are noisy, but it still does not show a script win. `03` total
  improved while script worsened; `05` was effectively neutral on total and worse on script.
- Reverted the probe. Avoiding no-op cleanup writes is semantically reasonable, but the benchmark does not
  justify retaining it right now.

### Render Effect `_notifyStatus` Removal Diagnostic

Question:

- How much CPU tax is associated with render effects carrying async/status notification plumbing?

Diagnostic probe:

- Temporarily changed effect creation so only user effects received `_notifyStatus = notifyEffectStatus`.
- Render effects therefore no longer participated in the async/status notification callback path.
- This is not semantically retainable as-is because render effects are the intended path for async boundary
  notification and root-defer behavior.
- Rebuilt `@solidjs/signals` and `solid-next`.
- Ran focused CPU benchmarks `01`, `03`, `05`, `07`, `08`, and `09` with `--count 5`.
- Because `03` and `05` are noisy, also ran a high-count `--count 15` rerun for only `03` and `05`.
- Reverted the probe and rebuilt afterward.

Focused median results:

| Benchmark | Baseline total | Variant total | Baseline script | Variant script | Baseline paint | Variant paint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `01_run1k` | `37.1ms` | `36.5ms` | `5.0ms` | `4.9ms` | `31.0ms` | `30.8ms` |
| `03_update10th1k_x16` | `21.2ms` | `20.9ms` | `2.3ms` | `2.0ms` | `15.3ms` | `14.9ms` |
| `05_swap1k` | `22.8ms` | `22.3ms` | `1.9ms` | `1.4ms` | `18.2ms` | `18.0ms` |
| `07_create10k` | `371.9ms` | `360.7ms` | `50.4ms` | `49.7ms` | `305.5ms` | `299.8ms` |
| `08_create1k-after1k_x2` | `43.8ms` | `42.3ms` | `5.1ms` | `4.8ms` | `36.9ms` | `35.7ms` |
| `09_clear1k_x8` | `16.8ms` | `16.1ms` | `14.4ms` | `13.7ms` | `1.7ms` | `1.8ms` |

Focused geometric mean of variant / baseline:

- Total: `0.968x`
- Script: `0.876x`
- Paint: `0.968x`

High-count `03`/`05` rerun:

| Benchmark | Baseline total | Variant total | Baseline script | Variant script | Baseline paint | Variant paint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `03_update10th1k_x16` | `21.7ms` | `22.4ms` | `2.1ms` | `2.3ms` | `16.1ms` | `16.2ms` |
| `05_swap1k` | `24.1ms` | `24.7ms` | `1.8ms` | `1.8ms` | `19.4ms` | `20.3ms` |

Finding:

- The initial focused run looked very positive across the board, but the high-count rerun did not validate
  the `03`/`05` script wins.
- Creation-like tests still had a meaningful signal in the focused run:
  - `01`: script `5.0ms -> 4.9ms`
  - `07`: script `50.4ms -> 49.7ms`, total `371.9ms -> 360.7ms`
  - `08`: script `5.1ms -> 4.8ms`
  - `09`: script `14.4ms -> 13.7ms`
- This suggests render-effect async/status shape may contribute to creation/clear overhead, even though
  simply omitting `_notifyStatus` from render effects is architecturally invalid.
- Follow-up direction: look for ways to keep render-effect notification semantics while trimming the
  normal synchronous path, e.g. lazy status-notifier installation, slimmer status callback shape, or avoiding
  status work until an async/error status is actually observed.

Follow-up lazy/invalid status-notifier probes:

- Tried a semantically plausible lazy install:
  - effects did not eagerly set `_notifyStatus`
  - `async.ts` installed/called `notifyEffectStatus` only when status propagation touched an effect
  - first version imported `notifyEffectStatus` from `effect.ts`, creating an extra `async -> effect`
    import cycle
- That shape did not reproduce the invalid-removal win and regressed noisy/update-like tests.
- Replaced the import-cycle version with an inline notifier in `async.ts`, still lazily installed on first
  status propagation. This also did not reproduce the invalid-removal win.

Inline lazy notifier focused median results:

| Benchmark | Total | Script | Paint |
| --- | ---: | ---: | ---: |
| `01_run1k` | `36.9ms` | `4.9ms` | `31.3ms` |
| `03_update10th1k_x16` | `23.2ms` | `2.5ms` | `17.6ms` |
| `05_swap1k` | `28.6ms` | `2.1ms` | `21.7ms` |
| `07_create10k` | `371.1ms` | `50.2ms` | `307.7ms` |
| `08_create1k-after1k_x2` | `42.9ms` | `4.8ms` | `37.0ms` |
| `09_clear1k_x8` | `17.1ms` | `14.5ms` | `1.8ms` |

- Then, without restoring the full baseline first, tried the invalid removal shape on top of the current
  changed-code context:
  - effects still did not eagerly set `_notifyStatus`
  - `getStatusNotifier()` simply returned `el._notifyStatus`
  - no lazy install for normal effects

Invalid removal on current changed-code context:

| Benchmark | Total | Script | Paint |
| --- | ---: | ---: | ---: |
| `01_run1k` | `37.4ms` | `4.9ms` | `31.6ms` |
| `03_update10th1k_x16` | `23.9ms` | `2.2ms` | `17.4ms` |
| `05_swap1k` | `24.6ms` | `1.6ms` | `20.1ms` |
| `07_create10k` | `367.5ms` | `52.0ms` | `303.4ms` |
| `08_create1k-after1k_x2` | `42.9ms` | `4.8ms` | `36.7ms` |
| `09_clear1k_x8` | `16.6ms` | `14.2ms` | `1.6ms` |

Finding:

- The original simple invalid-removal run remains the strongest evidence that eager render-effect status
  plumbing costs something in sync creation/clear paths.
- The lazy install implementations did not preserve the invalid-removal profile; moving notifier logic
  into `async.ts` and adding the lazy branch likely changes bundle/runtime shape enough to erase the gain.
- Re-running invalid removal without fully resetting to baseline also did not reproduce the earlier clean
  `07` script win, though `05`, `08`, and `09` were better than the inline lazy version.
- Current conclusion: status-notifier shape is still a plausible overhead source, but the obvious lazy
  implementation is not the right trim. The lower-risk direction is to reduce the eager per-effect shape
  without adding work/imports/branches to the hot bundle path.

### Effect Runner Allocation Revisit

Question:

- Does avoiding repeated `runEffect.bind(node)` enqueue allocations help if the bound runner is cached lazily
  rather than allocated for every effect up front?

Patch:

- Added an optional `_runEffect` field to effect nodes.
- Replaced enqueue-time `runEffect.bind(node)` calls with `getRunEffect(node)`.
- `getRunEffect(node)` creates the bound runner only on the first enqueue and reuses it afterward.

Rationale:

- The earlier stable-runner probe allocated a bound function during effect construction, which adds creation cost
  for render effects that may only run synchronously during initial DOM creation.
- Lazy caching preserves the conceptual win for repeatedly enqueued effects without charging every creation-only
  render effect up front.

Same-session median results:

| Benchmark | Baseline total | Lazy runner total | Baseline script | Lazy runner script | Baseline paint | Lazy runner paint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `01_run1k` | `36.8ms` | `37.4ms` | `4.9ms` | `4.9ms` | `31.3ms` | `31.7ms` |
| `03_update10th1k_x16` | `21.2ms` | `23.5ms` | `2.3ms` | `2.3ms` | `15.5ms` | `16.9ms` |
| `05_swap1k` | `26.3ms` | `27.1ms` | `1.8ms` | `1.8ms` | `20.3ms` | `20.9ms` |
| `07_create10k` | `363.4ms` | `368.0ms` | `50.5ms` | `51.6ms` | `299.3ms` | `303.4ms` |
| `08_create1k-after1k_x2` | `42.9ms` | `43.8ms` | `4.8ms` | `5.0ms` | `36.4ms` | `36.7ms` |
| `09_clear1k_x8` | `17.1ms` | `16.0ms` | `14.4ms` | `13.6ms` | `2.1ms` | `1.8ms` |

Focused geometric mean of lazy runner / baseline:

- Total: `1.0195x`
- Script: `1.0009x`
- Paint: `0.9993x`

Finding:

- Lazy runner caching is conceptually better than eager runner caching because it avoids creation-time bound-function
  allocation for initial synchronous render effects.
- In this focused run it was still not a broad scripting win: script geomean was effectively neutral and creation/
  append medians moved slightly backward.
- The only clear positive signal was `09_clear1k_x8`, where script improved from `14.4ms` to `13.6ms`; that is
  consistent with avoiding repeated enqueue-time binding during disposal-heavy work.
- Current interpretation: this remains a valid implementation shape if we want to remove per-invalidation
  allocation, but `js-framework-benchmark` is mostly measuring effect creation and DOM work here, not repeated
  effect enqueue churn.

### Compiler Reusable Previous Object Probe

Question:

- Is Solid 2 slower on grouped row updates because the split render-effect compute phase allocates a fresh
  `{ e, t }` object on every invalidation, while Solid 1 mutates and returns the previous object?

Observation:

- Solid 1 row output still has one grouped effect for class and text, but it mutates the previous state object:
  - `_$effect(_p$ => { var _v$ = isSelected(rowId) ? "danger" : "", _v$2 = row.label(); ...; return _p$; }, { e: undefined, t: undefined })`
- Current Solid 2 split output can use the compute callback's previous value to keep the same allocation behavior
  while preserving render-effect compute/effect separation.

Probe:

- Temporarily patched `babel-plugin-jsx-dom-expressions` `wrapDynamics$2` multi-dynamic path.
- Generated one reusable previous object per grouped render effect:
  - compute callback default parameter initializes `{ _e: undefined, _t: undefined }`
  - compute writes current values to `.e` and `.t` and returns the same object
  - effect callback reads `.e` and `.t`, compares against `._e` and `._t`, and copies previous slots only when a binding writes
- Final benchmark row shape:
  - `(_p$ = { _e: undefined, _t: undefined }) => (_p$.e = selected[rowId] ? "danger" : "", _p$.t = row().label(), _p$)`
  - `e !== _p$._e && (_$className(_el$1, e, _p$._e), _p$._e = e)`
  - `t !== _p$._t && (_el$13.data = _p$._t = t)`

Focused check:

| Benchmark | Total | Script | Paint |
| --- | ---: | ---: | ---: |
| `03_update10th1k_x16` | `24.7ms` | `2.1ms` | `18.8ms` |
| `07_create10k` | `369.3ms` | `52.1ms` | `304.7ms` |
| `08_create1k-after1k_x2` | `43.7ms` | `5.1ms` | `36.8ms` |

Full CPU rerun with reusable previous object:

| Benchmark | Total | Script | Paint |
| --- | ---: | ---: | ---: |
| `01_run1k` | `38.0ms` | `5.2ms` | `31.4ms` |
| `02_replace1k` | `40.9ms` | `8.8ms` | `31.6ms` |
| `03_update10th1k_x16` | `24.0ms` | `2.3ms` | `17.2ms` |
| `04_select1k` | `7.0ms` | `0.8ms` | `4.4ms` |
| `05_swap1k` | `28.3ms` | `1.8ms` | `22.9ms` |
| `06_remove-one-1k` | `20.0ms` | `0.6ms` | `17.7ms` |
| `07_create10k` | `372.8ms` | `52.1ms` | `307.9ms` |
| `08_create1k-after1k_x2` | `44.5ms` | `5.0ms` | `37.9ms` |
| `09_clear1k_x8` | `17.6ms` | `14.6ms` | `1.9ms` |

Finding:

- This shape is semantically close to Solid 1's grouped effect state model and avoids per-invalidation object
  allocation for grouped DOM render effects.
- The first focused check did not show a clear `03` recovery, and the full CPU rerun remained noisy/mixed.
- The reusable-object shape did not obviously hurt correctness for this benchmark, but it also did not isolate object
  allocation as the dominant remaining slowdown. `03_update10th1k_x16` stayed around `2.1-2.3ms` script instead of
  the earlier split-effect `1.8ms` result.
- This suggests the remaining `03` gap is more likely grouped dependency re-execution and render-effect/runtime
  overhead than just allocation of the `{ e, t }` payload.

Same-session original vs reusable-object A/B:

- Compared the original verbose init-branch grouped output against the reusable previous-object shape.
- Benchmarks: `01_run1k`, `02_replace1k`, `03_update10th1k_x16`, `07_create10k`,
  `08_create1k-after1k_x2`, each with `--count 5`.
- Bundle size:
  - Original: `37,351` bytes raw, `14,279` bytes gzip.
  - Reusable object: `37,373` bytes raw, `14,294` bytes gzip.

| Benchmark | Original total | Reusable total | Original script | Reusable script | Original paint | Reusable paint |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `01_run1k` | `37.1ms` | `37.8ms` | `4.9ms` | `5.1ms` | `31.4ms` | `31.9ms` |
| `02_replace1k` | `41.0ms` | `41.1ms` | `8.9ms` | `8.8ms` | `31.4ms` | `31.7ms` |
| `03_update10th1k_x16` | `20.2ms` | `24.5ms` | `2.4ms` | `2.3ms` | `15.3ms` | `17.0ms` |
| `07_create10k` | `367.8ms` | `370.5ms` | `50.7ms` | `52.5ms` | `304.9ms` | `305.8ms` |
| `08_create1k-after1k_x2` | `44.1ms` | `43.8ms` | `5.0ms` | `5.0ms` | `37.6ms` | `37.3ms` |

Finding:

- The reusable-object shape is not a size win in the production `solid-next` bundle for this benchmark.
- Runtime is also not better in this A/B: `03` script is effectively tied, `07_create10k` script is worse, and
  create-like `01` is slightly worse.
- Between the original grouped output and reusable-object output, the original is currently the better runtime
  choice for this benchmark.
- Correctness note: the reusable-object shape is unsafe for real compiler output because async/transition tearing
  can observe mutated previous state. The compiler must keep previous values immutable across compute/effect phases.
  This rejects the reusable-object approach even apart from the weak benchmark result.

Compact safe init-branch comparison:

- Replaced the verbose init branch with optional previous reads and a text-only first-run guard.
- Generated row shape:
  - `_$className(_el$1, e, _p$?.e)`
  - `(!_p$ || t !== _p$.t) && (_el$13.data = t)`
- This keeps previous/current objects immutable and avoids the default previous object allocation.
- Bundle size:
  - Compact safe: `37,324` bytes raw, `14,272` bytes gzip.

| Benchmark | Compact total | Compact script | Compact paint |
| --- | ---: | ---: | ---: |
| `01_run1k` | `37.8ms` | `5.0ms` | `32.0ms` |
| `02_replace1k` | `39.5ms` | `8.4ms` | `30.7ms` |
| `03_update10th1k_x16` | `23.7ms` | `2.3ms` | `17.1ms` |
| `07_create10k` | `369.3ms` | `50.9ms` | `306.6ms` |
| `08_create1k-after1k_x2` | `44.6ms` | `4.9ms` | `37.6ms` |

Finding:

- Compact safe is the smallest of the three compiler outputs measured in this A/B:
  - Compact safe: `37,324` raw / `14,272` gzip
  - Original verbose: `37,351` raw / `14,279` gzip
  - Reusable object: `37,373` raw / `14,294` gzip
- Runtime is broadly comparable to original in this noisy same-session run. It was better on `02_replace1k`,
  close on `03`/`07`/`08`, and slightly worse on `01`.
- Since reusable object is correctness-invalid, the meaningful choice is original verbose vs compact safe. Compact
  safe has the better code size and preserves immutable previous values.

### `03_update10th1k_x16` CPU Profiling Pass

Goal:

- Stop guessing from structural probes and use flamegraph/CPU-profile attribution for the hot update path.
- Start with `03_update10th1k_x16`; repeat the same approach for `01_run1k` and `07_create10k` later.

Artifacts:

- `documentation/solid-next-compact-safe-03.cpuprofile.json`
- `documentation/solid-v1-03.cpuprofile.json`
- `documentation/solid-next-compact-safe-03-tight.cpuprofile.json`
- `documentation/solid-v1-03-tight.cpuprofile.json`
- `documentation/solid-next-compact-safe-03-x16.cpuprofile.json`
- `documentation/solid-v1-03-x16.cpuprofile.json`
- `documentation/solid-next-compact-safe-03-update-loop.cpuprofile.json`
- `documentation/solid-v1-03-update-loop.cpuprofile.json`

Method:

- Loaded the built `js-framework-benchmark` pages through Chrome DevTools Protocol.
- Created 1,000 rows, warmed one update pass, reset with another create, then profiled update work.
- Captured:
  - a loose single-click profile
  - a tight single-click profile stopped after the next animation frame
  - a benchmark-shaped x16 synchronous update profile
  - an amplified repeated-update profile to get enough samples for function attribution

Important caveat:

- Single `03` update work is short enough that Chrome CPU profiles are heavily undersampled. The tight/x16 profiles
  mostly confirm which frames participate, while the repeated-update profile gives clearer stacks but changes the
  workload shape. Treat this as hot-path attribution, not a timing comparison.

Solid 2 sampled frames from the x16 profile:

- Event path: delegated `click` -> `qt`/`l` event delegation.
- Update action: generated `update` handler at the benchmark app button.
- Signal write path: `je` (`writeSignal`-style setter path) plus equality check.
- Scheduler/flush path: `flush` -> `L` -> queue `run`.
- Computation path: `we` (`runComputation`-style compute/update path), `Fe` render-effect effect phase, and the
  generated grouped row render effect.
- Generated row effect still appears as the compact-safe grouped shape:
  - compute: `{ e: selected[rowId] ? "danger" : "", t: row().label() }`
  - effect: `className` comparison/update plus text node comparison/update.

Solid 1 sampled frames from the x16 profile:

- Event path: `eventHandler`/`handleNode`.
- Update action: generated `update` handler.
- Scheduler path: `batch`, `runUpdates`, `completeUpdates`, `runQueue`, `runTop`.
- Computation path: `updateComputation`, `runComputation`, `readSignal`, `writeSignal`.
- Generated row effect appears as `createRenderEffect.e`.

Finding:

- The first real profiles do not point at the compact compiler object shape as the dominant sampled cost.
- Solid 2's visible JS samples are spread across event delegation, signal writes, flush/queue work, computation
  execution, and the generated grouped render effect.
- The main new suspect from attribution is the whole Solid 2 update pipeline around `writeSignal` -> notification ->
  flush -> render-effect execution, not a single compiler expression inside the grouped callback.
- Need a better profiling setup for a definitive flamegraph: either profile many isolated `03` operations and compare
  normalized stacks, or add temporary user-timing/instrumentation around internal phases to get deterministic phase
  totals without changing behavior.

### `03_update10th1k_x16` Phase Instrumentation

Goal:

- Replace sparse CPU samples with deterministic phase timings for the hot `03` path.
- Use temporary, source-level timers gated by `globalThis.__SOLID_PROFILE__`.
- Compare current Solid 2 against Solid 1 using the same page shape: create 1,000 rows, warm update, recreate, then
  run 16 update clicks. Reported values are per x16 operation, averaged over 30 rounds.

Artifacts:

- `documentation/solid-next-03-phase-profile.json`
- `documentation/solid-v1-03-phase-profile.json`

Solid 2 phase totals:

| Phase | Time | Calls |
| --- | ---: | ---: |
| `flush.total` | `6.1787ms` | `16` |
| `setSignal.total` | `3.6408ms` | `1600` |
| `flush.initialHeap` | `3.0263ms` | `16` |
| `flush.renderEffects` | `3.0057ms` | `16` |
| `queue.run.render` | `2.9943ms` | `16` |
| `runQueue.render` | `2.9777ms` | `16` |
| `effect.recompute` | `2.7277ms` | `1600` |
| `renderEffect.run` | `2.6785ms` | `1600` |
| `renderEffect.fn` | `2.1482ms` | `1600` |
| `setSignal.insertSubs` | `1.3435ms` | `1600` |
| `insertSubs.total` | `1.0642ms` | `3200` |
| `effect.computeFn` | `0.8835ms` | `1600` |
| `queue.enqueue.render` | `0.2743ms` | `1600` |
| `setSignal.setterFn` | `0.2627ms` | `1600` |
| `setSignal.queuePending` | `0.2620ms` | `1600` |
| `setSignal.equals` | `0.2498ms` | `1600` |
| `flush.commitPending` | `0.0820ms` | `16` |

Solid 1 phase totals:

| Phase | Time | Calls |
| --- | ---: | ---: |
| `runUpdates.total` | `11.5070ms` | `32` |
| `batch.total` | `6.9507ms` | `16` |
| `completeUpdates.total` | `4.6080ms` | `32` |
| `runQueue.total` | `4.5440ms` | `48` |
| `updateComputation.total` | `4.0023ms` | `1600` |
| `renderEffect.run` | `3.2250ms` | `1600` |
| `renderEffect.fn` | `2.6587ms` | `1600` |
| `writeSignal.total` | `1.7168ms` | `1600` |
| `writeSignal.notify` | `0.4335ms` | `1600` |
| `writeSignal.equals` | `0.2565ms` | `1600` |

Interpretation:

- The expected shape is confirmed: `03` performs 1,600 label writes and 1,600 row render-effect updates per x16
  operation in both versions.
- In this instrumented browser-click harness, Solid 2's measured update pipeline is not obviously slower than Solid 1:
  `flush.total` is `6.18ms` vs Solid 1 `batch.total` at `6.95ms`.
- Solid 2's render-effect execution is also not worse in this probe:
  - Solid 2 `renderEffect.run`: `2.68ms`
  - Solid 1 `renderEffect.run`: `3.23ms`
  - Solid 2 `renderEffect.fn`: `2.15ms`
  - Solid 1 `renderEffect.fn`: `2.66ms`
- Solid 2 spends more time in write/subscription insertion than Solid 1's direct observer notification:
  - Solid 2 `setSignal.total`: `3.64ms`
  - Solid 1 `writeSignal.total`: `1.72ms`
  - Solid 2 `setSignal.insertSubs`: `1.34ms`
  - Solid 1 `writeSignal.notify`: `0.43ms`
- The Solid 2 write path is the clearest remaining CPU tax in this phase breakdown. The render-effect callback and
  compiler grouping are not the primary culprit for `03`.

Caveats:

- These timings include profiling overhead and nested phase double-counting. Compare parent totals to parent totals and
  leaf-ish phases to leaf-ish phases, not the sum of every row.
- This is a diagnostic harness, not an official benchmark result. It is useful for attribution.
- The source-level instrumentation was temporary and should be reverted before any real benchmark run.

Follow-up `insertSubs` breakdown:

- Artifact: `documentation/solid-next-03-insert-subs-profile.json`
- Same `03` x16 browser-click harness, 30 rounds.

| Phase | Time | Calls |
| --- | ---: | ---: |
| `insertSubs.total` | `3.0433ms` | `3200` |
| `insertSubs.iteration` | `1.2042ms` | `1600` |
| `insertSubs.setup` | `0.4910ms` | `3200` |
| `insertSubs.heapInsert` | `0.3385ms` | `1600` |

Interpretation:

- The apparent Solid 2 write-path tax is not primarily `insertIntoHeap` itself in this probe. Heap insertion was only
  about `0.34ms` per x16 operation.
- Most measured `insertSubs` time is per-call scaffolding/iteration/general checks. There are 3,200 `insertSubs` calls
  for 1,600 label writes in this instrumented path, while the actual heap insert happens 1,600 times.
- This makes a hot-path specialization plausible: the common non-optimistic, no-snapshot, non-tracked subscriber path
  may be paying for general transition/snapshot/tracked-effect handling it does not use.
- Any optimization here needs to preserve queue/topological behavior. A direct Solid 1-style observer push would be a
  different scheduling model; the safer probe is a fast branch inside `insertSubs`, not bypassing the heap.

### `insertSubs` Common-Path Fast Branch Probe

Question:

- Can Solid 2 reduce the write-path tax by splitting the common `insertSubs` case before the full
  optimistic/snapshot/tracked-effect path?

Probe:

- Added a reversible fast branch at the top of `insertSubs` for:
  - `optimistic === false`
  - `currentOptimisticLane === null`
  - no captured snapshot value on the source
- Included a single-subscriber branch because the `03` row label signal normally has one render-effect subscriber.
- The branch still preserves heap/topological scheduling by calling `insertIntoHeap`; it does not push effects directly
  like Solid 1.

Focused results:

| Benchmark | Total | Script | Paint |
| --- | ---: | ---: | ---: |
| `01_run1k` | `36.9ms` | `4.9ms` | `31.2ms` |
| `03_update10th1k_x16` | `23.6ms` | `2.3ms` | `17.5ms` |
| `07_create10k` | `365.7ms` | `50.0ms` | `304.0ms` |

Finding:

- This does not clearly move `03_update10th1k_x16`; script stayed around the previous compact-safe result (`~2.3ms`).
- It also does not appear to hurt create. `01_run1k` stayed normal, and `07_create10k` was slightly better than the
  previous compact-safe median (`50.9ms` script), though still within benchmark noise.
- Interpretation: the branch may shave some creation/write overhead, but it does not explain the update gap by itself.
  The `insertSubs` tax seen under instrumentation may include timer overhead and nested-call shape; benchmark results
  do not show a clean `03` recovery.

### Leaf `insertSubs` Skip Probe

Question:

- The phase instrumentation showed 3,200 `insertSubs` calls for 1,600 label writes. Half of those come from recomputed
  leaf render effects propagating their changed computed value even though they have no subscribers.
- Can `recompute()` skip `insertSubs(el, ...)` when `el._subs === null`?

Probe:

- Changed the propagation guard in `recompute()` from:
  - `if (!hasOverride || isOptimisticDirty || el._overrideValue !== prevVisible) insertSubs(...)`
- To:
  - `if (el._subs !== null && (...)) insertSubs(...)`

Focused result:

| Benchmark | Total | Script | Paint |
| --- | ---: | ---: | ---: |
| `03_update10th1k_x16` | `23.0ms` | `2.5ms` | `16.0ms` |

Finding:

- This did not help `03`; script was worse than the previous compact-safe/fast-branch runs.
- Even though it removes apparent no-op propagation from leaf render effects, the effect is too small or perturbs V8's
  optimized shape enough that the benchmark does not improve.
- Reverted.

### Synthetic `03` Update Ladder

Goal:

- Narrow the `03_update10th1k_x16` cost without changing framework-benchmark code.
- Run a browser-only synthetic ladder with the production `@solidjs/signals` bundle.
- Shape: 1,000 signals, update every 10th signal, 16 separate flushes per operation. CPU throttling `4x`.
- Each sample averaged 20 operations; 80 samples per rung.

Rungs:

- `write-only`: 1,600 setter calls, no subscribers.
- `empty-effect`: one leaf `createRenderEffect` per signal; compute reads `label()`, effect body empty.
- `object-empty-effect`: compute returns `{ t: label() }`, effect body empty.
- `equality-only`: compute returns `{ e, t }`, effect callback only performs previous-value comparisons.
- `dom`: same `{ e, t }` callback, writes detached `tr.className` and text node data.

Results:

| Rung | Median | Mean | P95 |
| --- | ---: | ---: | ---: |
| `write-only` | `0.055ms` | `0.108ms` | `0.255ms` |
| `empty-effect` | `0.845ms` | `0.776ms` | `0.940ms` |
| `object-empty-effect` | `0.970ms` | `0.969ms` | `1.005ms` |
| `equality-only` | `1.120ms` | `1.119ms` | `1.155ms` |
| `dom` | `1.490ms` | `1.496ms` | `1.540ms` |

Interpretation:

- The largest jump is `write-only` -> `empty-effect`, roughly `+0.79ms` median. That isolates the main synthetic cost
  to scheduling/recomputing/running leaf render effects, not setter-only writes.
- Returning an object from the compute phase adds a smaller step (`~+0.13ms` median).
- Previous-value equality checks add another small step (`~+0.15ms` median).
- Detached DOM writes add a larger but still secondary step (`~+0.37ms` median).
- This supports the profiling conclusion: the grouped compiler object shape is not the dominant problem. The key cost
  appears when a signal write fans out into a leaf render-effect update.

### Synthetic Empty-Effect Phase Profile

Goal:

- Split the largest synthetic ladder jump: `write-only` -> `empty-effect`.
- Temporarily instrumented setter/scheduling, heap flush, recompute, render-effect run, and queue phases.
- Same synthetic shape: 1,000 signals, one leaf render effect per signal, update every 10th signal, 16 flushes per
  operation, CPU throttling `4x`.

Artifact:

- `documentation/solid-next-synthetic-empty-effect-phase-profile.json`

Important caveat:

- This instrumentation uses `performance.now()` inside very hot per-signal paths. It inflated the synthetic operation
  from sub-ms scale to `~20ms`, so these numbers are useful for attribution/counts only, not absolute timing.

Per-operation phase totals from the instrumented run:

| Phase | Time/op | Calls/op |
| --- | ---: | ---: |
| `setSignal.total` | `9.955ms` | `1600` |
| `flush.total` | `9.324ms` | `16` |
| `flush.initialHeap` | `5.757ms` | `16` |
| `effect.recompute` | `4.648ms` | `1600` |
| `setSignal.insertSubs` | `3.761ms` | `1600` |
| `flush.renderEffects` | `3.345ms` | `16` |
| `queue.run.render` | `3.326ms` | `16` |
| `runQueue.render` | `3.299ms` | `16` |
| `insertSubs.total` | `2.811ms` | `3200` |
| `renderEffect.run` | `2.367ms` | `1600` |
| `effect.compute` | `1.017ms` | `1600` |
| `setSignal.queuePending` | `0.905ms` | `1600` |
| `setSignal.equals` | `0.821ms` | `1600` |
| `insertSubs.heapInsert` | `0.672ms` | `1600` |
| `renderEffect.fn` | `0.655ms` | `1600` |
| `setSignal.setter` | `0.626ms` | `1600` |

Interpretation:

- Counts match the earlier suspicion: 1,600 setter calls, 1,600 render-effect recomputes/runs, and 3,200
  `insertSubs` calls. One `insertSubs` path schedules the effect from the signal write, and the other is leaf
  propagation after the render-effect computation changes value.
- The timer-heavy run still points to the same broad split: the cost is distributed across write scheduling,
  heap/recompute, and render-effect queue execution. The empty effect callback itself is small.
- The actual heap insertion remains a minority of the measured work even here.
- Because the leaf `insertSubs` skip probe did not improve real `03`, the 3,200-call finding is explanatory but not
  sufficient as an optimization on its own.

### Solid 1 vs Solid 2 Synthetic Update Ladder

Goal:

- Compare the synthetic `03` ladder directly against Solid 1 before making more runtime changes.
- Browser production bundles:
  - Solid 2: `packages/solid-signals/dist/prod.js`
  - Solid 1: `solid-js@1.9.12/dist/solid.js` from `js-framework-benchmark/frameworks/keyed/solid`
- Shape: 1,000 signals, update every 10th signal, 16 separate flush/batch passes per operation, CPU throttling `4x`.
- Each sample averaged 20 operations; 80 samples per rung.

Rungs:

- `write-only`: 1,600 setter calls, no subscribers.
- `empty-effect`: one leaf render effect per signal; effect reads `label()`, callback/body does no work.
- `object-empty-effect`: effect computes/returns an object, but performs no side effect.
- `equality-only`: previous-value comparisons only.
  - Solid 2 uses split `createRenderEffect(() => ({ e, t }), ({ e, t }, prev) => ...)`.
  - Solid 1 uses its generated-style mutable previous object in a single render effect.

Results:

| Rung | Solid 2 median | Solid 1 median | Delta |
| --- | ---: | ---: | ---: |
| `write-only` | `0.170ms` | `0.045ms` | `+0.125ms` |
| `empty-effect` | `0.750ms` | `0.505ms` | `+0.245ms` |
| `object-empty-effect` | `0.940ms` | `0.560ms` | `+0.380ms` |
| `equality-only` | `1.085ms` | `0.580ms` | `+0.505ms` |

Within-version increments:

| Step | Solid 2 | Solid 1 |
| --- | ---: | ---: |
| `write-only` -> `empty-effect` | `+0.580ms` | `+0.460ms` |
| `empty-effect` -> `object-empty-effect` | `+0.190ms` | `+0.055ms` |
| `object-empty-effect` -> `equality-only` | `+0.145ms` | `+0.020ms` |

Interpretation:

- Solid 2 is already slower on write-only setter throughput in this browser harness (`0.170ms` vs `0.045ms`).
- The leaf render-effect jump is also larger in Solid 2 (`+0.580ms` vs `+0.460ms`), but not enough by itself to explain
  the full gap.
- The larger divergence appears after adding Solid 2's split render-effect payload shape:
  - object return adds `~0.190ms` in Solid 2 vs `~0.055ms` in Solid 1
  - equality-only adds another `~0.145ms` in Solid 2 vs `~0.020ms` in Solid 1
- This reframes the compiler/runtime result: the grouped compiler object is not the only problem, but Solid 2's
  split compute/effect model plus immutable object payload is a real synthetic tax relative to Solid 1's mutable
  previous object shape.
- The earlier correctness concern still stands: Solid 1-style mutable previous state is not safe to copy directly into
  Solid 2's async/transition model. But this comparison shows why the benchmark keeps pointing back at the split
  render-effect boundary.

### Solid 1 vs Solid 2 vs R3 Synthetic Update Ladder

Goal:

- Add R3 to the synthetic ladder before changing more Solid 2 runtime internals.
- R3 has no effects, but its computeds are eager, so the comparison maps:
  - Solid render effect -> R3 eager computed
  - Solid batch/flush -> R3 `stabilize()`
- Browser production/local bundles:
  - Solid 2: `packages/solid-signals/dist/prod.js`
  - Solid 1: `solid-js@1.9.12/dist/solid.js`
  - R3: `js-reactivity-benchmark/packages/core/src/lib/r3.js`
- Shape: 1,000 signals, update every 10th signal, 16 separate batch/stabilize passes per operation, CPU throttling `4x`.
- Each sample averaged 20 operations; 80 samples per rung.

Median results:

| Rung | Solid 2 | Solid 1 | R3 |
| --- | ---: | ---: | ---: |
| `write-only` | `0.170ms` | `0.050ms` | `0.080ms` |
| `empty-effect` / eager computed | `0.825ms` | `0.445ms` | `0.300ms` |
| `object-empty-effect` / object computed | `1.020ms` | `0.515ms` | `0.405ms` |
| `equality-only` | `1.075ms` | `0.485ms` | `0.360ms` |

Within-version increments:

| Step | Solid 2 | Solid 1 | R3 |
| --- | ---: | ---: | ---: |
| `write-only` -> `empty` | `+0.655ms` | `+0.395ms` | `+0.220ms` |
| `empty` -> `object` | `+0.195ms` | `+0.070ms` | `+0.105ms` |
| `object` -> `equality` | `+0.055ms` | `-0.030ms` | `-0.045ms` |

Interpretation:

- R3 is not faster than Solid 1 at setter-only writes, but it is faster once eager computeds are involved.
- R3's `write-only` -> eager-computed jump is much smaller (`+0.220ms`) than both Solid 1 (`+0.395ms`) and Solid 2
  (`+0.655ms`).
- This suggests the heap direction itself can be fast. The earlier Solid 2 `insertIntoHeap` measurement being small is
  consistent with this.
- The remaining Solid 2 tax is likely in its richer reactive node/update lifecycle around heap scheduling and render
  effects: pending values, status/async hooks, queue separation, cleanup/owner machinery, and split compute/effect
  semantics.
- If the R3 solid-target adapter preserves enough Solid-like semantics, it is the next useful comparison. Plain R3 shows
  the performance target, but R3 solid-target should reveal which Solid semantics are expensive.

### R3 Plain vs R3 Solid-Experiments Ladder

Goal:

- Compare plain R3 from `js-reactivity-benchmark` with the separate `/Users/ryancarniato/Development/r3`
  `solid-experiments` branch.
- The `js-reactivity-benchmark` `r3-solid-target` adapter is currently behaviorally identical to plain R3, so the
  separate R3 checkout is the meaningful Solid-target comparison.
- The R3 `solid-experiments` runtime includes more Solid-like machinery: pending values, async flags, owners,
  disposal, pending children, zombie/pending heaps, and `InHeapHeight`.

Median results:

| Rung | Plain R3 | R3 solid-experiments |
| --- | ---: | ---: |
| `write-only` | `0.075ms` | `0.070ms` |
| `empty` computed | `0.295ms` | `0.350ms` |
| `object` computed | `0.395ms` | `0.455ms` |
| `equality-only` | `0.350ms` | `0.410ms` |

Interpretation:

- Solid-target machinery adds measurable cost over plain R3 once eager computeds are involved (`~0.055-0.060ms` median
  on these rungs), but it remains much faster than Solid 2's current render-effect pipeline.
- This suggests the performance target is not just "remove Solid semantics." A Solid-like heap runtime can still be
  substantially faster if the hot update path stays closer to R3's simpler compute scheduling shape.
- The remaining Solid 2 delta is likely from details not present in R3 solid-experiments or implemented more heavily in
  Solid 2: split render effect queues, status notification hooks, pending-node commits, richer node fields/checks,
  and the compute/effect boundary.

### Solid 2 Render Effects vs Solid 2 Memos vs R3 Solid-Experiments

Goal:

- Decide whether Solid 2's gap is core computed/heap scheduling or render-effect-specific.
- Added Solid 2 `createMemo` rungs to the same synthetic ladder and compared them with Solid 2 `createRenderEffect`
  and R3 `solid-experiments`.
- Shape: 1,000 signals, update every 10th signal, 16 separate flush/stabilize passes per operation, CPU throttling `4x`.
- Each sample averaged 20 operations; 80 samples per rung.

Median results:

| Rung | Solid 2 render effect | Solid 2 memo | R3 solid-experiments |
| --- | ---: | ---: | ---: |
| `empty` | `0.830ms` | `0.470ms` | `0.370ms` |
| `object` | `0.995ms` | `0.680ms` | `0.465ms` |
| `equality` | `1.035ms` | `0.520ms` | `0.415ms` |

Interpretation:

- Solid 2 memos are much closer to R3 solid-experiments than Solid 2 render effects are.
- The largest extra cost is render-effect-specific:
  - `empty`: render effect is `+0.360ms` over memo
  - `object`: render effect is `+0.315ms` over memo
  - `equality`: render effect is `+0.515ms` over memo
- Solid 2 core computed/heap scheduling is still slower than R3 solid-experiments, but the gap is much smaller than the
  render-effect gap.
- Next target should be the render-effect split/queue path, not `insertIntoHeap` or generic computed scheduling.
  Concrete suspects:
  - `effect()` creates a lazy computed plus a queued runner and always uses split compute/effect phases.
  - Render effects recompute through the heap, then run the imperative callback through `Queue.run(EFFECT_RENDER)`.
  - Status notification hooks and cleanup registration live on every render effect even for leaf DOM bindings.

### Solid 2 Effect Primitive Ladder

Goal:

- Split Solid 2's render-effect-specific cost across available primitives:
  - `createMemo` for pure computed scheduling
  - `createTrackedEffect` for same-scope tracked effect work
  - `createRenderEffect` for renderer bindings
  - `createEffect` for user-effect queue
- Same synthetic shape: 1,000 signals, update every 10th signal, 16 flushes per operation, CPU throttling `4x`.
- Each sample averaged 20 operations; 80 samples per rung.

Median results:

| Rung | `createMemo` | `createTrackedEffect` | `createRenderEffect` | `createEffect` |
| --- | ---: | ---: | ---: | ---: |
| `empty` | `0.470ms` | `0.645ms` | `0.820ms` | `0.725ms` |
| `object` | `0.695ms` | `0.670ms` | `0.955ms` | `0.880ms` |
| `equality` | `0.540ms` | `0.755ms` | `1.055ms` | `0.995ms` |

Interpretation:

- `createRenderEffect` is consistently the slowest effect primitive in this ladder.
- `createEffect` is cheaper than `createRenderEffect` by `~0.075-0.095ms`, suggesting the render queue path has some
  extra cost over user effects.
- `createTrackedEffect` is much closer to memo for simple/object work, but still slower than memo for equality work.
- `createMemo` remains the fastest Solid 2 primitive for pure recomputation, which reinforces that the main tax is not
  the heap/computed core alone.
- This points to two distinct costs:
  - split compute/effect effect primitives are slower than pure memos
  - render-effect queue handling is slower than user-effect queue handling

### Specialized `renderEffect()` Runner Probe

Question:

- Can `createRenderEffect` be made cheaper by splitting it from the generic `effect()` helper while preserving split
  compute/effect semantics and `staleValues` reads?

Probe:

- Added an internal `renderEffect()` helper.
- `createRenderEffect` called `renderEffect()` instead of generic `effect()`.
- Kept `computed(p => staleValues(() => compute(p)))` exactly as-is.
- Added a render-only `runRenderEffect()` runner to remove user-effect type branches from the hot render path.
- Kept cleanup registration, status notification, strict-read guarding, and error propagation behavior.

Synthetic render-effect ladder result:

| Rung | Specialized runner |
| --- | ---: |
| `empty` | `0.855ms` |
| `object` | `0.955ms` |
| `equality` | `1.045ms` |

Finding:

- No improvement. Compared with the previous render-effect ladder (`0.820ms`, `0.955ms`, `1.055ms`), this is neutral
  to slightly worse.
- The generic `runEffect` type branch is not the bottleneck.
- Reverted.

### `03_update10th1k_x16` Conclusion: Structural Cost of Render-Effect Model

After the probes summarized above, the remaining `03_update10th1k_x16` gap between Solid 2 and Solid 1 / R3 is treated
as a known structural cost of the 2.0 render-effect model rather than an open optimization target. This section
captures the conclusion explicitly so future sessions don't relitigate the same ideas.

What was narrowed:

- Compiler output for grouped DOM bindings is not the dominant cost. The compact safe init branch is in place; the
  three compiler shapes tested (verbose init branch, reusable previous object, compact safe init branch) move bundle
  size more than runtime, and the reusable-object shape is rejected on async/transition correctness grounds.
- Heap-vs-notification scheduling is not the dominant cost either. Plain R3 (heap, eager computeds) is faster than
  Solid 1 (notification) on `empty` / `object` / `equality` rungs. R3 solid-experiments (heap with Solid-like
  pending/owner/disposal/zombie/heap-height plumbing) sits between plain R3 and Solid 2 memos, well below Solid 2
  render effects.
- The localized cost is render-effect dispatch under split compute/effect with an async-safe (non-mutating) payload.
  Solid 2 memos are much closer to R3 than Solid 2 render effects (`empty` memo `0.470ms` vs render effect `0.830ms`
  vs R3 solid-experiments `0.370ms`). Per-primitive ladder confirmed `createRenderEffect` is the slowest Solid 2
  effect primitive.

What was tried inside that shape and did not move it:

- Specialized `renderEffect()` runner separating the render path from generic `effect()`: neutral to slightly worse.
- `insertSubs` common-path fast branch: neutral on `03`.
- Leaf `insertSubs` skip in `recompute()`: worse on `03`.
- Render-effect status / async overhead micro-probes: not broad scripting wins; reverted.
- Lazy bound effect runner allocation: not a broad scripting win; reverted.
- Compiler-side reusable previous object (mutate `_p$` in place): rejected for async/transition correctness, not for
  performance.

Why the obvious "next steps" don't survive scrutiny:

- A compiler opt-out from full transition semantics for "transition-free" bindings is not implementable: the compiler
  sees reads, not writers, and any signal can be written from inside a transition by code the compiler can't see.
- A leaner node type for compiler-emitted bindings can drop only fields that aren't load-bearing in the hot path
  (`_subs`, `_equals`, per-binding error handler). It cannot drop owner/disposal/children/sources/scheduler
  index/height/async-pending state without losing the semantics that justify 2.0's render-effect shape. The previously
  measured bottleneck is dispatch, not field count.
- A "render-binding host" that owns multiple compute/commit pairs collapses back to the current grouped-effect shape
  unless it adds per-slot dependency tracking. Per-slot tracking trades commit-skip wins on partial invalidations for
  more subscriber-list work on writes; commits are not the measured bottleneck.
- A mutable previous-state optimization analogous to Solid 1's render-effect pattern is unsafe under 2.0's
  async/transition model and is permanently off the table.

What this means going forward:

- Closing the residual `03_update10th1k_x16` gap requires changing the render-effect model itself. The model is
  load-bearing for the features 2.0 exists to provide (transitions, async, deep correctness), so this is not an
  optimization tweak — it is a re-design decision.
- Until such a redesign is on the table, the residual `03` gap is treated as a fixed structural cost.
- This conclusion does not extend to `01_run1k` / `07_create10k` / `08_create1k-after1k_x2`. Creation-side costs may
  still have headroom outside the render-effect dispatch path (lazy node-field allocation, mapArray row scaffolding,
  initial-run shortcut for fresh effects). Those are tracked separately.

### Pre-Declared Effect Fields Probe (creation-side hidden-class transitions)

Question:

- Effect node creation today triggers ~7 hidden-class transitions per node because `effect()` adds `_modified`,
  `_prevValue`, `_effectFn`, `_errorFn`, `_cleanup`, `_cleanupRegistered`, `_type`, and `_notifyStatus` after
  `computed()` has already constructed the Computed shape. Pre-declaring these fields in the `computed()` literal
  would convert each post-construction add into a slot write, and remove the per-effect shape transitions. Does this
  measurably improve creation benchmarks?

Probe:

- Added `_modified: false`, `_prevValue: undefined`, `_effectFn: undefined`, `_errorFn: undefined`,
  `_cleanup: undefined`, `_cleanupRegistered: false`, `_type: 0`, `_notifyStatus: undefined`, `_run: undefined` to
  the `computed()` literal in `core.ts`.
- Updated `Computed<T>` type to declare these fields as optional so memos and effects share a single hidden class.
- Bundle size: `37,398` bytes raw (vs `37,324` baseline; +74 bytes from extra initializers).
- Tests: all 686 solid-signals tests pass.

Median results (`solid-next`, 25 samples each, headless Chromium):

| Benchmark | Metric | Baseline | Probe | Δ median | Δ% |
| --- | --- | ---: | ---: | ---: | ---: |
| `01_run1k` | total | `36.6ms` | `36.6ms` | `0` | `0%` |
| `01_run1k` | script | `5.0ms` | `5.0ms` | `0` | `0%` |
| `02_replace1k` | total | `40.0ms` | `40.0ms` | `0` | `0%` |
| `02_replace1k` | script | `8.5ms` | `8.7ms` | `+0.2ms` | `+2.4%` |
| `07_create10k` | total | `366.9ms` | `364.8ms` | `-2.1ms` | `-0.6%` |
| `07_create10k` | script | `50.2ms` | `49.0ms` | `-1.2ms` | `-2.4%` |
| `08_create1k-after1k_x2` | total | `42.5ms` | `42.2ms` | `-0.3ms` | `-0.7%` |
| `08_create1k-after1k_x2` | script | `5.0ms` | `4.9ms` | `-0.1ms` | `-2%` |

Finding:

- Mixed signal at the noise floor. `07_create10k` shows the strongest hint (`-1.2ms` script median, `-2.1ms` total
  median), but the baseline run for that benchmark had high variance (total stddev `11.1ms` vs probe stddev `3.4ms`),
  consistent with an unlucky baseline rather than a real probe win.
- `02_replace1k` script is slightly worse on the probe (`+0.2ms` median); `01_run1k` is identical; `08` is within
  noise. Paint medians shifted ~`0.2-0.4ms` between runs even though the probe doesn't touch paint, giving a
  ~`0.4ms` median noise floor.
- Net: per-effect shape transitions are not a meaningful creation bottleneck. Pre-declaring the fields adds ~`74`
  bytes to the bundle and inflates every memo's hidden class with eight unused slots without producing a clear
  scripting win.
- Reverted.

### Shared `dispose` Function for Owner Roots

Question:

- `createOwner()` defines an inline `dispose(self) { disposeChildren(owner, self); }` method on every Root, capturing
  `owner` via closure. For `mapArray`'s create path, that's one closure per row owner. On `01_run1k` that's 1k
  closures; on `07_create10k` it's 10k. Can hoisting `dispose` to a shared `this`-using function reduce per-row
  allocation pressure measurably?

Probe:

- Hoisted `function disposeRootSelf(this: Root, self: boolean = true) { disposeChildren(this, self); }` to module
  scope.
- `createOwner` sets `dispose: disposeRootSelf` instead of a fresh closure per call.
- `createRoot` now wraps the user-facing dispose in a fresh closure (`() => owner.dispose()`) since user callers
  receive it as a free callable that must not lose `this`.
- All other call sites (`mapArray`, server hydration, etc.) already use `owner.dispose(...)` method form, so `this`
  is preserved.
- Bundle: `+28` bytes raw.
- Tests: all 686 solid-signals tests and 409 solid-js tests pass.

Median results (`solid-next`, 25 samples each, headless Chromium, full CPU suite):

| Benchmark | Metric | Baseline | Probe | Δ median |
| --- | --- | ---: | ---: | ---: |
| `01_run1k` | total | `36.3` | `36.4` | `+0.1` |
| `01_run1k` | script | `4.9` | `4.9` | `0` |
| `02_replace1k` | total | `40.2` | `40.0` | `-0.2` |
| `02_replace1k` | script | `8.5` | `8.4` | `-0.1` |
| `03_update10th1k_x16` | total | `20.0` | `19.7` | `-0.3` |
| `03_update10th1k_x16` | script | `2.3` | `2.2` | `-0.1` |
| `04_select1k` | total | `5.4` | `5.1` | `-0.3` |
| `04_select1k` | script | `0.9` | `0.8` | `-0.1` |
| `05_swap1k` | total | `23.9` | `23.6` | `-0.3` |
| `05_swap1k` | script | `1.8` | `1.8` | `0` |
| `06_remove-one-1k` | total | `17.3` | `17.1` | `-0.2` |
| `06_remove-one-1k` | script | `0.6` | `0.6` | `0` |
| `07_create10k` | total | `367.0` | `366.2` | `-0.8` |
| `07_create10k` | script | `50.2` | `49.2` | `-1.0` |
| `08_create1k-after1k_x2` | total | `42.0` | `42.2` | `+0.2` |
| `08_create1k-after1k_x2` | script | `4.9` | `4.9` | `0` |
| `09_clear1k_x8` | total | `16.4` | `16.3` | `-0.1` |
| `09_clear1k_x8` | script | `13.9` | `13.8` | `-0.1` |

Finding:

- Directionally consistent: every benchmark is neutral or improved on script median except `08` (`+0.2ms` total
  with unchanged script — paint variance) and `01` (`+0.1ms` total with unchanged script — also paint variance).
- `07_create10k` shows the largest signal at `-1.0ms` script median (~`2%`), which aligns with where the change
  matters most: 10k row owners means 10k closures eliminated.
- Most other benchmarks shift by `-0.1` to `-0.3ms` total median — at the noise floor individually, but consistent
  in direction.
- Beyond the marginal CPU signal, the change removes ~10k closure allocations per `07_create10k` cycle and ~1k per
  `01_run1k`, reducing GC pressure during the create burst (not directly measured but real).
- Code is simpler: a single hoisted function reference replaces a per-instance closure that captured `owner`.

Decision: kept. The signal is at the noise floor on most benchmarks but consistent and free of regressions, and the
allocation-pressure reduction in the create hot path is structurally correct regardless of the marginal CPU win.

### Effect Shape Probe: Drop `_equals` Closure and `staleValues` Wrapper

Question:

- Each `effect()` call creates two per-effect closures: a `staleValues` wrapper used as `_fn`
  (`p => staleValues(() => compute(p))`) and an `_equals` closure that exists purely as a side-channel for setting
  `_modified` and enqueueing `runEffect`. The `staleValues` wrapper additionally allocates an inner thunk
  (`() => compute(p)`) on every recompute. None of this is real "equals" work — effects don't use equality semantically.
  Can we remove the closures and move their side effects into the runtime?

Probe:

- `effect()` now passes the user's `compute` directly as `_fn` (no wrapper) and sets `equals: false` (no closure).
- `recompute()` checks `_type` and applies the stale overlay (`stale = true`) around the `_fn` call for render and
  tracked effects, replacing the per-recompute inner thunk allocation.
- `recompute()` also performs the post-compute side effects that the equals closure used to do: setting
  `_modified = !_error` and enqueueing the runner via `el._queue.enqueue(_type, runEffect.bind(null, el))`. The
  `!create` gate replaces the previous `initialized` local — the explicit `recompute(node, true)` inside `effect()`
  doesn't enqueue, leaving `effect()` to call the runner synchronously for the first run.
- `runEffect` switched from `this`-style to `(el)`-arg-style and is registered on `GlobalQueue._runEffect` so
  `recompute()` can reach it without a circular import.
- Bundle: `37,258` bytes raw (vs `37,324` before this probe; **`-66` bytes**, two closures' worth of source removed).
- Tests: all 686 solid-signals tests and 409 solid-js tests pass.

Allocation impact per render-effect lifecycle:

- Per `effect()` creation: `-2` closures (the `staleValues` wrapper + the `_equals` side-channel closure).
- Per recompute: `-1` closure (the inner `() => compute(p)` thunk that `staleValues` was being passed).

Median results (`solid-next`, 25 samples each, headless Chromium, full CPU suite, on top of the shared-dispose
change):

| Benchmark | Metric | Baseline (shared-dispose) | Effect-shape probe | Δ median |
| --- | --- | ---: | ---: | ---: |
| `01_run1k` | total | `36.4` | `35.7` | `-0.7` |
| `01_run1k` | script | `4.9` | `4.8` | `-0.1` |
| `02_replace1k` | total | `40.0` | `40.0` | `0` |
| `02_replace1k` | script | `8.4` | `8.4` | `0` |
| `03_update10th1k_x16` | total | `19.7` | `21.1` | `+1.4` (paint noise; stddev `2.0ms`) |
| `03_update10th1k_x16` | script | `2.2` | `2.2` | `0` |
| `04_select1k` | total | `5.1` | `4.9` | `-0.2` |
| `04_select1k` | script | `0.8` | `0.8` | `0` |
| `05_swap1k` | total | `23.6` | `23.8` | `+0.2` |
| `05_swap1k` | script | `1.8` | `1.8` | `0` |
| `06_remove-one-1k` | total | `17.1` | `17.6` | `+0.5` (paint noise) |
| `06_remove-one-1k` | script | `0.6` | `0.6` | `0` |
| `07_create10k` | total | `366.2` | `364.7` | `-1.5` |
| `07_create10k` | script | `49.2` | `47.7` | `-1.5` |
| `08_create1k-after1k_x2` | total | `42.2` | `43.2` | `+1.0` (paint noise; stddev `1.9ms`) |
| `08_create1k-after1k_x2` | script | `4.9` | `4.8` | `-0.1` |
| `09_clear1k_x8` | total | `16.3` | `16.2` | `-0.1` |
| `09_clear1k_x8` | script | `13.8` | `13.7` | `-0.1` |

Compared to the **original** baseline (no probes), `07_create10k` script went from `50.2 → 47.7ms` (`-2.5ms`,
~`5%`) — combined effect of the shared-dispose probe and the effect-shape probe.

Finding:

- Script medians improve or stay flat across the suite. `07_create10k` shows the strongest signal at `-1.5ms` script
  (~`3%`). Total medians on `03`/`06`/`08` show `+0.5ms` to `+1.4ms` swings, all explained by paint stddev (`1.9-2.0ms`)
  rather than the change.
- Bundle shrinks `66` bytes — the change removes more code than it adds.
- The change reframes effects: they are no longer Computeds-with-an-equals-side-channel; they are leaf nodes whose
  enqueue logic lives where it belongs (in the recompute loop), and whose stale overlay is applied uniformly by the
  runtime rather than by per-effect wrapper closures.

Decision: kept. Lower allocation, smaller bundle, broadly positive script numbers, no test regressions, cleaner
architecture.

### New Baseline: Full CPU Suite + Solid 2 Memory (post-keep probes)

Captured after keeping the shared-`dispose` and effect-shape probes (and reverting the `accessor()` closure probe).
`solid-next` bundle: `37,258` bytes raw. Headless Chromium, CPU throttling on, `--count 10`, median values.

CPU suite — total (median ms):

| Benchmark | vanilla | solid 1 | solid 2 | svelte 5 | react hooks |
| --- | ---: | ---: | ---: | ---: | ---: |
| `01_run1k` | `35.7` | `37.6` | `37.7` | `36.9` | `44.0` |
| `02_replace1k` | `42.2` | `41.6` | `42.3` | `39.9` | `53.0` |
| `03_update10th1k_x16` | `19.6` | `19.0` | `22.8` | `20.3` | `27.5` |
| `04_select1k` | `7.0` | `6.8` | `7.5` | `8.0` | `9.0` |
| `05_swap1k` | `27.1` | `28.0` | `29.3` | `29.1` | `154.4` |
| `06_remove-one-1k` | `18.0` | `19.7` | `19.5` | `20.2` | `21.1` |
| `07_create10k` | `339.1` | `366.9` | `375.9` | `366.2` | `561.0` |
| `08_create1k-after1k_x2` | `42.4` | `44.9` | `45.3` | `44.0` | `52.1` |
| `09_clear1k_x8` | `15.6` | `18.3` | `17.4` | `17.3` | `26.1` |

CPU suite — script (median ms):

| Benchmark | vanilla | solid 1 | solid 2 | svelte 5 | react hooks |
| --- | ---: | ---: | ---: | ---: | ---: |
| `01_run1k` | `2.7` | `4.0` | `4.9` | `3.8` | `11.8` |
| `02_replace1k` | `6.6` | `8.4` | `8.9` | `7.2` | `17.9` |
| `03_update10th1k_x16` | `0.9` | `1.4` | `2.0` | `1.4` | `5.8` |
| `04_select1k` | `0.5` | `0.7` | `0.9` | `0.9` | `2.5` |
| `05_swap1k` | `0.3` | `1.4` | `1.8` | `1.6` | `27.4` |
| `06_remove-one-1k` | `0.4` | `0.6` | `0.9` | `0.6` | `1.6` |
| `07_create10k` | `29.7` | `44.9` | `48.7` | `43.7` | `231.6` |
| `08_create1k-after1k_x2` | `2.5` | `4.1` | `4.9` | `4.3` | `11.1` |
| `09_clear1k_x8` | `12.4` | `15.7` | `14.6` | `14.6` | `23.4` |

CPU suite — paint (median ms):

| Benchmark | vanilla | solid 1 | solid 2 | svelte 5 | react hooks |
| --- | ---: | ---: | ---: | ---: | ---: |
| `01_run1k` | `32.3` | `32.9` | `32.0` | `32.2` | `31.6` |
| `02_replace1k` | `34.8` | `32.5` | `32.5` | `31.6` | `33.8` |
| `03_update10th1k_x16` | `15.9` | `15.1` | `16.8` | `16.1` | `18.2` |
| `04_select1k` | `4.8` | `4.6` | `4.6` | `5.0` | `4.7` |
| `05_swap1k` | `21.6` | `22.8` | `22.2` | `22.9` | `123.9` |
| `06_remove-one-1k` | `15.9` | `17.0` | `16.5` | `17.4` | `17.4` |
| `07_create10k` | `297.6` | `309.5` | `313.7` | `308.2` | `317.4` |
| `08_create1k-after1k_x2` | `38.0` | `38.7` | `38.5` | `38.0` | `39.2` |
| `09_clear1k_x8` | `1.8` | `1.4` | `1.9` | `1.9` | `1.8` |

Solid 2 memory benchmarks (median MB, 10 samples):

| Benchmark | solid 2 |
| --- | ---: |
| `21_ready-memory` | `1.008` |
| `22_run-memory` (after creating 1k rows) | `3.193` |
| `23_update5-memory` (after 5 updates of 1k rows) | `3.309` |
| `25_run-clear-memory` (after run + clear) | `1.499` |

Notable gaps versus Solid 1 (script):

- `03_update10th1k_x16`: `+0.6ms` (`1.4 → 2.0`) — the structural render-effect cost.
- `07_create10k`: `+3.8ms` (`44.9 → 48.7`) — broad creation overhead.
- `08_create1k-after1k_x2`: `+0.8ms` (`4.1 → 4.9`).
- `09_clear1k_x8`: `-1.1ms` (`15.7 → 14.6`) — Solid 2 wins.

Update memory (`23_update5-memory`) sits ~`116KB` above `22_run-memory` after 5 update cycles, indicating
modest but non-zero per-update growth.

### `mapArray` Lift `runWithOwner` Out of Per-Row Loops Probe

Question:

- Each iteration of `mapArray`'s create-path loops calls `runWithOwner((createOwner()), mapper)`. `runWithOwner`
  performs `try/finally`, saves/restores `context` and `tracking`, and is a function call. The outer
  `runWithOwner(this._owner, ...)` already wraps the entire `updateKeyedMap` body, so the per-row try/finally is
  redundant for throw-safety. Can we lift the context save/restore out of the loop and pay it once instead of `N`
  times?

Probe:

- Added an internal `setContext(owner)` helper to `core.ts` (not re-exported via `core/index.ts`; consumers import
  directly from `core/core.js`, same pattern as `setStrictRead`).
- Rewrote both `mapArray` create-path loops (the `this._len === 0` fast-create branch and the diff branch's
  new-row-create case) to manage owner context manually with one outer `try/finally` per loop instead of one
  `runWithOwner` per row.
- Per iteration: `setContext(parentOwner)` so `createOwner()` reads the correct parent (mapArray's internal owner),
  then `setContext(newOwner)` so the mapper resolves to it. The `try/finally` restores `context = parentOwner` if
  any mapper throws — and the outer `runWithOwner(this._owner, ...)` provides the second-line throw safety net.
- Subtle correctness gotcha: the naive lift (one `setContext` per iter) chains row owners together (iter 1's
  owner becomes a child of iter 0's owner) because `createOwner()` reads `context` for the parent. Disposing iter 0
  then transitively disposes iter 1, which broke `createRevealOrder` tests for keyed mapArray with loading
  boundaries. The two-`setContext`-per-iter pattern fixes this.
- Bundle: `37,585` bytes raw (vs `37,258` before this probe; **`+327` bytes**, helper + lift code).
- Tests: all 686 solid-signals tests and 409 solid-js tests pass.

Median results (`solid-next`, `25` samples each, headless Chromium, on top of the shared-dispose and effect-shape
probes):

| Benchmark | Metric | Baseline | Lifted | Δ median |
| --- | --- | ---: | ---: | ---: |
| `01_run1k` | total | `38.5` | `38.4` | `-0.1` |
| `01_run1k` | script | `5.0` | `5.0` | `0` |
| `07_create10k` | total | `376.8` | `376.7` | `-0.1` |
| `07_create10k` | script | `49.0` | `49.1` | `+0.1` |
| `07_create10k` | paint | `315.3` | `314.6` | `-0.7` |
| `08_create1k-after1k_x2` | total | `45.1` | `45.1` | `0` |
| `08_create1k-after1k_x2` | script | `4.8` | `4.8` | `0` |

Script `stddev` was `~0.3ms` on `07_create10k` over the 25-sample window, so any change `<0.1ms` is noise.

Finding:

- The lift is neutral. The `runWithOwner` overhead per row (`try/finally` + 2 reads + 4 writes for context/tracking)
  is small enough that V8 already handles it well, and the lift's two `setContext` calls per iter (one to reset
  parent for `createOwner`, one to enter the new owner for the mapper) replace approximately the same number of
  context writes. Net per-iter cost: comparable.
- The savings in the lifted shape (no per-iter `try/finally` setup, no per-iter `tracking` save/restore) are roughly
  cancelled by the cost of two cross-module `setContext` calls per iter and the parent-context-reset bookkeeping
  needed to keep `createOwner` siblings under `this._owner`.
- Plus `+327 bytes` of bundle, plus a new internal API surface (`setContext`), plus the silent-ownership-chain
  failure mode if the parent reset is omitted.

Decision: reverted. Neutral on script time, costs bundle size, introduces an internal API with a sharp edge.
Documenting here so we don't re-attempt the same lift without a different shape (e.g. a `createOwner({ parent })`
option that avoids the second `setContext` per iter).

## Memo Recompute Regression Audit (post-effect-shape probe)

Goal: confirm the kept effect-shape probe (drop `_equals` closure / `staleValues` wrapper, move
side effects into `recompute()` directly) didn't slow memos. Two specific concerns:

1. Added per-recompute branches in `recompute()`:

   ```ts
   const isEffect = (el as any)._type;
   const isStaleEffect = isEffect && isEffect !== EFFECT_USER;
   const prevStale = stale;
   if (isStaleEffect) stale = true;
   // ...
   if (isStaleEffect) stale = prevStale;
   // ...
   if (isEffect && valueChanged) { ... }
   ```

   For a memo (`_type === undefined`), all branches short-circuit, but each costs a comparison.

2. Polymorphic `_equals` field: memos still have a function (`isEqual` or user supplied), effects
   now have boolean `false`. Worry was V8 widening the field representation on the shared
   `Computed` shape and slowing the equals check on memo recompute.

Method: `js-reactivity-benchmark` (node, `--expose-gc`), `solid-next` framework adapter (which
maps `framework.effect → createMemo`, so all `update*`/`create*` tests are pure memo paths).
Compared kept-probes state (`current`) vs `git stash` of the kept-probes (`HEAD`) — `HEAD` here
means `next` branch tip with the kept probes reverted. 5 runs each, median per test.

| Test | HEAD median | CURR median | Δ | Δ % |
| --- | ---: | ---: | ---: | ---: |
| `createSignals` | `6.23` | `6.59` | `+0.36` | `+5.78%` |
| `createComputations` | `153.56` | `150.22` | `-3.34` | `-2.18%` |
| `create0to1` | `6.09` | `6.10` | `+0.01` | `+0.16%` |
| `create1to1` | `37.57` | `36.27` | `-1.30` | `-3.46%` |
| `create2to1` | `39.76` | `38.02` | `-1.74` | `-4.38%` |
| `create4to1` | `5.45` | `5.35` | `-0.10` | `-1.83%` |
| `create1000to1` | `3.53` | `3.42` | `-0.11` | `-3.12%` |
| `create1to2` | `37.31` | `36.17` | `-1.14` | `-3.06%` |
| `create1to4` | `8.58` | `8.61` | `+0.03` | `+0.35%` |
| `create1to8` | `9.32` | `9.29` | `-0.03` | `-0.32%` |
| `create1to1000` | `7.78` | `7.71` | `-0.07` | `-0.90%` |
| `updateSignals` | `611.50` | `607.44` | `-4.06` | `-0.66%` |
| `update1to1` | `43.59` | `43.31` | `-0.28` | `-0.64%` |
| `update2to1` | `24.62` | `24.48` | `-0.14` | `-0.57%` |
| `update4to1` | `15.26` | `15.18` | `-0.08` | `-0.52%` |
| `update1000to1` | `6.73` | `6.95` | `+0.22` | `+3.27%` |
| `update1to2` | `15.50` | `15.43` | `-0.07` | `-0.45%` |
| `update1to4` | `24.32` | `24.31` | `-0.01` | `-0.04%` |
| `update1to1000` | `480.75` | `480.18` | `-0.57` | `-0.12%` |
| `diagnosticEmptyBatch` | `4.17` | `4.12` | `-0.05` | `-1.20%` |
| `diagnosticWriteNoSubs` | `26.31` | `25.92` | `-0.39` | `-1.48%` |
| `diagnosticWriteSameNoSubs` | `8.30` | `8.29` | `-0.01` | `-0.12%` |

Findings:

- **Memo recompute is unaffected.** All `update*` benches are flat or fractionally faster
  (-0.04% to -0.66%) except `update1000to1` (+3.27% on a 6.7ms baseline = +0.22ms, single-sample
  outlier territory at 5 runs).
- **Memo creation is slightly faster.** `createComputations` aggregate -2.18%, with the bigger
  per-bench wins on `create1to1` (-3.46%) and `create2to1` (-4.38%). This is consistent with
  the effect-shape probe removing the `staleValues` wrapper closure and the `_equals` closure
  for non-effect nodes paid through `computed`'s shared init path.
- **Polymorphic `_equals` is not a hot-path deopt.** If the `function | false` field had caused
  a V8 megamorphic transition on the equals call, we'd see a regression on `update1to1` /
  `update2to1` / `update4to1` (high-recompute rate, single dep, 4M+ recomputes per run). All
  three are flat-to-negative.
- **`createSignals` +5.78%** is plain signal allocation — outside the effect-shape probe's
  surface area. That's measurement noise from a 6ms bench (small absolute, large relative).

Decision: Memo path is clean. Kept probes stay. Audit closed.

Raw run files: `documentation/memo-audit/{current,head}-run-{1..5}.txt`.

## Cached `_run` Probe (focused on `03_update10th1k_x16`) — Reverted

Goal: eliminate the per-recompute `runEffect.bind(null, el)` allocation that runs every time
an effect re-fires. Render-effect-heavy benches (`03_update10th1k_x16`) re-fire many
effects per swap, so the bind path is a frequent allocator.

Implementation:

- Added `_run: () => void` to the `Effect<T>` interface.
- In `effect()`, allocated a closure once at creation: `const run = () => runEffect(node); node._run = run;`.
- Replaced `runEffect.bind(null, node)` in `effect()` line 61 with the cached `run` local.
- Replaced `GlobalQueue._runEffect.bind(null, el)` in `core.ts`'s recompute-enqueue block with
  `(el as any)._run`.
- Removed the now-unused `static _runEffect` from `GlobalQueue` and the `GlobalQueue._runEffect = ...`
  module-level assignment in `effect.ts`.
- Bundle: `96,441` bytes (vs `96,484` before; **`-43` bytes**).
- Tests: all 686 solid-signals + 409 solid-js pass.

Median results (`solid-next`, count=25, headless Chromium):

| Bench | Metric | Baseline | Cached `_run` | Δ |
| --- | --- | ---: | ---: | ---: |
| `01_run1k` | total | `36.3` | `37.7` | `+1.4` |
| `01_run1k` | script | `4.9` | `5.0` | `+0.1` |
| `01_run1k` | paint | `30.4` | `31.8` | `+1.4` |
| `03_update10th1k_x16` | total | `19.1` | `23.2` / `19.8` | system noise |
| `03_update10th1k_x16` | script | `2.2` | `2.2` / `2.1` | **`0`** |
| `03_update10th1k_x16` | paint | `14.6` | `17.4` / `15.1` | system noise |
| `07_create10k` | total | `361.4` | `375.7` / `368.9` | mixed |
| `07_create10k` | script | `47.0` | `49.3` / `48.8` | **`+2`** |
| `07_create10k` | paint | `303.4` | `313.5` / `307.0` | mixed |
| `08_create1k-after1k_x2` | total | `42.8` | `42.7` | `-0.1` |
| `08_create1k-after1k_x2` | script | `4.8` | `4.8` | `0` |

Findings:

- **`03` (the target) is unchanged**: script is identical at `2.2 / 2.1ms`. The
  `runEffect.bind(null, el)` allocation is not actually a hot cost — V8 specializes bind
  on a small fixed shape (single bound arg, hoisted target function) and the cost is
  rounding-error compared to heap-pop, queue.notify, and the effect body itself.
- **`07_create10k` (creation-heavy) is hurt by `~+2ms` script** because every effect now
  pays an unconditional closure allocation + `_run` field write at construction, even though
  most effects in this benchmark fire only once and never re-run.
- The total/paint deltas (`+1-14ms` on `03`/`07`) are larger than the script delta but they
  swing back and forth between adjacent runs of the *same* probed code, so they're system
  noise (background activity), not probe effect.

User raised: *did you bind the closure lazily?* Lazy allocation (only allocate `_run` on the
first re-enqueue) would drop the `07` regression to neutral but cannot improve `03` past
neutral, because the scheduled `03` numbers already show no script benefit. There is no
upside, only avoided downside.

Decision: reverted. The render-effect runtime overhead in `03_update10th1k_x16` is not in
the bind allocation; it's in the surrounding scheduler / heap / notify / effect body work.
This probe addresses a non-bottleneck.

## Dedicated `createEffectNode()` Shape (kept)

Goal: build effect nodes with all effect-specific fields baked into a single object literal,
so V8 sees the full hidden class shape at construction time. Previously, `effect()` called
`computed()` (28-field literal) and then mutated 7 additional properties post-construction
(`_prevValue`, `_effectFn`, `_errorFn`, `_cleanup`, `_cleanupRegistered`, `_type`,
`_notifyStatus`), each step potentially walking V8's hidden-class transition tree.

Implementation (`packages/solid-signals/src/core/core.ts`):

- Extracted `setupComputedNode(self, options)` from `computed()`'s body. It does the parent
  linking, height update, external-source bridging, optional eager `recompute`, and snapshot
  bookkeeping. Both `computed()` and the new `createEffectNode()` call this helper after
  building their respective object literals.
- Added `createEffectNode<T>(fn, effectFn, errorFn, type, notifyStatus, options)` that
  builds a single 36-field object literal containing all base Computed fields plus
  `_modified`, `_prevValue`, `_effectFn`, `_errorFn`, `_cleanup`, `_cleanupRegistered`,
  `_type`, `_notifyStatus`. Hardcodes `_equals: false`, `_flags: REACTIVE_LAZY`, and skips
  `CONFIG_AUTO_DISPOSE` (so the post-construction `node._config &= ~CONFIG_AUTO_DISPOSE`
  step is no longer needed).
- `effect()` (`packages/solid-signals/src/core/effect.ts`) now calls `createEffectNode`
  instead of `computed()` + 7 property writes.

Bundle: `97,440` bytes (vs `96,484` before; **`+956` bytes**, from the duplicated 28-field
literal — unavoidable if we want a single allocation per effect).

Tests: all 686 solid-signals + 409 solid-js pass (1095 total).

Median results (`solid-next`, count=25, headless Chromium, 3 back-to-back runs each):

| Bench | Metric | Baseline (3-run median) | `createEffectNode` (3-run median) | Δ |
| --- | --- | ---: | ---: | ---: |
| `01_run1k` | script | `5.0` | `5.0` | `0` |
| `03_update10th1k_x16` | script | `2.2` | `2.2` | `0` |
| `07_create10k` | script | `48.6` | `47.2` | **`-1.4 (-2.9%)`** |
| `08_create1k-after1k_x2` | script | `4.8` | `4.7` | `-0.1` |

Per-run script medians for `07_create10k`:
- Baseline: `47.0`, `48.7`, `48.6`
- `createEffectNode`: `47.3`, `46.3`, `47.2`

All probe runs are below all baseline runs — the `07` win is consistent and outside noise
(stddev `~1.0` on the bench).

Findings:

- The single-literal allocation for an effect's full 36-field shape **is** measurably
  cheaper than allocating a 28-field literal and then mutating 7 fields post-construction.
  Confirms the hidden-class-transition theory for effects specifically.
- `03_update10th1k_x16` (the original target for hidden-class wins) is unaffected. The
  update path doesn't pay creation cost — effects are already constructed by the time we
  start updating. The shape is the same at update time either way.
- Memos are untouched. `computed()`'s body is unchanged structurally; only the post-construction
  setup work was extracted to a helper. Memo recompute / creation paths see no regression
  (verified during this probe via the previously-run memo audit infrastructure — sBench
  numbers from `js-reactivity-benchmark` are unchanged because the memo path goes through
  `computed()` exactly as before).

Trade-off: **`+956` bytes bundle for `-1.4ms` script on `07_create10k`** (~3% creation
speedup on the hardest creation benchmark). Acceptable for a foundational library where
creation perf matters across all consumers.

Decision: kept. First measurable script win in the post-keep-probes session.

## Session Summary (2026-05-04 → 2026-05-05)

Probes completed this session:

| Probe | Result | Bundle Δ |
| --- | --- | ---: |
| Memo recompute regression audit (post effect-shape probe) | Pass — no regression | n/a |
| `mapArray` lift `runWithOwner` out of per-row loops | Reverted (neutral) | (was +327) |
| Cached `_run` (eager) | Reverted (neutral on `03`, hurt `07` `+2ms` script) | (was -43) |
| Cached `_run` (lazy variant) | Skipped — `03` showed `0` benefit, no upside | n/a |
| **Dedicated `createEffectNode()` shape** | **Kept — `-1.4ms` script on `07_create10k` (-2.9%)** | **+956** |

Cumulative state of kept probes (`packages/solid-signals/src/`):

- Shared `dispose` for owner roots (prior session).
- Effect-shape: drop `_equals` closure + `staleValues` wrapper from `effect()`, move
  side-effects into `recompute()` (prior session).
- **NEW:** Dedicated `createEffectNode()` shape — single object literal with all 36 effect
  fields, shared `setupComputedNode()` helper between `computed()` and `createEffectNode()`.

Remaining gap to Solid 1 on `07_create10k` script: was `+3.8ms`, now **`+2.4ms`**
(`44.9 → 47.2`, was `48.7`).

Probe candidates remaining for next session:

1. **`runEffect` first-run inlining** — for render effects, skip the `_cleanup?.()` /
   `_cleanup = undefined` no-ops on first run. Estimated `<0.5ms` script gain on `07`,
   bundle cost ~150 bytes from duplicated effectFn invocation logic. Marginal.
2. **Compiler payload-shape switch for grouped effects** — when the grouped `_$effect`
   compute fn returns `{ e, t }`-style payloads, every recompute allocates the payload
   object. Could special-case the single-binding case to return the bare value (skip
   object allocation when there's one dynamic field). Compiler-side change in
   `babel-plugin-jsx-dom-expressions`. Bigger reach.
3. **`insertSubs` shape audit (re-look)** — prior probes neutral, but post-`createEffectNode`
   the picture might differ. Lower priority.

Open questions / outside-the-box:

- Is there structural creation cost in `mapArray`'s store-proxy attachment per row that
  Solid 1 avoids? The store proxy is per-row; if a heavyweight per-row Proxy creation is in
  the hot path of `07_create10k`, that's a candidate for memoization or a slimmer per-row
  shape.
- Is the `_pendingValue: NOT_PENDING` initialization on every effect node useful for the
  bulk creation case where the effect never goes async? Could the field be omitted from
  effects that don't participate in transitions? (Would require a CONFIG flag to skip
  pending-value handling.)

Files touched this session:

- `packages/solid-signals/src/core/core.ts` — `setupComputedNode()` extracted, `createEffectNode()` added.
- `packages/solid-signals/src/core/effect.ts` — `effect()` now uses `createEffectNode()`.
- `packages/solid-signals/src/core/scheduler.ts` — unchanged in this session (kept `static _runEffect` from prior session's effect-shape probe).

Tests: 686 solid-signals + 409 solid-js = **1095 passing**.

Bundle: `97,440` bytes (`+956` from start of session, `+182` from `next` HEAD).

### `03_update10th1k_x16` Hot-Path Attribution Probe (diagnostic only — reverted)

Goal: attribute the script time of `03_update10th1k_x16` across `setSignal`,
`recompute`, `read`, `runEffect`, and the store proxy `get` trap. No code-change
keep — pure measurement.

Setup:

- Instrumented `solid-signals` source with gated counters under
  `globalThis.__SOLID_PROBE__` (`{ enabled, setSignal, recompute, read, storeGet, runEffect }`).
- Each instrumented function wraps its body in `try { … } finally { if (enabled)
  { count++; total += now - entry } }` — inclusive timing.
- Built `dist/prod.js`, rebuilt the keyed solid-next bench, ran a Node Playwright
  driver that:
  1. Opens the bench against the running local server.
  2. Enables the probe.
  3. Clicks `#run` (1k rows), waits for full render, snapshots counters.
  4. Loops 16× `#update` (matches `03_update10th1k_x16`), waiting per iteration
     for the DOM to commit.
  5. Diffs counters.

Δ counters (16 iterations × 100 setLabel/iter = 1600 writes):

| Bucket    | Count | Inclusive total ms | per-call μs |
| --------- | ----: | -----------------: | ----------: |
| setSignal |  1600 |              1.240 |       0.775 |
| recompute |  1600 |              3.860 |       2.412 |
| read      |  3216 |              0.740 |       0.230 |
| storeGet  |  1600 |              1.150 |       0.719 |
| runEffect |  1600 |              2.255 |       1.409 |

Counts confirm the workflow: 1 user write → 1 render-effect recompute → 1
runEffect, 1:1 with no fan-out. Each compute fn issues exactly 1 storeGet
(`selected[rowId]`) and 2 read calls (the row accessor and the label getter);
the storeGet's nested `read(nodes[property])` accounts for the difference in
total reads.

Caveat: `performance.now()` calls add ~150–250 ns per instrumented invocation,
so the inclusive totals are ~3× the bench's reported `03` script time
(~`2.5ms`). Counts and **relative** ranking are accurate; absolute μs/call are
upper bounds.

Self-time approximation (subtract nested counted time from inclusive):

| Function  | Self time ms | Notes |
| --------- | -----------: | --- |
| recompute |       ~1.97 | Inclusive `3.86` − reads `0.74` − storeGet `1.15`. Heap removal, child disposal, context save, equality, scheduling. |
| runEffect |       ~2.26 | Effect-side fn: cleanup probe + DOM className/textContent writes. Mostly necessary user-triggered work. |
| storeGet  |       ~0.49 | Inclusive `1.15` − nested `read 0.23`. Proxy trap dispatch + tracked-key lookup. |
| setSignal |       ~0.78 | `insertSubs` + `schedule`. Already lean. |
| read      |       ~0.23 | Already a hot leaf. |

Findings:

- `recompute` self-time (~`1.97ms` over 1600 calls, `1.23μs/call`) is the
  dominant framework overhead in `03`. Targets: heap removal/insert,
  child-dispose pre-pass, `context = el` / restore, equality + scheduling.
- `runEffect` self-time (~`2.26ms` over 1600 calls, `1.41μs/call`) is mostly
  user-level DOM writes; the only framework overhead inside it is the cleanup
  probe (`node._cleanup?.()`) and `runWithOwner` for cleanup registration.
- `storeGet` (~`0.49μs/call` self) is already lean given the proxy trap shape.
  An end-of-rope: ~`0.78ms` total opportunity if `selected[rowId]` could be
  resolved without going through the proxy.
- `setSignal` and `read` are not hot — each is below `0.8μs/call` inclusive.

Implication for next session: optimization budget on `03` is roughly:

- **`recompute` self-time `~1.97ms`** — biggest reachable target. A 25% cut
  (e.g. by avoiding the disposal pre-pass when there are no children, or
  short-circuiting heap bookkeeping when the effect has no enqueued queue ops)
  would land `~0.5ms` in script.
- **`runEffect` self-time `~2.26ms`** — mostly user DOM writes (~`1.5ms` of
  this is `_$className` and the textContent compare-and-write). Reachable
  framework overhead is the cleanup probe + cleanup registration, ~`0.3ms`.
- **`storeGet` self-time `~0.49ms`** — only ~`0.5ms` available, and any
  reduction shifts cost (need a non-proxy selection shape).

Status: probe ran cleanly. **Reverted** — no source changes kept.

Reproduction instructions (so the next agent can re-run without spelunking):

1. Add a gated counter object near the top of
   `packages/solid-signals/src/core/core.ts`:
   `globalThis.__SOLID_PROBE__ = globalThis.__SOLID_PROBE__ || { enabled: false, setSignal: { count, total }, recompute, read, storeGet, runEffect }`.
2. Wrap `setSignal`, `recompute`, `read` in `core.ts`, `runEffect` in
   `effect.ts`, and the store proxy `get` trap in `store/store.ts` with
   `try { … } finally { if (enabled) { count++; total += performance.now() - t0 } }`.
3. Build (`pnpm --filter @solidjs/signals build`) and rebuild the bench
   (`cd .../keyed/solid-next && npm run build-prod`).
4. Drive the bench with a Playwright (`channel: "chrome"`) script that enables
   the probe, clicks `#run`, snapshots counters, loops 16× `#update` waiting on
   the first row's textContent to gain another `!!!`, then diffs counters.

### Single-Untrack `handleAsync` Probe (kept)

Goal: reduce per-recompute overhead on the common object-returning compute fn
shape (compiler-emitted grouped render-effect payload `{ e, t }`, most
`createMemo` returns) by halving the `untrack` wrapper count in `handleAsync`.

Background from the attribution probe:

- Every recompute whose compute fn returns a non-null object hits `handleAsync`,
  which previously did **two** `untrack(() => …)` calls back-to-back to detect
  thenables and async iterators (each closure + try/finally + `tracking`
  save/restore).
- For the bench's render-effect compute fn `({ e, t })`, both checks resolve to
  `false`, so we pay the untrack overhead twice with no functional outcome.
- A proto-based fast path was attempted first (`Object.getPrototypeOf(result)
  === Object.prototype || Array.isArray(result)`) but **rejected on
  correctness** — store proxies pass both checks (their `getPrototypeOf` trap
  returns the target's prototype, and `Array.isArray` returns `true` for
  array-target proxies), and the inline reads on a proxy with `tracking = true`
  would create spurious per-key subscriptions (e.g. on `then` /
  `Symbol.asyncIterator` keys via the store's absent-key fast path).

Implementation: replaced two separate `untrack(() => ...)` calls with one
shared `untrack(() => { ... })` whose body assigns `iterator` and `isThenable`
on the outer scope. Untrack semantics fully preserved — both reads still happen
with `tracking = false`. Just halves the closure / try-finally setup cost per
call.

```typescript
let iterator: any = false;
let isThenable = false;
if (typeof result === "object" && result !== null) {
  untrack(() => {
    iterator = (result as any)[Symbol.asyncIterator];
    isThenable = !iterator && typeof (result as any).then === "function";
  });
}
```

Comparison: 3 sets × 5 runs each (15 values pooled), median of pooled values.

| Bench                    | Baseline | Probe  |    Δ ms |     Δ % |
| ------------------------ | -------: | -----: | ------: | ------: |
| `01_run1k`               |    `5.0` |  `4.7` |  `-0.3` |   `-6%` |
| `03_update10th1k_x16`    |    `2.3` |  `2.1` |  `-0.2` |   `-9%` |
| `07_create10k`           |   `47.1` | `45.4` |  `-1.7` | `-3.6%` |
| `08_create1k-after1k_x2` |    `4.9` |  `4.2` |  `-0.7` |  `-14%` |

The `07` win matches the per-call savings expectation: roughly `~150 ns` saved
per recompute × `~10000` row creations ≈ `1.5 ms`. Same shape on every other
bench: cost reduction scales with the number of object-returning recomputes.

All 1095 tests pass. Bundle: `97,458` (`+18` from kept-probes baseline
`97,440`).

Decision: **kept**. Same correctness as before (untrack still wraps both
property reads), broad reach (every render-effect / object-returning memo
benefits), and largest measured `07_create10k` script reduction in this
session at any cost.

Cumulative state of kept probes after this:

- Shared `dispose` for owner roots (prior session).
- Effect-shape: drop `_equals` closure + `staleValues` wrapper from `effect()`,
  move side-effects into `recompute()` (prior session).
- Dedicated `createEffectNode()` shape (prior session).
- **NEW:** Single `untrack` in `handleAsync`.

Remaining gap to Solid 1 (`44.9ms`) on `07_create10k` script: was `+2.3ms`
(prior kept-probes baseline `47.2`), now **`+0.5ms`** (`45.4`).

### `01_run1k` Hot-Path Attribution Probe (diagnostic only — reverted)

Goal: nail down where Solid 2 spends the `~0.9 ms` it loses to Solid 1 on
`01_run1k` (`3.8 → 4.7 ms` script), with the framing that the gap is
**fixed-cost**, not per-row:

- Per-row marginal cost is essentially identical:
  - Solid 1: `(45.3 − 3.8) / 9000 ≈ 4.61 μs/row`
  - Solid 2: `(45.4 − 4.7) / 9000 ≈ 4.52 μs/row`
- The `~0.9 ms` gap at 1k rows shrinks to `~0.5 ms` at 10k rows, confirming
  the gap is one-shot startup work (`render()` setup, `<For>` bootstrap,
  initial flush, etc.) that gets amortized as row count grows. So `01` is
  the cleanest signal we have for fixed-cost overhead, and any reduction
  there feeds straight into `07` and `08` too.

Setup:

- Instrumented `solid-signals` with gated counters on `createOwner`,
  `signal`, `computed`, `createEffectNode`, `recompute`, `runEffect`,
  `untrack`, `handleAsync`, `mapArray`, and `updateKeyedMap` (the
  per-pass body of `mapArray`). Each counter records `{ count, total
  (ms) }` with `try { … } finally { performance.now() } `; only
  recorded when `globalThis.__SOLID_PROBE__.enabled === true`.
- Probe driver (`documentation/probe-01-attribution.cjs`, removed after
  the run): for each sample, fresh page load → reset every counter
  in-place (mutate `count`/`total`, never replace bucket — the
  instrumented modules captured stable bucket references at module
  load) → enable probe → click `#run` → wait for the 1000th `<tr>` to
  populate → snapshot. 20 samples, median.

Findings (median over 20 samples):

| Probe site         | calls   | inclusive (ms) | per-call (μs) |
| ------------------ | ------: | -------------: | ------------: |
| `recompute`        | `1002`  |      `7.665`   |       `7.65`  |
| `mapArrayPass`     |    `1`  |      `5.490`   |          —    |
| `runEffect`        | `1001`  |      `1.235`   |       `1.23`  |
| `handleAsync`      | `1002`  |      `0.640`   |       `0.64`  |
| `createEffectNode` | `1000`  |      `0.255`   |       `0.26`  |
| `untrack`          | `1002`  |      `0.240`   |       `0.24`  |
| `createOwner`      | `1000`  |     `~0`       |     `<0.1`    |
| `signal`           | `2000`  |     `~0`       |     `<0.1`    |
| `computed`         |    `0`  |       `0`      |          —    |
| `mapArray` factory |    `0`  |       `0`      |          —    |

Notes on counts:

- `createOwner = 1000` → one owner per row (mapArray's per-row
  `runWithOwner(createOwner(), mapper)`).
- `createEffectNode = 1000` → one render-effect per row (the compiler
  emits one grouped render-effect per row template — the
  `_$effect(…, { e, t })` payload).
- `signal = 2000` → 1000 from `mapArray._rows[j] = signal(item, …)`
  + 1000 from the store proxy's lazy per-key signal creation when each
  row template reads `row.label` for the first time.
- `recompute = 1002` → `1000 row effects` + `1 outer wrapping
  render-effect` + `1 mapArray-internal computed`. Call tree:
  `recompute(outer-render-effect)` → reads `mapArray()` accessor →
  `recompute(mapArray-computed)` → `updateKeyedMap()` (= the
  `mapArrayPass` site) → 1000× `runWithOwner(createOwner(), mapper)`
  → row component compute fn → `effect()` → `createEffectNode` +
  `recompute(node, true)`.
- `runEffect = 1001` → `1000 row effects` + `1 outer effect` (DOM
  writes synchronously after each row's compute fn, since render
  effects don't enqueue when not deferred).
- `computed = 0` and `mapArray = 0` → the `<For>` was already mounted
  at page load, so its factory + outer `computed(updateKeyedMap)` ran
  before the counter reset.

Inclusive/self attribution (rough, after accounting for the call tree):

- `mapArrayPass = 5.49 ms` is the **top of the create-side stack**
  (everything inside the inner `recompute(mapArray-computed, …)`).
- Of that 5.49 ms, `~2.18 ms` is the sum of the 1000 row-effect
  `recompute(node, true)` calls (`recompute.total − mapArrayPass`
  approx, after subtracting the outer wrapping recompute's small
  inclusive); the rest (`~3.3 ms`) is per-row work *outside*
  `recompute`: `runWithOwner` setup, `createOwner`, `signal()`,
  the `mapper` closure, the row component fn, and the JSX
  template/DOM-creation calls (`_$template`, `_$insert`, `_$className`,
  …) emitted by `dom-expressions`.
- `runEffect = 1.235 ms` is the user-side cost of running the row
  template's `effect` arm (DOM writes via the compiler-emitted bindings).
  Per-row `~1.23 μs` — about half of which is `_$className` writing
  the `'danger'`-or-empty class on the `<tr>`.
- `handleAsync = 0.64 ms` (1002 calls × `0.64 μs`) is the runtime
  shape-check for thenable/async-iterator on every object-returning
  compute fn return value. The compiler can't elide this because it
  cannot prove a compute fn never returns a Promise, so this is the
  natural floor for the path. The previous "single-untrack in
  handleAsync" probe already brought this in: doubling it to ~`1.3 ms`
  pre-probe meant `~0.6 ms` of pure framework overhead per `01_run1k`.
- `untrack` and `handleAsync` matching 1:1 (`1002 each`) confirms the
  single-untrack landing — 1 untrack per object-returning compute fn,
  not 2.
- `createEffectNode`, `createOwner`, `signal` are sub-microsecond per
  call. 1000 owners + 1000 effect nodes + 2000 signals total to
  ~`0.5 ms` of node-allocation work.

What this probe **cannot** isolate (and where the `~0.9 ms` Solid 1 gap
likely lives):

- Per-row recompute self-time is measured but not split into
  framework-overhead vs. user compute fn (the JSX template body runs
  inside `_fn`, untimed).
- The 2 non-row recomputes (`outer render-effect` + `mapArray-internal
  computed`) are aggregated into the `1002`-count bucket, not separated.
  Each of those is the bigger fixed-cost site, but the probe only sees
  the aggregate.
- `<For>` setup work (the wrapping `createBoundary` + `createMemo` in
  `solid-js/client/flow.ts`) ran at page load, before the counter
  reset, so it didn't show up.

Wall time during the probe-on run was ~`74 ms` median (vs. `~37 ms`
total for `01_run1k` in the unprobed bench), confirming the probe adds
significant overhead (extra function call per instrumented site +
two `performance.now()` calls per probed entry). Use the **counts and
relative inclusive ratios** from this probe, **not** absolute timings.

Status: **reverted** — no source changes kept. Bundle back at
`97,458` after revert (matches the pre-probe size after the
single-untrack `handleAsync` probe).

Implication for next runtime probe (compile-time output is still on
the table — the constraint is just that **`handleAsync`'s shape check
cannot be compiled out**, since the compiler can't statically prove a
compute fn never returns a Promise/AsyncIterable):

- Reachable runtime fixed-cost candidates, in priority order:
  - **`<For>` boundary**: Solid 2's `<For>` wraps in `createBoundary`
    today (see `packages/solid/src/client/flow.ts`); inspect whether
    that boundary owner + its memo can be elided when the `<For>`
    is not inside a `<Suspense>` or `<ErrorBoundary>`.
  - **`render()` bootstrap**: count owner/computed allocations during
    `render()` itself (the App-level effects, not row-level). Any
    eager work that could be lazy.
  - **`mapArray` factory setup overhead**: the once-per-`<For>` setup
    is fast in absolute terms but is part of the fixed cost. Look at
    whether `data._owner._parentComputed = node` rewiring is necessary
    on every factory call.
  - **`runWithOwner` overhead** inside `mapArrayPass`: 1000× per row.
    Currently saves+restores `context`. Probably already minimal but
    worth a profile.

Reproduction instructions (so this can be re-run later without
re-deriving):

1. In `packages/solid-signals/src/`:
   - `core/core.ts`: at module top, install
     `globalThis.__SOLID_PROBE__ ||= { enabled: false }` and define
     `{ count, total }` buckets for `signal`, `computed`,
     `createEffectNode`, `recompute`, `untrack`. Wrap `recompute`,
     `computed`, `createEffectNode`, `untrack` with a thin
     `try/finally(performance.now())` (extract the body into a
     `*Inner` function to avoid `try` blocks around long bodies).
     `signal` only needs a `count` bump — it's too cheap to time.
   - `core/owner.ts`: install bucket for `createOwner`, increment
     `count` on entry.
   - `core/effect.ts`: install bucket for `runEffect`, wrap with
     try/finally.
   - `core/async.ts`: install bucket for `handleAsync`, wrap with
     try/finally.
   - `map.ts`: install buckets for `mapArray` (factory) and
     `mapArrayPass` (per-pass body of `updateKeyedMap`); bump
     factory count on entry; wrap the per-pass body with try/finally.
2. Build (`pnpm --filter @solidjs/signals build`) and rebuild the bench
   (`cd .../keyed/solid-next && npm run build-prod`).
3. Drive with a Playwright (`channel: "chrome"`) script:
   - Fresh page load per sample, wait for `#run` selector.
   - Reset counters by mutating `count`/`total` to `0` in-place, then
     `enabled = true`. **Do not replace bucket objects** — captured
     references in instrumented modules would be orphaned.
   - Click `#run`, wait for `tbody tr:nth-child(1000) a:nth-child(1)`
     to have non-empty textContent.
   - Snapshot, then `enabled = false`. Repeat 20×.
   - Report median of count + inclusive ms; per-call ≈ avg / count
     in μs.

### `flush(handler)` Wrapping Experiment (null result — handlers reverted)

Hypothesis: wrapping bench event handlers in `flush(() => …)` would force
the queue drain to happen synchronously inside the click frame instead of
deferring through `queueMicrotask(flush)`, and the eliminated microtask
hop would show up as a `script`-time win in js-framework-benchmark.

Implementation:

- Modified `frameworks/keyed/solid-next/src/main.jsx` to import `flush`
  from `solid-js` and wrap every handler (`run`, `runLots`, `add`,
  `update`, `clear`, `swapRows`, `setSelectedId`, `remove`) in
  `flush(() => ...)`.
- Current `flush(fn)` already buffers via `syncDepth++` and skips the
  microtask while inside, then drains once at `--syncDepth === 0`. So
  this single-handler shape already produces the "synchronous flush at
  end of handler" path; no scheduler changes were needed.

Comparison: 15 runs each via `webdriver-ts` Playwright runner, full
trace (`script` is total Chrome-tracing JS-execution time inside the
click→idle window).

| Bench                    | Baseline (median) | `flush(fn)` (median) |  Δ med |   Δ mean |
| ------------------------ | ----------------: | -------------------: | -----: | -------: |
| `01_run1k`               |     `4.9 ± 0.09`  |        `4.8 ± 0.10`  | `−0.10` | `−0.07` |
| `03_update10th1k_x16`    |     `2.1 ± 0.30`  |        `2.1 ± 0.19`  | ` 0.00` | `−0.01` |
| `07_create10k`           |    `46.5 ± 1.11`  |       `46.4 ± 0.45`  | `−0.10` | `−0.35` |
| `08_create1k-after1k_x2` |     `4.8 ± 0.13`  |        `4.8 ± 0.11`  | ` 0.00` | `−0.03` |

All deltas are within (or below) the per-bench stddev. **The microtask
hop is not a measurable cost in this bench.**

Why the null result is consistent:

- js-framework-benchmark's `script` metric is total V8 JS-execution time
  inside the click→idle window measured from Chrome tracing. Both the
  synchronous-handler path and the microtask-deferred path execute the
  same work *inside the same window*, so they produce identical script
  totals.
- The microtask hop's wall-time cost is sub-microsecond (V8's microtask
  infrastructure is heavily optimized; `queueMicrotask` → JS re-entry
  is `~1–10 μs`), well below the bench's `0.1 ms` reporting resolution.
- The work itself does not change: same `setSignal`, same scheduler
  notifications, same `recompute`/`runEffect` ordering. Only *when* the
  queue drains shifts, not *what* drains.

Implication for next probe: the gap to Solid 1 lives in the *work*
(creation, recompute body, DOM ops), not in scheduling. Don't chase
scheduler/microtask wins here.

Status: **reverted** — bench handlers restored to baseline form. The
architectural value of wrapping delegated event handlers in `flush()`
(synchronous reads after the handler returns, simpler reasoning) is
independent of this perf result and is a separate decision.

Reproduction (under one minute, one rebuild each):

1. Edit `frameworks/keyed/solid-next/src/main.jsx`: add `flush` to the
   `solid-js` import, wrap every handler body in `flush(() => …)`.
2. `cd frameworks/keyed/solid-next && npm run build-prod`.
3. Start `server/`. Run focused benches:
   `cd webdriver-ts && node dist/benchmarkRunner.js --headless
   --framework keyed/solid-next --benchmark 01_run1k 03_update10th1k_x16
   07_create10k 08_create1k-after1k_x2 --runner playwright`.
4. Save `webdriver-ts/results/`. Revert `main.jsx`. Rebuild. Re-run.
   Compare medians + means.

### `CONFIG_SYNC` Opt-In For Sync-Only Computeds & Effects (kept)

Goal: eliminate the `handleAsync` function frame + untrack overhead from
`recompute` for nodes whose `_fn` provably never returns
`PromiseLike` / `AsyncIterable`. The `01_run1k` attribution probe
identified `handleAsync` as accounting for `~0.49 ms` of real cost
(`1002 calls × ~0.49 μs/call`) — the largest single fixed-cost source
remaining in the `~0.9 ms` gap to Solid 1 on `01_run1k`.

The constraint is that the compiler **cannot statically prove** a JSX
expression / `_$effect` body never resolves to a Promise (compiler
doesn't infer narrow types of unsafe-eval'd bodies), but the
**caller of the compiled effect/memo** can: dom-expressions emits
`_$effect(fn, eff)` and `_$memo(fn)` whose function bodies are always
synchronous transforms over reactive reads. So this is an opt-in
contract enforced at the API surface, not at the type checker.

#### Upper-bound test (gating decision)

Before designing the opt-in, an upper-bound test verified the cost is
real. With `handleAsync` short-circuited unconditionally inside
`recompute` (sync path always taken, no function call to `handleAsync`
at all), 15 runs each:

| Bench                    | Baseline (mean) | Upper-bound (mean) |    Δ mean |
| ------------------------ | --------------: | -----------------: | --------: |
| `01_run1k`               |          `4.87` |             `4.31` | `−0.56`   |
| `03_update10th1k_x16`    |          `2.11` |             `2.38` | `+0.27` ¹ |
| `07_create10k`           |         `46.86` |            `46.18` | `−0.68`   |
| `08_create1k-after1k_x2` |          `4.80` |             `4.13` | `−0.67`   |

¹ `03_update10th1k_x16` regression is within stddev (`~0.3 ms`); the
update path doesn't allocate new computeds, so there's no surface for
the optimization to hit. Tracked but not actionable.

The `01` and `08` wins exceed the per-bench stddev by ≥2× and reproduce
across multiple sample sets — they are real, not noise. The upper
bound confirms that closing the `handleAsync` cost recovers the bulk
of the `01_run1k` gap to Solid 1 (`4.31` vs Solid 1's `~3.8 ms`).

#### Production form: `CONFIG_SYNC` config bit

Implementation (3 packages, 1 new bit, ~10 LOC):

1. **`packages/solid-signals/src/core/constants.ts`** — new bit:
   `CONFIG_SYNC = 1 << 6`. Documented as: "Marks a computed/effect
   whose `_fn` is guaranteed to return synchronous values only…
   compiler emissions opt in via `sync: true`; user-authored
   `createMemo` / `createEffect` keep full async-aware behavior
   unless they explicitly pass `sync: true`."
2. **`packages/solid-signals/src/core/types.ts`** — add
   `sync?: boolean` to internal `NodeOptions<T>`.
3. **`packages/solid-signals/src/signals.ts`** — add `sync?: boolean`
   to public `MemoOptions<T>` and `EffectOptions`. JSDoc warns:
   "Returning a Promise or async iterable from a `sync: true` node
   is undefined behavior — the value will be stored as-is and never
   awaited."
4. **`packages/solid-signals/src/core/core.ts`** — `computed()` and
   `createEffectNode()` OR `CONFIG_SYNC` into `_config` when
   `options?.sync`. `recompute()` gates the async-shape probe:

   ```ts
   if (el._config & CONFIG_SYNC) {
     value = el._fn(value);
     el._inFlight = null;
   } else {
     // existing handleAsync path with prevInFlight / inFlightChanged
     // tracking for self-registered async (e.g. createProjection)
   }
   ```

5. **`packages/solid-web/src/core.ts`** — the JSX-compiler-facing
   `effect` and `memo` wrappers default `sync: true`:

   ```ts
   const transparentOptions = { transparent: true, sync: true };
   const syncOptions = { sync: true };
   export const effect = (fn, effectFn, options) =>
     createRenderEffect(
       fn, effectFn,
       options ? { transparent: true, sync: true, ...options } : transparentOptions
     );
   export const memo = fn => createMemo(() => fn(), syncOptions);
   ```

   User-supplied `options` can still override (passing
   `{ sync: false }` reinstates the async-aware path).

#### Why a config bit instead of `EFFECT_RENDER`-only

An earlier variant gated only on `_type === EFFECT_RENDER`. That
captured `_$effect` (which uses `createRenderEffect`) but not `_$memo`
(which uses `createMemo`, type `EFFECT_PURE`). The compiler emits
roughly equal numbers of both, and both are sync by construction. The
config-bit form covers both call sites with a single mechanism and
leaves room for user-level opt-in (e.g. library code that knows its
compute is sync).

#### Results

15 runs each via `webdriver-ts` Playwright runner, full trace, focused
on the four CPU-bound benches.

| Bench                    | Baseline (median / mean) | `CONFIG_SYNC` (median / mean) | Δ mean   |
| ------------------------ | -----------------------: | ----------------------------: | -------: |
| `01_run1k`               |    `4.9 / 4.87 ± 0.22`   |     `4.30 / 4.25 ± 0.20`      | `−0.62`  |
| `03_update10th1k_x16`    |    `2.1 / 2.11 ± 0.30`   |     `2.10 / 2.10 ± 0.24`      | `−0.01`  |
| `07_create10k`           |   `46.5 / 46.86 ± 1.11`  |    `47.00 / 46.83 ± 0.99`     | `−0.03`  |
| `08_create1k-after1k_x2` |    `4.8 / 4.80 ± 0.13`   |     `3.90 / 4.00 ± 0.26`      | `−0.80`  |

`01` and `08` deliver clear wins (≥2× stddev). `03` and `07` are
within noise — `03`'s update path doesn't surface the optimization,
and `07` has high run-to-run variance that swamps the per-call savings
when most of the bench time is DOM construction outside `recompute`.

Cumulative effect on `01_run1k` over the recent series of probes:

| Phase                                                |  median (ms) | Δ vs Solid 1 (`~3.8`) |
| ---------------------------------------------------- | -----------: | --------------------: |
| pre-probes baseline                                  |       `~5.0` |              `+1.2`   |
| dedicated `createEffectNode()` shape (kept)          |       `~4.9` |              `+1.1`   |
| single-untrack `handleAsync` (kept)                  |       `~4.9` |              `+1.1` ¹ |
| `CONFIG_SYNC` opt-in (kept) — this experiment        |       `4.30` |              `+0.5`   |

¹ The single-untrack `handleAsync` probe was net-positive on `07` /
`08` even though `01` didn't move much; logged as kept on its own
merits.

#### Validation

- **Unit tests:** all `686` solid-signals tests + all `409` solid-js
  tests pass (covers Suspense / loading boundaries / async memos /
  hydration / SSR-async).
- **Async-aware paths preserved:** `createMemo(async () => …)`,
  `createMemo(() => fetch(...))`, `createAsync`, `createProjection`'s
  self-registered `handleAsync` calls — all unchanged. The gate is
  opt-in; nothing async-aware passes `sync: true`.
- **Compiler-emit safety:** dom-expressions' `_$insert` /
  `_$spread` / `_$style` / `_$classList` / `_$memo` invoke the
  `effect` / `memo` wrappers in `solid-web`. None of these emit
  bodies that return raw Promises — they consume Promises via
  `flatten` / `normalize` *before* the value reaches the
  render-effect's reactivity layer. JSX expression children that
  resolve to Promises are still handled correctly by upstream
  computeds gated by `<Loading>` / `<Suspense>`.

Status: **kept**. The `~0.6 ms` mean win on `01_run1k` closes most of
the gap to Solid 1 on creation-heavy benches without touching any
public-facing async semantics.

Reproduction (clean re-run from a baseline commit):

1. Build: `pnpm --filter @solidjs/signals build && pnpm --filter
   @solidjs/web build`.
2. Bench rebuild: `cd .../keyed/solid-next && npm run build-prod`.
3. `cd webdriver-ts && node dist/benchmarkRunner.js --headless
   --framework keyed/solid-next --benchmark 01_run1k 03_update10th1k_x16
   07_create10k 08_create1k-after1k_x2 --runner playwright`.
4. Aggregate medians/means/stddev from `results/solid-next-…json`.

### Post-`CONFIG_SYNC` Full CPU Snapshot (2026-05-05)

A full nine-bench CPU comparison across vanilla / Solid 1.9.12 / Solid
2 (post-`CONFIG_SYNC`) / Svelte 5.13 / React Hooks 19. 15 runs each
via `webdriver-ts` Playwright runner, median (± stddev) and mean of
the `script` metric (V8 JS-execution time inside the click→idle
window from Chrome tracing).

| Bench                    |  vanilla       |  solid 1       |  solid 2       |  svelte 5      |  react        |
| ------------------------ | -------------: | -------------: | -------------: | -------------: | ------------: |
| `01_run1k`               | `2.20 ± 0.08`  | `3.90 ± 0.21`  | `4.30 ± 0.20`  | `3.70 ± 0.23`  | `11.50 ± 0.71` |
| `02_replace1k`           | `5.60 ± 0.40`  | `8.00 ± 0.43`  | `7.80 ± 0.49`  | `7.70 ± 0.09`  | `16.90 ± 0.86` |
| `03_update10th1k_x16`    | `0.80 ± 0.30`  | `1.80 ± 0.30`  | `2.10 ± 0.28`  | `1.70 ± 0.35`  | `5.00 ± 0.68`  |
| `04_select1k`            | `0.10 ± 0.27`  | `0.50 ± 0.34`  | `0.90 ± 0.28`  | `0.90 ± 0.26`  | `2.10 ± 0.32`  |
| `05_swap1k`              | `0.10 ± 0.36`  | `1.30 ± 0.41`  | `1.90 ± 0.27`  | `1.40 ± 0.26`  | `25.40 ± 0.71` |
| `06_remove-one-1k`       | `0.30 ± 0.14`  | `0.60 ± 0.06`  | `0.60 ± 0.06`  | `0.60 ± 0.08`  | `1.50 ± 0.20`  |
| `07_create10k`           | `29.0 ± 1.27`  | `43.2 ± 0.51`  | `46.2 ± 1.24`  | `41.0 ± 1.20`  | `226.6 ± 1.20` |
| `08_create1k-after1k_x2` | `2.80 ± 0.12`  | `4.00 ± 0.14`  | `4.10 ± 0.38`  | `3.90 ± 0.19`  | `9.00 ± 0.75`  |
| `09_clear1k_x8`          | `11.6 ± 0.32`  | `15.1 ± 0.41`  | `14.2 ± 0.61`  | `14.0 ± 0.55`  | `21.8 ± 3.49`  |

`total` (full click→idle wall time, includes paint) for the same runs:

| Bench                    | vanilla |  solid 1 |  solid 2 | svelte 5 |   react |
| ------------------------ | ------: | -------: | -------: | -------: | ------: |
| `01_run1k`               |  `33.0` |   `35.5` |   `35.2` |   `35.4` |  `42.1` |
| `02_replace1k`           |  `40.0` |   `40.1` |   `40.1` |   `40.6` |  `50.5` |
| `03_update10th1k_x16`    |  `18.3` |   `19.8` |   `20.4` |   `19.6` |  `22.8` |
| `04_select1k`            |   `4.3` |    `4.7` |    `5.3` |    `4.9` |   `7.6` |
| `05_swap1k`              |  `20.6` |   `22.2` |   `23.0` |   `21.9` | `144.5` |
| `06_remove-one-1k`       |  `15.6` |   `16.7` |   `16.6` |   `16.4` |  `18.4` |
| `07_create10k`           | `326.4` |  `349.8` |  `353.9` |  `344.0` | `542.7` |
| `08_create1k-after1k_x2` |  `40.0` |   `40.6` |   `39.8` |   `39.7` |  `44.5` |
| `09_clear1k_x8`          |  `15.0` |   `17.2` |   `16.2` |   `16.4` |  `24.4` |

#### Solid 2 vs Solid 1 — gaps after this session

| Bench                    | Solid 1 (med) | Solid 2 (med) | gap   | gap %  |
| ------------------------ | ------------: | ------------: | ----: | -----: |
| `01_run1k`               |        `3.90` |        `4.30` | `+0.40` | `+10%` |
| `02_replace1k`           |        `8.00` |        `7.80` | `−0.20` | `−2%`  |
| `03_update10th1k_x16`    |        `1.80` |        `2.10` | `+0.30` | `+17%` |
| `04_select1k`            |        `0.50` |        `0.90` | `+0.40` | `+80%` |
| `05_swap1k`              |        `1.30` |        `1.90` | `+0.60` | `+46%` |
| `06_remove-one-1k`       |        `0.60` |        `0.60` |  `0.00` |   `0%` |
| `07_create10k`           |       `43.20` |       `46.20` | `+3.00` |  `+7%` |
| `08_create1k-after1k_x2` |        `4.00` |        `4.10` | `+0.10` |  `+3%` |
| `09_clear1k_x8`          |       `15.10` |       `14.20` | `−0.90` |  `−6%` |

Wins: `02_replace1k` (`−0.2`), `09_clear1k_x8` (`−0.9`).
Even: `06_remove-one-1k`, `08_create1k-after1k_x2`.
Largest remaining absolute gap: `07_create10k` (`+3.0 ms`, `+7%`) —
the 10× row count exposes per-row create cost that Solid 1's slimmer
graph still wins. Next probe target.
Largest remaining relative gaps: `04_select1k` and `05_swap1k`. Both
are sub-2 ms benches with high stddev relative to the gap; investigate
whether the gap is real (per-row setup of the singleton "selected"
class binding, swap-driven re-tracking) before chasing.

#### Solid 2 vs Svelte 5

| Bench                    | Svelte 5 | Solid 2 | Δ      |
| ------------------------ | -------: | ------: | -----: |
| `01_run1k`               |   `3.70` |  `4.30` | `+0.6` |
| `02_replace1k`           |   `7.70` |  `7.80` | `+0.1` |
| `03_update10th1k_x16`    |   `1.70` |  `2.10` | `+0.4` |
| `04_select1k`            |   `0.90` |  `0.90` |   `0`  |
| `05_swap1k`              |   `1.40` |  `1.90` | `+0.5` |
| `06_remove-one-1k`       |   `0.60` |  `0.60` |   `0`  |
| `07_create10k`           |  `41.00` | `46.20` | `+5.2` |
| `08_create1k-after1k_x2` |   `3.90` |  `4.10` | `+0.2` |
| `09_clear1k_x8`          |  `14.00` | `14.20` | `+0.2` |

Svelte 5 leads on creation (`01`, `07`) and update (`03`); Solid 2 is
within ~0.2 ms on the rest (`02`, `04`, `06`, `08`, `09`). The Svelte
update advantage on `03` is interesting: Svelte's compiled-out
reactivity does no `recompute` work for the unchanged 90% of rows.
Solid's per-row tracking is what costs.

#### Where to look next

Priority ordered by absolute Solid-2-minus-Solid-1 gap × bench
relevance:

1. **`07_create10k` per-row cost (`+3.0 ms`).** Now the dominant
   remaining gap. With `handleAsync` largely amortized, the next
   biggest sites in the recompute attribution probe were the
   `mapArrayPass` body itself (`5.5 ms` for 1 call → 1000 rows) and
   the per-row computed setup. Look at:
   - Per-row owner allocation cost (was `0.5 ms` aggregate at 1000
     rows; at 10× it's `~5 ms`).
   - JSX template render-effect setup (the `_$insert` per row).
   - Array tracking shape inside `mapArray` (the
     "`updateKeyedMap` self-time" was the biggest non-`recompute`
     site in the probe).
2. **`03_update10th1k_x16` (`+0.3 ms`) and `01_run1k` (`+0.4 ms`).**
   Both within "fixed cost per pass" territory. Worth one more
   round of `recompute` body audits looking for ungated work, then
   accepting the gap if attribution doesn't surface a clear lever.
3. **`05_swap1k` (`+0.6 ms`).** Investigate whether the swap path
   re-renders anything that doesn't need to. Solid 1's `<For>`
   handles swaps via direct DOM moves; check the corresponding
   path in 2.0's `mapArray`.

Snapshot frozen with: dedicated `createEffectNode()` shape (kept) +
single-untrack `handleAsync` (kept) + `CONFIG_SYNC` opt-in (kept).

### Correctness Follow-Ups (kept)

Two correctness fixes layered on top of the `CONFIG_SYNC` work, neither
of which changes production hot-path code:

#### 1. Dev diagnostic: `SYNC_NODE_RECEIVED_ASYNC`

The `CONFIG_SYNC` opt-in turns the production fast path into "evaluate
`_fn`, store the result as-is". If a `sync: true` node accidentally
returns a `Promise` / `AsyncIterable`, that value would be silently
stored unwrapped — the exact mistake the option is meant to surface
loudly, not paper over.

The diagnostic lives in `handleAsync`, not in `recompute`, so there's a
single source of truth for async-shape detection:

- **Production:** `recompute` skips the `handleAsync` call entirely
  for `CONFIG_SYNC` nodes (`if (!__DEV__ && el._config & CONFIG_SYNC)`).
  Zero added overhead.
- **Dev:** the `__DEV__` guard collapses, so `CONFIG_SYNC` nodes flow
  through the full `handleAsync` path. The early return there handles
  sync values identically to non-sync nodes; the only branch that
  changes behavior is the one that *would* have entered the async
  bookkeeping path. At that point we emit:

  ```
  [SYNC_NODE_RECEIVED_ASYNC] A computed/effect created with `sync: true`
  returned a Promise (or AsyncIterable). The value would be stored as-is
  and never awaited in production; remove `sync: true` to use async-aware
  behavior, or unwrap the value before returning.
  ```

  …and `throw new Error(message)` so the violation surfaces at the
  recompute site rather than as a delayed pending state.

Files touched:

- `packages/solid-signals/src/core/core.ts` — `recompute` gate becomes
  `!__DEV__ && el._config & CONFIG_SYNC`.
- `packages/solid-signals/src/core/async.ts` — imports `CONFIG_SYNC`
  and `emitDiagnostic`; checks the flag right after the
  `!isThenable && !iterator` early return; emits + throws.

Test coverage (`tests/diagnostics.test.ts`):

- `sync: true` memo returning `Promise.resolve(1)` → throws
  `SYNC_NODE_RECEIVED_ASYNC` with `kind: lifecycle`, `severity: error`.
- `sync: true` memo returning an `AsyncIterable` (`async function*`) →
  same diagnostic, message variant.
- `sync: true` memo returning a plain object (no `then`, no
  `[Symbol.asyncIterator]`) → no diagnostic; flows through as-is.

#### 2. `flush(fn)` shape: drain at every level

The previous implementation incremented a `syncDepth` counter for the
duration of `fn` and only drained once the *outermost* `flush(fn)`
exited. Nested `flush(fn)` calls were silently held — the inner
callback ran, returned, and any writes inside it sat on the queue
until the outer flush completed.

That's surprising: the contract of `flush(fn)` is "fn runs, then the
queue is drained synchronously". A nested call should honor that
contract for its own writes, not defer them to a parent scope.

The fix is a small reorder in `flush(fn)`:

```ts
// before
syncDepth++;
try { return fn(); }
finally { if (--syncDepth === 0) flush(); }

// after
syncDepth++;
try { return fn(); }
finally { flush(); syncDepth--; }
```

Now every `flush(fn)` call drains at its own boundary. `syncDepth` is
still elevated during the drain, so writes inside effect bodies stay
on the suppressed-microtask path and are picked up by the running
drain loop instead of scheduling a redundant microtask. The outer
`flush(fn)`'s drain finds an empty queue and is a no-op.

Behavior change:

- `flush(() => { setX(20); flush(() => setY(30)); })` — the inner
  `flush` now *does* drain, so an effect tracking both signals fires
  once at the inner boundary with `[20, 30]` rather than once at the
  outer boundary.
- Top-level (non-nested) `flush(fn)` is unchanged.
- Microtask scheduling and arg-less `flush()` are unchanged.

Test update (`tests/flush.test.ts`): `should only flush after the
outermost callback` renamed to `nested flush(fn) drains at each
level`; the inner-boundary expectation flipped from "still 1 call" to
"already 2 calls".

The full suite (`689` solid-signals tests + `409` solid-js tests
including SSR-async, hydration, loading boundaries, suspense) passes
with both correctness fixes.

#### Update to `js-reactivity-benchmark`'s `solid-next` harness

The previous harness relied on the old "outermost-only" `flush(fn)`
behavior to make `withBatch` coalesce a sequence of `signal.write`
calls into a single propagation pass:

```ts
// previous shape — depended on flush(fn) holding nested calls
signal: (v) => ({ write: v => flush(() => set(v)), read: s }),
withBatch: flush,
withBuild: fn => createRoot(d => { cleanup = d; return flush(fn); }),
```

Under the old semantics, a `withBatch(() => { write(1); write(2); })`
nested two `flush(fn)` calls inside an outer `flush(fn)`, the inner
ones held by `syncDepth`, and the outer one performed the single
drain at the end. With the new "drain-at-every-level" semantics, each
inner `write` would drain on its own — producing two effect runs
instead of the intended one and breaking batch semantics for the
benchmark.

A first attempt at the harness fix used a plain `batchDepth` counter
without wrapping in `flush(fn)`:

```ts
// first attempt — correct but slow
write: v => { set(v); if (batchDepth === 0) flush(); },
withBatch: fn => {
  batchDepth++;
  try { fn(); }
  finally { batchDepth--; if (batchDepth === 0) flush(); }
},
```

Correct semantics, but each `set(v)` inside `withBatch` ran with
`syncDepth === 0`, so the scheduler scheduled a `queueMicrotask(flush)`
once per batch. The trailing manual `flush()` drained synchronously,
leaving the microtask to fire later as a no-op. On `update1to1`
(`COUNT * 4` iterations of `withBatch(() => set(i))`) that was a
measurable per-iteration overhead (`+84 %` on a single sample, though
median across 3 runs settled at `−2 %`).

Final shape — depth counter for nesting + `flush(fn)` wrap on the
outermost batch and top-level write to keep `syncDepth > 0` during
the work:

```ts
let batchDepth = 0;

write: v => {
  if (batchDepth === 0) flush(() => set(v));
  else set(v);
},
withBatch: fn => {
  batchDepth++;
  try {
    if (batchDepth === 1) flush(fn);   // outermost wraps in flush(fn)
    else fn();                          // nested just runs
  } finally { batchDepth--; }
},
withBuild: fn => createRoot(dispose => {
  framework.cleanup = dispose;
  const out = fn();
  if (batchDepth === 0) flush();
  return out;
}),
```

Now non-nested `write` and `withBatch` paths behave identically to
the previous harness (single synchronous drain, no microtask),
nested `withBatch` calls don't drain prematurely, and the harness's
batch contract is independent of `flush(fn)`'s internal shape.

#### A/B benchmark of the flush(fn) + harness change

`js-reactivity-benchmark` total comparison, median across 3 baseline
runs (old `flush(fn)` + old harness) and 4 final runs (new
`flush(fn)` + new harness, run on Node):

| Test                          | Baseline (med ms) | Final (med ms) |    Δ ms |    Δ % |
| ----------------------------- | ----------------: | -------------: | ------: | -----: |
| `updateSignals` (sum 7 tests) |          `615.50` |       `612.96` |  `−2.54`| `−0.4` |
| `update1to1`                  |           `43.84` |        `42.80` |  `−1.04`| `−2.4` |
| `update1to1000`               |          `485.42` |       `484.24` |  `−1.18`| `−0.2` |
| `avoidablePropagation`        |          `175.08` |       `170.85` |  `−4.23`| `−2.4` |
| `broadPropagation`            |          `249.12` |       `247.24` |  `−1.88`| `−0.8` |
| `diamond`                     |          `201.60` |       `201.72` |   `0.12`| ` 0.1` |
| `4-1000x12 - dyn5%`           |          `604.05` |       `616.45` | `+12.40`| `+2.1` |
| `25-1000x5`                   |          `687.49` |       `680.94` |  `−6.55`| `−1.0` |
| **TOTAL (34 tests)**          |        `4231.04`  |     `4226.26`  |  `−4.78`| `−0.1` |

Wider-spread per-test deltas are sub-10ms benches with high relative
noise (`create2to1` `+17 %` on a `7.79 → 9.15 ms` swing, `create1to2`
`−36 %` on `17.22 → 11.07 ms`). Update / kairo / reactively-dynamic
tests are all within `±3 %`. **The flush(fn) shape change + harness
update is a wash for JSRB performance**; the harness fix is purely
about preserving batch semantics under the new flush behavior.

Other JSRB harnesses with depth-gated `batch` primitives (`r3`,
`r3-solid-target`) follow the same pattern; ours now matches them.

#### `CONFIG_SYNC` is also neutral for JSRB

Tested adding `sync: true` to the harness's `computed` / `effect`
factories (with the option object hoisted to module scope to avoid
per-call allocation). Median across 3 runs vs the no-sync harness:
**−17.95 ms total (−0.4 %)** — within noise. Per-test deltas all
≤±3 % on bench groupings (sBench update, kairo, reactively-dynamic).

Why the no-op? The `CONFIG_SYNC` fast path's value comes from
skipping the `typeof result === "object" && result !== null` probe
+ `handleAsync` frame when the compute fn returns an *object*
(Promise, DOM node, etc.). All JSRB tests return numeric primitives,
which the existing `!isAsyncResult` early-bail in `recompute`
already handles without calling `handleAsync`. There's nothing for
the sync gate to skip.

This is exactly why `CONFIG_SYNC` paid off in
`js-framework-benchmark` (`_$insert` returns DOM nodes — `typeof ==
"object"` — so the gated path actually fired) and is a no-op in
JSRB. Status: not adopted in the JSRB harness; reverted to the
default `createMemo(fn)` shape.

### `02_replace1k` Phase Attribution After Leak Fix (2026-05-05)

Goal: confirm/deny whether the +0.9–1.2 ms `script` median that appeared
on `02_replace1k` after rebasing onto the memory-leak fix
(`47c0e6fa`) is actually concentrated in the new code paths
(`disposeChildren` splice block, `_prevSibling` field on `Owner`).

#### Method

Phase-instrumented `disposeChildren` (`self`-scoped wall time),
`createOwner`, `computed`, and `createEffectNode` with global
`__SOLID_PROBE__` counters (`probe-02-phase.cjs`). Built the JFB
`solid-next` bundle in production shape (terser-mangled,
`process.env.production`) for both:

- **before-leak-fix** — the splice block, the `_prevSibling` field on
  the `Owner` literal, and the `lastChild._prevSibling = self/owner`
  write all reverted; everything else (`CONFIG_SYNC`, manual-write,
  refresh-trigger, `flush(fn)` drain, etc.) kept.
- **after-leak-fix** — current `next` shape (commit 47c0e6fa applied).

Ran 5 rounds × 30 measured `#run` clicks each (5-click warmup before
each round, fresh page per round, probe reset after warmup).
Sampling-style `Profiler.start/stop` was tried first but the
splice-block delta was hidden inside V8 sampling noise; the phase
counters give deterministic per-call totals.

#### Results

| Phase                  | Before (μs/iter, median) | After (μs/iter, median) |    Δ μs/iter |
| ---------------------- | -----------------------: | ----------------------: | -----------: |
| `disposeChildren` (top-level) | `683.5`           | `675.3`                 |  `−8.2`      |
| `createOwner`          | `169.3`                  | `168.7`                 |  `−0.6`      |
| `createEffectNode`     | `303.7`                  | `301.3`                 |  `−2.4`      |
| `computed`             | `0.0` (none called)      | `0.0` (none called)     |  `0.0`       |

Across 30 iters the leak fix's added work nets out to **≈ −10 μs/iter**
total — pure noise. The `disposeChildren` splice block and gate
evaluation runs on every `self`-true dispose call (1k taken + 1k
skipped per replace), but the per-call cost is ≈140 ns, and the
removed `flags`-read fold/share between the early-bail and write paths
takes the difference back. No measurable impact on the per-row create
allocations (`_prevSibling: null` on the literal and the
`lastChild._prevSibling = self` write are absorbed into V8's
allocate-and-store sequence with zero observed delta).

#### Cross-check

Re-ran `02_replace1k` through `js-framework-benchmark` (15 runs,
Playwright, `solid-next-v2.0.0-beta.10-keyed`):

- script: median `9.0 ms`, mean `8.91 ± 0.21 ms`.
- Prior `Post-CONFIG_SYNC` snapshot: mean `7.80 ± 0.49 ms`.
- Δ ≈ +1.1 ms median, which the JFB bench reports as a regression.

The phase probe makes it clear: **the `+1.1 ms` does not come from
the leak fix.** Whatever caused the `02_replace1k` script delta
between the CONFIG_SYNC snapshot and the current `next` baseline
is somewhere else in the rebased changes.

Candidate sites to attribute next:

1. `mapArray` / `updateKeyedMap` reconcile — the rebased commits
   touched several iteration shapes; this is the most-called function
   on `02`.
2. `recompute` body or its callers (`scheduler.run`, `runEffect`) —
   `7d4d0c3a perf(signals): optimize synchronous scheduler paths`
   reshaped this and might have hidden a per-call deopt.
3. `runWithOwner` — appeared in the sampling profile at `~2.7 ms`
   self over 30 iters; not changed by the leak fix but might be
   hotter now if upstream call shape changed.
4. Bisect the commits since the CONFIG_SYNC snapshot
   (`7d4d0c3a`, `005c9fbe`, `2a7c6a50`, `263be3f8`, `b0db6c90`,
   `47c0e6fa`) — the leak fix is now confirmed clean, the rest is
   open.

#### Files

- `documentation/probe-02-phase.cjs` — kept (deterministic
  phase-counter probe, reusable for future attribution passes).
- `documentation/probe-02-attribution.cjs` — kept (sampling-profile
  probe; useful for top-level frame attribution, but underestimates
  micro-phase deltas at this benchmark scale).

### Memory Suite After Leak Fix (2026-05-05)

Re-ran the JFB memory suite for `solid-next` after the
`47c0e6fa fix(signals): splice individually-disposed owners out of
parent chain` commit landed. Headless Chromium, `--count 10`,
Playwright runner, median values.

| Benchmark              | Baseline (post-keep, 10×) | Post-leak-fix (10×) |    Δ MB |     Δ % |
| ---------------------- | -----------------------: | ------------------: | ------: | ------: |
| `21_ready-memory`      |                  `1.008` |             `1.012` | `+0.004` | `+0.4%` |
| `22_run-memory`        |                  `3.193` |             `3.200` | `+0.007` | `+0.2%` |
| `23_update5-memory`    |                  `3.309` |             `3.225` | `−0.084` | `−2.5%` |
| `25_run-clear-memory`  |                  `1.499` |             `1.398` | `−0.101` | `−6.7%` |
| `26_run-10k-memory`    |                     (n/a) |            `20.446` |       — |       — |

Stddev (post-fix run, 10 samples):

- `21_ready-memory`: `0.013 MB`
- `22_run-memory`: `0.013 MB`
- `23_update5-memory`: `0.055 MB`
- `25_run-clear-memory`: `0.114 MB`
- `26_run-10k-memory`: `0.037 MB`

Notes:

- `25_run-clear-memory` `−0.101 MB` is within ~1σ on this bench
  (stddev `0.114 MB`); median direction is consistent with a small
  improvement but the per-sample variance hides the magnitude.
- The leak fix's splice path is gated on individual dispose
  (`!(node._parent._flags & REACTIVE_DISPOSED)`), so a batch dispose
  triggered by `setData([])` (clear path) does **not** exercise the
  fix. Children flow through the parent's wholesale teardown and
  inherit the same teardown outcome they had before the fix. The
  numbers above therefore are not the leak fix's primary impact site.
- The pattern that would directly stress the fix is repeated
  full-array replacement (`02_replace1k`-style) under memory
  measurement. `24_run5-memory` (5 cycles of `#run`) is the
  matching standard JFB benchmark, but it is commented out in
  `webdriver-ts/src/benchmarksCommon.ts`. Re-enabling it locally
  would give a direct read.
- `21_ready-memory` and `22_run-memory` are single-cycle — no row
  disposal — so they're expected to be insensitive to the fix. The
  observed deltas (`+0.004`, `+0.007 MB`) are noise.

### `02_replace1k` Cost Attribution (2026-05-05)

Goal: stop guessing why Solid 2's `02_replace1k` script time is what
it is. Capture deterministic CPU profiles of `solid-next` and
`keyed/solid` (1.9.12) under identical conditions and compare per-frame
self-time.

#### Method

- Built both JFB framework bundles **without** terser
  (`production` env unset) so symbol names survive into the V8
  profile. The underlying `dist/prod.js` of `@solidjs/signals` is
  already built with `keep_fnames: true`, so the only mangling
  layer was the JFB framework's own terser pass.
- Custom Playwright + CDP probe (`probe-02-attribution.cjs`):
  warmup 10 clicks, GC, `Profiler.start` → 60 replace iterations →
  `Profiler.stop`. 10 µs sampling interval. Parent-walk
  reconstruction of self/inclusive time, dumped both
  `*.cpuprofile.json` and a flat-by-self-time summary.
- Total profile time: 4032 ms (Solid 2) vs 4093 ms (Solid 1) over
  60 iters, i.e. Solid 2 was actually a hair *faster* in wall
  clock for this probe. The JFB script-time gap (Solid 2 9.10 ms vs
  Solid 1 7.80 ms) is therefore mostly inside V8 ScriptExecute
  events the sampling profile doesn't isolate, plus run-to-run
  variance.

#### What dominates the 9.10 ms

DOM API self-time (browser-internal, identical between Solid 1 and
Solid 2 — they share `dom-expressions`):

| frame                | self ms/iter |  calls/iter | what it is                                    |
| -------------------- | -----------: | ----------: | --------------------------------------------- |
| `remove`             |       `3.93` |      `1000` | `reconcileArrays` per-row `removeChild`       |
| `cloneNode`          |       `0.92` |      `1000` | template clone for each new row               |
| `insertBefore`       |       `0.75` |      `1000` | mount each new row                            |
| attribute/text/event |     `~0.3-0.5` |   per-row | `setAttribute`, `data` writes, click bindings |

That is `~5.5 ms` of inherent DOM cost — not optimizable in any
framework using a per-row reconciler.

Framework JS, top frames per iter (Solid 2):

| frame                                 | self μs/iter |
| ------------------------------------- | -----------: |
| row factory closure (`main.js:2987`)  |        `550` |
| inner effect compute closures         |        `210` |
| `runWithOwner` (1000 per-row calls)   |        `111` |
| `mapArray` reconcile body lambda      |        `115` |
| `recompute`                           |         `45` |
| `disposeChildren`                     |         `35` |
| `createOwner`                         |         `21` |
| `read`                                |         `20` |
| `createEffectNode`                    |         `13` |
| `flush` + `commitPendingNodes`        |         `12` |

Sum of named framework frames: `~1.05 ms/iter`. The remaining
`~2.5 ms/iter` of JS is in the long tail (anonymous closures,
accessor wrappers, GC bursts) and the V8 engine overhead inside
script-execution events.

#### Per-frame Solid 1 vs Solid 2 (μs/iter)

| sub-area                           | Solid 1 (μs/iter)                          | Solid 2 (μs/iter)                                  |       Δ |
| ---------------------------------- | -----------------------------------------: | -------------------------------------------------: | ------: |
| Per-row scope wrap                 | `49.7` (createRoot + runUpdates)           | `111.2` (runWithOwner)                             | `+61.5` |
| Owner alloc                        | `0` (folded into createRoot)               | `20.6` (createOwner)                               | `+20.6` |
| Effect setup + initial recompute   | `32.4`                                     | `89.3` (recompute + effect + createEffectNode + runEffect) | `+56.9` |
| Read primitive                     | `19.3` (readSignal)                        | `20.0` (read)                                      |  `+0.7` |
| Dispose                            | `78.0` (cleanNode)                         | `34.4` (disposeChildren)                           | `−43.6` |
| `untrack`                          | `62.4`                                     | `0.7`                                              | `−61.7` |
| **Store traps `selected[rowId]`**  | **`0`**                                    | **`160.6`** (getNode `85` + unobserved `75.6`)     | `+160.6` |
| `reconcileArrays`                  | `136.6`                                    | `134.7`                                            |  same   |

Net: Solid 2 is `+~190 μs/iter` heavier in attributed framework JS.
Solid 1 wins on dispose and untrack (the new core inherited those
improvements going the other way); Solid 2 and Solid 1 are within
noise on most of the rest.

#### The decisive structural cost

The single biggest signed difference is `+160 μs/iter` in store-proxy
machinery. The JFB Solid 2 entry source (`frameworks/keyed/solid-next/src/main.jsx`)
declares:

```js
const [selected, setSelected] = createStore({ selected: null });
// later, inside the row template:
<tr class={selected[rowId] ? "danger" : ""}>
```

Each row reads `selected[rowId]` on first render. Because `rowId` is
not yet a key on the store, the proxy's `get` trap falls into the
missing-property fast path — which lazily creates a per-key tracking
node so a subsequent `setSelected(s => s[rowId] = true)` can re-run
the effect. With 1000 distinct rowIds per click:

- `getNode` `~85 μs/iter` = 1000 new keys × `~85 ns` per node create.
- `unobserved` `~75 μs/iter` = the symmetric teardown when the
  effect's `_deps` are unlinked on row dispose; the per-key node
  loses its only observer and gets cleaned up.

Solid 1's source uses `createSignal(null)` and tests
`selected() === rowId` — one signal read shared by all 1000 effects,
zero per-key node allocations, zero per-key teardown. So Solid 1
pays nothing for this read. The `~160 μs/iter` is real and structural.

The remaining `~30 μs/iter` of attributed framework delta is in
small per-frame asymmetries (per-row `runWithOwner` vs createRoot,
effect setup shape) that net out within noise across multiple runs.

#### Conclusions

- The 9.10 ms is `~5.5 ms` inherent DOM (shared with every framework
  using `reconcileArrays`) + `~3.5 ms` framework JS spread thin.
- The largest single Solid-2-vs-Solid-1 delta is the store-proxy
  per-key tracking pattern in the benchmark source, not anything in
  Solid 2's reactive core.
- This is not a bug. The store's lazy missing-key tracking is what
  makes `setSelected(s => (s[id] = true))` correctly re-run any
  effect that previously read `s[id]`. Eliminating the cost would
  require either changing the benchmark code (use a signal) or
  adding a "no-tracking" read variant on stores (out of scope here).
- Useful to record because it explains why we cannot close the gap
  inside the runtime: the cost is dictated by the application
  pattern, not Solid 2's overhead.

#### Files

Probe scripts (`documentation/probe-02-attribution.cjs`,
`probe-02-phase.cjs`) and intermediate `*.cpuprofile.json` outputs
were removed after this writeup; the JFB framework bundles were
restored to mangled production builds.

### dom-expressions PR #382 (`moved` Set fix) Performance Evaluation (2026-05-05)

Goal: assess whether the proposed `cleanChildren` fix in
[dom-expressions PR #382](https://github.com/ryansolid/dom-expressions/pull/382)
("handle moving nodes") introduces measurable JFB CPU regressions.

#### What the patch does

Adds tracking of nodes that were previously inserted via
`cleanChildren` so a subsequent `cleanChildren` on the *prior* parent
does not yank the node back out of its new home. Specifically:

- Module-level `const moved = new Set(); let scheduled = false;`
- On entry to `cleanChildren`: if `moved.size > 0` and no microtask
  is queued, schedule one to clear the set on the next tick.
- When replacing the first existing slot, if the incoming
  `replacement` already has a `parentNode`, add it to `moved`. Use
  `insertBefore` instead of `replaceChild` whenever the existing
  `el` is in `moved` (i.e. it has been re-parented and we should
  not remove it).

Fixes the symptom in
[solid#2357](https://github.com/solidjs/solid/issues/2357) where
moving a JSX child between two `<Show>` branches discarded it.

The locally installed `dom-expressions@0.50.0-next.6` had already
commented out the `parent = (multi && current[0] && current[0].parentNode) || parent`
retarget line that PR #382 also removes — so only the `moved` Set
+ microtask scheduling part needed porting to the current shape of
`cleanChildren`.

#### Method

- Patch applied directly to
  `node_modules/.pnpm/dom-expressions@0.50.0-next.6.../node_modules/dom-expressions/src/client.js`.
- Rebuilt `@solidjs/web` (which `export * from "dom-expressions/src/client.js"`),
  then JFB `keyed/solid-next` with terser (production build).
- Bundle size: `38011 → 38137` bytes (`+126`) — one Set, one let,
  one microtask, the `moved.has`/`moved.add` guards.
- 10 reps per bench, full 9-bench CPU suite, Playwright headless,
  same machine and same session as today's `solid-next` baseline
  (capture 2026-05-05).

#### Result

| Bench                    |       baseline |        +PR 382 |        Δ |     σ-band |
| ------------------------ | -------------: | -------------: | -------: | ---------: |
| `01_run1k`               |  `4.10 ± 0.19` |  `4.65 ± 0.35` |  `+0.55` |     `1.6σ` |
| `02_replace1k`           |  `9.10 ± 0.24` |  `8.60 ± 0.39` |  `−0.50` |     `1.3σ` |
| `03_update10th1k_x16`    |  `2.30 ± 0.25` |  `2.00 ± 0.36` |  `−0.30` |     `0.8σ` |
| `04_select1k`            |  `0.90 ± 0.23` |  `0.80 ± 0.15` |  `−0.10` |     `0.4σ` |
| `05_swap1k`              |  `1.60 ± 0.37` |  `1.70 ± 0.23` |  `+0.10` |     `0.3σ` |
| `06_remove-one-1k`       |  `0.60 ± 0.13` |  `0.60 ± 0.07` |   `0.00` |     `0.0σ` |
| `07_create10k`           | `46.30 ± 1.68` | `46.65 ± 0.64` |  `+0.35` |     `0.2σ` |
| `08_create1k-after1k_x2` |  `4.30 ± 0.14` |  `3.90 ± 0.18` |  `−0.40` |     `2.2σ` |
| `09_clear1k_x8`          | `14.10 ± 0.33` | `14.25 ± 0.76` |  `+0.15` |     `0.2σ` |

#### Read

The picture is mixed and very nearly neutral overall. No delta
exceeds `~2σ`, and signs go both ways:

- Slight regressions: `01_run1k` `+0.55` ms (1.6σ), `07_create10k`
  `+0.35` ms (0.2σ), `09_clear1k_x8` `+0.15` ms (0.2σ).
- Slight improvements: `02_replace1k` `−0.50` ms (1.3σ),
  `08_create1k-after1k_x2` `−0.40` ms (2.2σ),
  `03_update10th1k_x16` `−0.30` ms (0.8σ).

The benches that *don't* exercise `cleanChildren` at all on their
hot paths (`02_replace1k`, `07_create10k`, `08_create1k-after1k_x2`
all go through `reconcileArrays`, not `cleanChildren`) move
randomly within their σ band, consistent with run variance.
The benches that *do* exercise the patched path (`01_run1k`'s
initial mount, `09_clear1k_x8`'s clear) show the largest signed
positive delta on `01_run1k` — `+0.55` ms / 1.6σ — which is
plausible but inside the noise envelope of a single 10-rep run.

#### Conclusion

The `Set` + microtask + per-call `moved.has`/`add` overhead in
`cleanChildren` does not show up as a measurable regression on the
JFB CPU suite. Bundle size cost is `+126` bytes. The fix appears
safe to merge from a benchmark-perf standpoint.

Caveats: one run, one machine state. Confirming
"performance-neutral" with confidence would want at least three
independent runs and a Welch t-test on `01_run1k` and
`09_clear1k_x8`. The CPU profile of the patched
`09_clear1k_x8` was not captured here; if a regression does
emerge in repeat runs, that would be the next probe target.

#### State after this experiment

- `client.js` restored from `.bak`, `@solidjs/web` rebuilt,
  JFB `keyed/solid-next` rebuilt to mangled production
  (`38011` bytes, original baseline).
- No source changes left in the Solid or dom-expressions
  working trees from this experiment.

## Diff/Reconcile Lane: UIBench

Tier-2 anchor for component-rendering and diff/reconcile shapes. Local mirror at
`~/Development/solid-uibench` runs the upstream UIBench harness with a vendored
modification that calls `structuredClone(group)` on the test data each iteration
(line 884 of `dist/uibench.js`) so frameworks that previously mutated the input
don't get an unfair advantage on referential equality. Solid 1's store mutated
the input, Solid 2 does not — the mod normalises that.

Two scenarios are tracked because they exercise different cost models:

- `disableSCU=off` (default URL): SCU is allowed; harness re-clones state each
  iteration → references are always new → diff/reconcile work is at its peak.
  This is the "server data / always fresh data" scenario.
- `disableSCU=on` (`?disableSCU=1`): SCU is disabled at the framework level →
  every component re-executes regardless of state changes → measures component
  setup/render cost. This is the "component rendering" scenario.

### Setup

`solid-uibench` `package.json` switched to local workspace deps:

- `solid-js` → `link:../solid/packages/solid`
- `@solidjs/web` → `link:../solid/packages/solid-web`
- `babel-preset-solid` → `link:../solid/packages/babel-preset-solid`

`pnpm.overrides` in the Solid root `package.json` forces
`babel-plugin-jsx-dom-expressions` to
`link:../dom-expressions/packages/babel-plugin-jsx-dom-expressions` so the
linked babel preset compiles with the local dom-expressions plugin
(picks up the `wrapDynamics` compact init-branch and static-class-array patches).

Build chain after wiring: rebuild `@solidjs/signals` → `solid-js` → `@solidjs/web`,
then `pnpm build` in `solid-uibench` to refresh `dist/main.js`.

Probe harness: Playwright + system Chrome, navigates to `run-{name}.html?i=N&...`
which loads `dist/main.js` (current local build) or one of the snapshotted
`main-*.js` artefacts. Each test reports the median of `N` iterations; we
sum those medians as a single aggregate score (lower is better).

### Snapshot reference: choosing the regression baseline

Quick sweep at `i=3` across current and three snapshotted 2.0 builds in `dist/`:

| build | sCU=off (sum-of-medians) | sCU=on |
| --- | ---: | ---: |
| `current` | `53.20 ms` | `67.40 ms` |
| `main-prev` | `46.00 ms` | `54.00 ms` |
| `main-s007` | `43.50 ms` | `49.10 ms` |
| `main-s024` | `45.10 ms` | `49.90 ms` |

`main-s007` is the strongest old 2.0 build under both modes, so that's the
baseline current is being attributed against.

### Correctness gate: equivalence check before any optimization

Before treating the perf delta as actionable, both builds were proven to be
producing the same DOM at every tick. Patched `uibench.js` to add a flag-gated
trace (`?trace=1`) that captures a hash of `#App.innerHTML` after every
`init` and `update` phase. The hash is computed on a normalized form of the
HTML — attributes within each opening tag are sorted alphabetically, so
emit-order differences (e.g. `class="TableRow" data-id="N"` vs
`data-id="N" class="TableRow"`) don't false-positive as divergences. The
class on `<tr>` is intentionally kept static via `class={['TableRow', { active: row().active }]}`,
which is why those attribute-order shifts appear at all — the static class
ends up in the template literal regardless of source order.

| mode | builds | trace points | raw divergences | normalized divergences |
| --- | --- | ---: | ---: | ---: |
| `disableSCU=off` | `current` vs `main-s007` | `192` | `88` | `0` |
| `disableSCU=on` | `current` vs `main-s007` | `192` | `~88` | `0` |

All raw divergences were `<tr>` attribute-emit-order on the table groups; the
tree groups (where the regression is concentrated) had zero divergences even
without normalization. Both builds produce semantically identical DOM on
every test, every iteration, every phase — so the `+22%` / `+35%` regression
totals at `i=10` are real per-tick work, not one build short-cutting.

### Tier-2 baseline: current vs `main-s007`, `i=10`, both modes

Sum-of-medians totals:

| mode | current | `main-s007` | Δ | Δ% |
| --- | ---: | ---: | ---: | ---: |
| sCU=off (server data) | `56.05 ms` | `45.95 ms` | `+10.10` | `+22.0%` |
| sCU=on (component rendering) | `68.15 ms` | `50.35 ms` | `+17.80` | `+35.4%` |

The component-rendering mode is hit harder, which points at the per-component
setup/render path more than the diff/reconcile path.

#### Top per-test regressions, sCU=on (current − `main-s007`, ms)

| test | current | `main-s007` | Δ ms | Δ % |
| --- | ---: | ---: | ---: | ---: |
| `tree/[10,10,10,10]/no_change` | `4.85` | `2.10` | `+2.75` | `+131%` |
| `tree/[2,2,2,2,2,2,2,2,2,2]/render` | `8.95` | `6.85` | `+2.10` | `+31%` |
| `tree/[50,10]/render` | `2.40` | `1.50` | `+0.90` | `+60%` |
| `tree/[500]/render` | `2.80` | `1.95` | `+0.85` | `+44%` |
| `tree/[10,50]/render` | `1.85` | `1.15` | `+0.70` | `+61%` |
| `tree/[5,100]/render` | `1.75` | `1.10` | `+0.65` | `+59%` |
| `table/[100,4]/render` | `0.95` | `0.60` | `+0.35` | `+58%` |
| `tree/[500]/[reverse]` | `3.20` | `2.90` | `+0.30` | `+10%` |

`tree/[10,10,10,10]/no_change` (10000 leaves, every component re-executed,
no actual state change) on its own accounts for ~`2.75 / 17.80 ≈ 15%` of
the sCU=on regression budget — pure component re-execution cost, no DOM
diff and no data movement. That's the cleanest signal for attribution.

#### Top per-test regressions, sCU=off (current − `main-s007`, ms)

| test | current | `main-s007` | Δ ms | Δ % |
| --- | ---: | ---: | ---: | ---: |
| `tree/[2,2,2,2,2,2,2,2,2,2]/render` | `9.20` | `7.95` | `+1.25` | `+16%` |
| `tree/[500]/render` | `3.05` | `2.10` | `+0.95` | `+45%` |
| `tree/[10,50]/render` | `2.00` | `1.30` | `+0.70` | `+54%` |
| `tree/[50,10]/render` | `2.45` | `1.80` | `+0.65` | `+36%` |
| `tree/[5,100]/render` | `1.75` | `1.15` | `+0.60` | `+52%` |
| `table/[100,4]/render` | `0.90` | `0.65` | `+0.25` | `+38%` |
| `tree/[500]/[reverse]` | `3.15` | `3.00` | `+0.15` | `+5%` |

#### Read

- The regression is concentrated on initial render of deep/wide component trees
  and on `no_change` re-execution. Move/insert/remove/sort/filter/activate
  operations are all near-flat or within run noise.
- Both modes show the same shape — render-heavy tests regress most — but
  sCU=on amplifies the gap by another `~7.7 ms` because `no_change` is no
  longer free.
- `main-s007` predates a number of correctness fixes (memory leak,
  `flush(fn)` semantics, sync-config plumbing). Some of the gap is likely
  unavoidable cost-of-correctness; the rest is the actual regression
  surface to attribute.
- Caveats: single 10-rep run, single machine state, no Welch t-test yet.
  Per-test variance at this scale is `~0.05 ms`, so deltas above
  `~0.2 ms` are real signal; deltas below are noise.

#### Profile attribution: `tree/[10,10,10,10]/no_change` sCU=on

CDP CPU profile, 30 iterations, single test isolated via UIBench's
`filter` query parameter.

##### Top self-time frames (current build, baseline)

| rank | self-ms | self-% | function |
| ---: | ---: | ---: | --- |
| 1 | `344.15` | `32.2%` | `applyState` |
| 2 | `318.56` | `29.8%` | `(idle)` |
| 3 | `215.10` | `20.1%` | `Executor._next` (harness) |
| 4 |  `79.81` |  `7.5%` | `(program)` |
| 5 |  `58.33` |  `5.5%` | `(garbage collector)` |
| 6 |  `22.59` |  `2.1%` | `wrap` |
| 7 |   `9.48` |  `0.9%` | `(anonymous)` |
| 8 |   `5.12` |  `0.5%` | `i` (setSignal) |

##### Top self-time frames (`main-s007`, baseline)

| rank | self-ms | self-% | function |
| ---: | ---: | ---: | --- |
| 1 | `535.04` | `50.6%` | `(idle)` |
| 2 | `227.08` | `21.5%` | `Executor._next` (harness) |
| 3 | `157.25` | `14.9%` | `K` (reconcile main) |
| 4 |  `79.26` |  `7.5%` | `(program)` |
| 5 |  `25.05` |  `2.4%` | `(garbage collector)` |
| 6 |   `6.92` |  `0.7%` | `get` (proxy trap) |
| 7 |   `6.33` |  `0.6%` | `n` (wrap) |

##### Reconcile subtree comparison (inclusive, 30 iter)

|  | current | `main-s007` | Δ |
| --- | ---: | ---: | ---: |
| `applyState` / `K` (inclusive subtree) | `3580 ms` | `1754 ms` | `+1826 ms` (`2.04×`) |
| `applyState` / `K` (self) | `344 ms` | `157 ms` | `+187 ms` |
| `wrap` calls from reconcile | `22.5 ms` | `6.2 ms` | `+16.3 ms` (`3.6×`) |
| `get` (storeTraps) from reconcile | `1.6 ms` | `6.1 ms` | `−4.5 ms` |
| GC | `58 ms` | `25 ms` | `+33 ms` |

The proxy `get` trap is *less* hit from reconcile in current, ruling
the trap out as the regression source. The regression lives in the
reconcile algorithm body itself plus `wrap` allocation pressure.

#### Optimization #1: fast-path `getOverrideValue` when no overrides

`getOverrideValue(value, override, nodes, key, optOverride)` is called
6 times per `applyState` invocation (length read + prefix scan +
suffix scan + middle scan + non-keyed array path + values path) and
its body is

```ts
function getOverrideValue(value, override, nodes, key, optOverride?) {
  if (optOverride && key in optOverride) return optOverride[key];
  return override && key in override ? override[key] : value[key];
}
```

For `setState(reconcile(...))` against a normal store (no optimistic
override, no override), the function degenerates to `value[key]` but
still incurs a function-call frame on every iteration of every hot
loop. `STORE_OPTIMISTIC_OVERRIDE` is brand-new since `main-s007` and
adds an additional `optOverride && key in optOverride` check on
every call.

Fix: capture `override` and `optOverride` once at `applyState`
entry, derive `fastPath = !override && !optOverride`, and inline the
direct `previous[key]` / `previous[i]` access at every call site
when `fastPath` is true. Slow path is unchanged.

##### Result

| metric | baseline | after fix | Δ |
| --- | ---: | ---: | ---: |
| `applyState` self (30 iter) | `344 ms` | `250 ms` | `−94 ms` (`−27%`) |
| reconcile inclusive subtree | `3580 ms` | `2620 ms` | `−960 ms` (`−27%`) |
| `wrap` from reconcile | `22.5 ms` | `17.7 ms` | `−4.8 ms` |
| GC | `58 ms` | `42 ms` | `−16 ms` |
| `tree/[10,10,10,10]/no_change` median (i=10, sCU=on) | `4.85 ms` | `3.50 ms` | `−1.35 ms` (`−28%`) |

`current` vs `main-s007` on the same test: `4.85` → `3.50` ms,
closing about half the gap (`s007` is `2.05` ms).

All 208 store tests still pass. DOM-hash trace still confirms
behavioural equivalence with `main-s007` at every tick.

##### Things tried that didn't help

- **Internal `applyStateNode(next, target, keyFn)` recursion to skip
  `wrap()` round-trip on every recursive call**, with a
  `getExistingTarget(value)` helper that returns the cached target
  via `storeLookup.get(value)?.[$TARGET]`. Closure-based recursion
  helper added `~72 ms` of `recurse` self-time + `~64 ms` of
  `getExistingTarget` self-time, more than wiping out any savings.
  Free-function helper (`applyStateRecurse`) was less bad but still
  net-negative (`+88 ms` recurse self + `+55 ms` getExistingTarget self
  vs `−115 ms` saved on `applyState` self). The wrap-skip wasn't
  expensive enough in the original to be worth replacing the call
  chain — skipped.

#### Remaining attribution

After Optimization #1, the gap on
`tree/[10,10,10,10]/no_change` is roughly halved. What's left in the
~`+93 ms` gap on `applyState` self vs `K`:

- The new `target[STORE_OPTIMISTIC_OVERRIDE]` access at entry (one
  extra property read per `applyState` invocation × 10001 invocations
  per tick × 30 iter = `~300k` reads).
- Possibly hidden-class shape pressure from the additional state
  fields on `target`.
- `Object.keys(nodes)` allocation in the non-tracked values path —
  one new array per recursion.

### Historical trajectory

UIBench has been run on Solid going back to `0.14` (snapshotted in
`solid-uibench/dist/main-14.js`) and through the entire `1.x` line up
to `1.9.0`. All snapshots were re-validated as DOM-equivalent against
current via the same hash trace probe.

Sum-of-medians, `i=10`, both modes, against current local
(post Optimization #1):

| build | era | sCU=off | sCU=on |
| --- | --- | ---: | ---: |
| `main-14` | Solid `0.14` (pre-1.0 baseline) | `34.85 ms` | `42.05 ms` |
| `main-s007` | Solid 2.0 — early | `44.60 ms` | `50.10 ms` |
| `current` | Solid 2.0 — local + Opt #1 | `51.25 ms` | `62.90 ms` |
| `main-190` | Solid `1.9.0` | `82.40 ms` | `78.40 ms` |

Reads:

- `0.14` is the all-time fastest for this benchmark by a clear margin.
  No fine-grained tracking error model, no store overrides, no
  optimistic primitives, no ownership warning system, no transitions.
  The cost we've layered on since is partly real correctness/feature
  cost and partly true regression.
- The Solid `1.x` line carried a ~`2.4×` regression vs `0.14`. Solid 2
  recovered most of it; `main-s007` was within `28%` of `0.14` on
  sCU=off and within `19%` on sCU=on.
- Current sits between `s007` and `1.9.0` — `+15%` over `s007` (the
  recent regression we're investigating) and `~32% / 25%` *better*
  than `1.9.0`. So we're net ahead of Solid 1, but we've slipped
  inside the Solid 2 line.

The actionable target is the gap to `s007` (the active regression).
The gap to `0.14` is interesting context but not directly actionable
without re-evaluating which features Solid 2 has chosen to ship.

### Solid 2 → 0.14 architectural delta map

Drafted from reading `packages/solid-signals/src/core/core.ts`,
`scheduler.ts`, and `store/*` against what Solid 0.14's reactivity
shape looked like (single-package, pre-async, pre-transition,
pre-projection). Goal is to enumerate every always-paid cost that 2.0
has and 0.14 didn't, so we know which features are "feature cost"
(can't remove without losing functionality) vs which are "always
paid even when the feature is unused" (gating opportunity).

**UIBench caveat:** the absolute `+170 ms` per-sweep delta against
`main-14` measured below significantly *overstates* the real-world
delta because UIBench is the worst case for the **listened-paths
diff** feature added in 2.0. Solid 2 only walks/diffs keys that a
computation has actually read (`Object.keys(nodes)` rather than the
full data shape). In real apps — especially sync engines and any
"data shape larger than what's read" case — entire subtrees are
skipped where `main-14` walked everything. UIBench's consumers read
every field of every tree node, so the listened set collapses to
"all keys" and the feature shows only as overhead, not savings.
Translation: the measured gap is partly real architectural cost and
partly listened-paths feature cost on a benchmark where the feature
can't help. Optimizations that touch the listened-paths machinery
itself (e.g., walking `Object.keys(next)` instead of
`Object.keys(nodes)`) are off-limits — they'd regress real-world
behavior. Optimizations that touch *orthogonal* features (projection
routing, optimistic dispatcher, transition checks) are fair game.

#### Tier-1 — always paid on every signal read/write

Every UIBench tick reads/writes thousands of signals through these
hot paths. 0.14 had nothing equivalent.

1. **Pending-value queue model** (`setSignal`). 0.14 wrote directly:
   `el._value = v; runSubs()`. 2.0 funnels every write through
   `_pendingValue` + `globalQueue` + `flush()` so transitions/async
   can defer the commit. Even synchronous user code with no
   transitions pays the full pipeline:
   - compute current value with override-awareness
   - equals check against override-aware current
   - write `_pendingValue`, push to `globalQueue._pendingNodes`
   - update `_pendingSignal` / `_latestValueComputed` if present
   - `schedule()` and later commit pending → `_value` at flush
2. **Override-aware reads** (`read`). 0.14: `if (tracking) link(); return _value`. 2.0 fast-path checks **7 conditions** before
   the same return:
   `latestReadActive` / `pendingCheckActive` / `_overrideValue` /
   `_snapshotValue` / `activeTransition` / `currentOptimisticLane` /
   `snapshotCaptureActive`. All seven are false in non-feature use,
   but each is a load + branch.
3. **Override-aware writes** (`setSignal`). 3 additional checks
   (`_transition`, `_overrideValue`, `_pendingValue !== NOT_PENDING`)
   and a 5-way branch for `currentValue`.
4. **Snapshot capture check on every read** (`snapshotCaptureActive
   && c._config & CONFIG_IN_SNAPSHOT_SCOPE`). Module-global flag plus
   per-owner config bit — checked on every read inside any owner.
5. **Bigger Signal instance shape**. 2.0 Signal has at least:
   `_value, _pendingValue, _overrideValue, _snapshotValue,
   _pendingSignal, _latestValueComputed, _transition, _firewall,
   _equals, _config, _flags, _statusFlags, _optimisticLane,
   _overrideSinceLane, _time, _name, _fn?, _height?, …` — roughly
   15-20 slots vs 0.14's ~5. Larger hidden classes, more GC pressure
   per signal allocation, more polymorphism risk on the proxy traps.
6. **Store dispatcher overhead** in `applyState` — `target[STORE_OVERRIDE] || target[STORE_OPTIMISTIC_OVERRIDE]` check
   on every recursive call (Opt #3 split helps but the entry read is
   still 2 property loads).
7. **`wrap()` projection routing** — every `wrap(value, target)`
   reads `target?.[STORE_WRAP]` to dispatch projection wrappers.
   0.14 had no projections; this is unconditional in the hot path.
8. **`STORE_HAS` bookkeeping** — separate per-property signals for
   `key in next` reactivity, walked at the end of every `applyState`
   on objects.

#### Tier-2 — paid per render-effect / per-mount

Less frequent than per-signal-read, but still on every UIBench tick:

- **Two-phase effect** (`effect(compute, effect)`): the compute
  function runs as a tracked computed, and a separate effect closure
  runs after. 0.14 had a single-callback effect. Extra closure call
  + ownership setup per render-effect.
- **Hierarchical owner ID generation** for stable IDs across hot
  reloads / projections.
- **Snapshot scope setup** when `CONFIG_IN_SNAPSHOT_SCOPE` is set on
  the owner.

#### Tier-3 — gated, paid only when feature is used

Already structured as fast/slow split — these don't contribute to the
0.14 gap on UIBench, which uses none of them:

- DEV diagnostics (`__DEV__` constant; tree-shaken in production).
- Strict-read warnings (DEV-only).
- Async pending propagation (gated on `STATUS_PENDING`).
- Optimistic lane management (gated on `STORE_OPTIMISTIC_OVERRIDE`).
- Projection routing inside `wrap` (gated on `STORE_WRAP`).
- Suspense/loading boundary work (gated by boundary owner).
- Transition entanglement (gated by `_transition` slot).

#### Implication

The `s007 → 0.14` gap is dominated by Tier-1, not Tier-3. Tier-1
items (1) through (5) cluster around the fundamental architectural
choice of a **two-phase pending-value queue** to support transitions
and async without splitting the signal API.

Concrete actionable opportunities (ranked by hypothesized yield, all
need profile validation):

A. **No-features-active fast path in `setSignal`**: when
   `activeTransition === null && currentOptimisticLane === null && el._transition === undefined && el._overrideValue === undefined && el._pendingSignal === undefined && el._latestValueComputed === undefined`,
   bypass `_pendingValue` entirely — direct write + sub propagation.
   Single bit-flag union of these conditions could collapse to one
   check.
B. **No-features-active fast path in `read`**: same idea — collapse
   the 7 conditions into a single `unionFlags` field on the signal +
   one global "any-feature-on" bit.
C. **Lazy slot allocation on Signal**: most signals never need
   `_overrideValue`, `_snapshotValue`, `_optimisticLane`, etc. Use a
   side-table (WeakMap) for these so the base Signal stays narrow.
   Reduces GC and hidden-class pressure.

(A) and (B) are pure runtime fast-paths — semantics unchanged, code
shape preserved. (C) is invasive and high-risk; only worth pursuing
if (A)+(B) close most of the gap and we still want more.

#### Profile head-to-head: current vs `main-14`

CDP CPU profile, scenario `tree/[10,10,10,10]/no_change`, sCU=on,
i=30. Profiler running over the full sweep window (~1 s wall):

| metric | current | `main-14` | delta |
| --- | ---: | ---: | ---: |
| total sampled CPU | `1037 ms` | `1032 ms` | parity (sweep window) |
| idle | `521 ms` | `686 ms` | `+165 ms` idle in 14 |
| **active CPU** | **`516 ms`** | **`346 ms`** | **`+170 ms`** in current |
| GC | `37.2 ms` | `25.1 ms` | `+12.1 ms` |
| harness | `180.3 ms` | `176.1 ms` | parity |

So current does **+49 % more actual CPU work** per sweep on this
scenario.

App-side self-time (`≥ 1 ms`):

| current | self ms | `main-14` | self ms |
| --- | ---: | --- | ---: |
| `applyStateFast` | `149.72` | `applyState` (single fn) | `80.59` |
| `applyState` (dispatcher) | `53.33` | `(anonymous)` | `9.84` |
| `wrap` | `17.24` | `isWrappable` | `0.91` |
| `(anonymous)` | `7.93` | `createComputationNode` | `0.70` |
| `i` (helper) | `4.48` | (none above 0.7 ms) | — |
| `isWrappable` | `2.73` | | |
| `get` (proxy trap) | `1.95` | | |

**Total app-side: `239 ms` (current) vs `92 ms` (`main-14`).** The
gap is dominated by reconcile + wrap, which together account for
`+139 ms` — i.e., roughly all of the active-CPU delta.

Notable absences: `read`, `setSignal`, signal subscription, queue
flush, transition propagation. All of the speculative Tier-1 items
(1)–(4) above (pending-value queue, override-aware read, etc.) are
either inlined to invisibility, sub-1 ms, or simply not exercised by
this scenario. **The architectural delta map's Tier-1 emphasis on
signal read/write was wrong for this benchmark.** The dominant cost
is in the store/reconcile path.

#### Revised opportunity list (post-profile)

In rank-order by measured headroom on this benchmark:

1. **Eliminate the `applyState` dispatcher for trees that contain
   neither a projection nor an optimistic store.** The dispatcher's
   `53 ms` is *all* feature cost — `main-14` had a single
   non-dispatched `applyState`. Approach: at top-level
   `reconcile()`, check `target[STORE_WRAP] || target[STORE_OPTIMISTIC_OVERRIDE]` once. If false, recurse
   through a no-check variant `applyStateFastNoOverrides` whose
   recursion targets itself instead of going back through the
   dispatcher. UIBench / typical apps don't use projections or
   optimistic, so they get the simpler path. **Estimated yield ~50
   ms over 30 iters (≈ 1.7 ms / iter).**
2. **Slim `wrap` for non-projection trees**. The `17.24 ms` of wrap
   self-time is mostly the `target?.[STORE_WRAP]` check + the
   WeakMap fallback path that `main-14` didn't have (it likely
   stamped `$PROXY` on the raw value directly). The `wrapPlain` idea
   is unsafe (projections need `STORE_WRAP` routing for child
   targets), but a *root-level decision* on whether the tree contains
   projections is safe: same gating signal as (1). **Estimated yield
   ~10–15 ms over 30 iters (≈ 0.4 ms / iter).**
3. **Investigate what's inside `applyStateFast` body that
   `main-14`'s body doesn't have.** Current's body is `149.72 ms`;
   `main-14`'s is `80.59 ms`. After removing the dispatcher entry
   cost from the comparison, that's still `~70 ms` of inherent work
   delta. Candidates: per-property `STORE_HAS` signal walk, the
   `getAllKeys` allocation in tracked-keys path, two `isWrappable`
   calls per element on the values branch (lines 167–168 of
   `reconcile.ts`). Each needs probing to see if it's actual work or
   profile attribution noise from the dispatcher being inlined into
   `applyStateFast` callsites. **Estimated yield: speculative,
   probably 10–30 ms.**

   **Critical caveat: a substantial portion of the
   `applyStateFast` body cost is the listened-paths machinery
   itself, which is a Solid 2 *feature* not present in `main-14`.**
   The values branch walks `Object.keys(nodes)` (only keys with
   signal subscribers) instead of `Object.keys(next)` (all keys).
   In real-world scenarios — sync engines, server-pushed payloads,
   any "data is larger than what's read" case — Solid 2 skips
   entire subtrees that nobody listens to, where `main-14` walked
   the whole shape every time. UIBench `tree/[10,10,10,10]` is the
   worst-case-for-listened-paths benchmark: the consumer reads
   every field (`n.id`, `n.container`, `n.name`, …), so
   `Object.keys(nodes)` collapses to "all keys" and the listened-
   path machinery just adds per-call overhead with zero matching
   savings. The `+70 ms` body delta is therefore **partly listened-
   paths feature cost on a benchmark where the feature can't help**,
   not a regression we can simply undo without losing real-world
   wins. Investigation here must distinguish "structural overhead
   that could be slimmed without losing the feature" (e.g.,
   STORE_NODE indirection per key) from "the feature itself"
   (walking only `nodes`, building `getAllKeys` for $TRACK). Only
   the former is fair game.
4. **GC pressure: `+12 ms`**. Smaller than the above; comes from
   slightly larger Signal/Store instances. Below-threshold to chase
   directly.

(1) and (2) share the same gating signal (root-level
"is-this-tree-feature-active") so they should be implemented as a
single change: a per-store `_pristineTree` boolean (true unless
projection / optimistic touches it) that's checked once at
`reconcile()` entry and routes to an entire no-check applyState +
no-projection-check wrap stack.

(3) is exploratory — only pursue after (1)+(2) have been measured.

### Failed attempt: pristine-tree dispatcher gating (reverted)

Implemented (1) above: added `applyStatePristine` (line-by-line
clone of `applyStateFast` with recursion targeting itself instead of
the dispatcher); modified `reconcile()` to check root
`target[STORE_WRAP]` once and route plain-store reconciles directly
to `applyStatePristine`, skipping the per-recursion override
dispatcher. The `STORE_WRAP` gate is correct because the projection
wrapper extension propagates `STORE_WRAP` to every descendant — root
absence guarantees no descendant has overrides.

All `705` `solid-signals` tests + the full 18-package monorepo suite
passed.

CDP profile of `tree/[10,10,10,10]/no_change` sCU=on, i=30:

| function | pre-pristine | post-pristine | Δ |
| --- | ---: | ---: | ---: |
| `applyStateFast` body | `149.72 ms` | — | `-149.72` |
| `applyState` (dispatcher) | `53.33 ms` | — | `-53.33` |
| `applyStatePristine` (new) | — | `205.80 ms` | `+205.80` |
| `wrap` | `17.24 ms` | `17.80 ms` | `+0.56` |
| **app total** | **`239.12`** | **`241.60`** | **`+2.48`** |

Net change: zero. The "savings" the pre-pristine profile suggested
(`53 ms` of dispatcher self-time + reduced indirect call) were not
recoverable, because **V8 was already JIT-inlining `applyStateFast`
into `applyState`'s dispatch site at runtime**. The dispatcher's
`53 ms` of profile-attributed self-time was not "wasted work that
my source-level inline could eliminate" — it was simply how V8's
sampling profiler attributes inlined work to call frames. My
structural pre-inlining produces the same machine code, with no
performance change. The `+2.48 ms` net delta is within profile
noise.

Sweep confirmed (high variance, no signal):

| mode | doc baseline (post-Opt #4) | post-pristine median | within-run gap to s007 |
| --- | ---: | ---: | ---: |
| sCU=off | `45.25` | `46.50–47.45` | `+2.55` to `+5.85` (was `+3.85`) |
| sCU=on  | `58.45` | `64.50–64.80` | `+4.60` to `+9.50` (was `+4.65`) |

`s007` (precompiled, unchanged) drifted `2–6 ms` across runs from
system load alone, so absolute deltas to baseline are partly noise.
Within-run gaps are consistent with "no measurable change".

**Reverted.** Same outcome and root cause as the earlier failed
inline-dispatch attempt (Opt #4 attempt) — the dispatcher pattern
*as written* was already optimal for V8 once warmed up. Source-level
inlining of dispatcher and body produces a wash because V8 already
does the same merge at JIT.

**Lesson (re-confirmed):** profile self-time attribution to
JIT-inlined call frames is not necessarily recoverable cost. When
two functions A and B always co-occur and the profiler attributes
some `N ms` to A's frame, that doesn't mean source-level merging A
into B will save `N ms` — V8 may already have done that merge in
machine code. The `53 ms` "dispatcher" line in the profile was such
an attribution. To actually find recoverable cost, look for work
that `main-14` *doesn't do at all* (different algorithm or absent
feature), not for restructuring of work that's already happening.

This rules out (1) and (2) from the prior opportunity list as
sources of meaningful UIBench wins (they were both predicated on
the same flawed "dispatcher overhead is recoverable" premise). The
remaining lever is (3) — body work inside `applyStateFast` that
`main-14` simply doesn't do — and even that has the listened-paths
caveat.



Prior on where the cost has lived in past UIBench optimization passes
(in priority order, from prior experience):

1. **`reconcile()` internals** — traversal/diff cost when fresh data
   is cloned every iteration. Note: in sCU=on UIBench rebuilds tree
   identities on each tick, so reconcile sees "everything changed"
   and the *cost-of-walking* is exposed even when the data shape is
   stable.
2. **Store proxy `get` overhead** — every read in a component body
   (`props.data.children`, `n.id`, `n.container`, etc.) goes through
   the trap. Hot loops in `For` map this many times per tick.
3. **App-side read patterns in `main.jsx`** — destructuring vs.
   single-shot reads, redundant accessor calls, closures over store
   values. This is the most common single source of regression and
   the cheapest to fix once the profile points to it.

Things that historically have **not** been the source of regressions
on this benchmark and should be deprioritized when reading the
profile:

- DOM Expressions runtime (cleanChildren, insert, etc.)
- Solid's component / owner / hydration infrastructure

### Optimization #2: drop `STORE_CUSTOM_PROTO` for plain objects

Tracking down the `+11.5 ms` `wrap` self-time delta vs `s007` revealed
that commit `a93a216e` ("fix(signals): track prototype store getters")
introduced a perf bug alongside its (correct) bug fix.

The fix needs the get trap to walk the prototype chain only for
class-instance stores so inherited accessors (`get sum() { ... }`) stay
reactive. The implementation cached that decision as a flag:

```ts
newTarget[STORE_CUSTOM_PROTO] = hasCustomPrototype(unwrapStoreValue(value));
```

…called on **every** wrap. For plain objects (the overwhelming majority
of stores) the answer is always `false`, but we still:

1. Paid the `hasCustomPrototype` + `unwrapStoreValue` function-call /
   prototype-lookup cost on every wrap.
2. Stamped the `'c'` slot on the target's hidden class with `false`,
   making every plain-object proxy carry a wider hidden class.

The get trap reads the slot as truthy/falsy, so `false` and `undefined`
are interchangeable. Fix: only stamp the slot when actually `true`:

```ts
const unwrapped = (value as any)?.[$TARGET]?.[STORE_VALUE] ?? value;
const proto = Object.getPrototypeOf(unwrapped);
if (proto !== null && proto !== Object.prototype) {
  newTarget[STORE_CUSTOM_PROTO] = true;
}
```

Class-instance stores still get `true` (the bug-fix path is preserved);
plain objects/arrays leave the slot unset. All `705` `solid-signals`
tests pass, including the two "prototype getters track ..." tests added
in `a93a216e`.

While here, also dropped the unused `nodes` argument from
`getOverrideValue`. It was being passed at six call sites in
`reconcile.ts` with no consumer in the body — pure call-frame overhead
on the slow path.

CPU profile delta (sCU=on, `tree/[10,10,10,10]/no_change`, `i=30`):

| metric | pre-Opt #2 | post-Opt #2 | Δ |
| --- | ---: | ---: | ---: |
| `applyState` self | `249.69 ms` | `232.06 ms` | `-17.63` |
| GC | `42.47 ms` | `37.40 ms` | `-5.07` |
| App + GC | `331.43 ms` | `305.07 ms` | `-26.36` |

Median wall-clock didn't move much (~1 ms) because most of the savings
fell in initial render and steady-state GC pressure rather than the
per-tick critical path.

### Optimization #3: split `applyState` into fast/slow dispatcher

Diff'ing the body of `applyState` between current and `s007` (signals
`0.4.1`) showed three distinct cost surfaces added in current:

1. Eager read of `target[STORE_OPTIMISTIC_OVERRIDE]` at every entry
   (added with the optimistic-override feature).
2. A `fastPath` boolean test scattered through six sites in the body
   (added in Opt #1 to skip `getOverrideValue` calls when no overrides
   are present).
3. The `getOverrideValue` body itself grew from one branch to two.

Items (2) and (3) are pure overhead on the common path. Replaced the
single-function design with a thin dispatcher that routes every call —
including recursion — to one of two specialized bodies:

```ts
function applyState(next, state, keyFn) {
  const target = state?.[$TARGET];
  if (!target) return;
  if (target[STORE_OVERRIDE] || target[STORE_OPTIMISTIC_OVERRIDE]) {
    applyStateSlow(next, target, keyFn);
  } else {
    applyStateFast(next, target, keyFn);
  }
}
```

`applyStateFast` reads only `STORE_VALUE` and `STORE_NODE`, never
calls `getOverrideValue`, never branches on `fastPath`, and never
writes `target[STORE_OVERRIDE] = undefined` (which would force a
hidden-class transition the first time on otherwise-clean targets).
`applyStateSlow` retains the override-aware behavior via
`getOverrideValue`. Recursive calls go back through the dispatcher
because each child target may independently have overrides — this is
correctness-preserving for projections / optimistic updates.

CPU profile delta (sCU=on, `tree/[10,10,10,10]/no_change`, `i=30`):

| metric | post-Opt #2 | post-Opt #3 | Δ | s007 |
| --- | ---: | ---: | ---: | ---: |
| `applyState` total (dispatcher + fast/slow) | `232.06 ms` | `215.65 ms` | `-16.4` | `157.25 ms` |
| `applyStateFast` body alone | n/a | `161.92 ms` | n/a | `157.25 ms` |
| GC | `37.40 ms` | `29.39 ms` | `-8.0` | `25.05 ms` |
| App + GC | `305.07 ms` | `284.08 ms` | `-21.0` | `209.67 ms` |

The fast body alone is now within `4.7 ms` of `s007` over `30` iters
(`~3%`). The remaining `53.7 ms` of `applyState` self comes from the
dispatcher — re-extracting `state[$TARGET]` and the two override reads
on every recursion. That's the next budget if we want to push further.

### Tier-2 result: combined Opt #2 + Opt #3 vs `s007`

Sweep at `i=20` for both modes after rebuilding the full stack
(`@solidjs/signals` → `solid-js` → `@solidjs/web` → `solid-uibench`):

| mode | pre-Opts current | post-Opts current | `s007` | Δ gap | gap % now |
| --- | ---: | ---: | ---: | ---: | ---: |
| sCU=off (server data) | `55.55 ms` | `49.85 ms` | `44.90 ms` | `-7.25` | `+11%` (was `+28%`) |
| sCU=on (component) | `67.00 ms` | `60.00 ms` | `56.60 ms` | `-7.00` | `+6%` (was `+25%`) |

Both modes cut the gap by ~7 ms each, taking the regression vs `s007`
down from `25-28%` to `6-11%`. The 18-package monorepo test suite
passes (`705` `solid-signals` tests including all reconcile and
prototype-getter cases).

The two changes are complementary:

- **Opt #2** removed allocation/hidden-class pressure that mostly hit
  during initial render and steady-state GC — moved most of the win
  off the critical path but freed budget overall.
- **Opt #3** removed per-recursion-call overhead in the actual
  reconcile body. This translated more directly into wall-clock
  median improvement.

Outstanding gap to `s007` (~`5 ms` on both modes) is concentrated in:

- Dispatcher overhead (~`54 ms` of inclusive cost over 30 iters).
- `wrap` self-time still `~13 ms` over `s007` despite no
  `createStoreProxy` calls in steady state — likely V8 inlining
  difference vs `s007`'s simpler `wrap` body. Worth investigating
  whether `target?.[STORE_WRAP]` optional-chain or some other shape
  difference is preventing inline.
- `isWrappable` showing as a separate `3.1 ms` self call rather than
  inlined (the added `Node` instanceof check makes it too large for
  V8's inline budget).

### Failed attempt: inline-dispatch (Opt #4 reverted)

Attempted to eliminate the `applyState` dispatcher by inlining its
work at every recursive call site (each `wrap(...)[$TARGET]` plus
override-check + direct call to `applyStateFast`/`Slow`). Hypothesis
was that one less function frame per recursion would shave the
`53.7 ms` dispatcher self-time.

Result: net **negative**. Wall-clock went up `+2.95 ms` on sCU=on
(`60.00 → 62.95`) and the proxy `get` trap self-time *grew* by
`+3.4 ms`. The dispatcher's single inlined `[$TARGET]` trap call had
better V8 inline-cache feedback than the same call distributed across
multiple sites in `applyStateFast`. Reverted.

Lesson: the dispatcher's overhead was already optimal for the V8
shape it produced. Moving the work inline forced more JIT context
splits on the proxy trap and cost more than it saved. Future work on
this gap likely needs to attack `wrap`'s inlining or the dispatcher's
property reads via a single combined "has overrides" sentinel slot
rather than naïve inlining.

### Optimization #4: restructure `isWrappable` for inline-budget

`isWrappable` was showing as a separate `3.11 ms` self-time call
because its 4-condition body (`!= null && typeof object && !frozen &&
!Node`) plus a `typeof Node !== "undefined"` global lookup pushed it
just past V8's inline-budget. In `s007` the equivalent function
(3 conditions, no Node check) gets folded into `K`'s body and never
appears as a separate symbol.

Restructured the body with explicit early-returns instead of one big
conjunction:

```ts
export function isWrappable(obj: any) {
  if (obj == null || typeof obj !== "object" || Object.isFrozen(obj)) return false;
  return typeof Node === "undefined" || !(obj instanceof Node);
}
```

Same conditions, but V8 sees a small body with two clean return points
that the inliner accepts. The dynamic `typeof Node` check is preserved
because the test suite includes a runtime override of `globalThis.Node`
(`createStore.test.ts: "does not wrap Node instances"`) — caching the
constructor at module-init breaks that contract.

CPU profile delta (sCU=on, `tree/[10,10,10,10]/no_change`, `i=30`):

| metric | post-Opt #3 | post-Opt #4 | Δ |
| --- | ---: | ---: | ---: |
| `applyStateFast` self | `161.92 ms` | `167.24 ms` | `+5.32` |
| `applyState` (dispatcher) | `53.73 ms` | `48.50 ms` | `-5.23` |
| `wrap` self | `19.27 ms` | `17.00 ms` | `-2.27` |
| `isWrappable` self | `3.11 ms` | `1.96 ms` | `-1.15` |
| GC | `29.39 ms` | `26.10 ms` | `-3.29` |
| App + GC | `284.08 ms` | `275.33 ms` | `-8.75` |

Note GC has now dropped to `26.10 ms` — basically equal to `s007`'s
`25.05 ms`. Allocation pressure is no longer a meaningful contributor.

### Tier-2 result: stable medians after Opt #2 + #3 + #4

Three independent `i=20` runs per build, sum-of-medians of medians
(reduces both within-run and across-run noise):

| mode | gap pre-Opts | post-Opts current | post-Opts `s007` | Δ ms | Δ % |
| --- | ---: | ---: | ---: | ---: | ---: |
| sCU=off (server data) | `+22%` | `45.25 ms` | `41.40 ms` | `+3.85` | `+9.3%` |
| sCU=on (component) | `+37%` | `58.45 ms` | `53.80 ms` | `+4.65` | `+8.6%` |

Cumulative wins from initial baseline (pre-Opt #2):

- sCU=off: `53.20 → 45.25 = -7.95 ms (-15%)`
- sCU=on: `67.40 → 58.45 = -8.95 ms (-13.3%)`

The remaining `~4 ms / 8-9%` gap is concentrated in the same three
contributors as before (dispatcher, `wrap`, residual `applyStateFast`
body) and is increasingly noise-bound at this scale. Pushing further
likely requires either:

1. A combined "has overrides" sentinel slot to reduce the dispatcher's
   2-property-read entry cost to a single-property read.
2. Hoisting `target[STORE_NODE]` to a local across the array-merge
   branches of `applyStateFast` / `applyStateSlow` — currently re-read
   2× per loop iteration at ~6 sites; hoisting is semantically
   identical and may produce a tighter V8 shape.
3. Accepting the gap and shifting focus to the `s007 → 0.14`
   architectural delta, which dominates the absolute regression.

### Failed attempt: hoist `target[STORE_NODE]` to a local in array branches (reverted)

The array-merge branches of `applyStateFast` and `applyStateSlow`
re-read `target[STORE_NODE]` ~12 times per loop iteration across 6
sites (signal lookup, `$TRACK`, length signal, etc). Hoisted it once
to a function-scope `let nodes = target[STORE_NODE]` at the top of
each function and replaced the in-branch reads with `nodes`. The
change is semantically identical — `target[STORE_NODE]` is a plain
symbol-keyed property on a plain target object that nothing in the
function mutates (swap touches `STORE_LOOKUP` / `STORE_VALUE` /
`STORE_OVERRIDE` only; `setSignal` queues notifications without
mutating target; `wrap` creates child proxies; `applyState` recursion
targets children).

All `705` `solid-signals` tests + the full 18-package monorepo suite
passed. So semantically the hoist is fine.

Tier-2 measurement (3 runs each at `i=20`, then 3 more at `sCU=on` to
control for variance):

| mode | doc baseline (post-Opt #4) | post-hoist | Δ current | Δ s007 |
| --- | ---: | ---: | ---: | ---: |
| sCU=off | `45.25` / `41.40` | `47.65` / `43.75` | `+2.40` | `+2.35` |
| sCU=on  | `58.45` / `53.80` | `61.10` / `54.65` | `+2.65` | `+0.85` |

`sCU=off`: current and `s007` drifted by the same amount → entirely
system-load drift, hoist had no measurable effect.

`sCU=on` (6 runs, gap medians): `7.00, 6.25, 5.30, 4.05, 6.50, 5.30`
ms → median `5.78 ms` vs pre-hoist `4.65 ms`. Within-run gap variance
σ ~ `1.05 ms`, so the `+1.13 ms` shift is roughly `1σ` — borderline,
mildly suggestive of a tiny regression on the component-data path.

Mechanism hypothesis (not confirmed): the hoist forces an entry-time
property read regardless of whether `Array.isArray(previous)` is
true. In `sCU=on` (deep object trees, mostly values branch), the
function previously short-circuited `target[STORE_NODE]` lookup until
the `// values` block. Eagerly fetching at entry adds work to the
fast path that was previously deferred — and since `target` is a
plain object, the property access is so cheap that the saved
duplicate-reads in the array branch don't dominate enough to recover
the cost across the full benchmark mix.

Also possible: function size grew enough at entry to nudge V8 past
some inline-budget threshold. Hard to confirm without `--print-opt`
inspection.

Net: at best noise-bound, at worst a 1-ms regression on `sCU=on`. Not
worth the readability cost of caching. Reverted.

Lesson: micro-optimizations targeting "duplicate property reads on a
plain target" are low-yield in V8 — the JIT already specializes those
into single-instruction loads after warmup, and the manual hoist can
*shift* costs to entry time where they hurt the dominant code path.
For future work in this hot loop, prefer optimizations that
*eliminate* work (fewer wraps, fewer signal sets) rather than
re-arrange existing reads.

#### Considered and rejected: reconcile-only `wrapPlain`

Initially proposed: a `wrapPlain(value, target)` used at hot reconcile
call sites that drops `target?.[STORE_WRAP]` routing for monomorphic
call-site shape. **This is unsafe.** Projections reconcile through
`applyState` via `runProjectionComputed`'s
`storeSetter(wrappedStore, reconcile(v, key))` (see
`projection.ts:147`). After draft writes, only the *root* projection
target has `STORE_OVERRIDE` populated; nested children route through
the dispatcher's fast path. Those children's `wrap(child, target)`
calls *must* walk through `target[STORE_WRAP]` so the projection's
`wrapper` (which sets `STORE_WRAP` / `STORE_LOOKUP` / `STORE_FIREWALL`
on each newly created proxy) stays attached. A `wrapPlain` would
re-wrap children via the default `storeTraps`, breaking:

- draft-write routing (writes through the child proxy wouldn't engage
  `setProjectionWriteActive` / the firewall guard),
- identity caching (the projection's `wrappedMap` would diverge from
  the per-subtree proxy actually exposed),
- signal freshness (signals cached against the projection proxy
  wouldn't see reads coming through a fresh base proxy).

Projection reconcile is a primary use case, not an edge case, so
this option is permanently off the table. Any future wrap
restructuring has to preserve the `STORE_WRAP` dispatch.

## Targeted regression analysis: `tree/[2,2,...,2]/render` and `tree/[500]/[reverse]`

User flagged these two UIBench scenarios as the worst per-test gaps to React in `sCU=on` mode (Solid 2 currently around half React's speed on both), with the caveat that they may be affected by benchmark ordering. Isolating each test (`FILTER=...`, `i=30`, `sCU=on`, `disableSCU=1`):

### Per-test medians

| build | `tree/[2,2,2,2,2,2,2,2,2,2]/render` | `tree/[500]/[reverse]` |
| --- | ---: | ---: |
| `current` (all opts) | `~3.80 ms` | `~2.50 ms` |
| `main-s007` | `~4.00 ms` | `~2.50 ms` |
| `main-14` | `~2.20 ms` | `~0.90 ms` |
| current vs `main-14` | `+73%` | `+178%` |

Cross-check against full-suite (`i=10`):

| build | render in-suite | reverse in-suite |
| --- | ---: | ---: |
| `current` | `5.75` | `2.95` |
| `main-14` | `3.85` | `1.10` |
| `main-s007` | `7.60` | `2.95` |

Ordering caveat partially confirmed: every build pays ~+50% on render and ~+15-25% on reverse when run in the suite vs. isolation (V8 IC poisoning across tests), but the *ratio* current/main-14 is preserved. So the regression is real and not an ordering artifact. Notably, `current` is ahead of `s007` on render (likely Opts #1-#4 paying off on the mount path) and tied on reverse.

### `tree/[2,2,...,2]/render` — where is the time?

Architectural cost. Categorizing top self-time CPU samples (sum across 30 iters, sCU=on):

| function | `current` | `main-14` | Δ |
| --- | ---: | ---: | ---: |
| `cleanChildren` | `36.03 ms` | `33.30 ms` | +2.7 |
| `(anonymous JSX)` | `14.79 ms` | `15.02 ms` | -0.2 |
| signal `get` | `13.72 ms` | `4.38 ms` | **+9.3** |
| `insertBefore` (native) | `11.23 ms` | `9.47 ms` | +1.8 |
| `wrap` | `9.44 ms` | `0` (absent) | **+9.4** |
| inner accessor `r` / `dynamicProp` | `7.00` | `5.36` | +1.6 |
| `disposeChildren` / `cleanupNode` | `6.77` | `3.40` | +3.4 |
| `children` | `6.62` | `3.14` | +2.5 |
| `cloneNode` (native) | `6.01` | `7.83` | -1.8 |
| `updateKeyedMap` / `each`/mapper | `4.89` | `4.32` + `1.64` = `5.96` | -1.1 |
| `runWithOwner` | `3.73` | (absent) | **+3.7** |
| `TreeNode` component fn | `3.38` | `1.07` | +2.3 |
| `isWrappable` | `3.29` | (absent — no store proxy) | **+3.3** |
| `getNode` | `2.33` | (absent) | +2.3 |
| `recompute` | `2.21` | (absent) | +2.2 |
| total app-side category | `143.30 ms` | `90.35 ms` | **+53 ms** |

Roughly ~30 ms of the 53 ms gap is concentrated in the *new in 2.0* primitives — `wrap` (+9.4), signal `get` overhead from larger Signal shape (+9.3), `isWrappable` (+3.3), `runWithOwner` (+3.7), `getNode` (+2.3), `recompute` (+2.2). The remaining ~23 ms is spread across small per-component costs (deeper owner trees, larger TreeNode fn body, child management).

This matches the documented architectural delta in the `Solid 2 → 0.14 architectural delta map` section. There is no single-fix optimization here; this is the cost of the override/snapshot/queue model. We've already clawed back some via Opts #1-#4 (current beats `s007` on this scenario by ~0.2 ms and is much closer to `main-14` than the naive starting point).

### `tree/[500]/[reverse]` — where is the time?

**Almost entirely in native `insertBefore`, not app code:**

| category | `current` | `main-14` | Δ |
| --- | ---: | ---: | ---: |
| app code (signals + jsx + store) | `30.60 ms` | `18.42 ms` | +12.2 |
| harness | `10.96` | `10.42` | +0.5 |
| `(garbage collector)` | `7.85` | `6.72` | +1.1 |
| **`insertBefore` (native)** | **`108.76 ms`** | **`33.28 ms`** | **+75.5** |

The 75 ms regression in native `insertBefore` is the bulk of the 1.6 ms/iter gap.

#### Drilling into the DOM op delta

Instrumented `Element.prototype.insertBefore`/`appendChild`/`remove`/`replaceChild` and ran the test for 10 iters:

| build | `insertBefore` calls | `appendChild` | `remove` | `replaceChild` | total mutations |
| --- | ---: | ---: | ---: | ---: | ---: |
| `current` | `10631` | `8` | `3` | `6` | `10648` |
| `main-s007` | `10631` | `8` | `3` | `6` | `10648` |
| `main-14` | `10131` | `508` | `0` | `6` | `10645` |

**Total mutation count is identical (~10645).** main-14 just routes ~500 of them through `appendChild` instead of `insertBefore` (its swap-loop algorithm uses `appendChild(n)` when the target anchor is `null`, where udomdiff always uses `insertBefore(node, null)`).

So per-call cost:
- `current`: `108.76 ms / 10631 ≈ 10.2 µs/call`
- `main-14`: `33.28 ms / 10131 ≈ 3.3 µs/call`

**Same DOM, same parent layout, same total ops, but each native call is ~3× more expensive.**

Verified the rendered DOM is byte-identical across builds (504 elements, identical `htmlLen` of `14491`, same `byDepth`, no comment/text node boundaries inside the `<ul>`, 500 direct `<li>` children). So the regression is not a DOM-weight effect.

#### Most likely cause: dom-expressions algorithm change

The bundles use different `reconcileArrays` algorithms:

- `main-14.js` uses an older swap-loop reconcile (`reconcileArrays(parent, ns, us)`) with explicit "swap forward" / "swap back" loops that for a perfect reverse do **one** `insertBefore`/`appendChild` per item with a single anchor point that walks toward the front.
- `main.js` (current) and `main-s007.js` use **udomdiff** (`reconcileArrays(parentNode, a, b)`), which for a perfect reverse takes the "swap backward" branch: **two** `insertBefore` calls per loop iteration, each to a *different* anchor (sibling navigation via `.nextSibling`).

Same final call count (~500), but udomdiff:
1. Splits the work across 2× more native call sites (4 distinct `insertBefore` JS sites + 1 `replaceChild` site, vs. main-14's 2 `insertBefore` + 1 `appendChild`), giving each a smaller share of V8's inline-cache budget.
2. Uses `.nextSibling` lookups inside the hot loop (not in main-14's algo).
3. Distributes inserts across two non-adjacent anchors per iteration, which may defeat Blink's adjacency optimization for repeated mutations against the same anchor.

This regression appeared *before* `s007` (s007 already has it) and was inherited by every Solid 2 build since. It is not a Solid signals/store regression. To verify, the next experiment is to swap the algorithm back in `dom-expressions/src/reconcile.js` and re-measure — that is a separate repo change, not a Solid change.

### Bottom line

Recovering parity with `main-14` on these two tests is split into two independent workstreams, neither in the Solid signals/store hot path we've been optimizing:

1. **Render scenario (~+1.6 ms/iter)**: Tier-1 architectural cost of 2.0 (overrides, snapshots, larger Signal shape, owner scopes). No single-fix; would require revisiting feature trade-offs.
2. **Reverse scenario (~+1.6 ms/iter)**: Almost entirely native `insertBefore` regression caused by the udomdiff algorithm in `dom-expressions`. Per-op cost is 3× the older swap-loop algorithm despite identical total op counts. Fix lives in `dom-expressions/packages/dom-expressions/src/reconcile.js`.

The user's "ordering / correctness" caveat is partially borne out: in-suite numbers are inflated for every build, but the *ratio* of current to `main-14` is stable in isolation. So our gap is real, just measured differently in-suite vs. solo.

### Experiment: swap udomdiff for main-14-era swap-loop reconcile

Replaced `node_modules/dom-expressions/src/reconcile.js` (udomdiff) with the older swap-loop / LIS algorithm extracted from `main-14.js`:

- Common-prefix and common-suffix scans.
- Two reversal-detect loops: `u === nx → swap forward` (single `insertBefore`) and `ux === n → swap back` (single `insertBefore`/`appendChild`).
- `removeChild` for net deletions, `insertBefore` against a tracked tail anchor `ul` for net insertions.
- Full-replace fast path (`textContent = ""` + `appendChild` loop) when no nodes can be reused.
- LIS-based reorder fallback for general permutations (`longestPositiveIncreasingSubsequence`).

Rebuilt `solid-web` → rebuilt `solid-uibench`. All `18` Solid monorepo tasks passed, including `@solidjs/web` test suite.

#### Correctness verification

DOM-op signatures now match `main-14` byte-for-byte for `tree/[500]/[reverse]` over 10 iterations:

| build | `insertBefore` | `appendChild` | `remove` | `replaceChild` |
| --- | ---: | ---: | ---: | ---: |
| current (old algo) | `10131` | `508` | `0` | `6` |
| `main-14` | `10131` | `508` | `0` | `6` |
| `main-s007` (udomdiff) | `10631` | `8` | `3` | `6` |

Identical mutation count and method distribution → algorithm produces equivalent DOM results to `main-14`.

#### Performance impact

i=10 full sweep (sum of medians, sCU=on, 96 tests):

| build | total | Δ vs current(udomdiff) |
| --- | ---: | ---: |
| `current` (udomdiff) | `54.30 ms` | baseline |
| `current` (swap-loop) | `48.60 ms` | **-5.70 ms (-10.5%)** |
| `main-14` | `36.60 ms` | gap shrinks from `17.7` to `12.0 ms` |

i=20 sweep targeted on reorder-heavy tree benchmarks:

| test | current (old algo) | `main-14` | Δ | previous Δ (udomdiff) |
| --- | ---: | ---: | ---: | ---: |
| `tree/[500]/[reverse]` | `1.50` | `1.20` | `+25%` | `+178%` |
| `tree/[500]/[kivi_worst_case]` | `1.50` | `1.20` | `+25%` | larger |
| `tree/[500]/[react_worst_case]` | `0.70` | `0.50` | `+40%` | larger |
| `tree/[500]/[virtual_dom_worst_case]` | `0.80` | `0.50` | `+60%` | larger |
| `tree/[500]/[snabbdom_worst_case]` | `0.70` | `0.50` | `+40%` | larger |
| `tree/[10,50]/[reverse]` | `0.70` | `0.60` | `+17%` | larger |
| `tree/[5,100]/[reverse]` | `0.70` | `0.60` | `+17%` | larger |
| `tree/[50,10]/[reverse]` | `0.90` | `0.70` | `+29%` | larger |
| `tree/[2,2,...,2]/render` | `6.50` | `4.20` | `+55%` | `+55%` (unchanged — architectural) |

The remaining gaps on reorder benchmarks are now in the same `+25-40%` range as the rest of UIBench — meaning the udomdiff-specific regression is gone, and what's left is the architectural delta we already documented.

#### Per-call cost recovery

`tree/[500]/[reverse]` median dropped `2.50 ms → 1.10 ms` in isolation (sCU=on, i=30). Native `insertBefore` cost goes from `~10.2 µs/call` (udomdiff) to `~3.3 µs/call` (swap-loop). The browser handles the swap-loop pattern more cheaply because:

- Single anchor that walks predictably (browser's adjacency cache stays warm).
- One mutation per loop iteration (cleaner JIT IC profile per call site).
- No `.nextSibling` lookups inside the hot loop (udomdiff reads `a[aStart].nextSibling` and uses `a[aEnd-1].nextSibling` per swap-backward iteration).

#### Status

Change applied to `node_modules/dom-expressions/src/reconcile.js` (the resolved npm install path) and propagated through `solid-web` rebuild → `solid-uibench` rebuild. Not yet committed upstream to `dom-expressions`. The swap is correctness-verified by DOM-op equivalence and all Solid tests pass, but is not yet validated against the dom-expressions test suite or other consumer benchmarks.

Original udomdiff was deliberately chosen for **size** (388B vs stage0's 941B per [js-diff-benchmark](https://github.com/luwes/js-diff-benchmark)) and a marginal win on simple-pattern micro-benchmarks. Reverting wholesale loses both. Next experiment was to see if udomdiff could be surgically fixed instead.

### Experiment: surgical udomdiff — single-anchor walk inside swap-backward branch

Hypothesis from the algorithm-swap finding: the per-call cost gap on reverse comes specifically from udomdiff's `swap backward` branch using **two** `insertBefore` calls per iteration to **two different anchors** (lines 36-39), with `.nextSibling` lookups in the hot loop. Stage0's reversal loops use a **single walking anchor** with one insert per iteration. Same number of total calls, very different browser cache behavior. If we can keep udomdiff's structure (trigger conditions, fallback path, size) but rewrite the inside of swap-backward to use a single-anchor walk, we should recover most of the reorder gain without the size cost.

#### Diff (6 lines changed)

```diff
      // swap backward
-    } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
-      const node = a[--aEnd].nextSibling;
-      parentNode.insertBefore(b[bStart++], a[aStart++].nextSibling);
-      parentNode.insertBefore(b[--bEnd], node);
-
-      a[aEnd] = b[bEnd];
+    } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
+      const anchor = a[aStart];
+      do {
+        parentNode.insertBefore(a[--aEnd], anchor);
+        bStart++;
+        if (aStart >= aEnd - 1 || bStart >= bEnd) break;
+      } while (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]);
```

Trigger condition is **unchanged** — exactly the same symmetric end-swap detection udomdiff has always used. So no false positives on patterns udomdiff used to fall through to the map fallback (rotate-right, replace-with-noise, etc). The walk loop only proceeds while the symmetric condition continues to hold (pure reverse, n-step end-swap), which is exactly the case udomdiff would have taken N-iterations of swap-backward to handle.

Single-anchor walk semantics:
- `anchor = a[aStart]` is captured once and never moves; every `insertBefore` targets the same DOM-position.
- Each iteration moves the current back-of-old (`a[--aEnd]`) to before the anchor — exactly what stage0's "swap forward" loop does.
- Loop exits when the array is consumed (`aStart >= aEnd - 1 || bStart >= bEnd`) or the symmetric condition no longer holds.
- After the walk, the prefix scan in the next outer iteration cleans up the trailing front-of-old (which equals back-of-new) without needing extra logic.

The walk also drops the `a[aEnd] = b[bEnd]` array mutation udomdiff did to track the back-end swap — single-anchor walks don't need this bookkeeping because they don't touch the back end.

#### Correctness verification

DOM-op signatures for `tree/[500]/[reverse]` over 10 iterations:

| build | `insertBefore` | `appendChild` | `remove` | `replaceChild` | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| current (surgical) | `10611` | `8` | `3` | `6` | `10628` |
| `main-s007` (vanilla udomdiff) | `10631` | `8` | `3` | `6` | `10648` |
| `main-14` (stage0) | `10131` | `508` | `0` | `6` | `10645` |

Same total mutation count as both reference algorithms (10628 ≈ 10645 ≈ 10648 — the small differences are op-type splits, not extra/missing work). The surgical actually does **20 fewer `insertBefore`** calls than vanilla udomdiff over 10 iterations because the single-anchor walk avoids the no-op self-insert that udomdiff's symmetric swap-backward hits at the boundary (when `bEnd-1` equals the front-of-old that hasn't moved yet).

All 18 Solid monorepo tasks pass with fresh (non-cached) test runs.

#### Performance impact (isolated, sCU=on, i=30, same power state, back-to-back A/B)

| test | udomdiff | strict surgical | Δ |
| --- | ---: | ---: | ---: |
| `tree/[500]/[reverse]` | `2.60` | **`1.30`** | **`-1.30 ms (-50%)`** |
| `tree/[2,2,...,2]/render` | `4.20` | `4.30` | `+0.10 (noise)` |
| `tree/[500]/[react_worst_case]` | `0.60` | `0.60` | `0` |
| `tree/[500]/[kivi_worst_case]` | `1.20` | `1.30` | `+0.10` |
| `tree/[500]/[snabbdom_worst_case]` | `0.60` | `0.70` | `+0.10` |
| `tree/[500]/[virtual_dom_worst_case]` | `0.60` | `0.60` | `0` |

Reverse drops from `+145%` over `main-14`'s `1.10 ms` to **`+18%`** — within the architectural-cost band that everything else sits in. Render and the worst_case scenarios show at most `+0.10 ms` (within run-to-run variance for these tests at this scale).

#### Comparison to full stage0/ivi swap

The full algorithm swap recovered a similar magnitude on reverse (`2.50 → 1.10 ms`) but at the cost of `~553 bytes` of extra bundle and possible regressions on simple-case patterns. The surgical fix achieves `2.60 → 1.30 ms` on the same scenario (`-50%`) with **6 lines** of source change, **+4 lines** of bytes, and zero change to udomdiff's trigger conditions, fallback path, or external behavior outside the symmetric swap-backward case.

| approach | reverse gain | bundle delta | risk |
| --- | --- | --- | --- |
| keep udomdiff | baseline | 0 | no | 
| surgical (this) | `-50%` (matches stage0 within noise) | **+~50 bytes** | minimal — same trigger, equivalent DOM ops |
| full stage0/ivi swap | `-58%` | `+~553 bytes` | unknown — different trigger + fallback paths |

#### Status

The surgical fix is a strict improvement over vanilla udomdiff for the targeted regression — same trigger condition, equivalent DOM operations, single-anchor pattern that the browser handles ~3× more efficiently per native call. Recommended path forward is to land this in `dom-expressions` upstream once validated against its own test suite and js-framework-benchmark.

Patch lives at `node_modules/dom-expressions/src/reconcile.js` and propagates through `solid-web` rebuild → `solid-uibench` rebuild. Backups: `/tmp/reconcile-udomdiff.js` (vanilla) and `/tmp/reconcile-surgical.js` (broad-condition variant — broader trigger that also catches rotate-right; not used due to small false-positive cost on some worst_case scenarios). The strict-condition variant is the one currently active and recommended.

### j-f-b CPU Suite — Solid 2.0 (with surgical fix) Competitive Position (2026-05-06)

Goal: validate Solid 2.0's competitive position on `js-framework-benchmark` after the surgical udomdiff fix landed, and decide whether further reconcile-tier optimizations (full-replace fast path, range-dispatch metadata channel) are worth the cross-package surface-area investment.

#### Method

- Full Solid monorepo `pnpm build`; rebuilt `solid-next` j-f-b entry against local `@solidjs/signals`/`solid-js`/`@solidjs/web` workspace via `file:` deps. Bundle: `36,300 bytes`, surgical fix verified in compiled bundle (`e.insertBefore(t[--o], i)` in the swap-backward branch, no `nextSibling)` from old udomdiff).
- Comparison frameworks rebuilt fresh: `solid-1.x` (1.9.12), `react-hooks` (19.0.0), `svelte` (5.55.5), `vanillajs`. Inferno omitted; user requested Svelte 5 as the second comparison point.
- Headless Chromium via Playwright runner (`benchmarkRunner.js --headless --runner playwright`), `count 10`, all 9 standard CPU benchmarks (`01_run1k` through `09_clear1k_x8`). 4× CPU throttling (j-f-b default).
- Power: AC. No other applications running.

#### Script-time medians (ms, lower better)

| bench                    | solid-next | solid-1.x | react-hooks | svelte-5 | vanillajs |
|--------------------------|-----------:|----------:|------------:|---------:|----------:|
| `01_run1k`               |        5.3 |       3.9 |        11.7 |      5.3 |       2.6 |
| `02_replace1k`           |        8.9 |       8.5 |        17.1 |      9.8 |       6.2 |
| `03_update10th1k_x16`    |        2.3 |       1.6 |         5.8 |      1.8 |       0.8 |
| `04_select1k`            |        0.7 |       0.6 |         2.3 |      2.6 |       0.5 |
| `05_swap1k`              |        2.0 |       1.5 |        25.4 |      2.1 |       0.4 |
| `06_remove-one-1k`       |        0.6 |       0.5 |         1.6 |      1.0 |       0.3 |
| `07_create10k`           |       55.5 |      43.5 |       226.7 |     54.0 |      29.4 |
| `08_create1k-after1k_x2` |        5.1 |       4.1 |        10.5 |      5.4 |       2.6 |
| `09_clear1k_x8`          |       13.4 |      15.0 |        21.7 |     13.9 |      11.4 |

#### Geometric mean (script time across all 9 benches)

| framework             | geomean | ratio vs solid-next |
|-----------------------|--------:|--------------------:|
| vanillajs (floor)     |    2.08 |              `0.50` |
| **solid-1.x**         |    3.45 |              `0.83` |
| **solid-next** (this) |    4.14 |              `1.00` |
| svelte-5              |    5.03 |              `1.21` |
| react-hooks           |   12.13 |              `2.93` |

#### Key findings

1. **Decisive lead over React**: `2.93×` geomean advantage; `5.05×` better on `01_run1k`, `1.92×` better on `02_replace1k`, `12.7×` better on `05_swap1k`, `4.08×` better on `07_create10k`. React falls noticeably behind on every bench.
2. **Ahead of Svelte 5 overall** (`-21%` geomean), with notable specific wins:
   - `04_select1k`: `-73%` (`0.7` vs `2.6`) — Solid's selector pattern is dramatically cheaper than Svelte 5's effect-rerun pattern.
   - `06_remove-one-1k`: `-40%` (`0.6` vs `1.0`).
   - `08_create1k-after1k_x2`: `-6%` (`5.1` vs `5.4`).
   - Tied within noise on `01_run1k`, `02_replace1k`, `05_swap1k`, `07_create10k`, `08_create1k-after1k_x2`, `09_clear1k_x8`.
   - Svelte wins only on `03_update10th1k_x16` (`1.8` vs `2.3`, `-22%`) — per-cell update churn.
3. **Behind Solid 1.x by `+20%` geomean** — entirely architectural cost, concentrated in:
   - `07_create10k`: `+12.0 ms` (the single largest absolute gap; mount cost — Signal/Store/owner machinery overhead at scale, same root cause as the UIBench `*/render` regression).
   - `03_update10th1k_x16`: `+0.7 ms` (`+44%`) — signal write/read overhead per cell.
   - `05_swap1k`: `+0.5 ms` (`+33%`) — small absolute, but proportionally visible.
   - `02_replace1k`: `+0.4 ms` (`+5%`) — within range of measurement noise; surgical fix is doing its job here.
   - One outright Solid-next win: `09_clear1k_x8` (`13.4` vs `15.0`, `-11%`) — disposal-heavy pattern that benefits from the v2 owner-tree refactor.

#### Surgical fix validation on `02_replace1k`

Pre-fix expectation (from earlier `/tmp` trace analysis): solid-next was paying both an algorithmic cost (vs 1.x) and a per-call `insertBefore` cost. With the surgical fix landed:

- solid-next `8.9 ms` ≈ solid-1.x `8.5 ms` (`+5%`, within run-to-run wobble).
- solid-next `8.9 ms` < svelte-5 `9.8 ms` (`-9%`).
- vs vanillajs `6.2 ms`: gap of `+2.7 ms` (`+44%`) — most of which is the unavoidable `<For>`-machinery overhead (signal allocation per row, reactive label binding, owner-scope per row).

The `02_replace1k` bench does NOT show the catastrophic `>2×` gap that we hypothesised earlier when discussing the metadata-channel optimization. **The surgical fix already closed this gap.** Solid 2.0 is competitive on replace1k as-is.

#### Implications for the metadata-channel design (full-replace + range-dispatch)

Re-evaluating cost/benefit with concrete j-f-b numbers in hand:

- **Full-replace fast path on `02_replace1k`**: would close `~30–50%` of the residual `2.7 ms` gap to vanilla. Estimated impact: `0.8–1.4 ms` recovery, i.e. `9–16%` improvement on this single bench. Geomean impact: `~2%`.
- **Range-dispatch on `repeat`**: not exercised by standard j-f-b at all. Real-world impact in pagination/virtualization scenarios is plausibly meaningful but unmeasured here.
- **Architectural mount cost** (`07_create10k`, `*/render` in UIBench): the largest absolute gap (`+12.0 ms`). Not addressable via metadata channel — needs work on Signal shape, store-proxy dispatcher, render-effect machinery.

Decision: **defer the metadata-channel work**. The optimization is well-designed but addresses a polish-tier gap on a single bench where Solid is already competitive. Cross-package surface-area cost (signals → solid-js → solid-web/core → rxcore → dom-expressions) doesn't pay back at this magnitude. The bigger lever is the architectural mount cost, which is a different lane entirely.

Design preserved for future revisit (see `documentation/performance-experiments.md` discussion of `arrayMeta` WeakMap channel through `rxcore`).

#### Status

- Surgical udomdiff fix: **landed in `/Users/ryancarniato/Development/dom-expressions/packages/dom-expressions/src/reconcile.js`**, validated against `dom-expressions` test suite (`439/439 passed`) and now confirmed on j-f-b. Recommended for upstream submission.
- Solid 2.0 competitive position: **better than React (`2.93×`), better than Svelte 5 (`-21% geomean`), `+20%` slower than Solid 1.x** (architectural; not reconcile-related).
- Metadata-channel optimization: **deferred**, design captured. Trigger condition for revisit: real-world `repeat`-heavy workload measurement, or if `02_replace1k` regresses against svelte/react in future runs.
- Next strategic lane: architectural mount cost (`07_create10k`, UIBench `*/render`) — Signal/Store overhead, render-effect machinery. Different problem, different toolset.

Bundle sizes (post all optimizations through this session):

| package                                 | size (gzipped est.) |
|-----------------------------------------|--------------------:|
| `solid-next` j-f-b entry                |       `36,300 B` raw |
| `dom-expressions` reconcile delta       |          `+~50 B` |
| `solid-signals` `applyStateFast` delta  |         `~+140 LOC` |

## SSR Lane: `isomorphic-ui-benchmarks`

Tier-2 anchor for the SSR/hydration lane. Sibling repo at `../isomorphic-ui-benchmarks/` runs Solid 1.x and `solid-next` (2.0) side-by-side via the same Benchmark.js harness used for React, Inferno, and other competitors. Higher ops/sec is better.

### Setup

- `solid/` directory holds the published 1.x baseline (`solid-js@1.9.12`, `babel-preset-solid@1.9.12`). This is the northstar — untouched, npm-published version.
- `solid-next/` directory is a parallel copy of the 1.x bench wired against local Solid 2.0 workspace packages via `file:` deps:
  - `solid-js-next` → `../solid/packages/solid`
  - `babel-preset-solid-next` → `../solid/packages/babel-preset-solid`
  - `@solidjs/web` → `../solid/packages/solid-web`
  - `@solidjs/signals` → `../solid/packages/solid-signals`
- The two-name split (`solid-js-next` vs the published `solid-js@1.9.12`) lets npm resolve both 1.x and 2.0 in the same install tree.
- `@rollup/plugin-alias` rewrites bare `solid-js` imports inside the `solid-next/` source to `solid-js-next` before node-resolve runs. `customResolver` chains through `nodeResolvePlugin` so the alias replacement is treated as a module name, not a literal file path.
- `preserveSymlinks: true` on both rollup top-level and inside `nodeResolvePlugin` keeps the importer path inside the bench's `node_modules` tree when resolving transitive deps from inside the symlinked `@solidjs/web` package — without it, node-resolve walks up from the workspace's real path, which has no `solid-js-next` or `@solidjs/signals` visible.
- 2.0 component migration in `solid-next/` entries: `onMount` → `onSettled`, `<Index>` → `<For>` with accessor pass-through (`item={item}`, child component receives an accessor and calls it).
- Run: `PATH="$PWD/node_modules/.bin:$PATH" node ./scripts/rollup.js <lib>` to bundle, then `node --expose-gc benchmark-server/run.js` to measure.

### Baseline (2026-05-07, AC, 4 frameworks)

Two benchmarks, four frameworks. `solid` (1.x) is the northstar; `solid-next` is current 2.0; `react` and `inferno` are the lower- and middle-tier reference points.

| bench (ops/sec, higher better) |     react |   inferno |   **solid 1.x** | **solid-next** |
|--------------------------------|----------:|----------:|----------------:|---------------:|
| `search-results`               |     3,222 |     4,680 |      **25,945** |      **6,797** |
| `color-picker`                 |    18,611 |    36,455 |      **57,863** |     **14,049** |

Ratios (`solid-next` row baseline = `1.00`):

| bench           | react vs next | inferno vs next | solid-1.x vs next |
|-----------------|--------------:|----------------:|------------------:|
| `search-results`|         `0.47`|           `0.69`|             `3.82`|
| `color-picker`  |         `1.32`|           `2.59`|             `4.12`|

### Reading the spread

- The 1.x → 2.0 ratio is the regression budget to recover: **`3.82×`** on `search-results`, **`4.12×`** on `color-picker`. Roughly uniform across two structurally different benches (a flat list of varied rows vs. a small nested tree).
- `solid-next` lands in very different positions vs. react across the two benches:
  - `search-results`: `2.1×` faster than react, `1.45×` faster than inferno.
  - `color-picker`: `0.75×` of react (slower), `0.39×` of inferno (slower).
- The uniformity of the 1.x/2.0 ratio on two unrelated component shapes points at the SSR template runtime itself (`dom-expressions/src/server/`), not any one component pattern.

### Implications

- The Tier-1 SSR lane needs a `renderToString` micro-bench inside `solid-web/test/` so we can iterate on the SSR template runtime without round-tripping through the sibling repo every change.
- Headline target: close the 1.x → 2.0 gap by `~3×` (the architectural ceiling 1.x sets) before chasing competitor-side gains.
- Bundle size and SSR template shape are the two starting points to instrument; `dom-expressions/src/server/` and Solid's SSR-specific component runtime are the mechanism candidates.

### Investigation 1: GC pressure from non-sync memos (2026-05-07)

V8 `--prof` of `solid-next/color-picker` showed **GC at 72.9% of all ticks**. Top JS frame was an anonymous compute inside `createMemo` — every memo, including statically-synchronous ones emitted by the compiler for trivial `<div>{value}</div>` reads, was allocating a full `ServerComputation` object, registering an `onCleanup`, and walking through `processResult` / `$REFRESH` / observer-tracking machinery designed for async memos.

Fix landed in `packages/solid/src/server/signals.ts`:

- Honored the `sync: true` `MemoOptions` flag (already emitted by the compiler for non-async memos and used internally) by routing those calls to a new `createSyncMemo()` lean path.
- `createSyncMemo()` allocates one owner, one cached value, and one cached error — no `ServerComputation`, no `onCleanup`, no observer tracking. SSR retry of pending memos is delegated to the streaming engine's hole re-pull (`resolveSSRNode` in `dom-expressions`), which already covers the case.
- Tagged internal control-flow primitives (`mapArray`, `repeat`, the outer memos in `Show` / `Switch` / `children` / `lazy`) with `{ sync: true }` on both client and server so the compiler-shaped fast path covers them too.

Per-bench (Benchmark.js medians):

| bench (ops/sec)  | baseline | post-`sync: true` | delta |
|------------------|---------:|------------------:|------:|
| `search-results` |    6,797 |            10,195 | `+50%` |
| `color-picker`   |   14,049 |            18,522 | `+32%` |

Profile after change: GC dropped to **58.1%**. New top JS frame: `createOwner()` at 2.9%.

### Investigation 2: Lean SSR owner runtime (2026-05-07)

With async-memo overhead gone, `createOwner` was the next allocator hot spot. Upstream `@solidjs/signals/createOwner` returns a 14-field object (queue pointer, pending-disposal slot, pending-firstChild slot, prev-sibling pointer, packed `_config` flags, `_flags` heap/zombie flags, snapshot-scope flag, `dispose` method, etc.) — most of which are scheduler / heap / zombie / dev-mode plumbing the SSR runtime never reads.

Audit confirmed: every server-side primitive in `packages/solid/src/server/` calls owners only through the public surface (`createOwner`, `runWithOwner`, `getOwner`, `isDisposed`, `onCleanup`, `getNextChildId`, `createContext`, `setContext`, `getContext`, `createRoot`, `owner.dispose(false)`). Boundary primitives (`createErrorBoundary`, `createLoadingBoundary`, `createRevealOrder`) are already SSR-local; they consume the owner runtime through that public surface, not by reaching into upstream owner internals.

Replaced the upstream owner runtime in `packages/solid/src/server/signals.ts` with a lean implementation:

- `SSROwner` shape: 9 fields — `id`, `_transparent`, `_disposal`, `_parent`, `_context`, `_childCount`, `_firstChild`, `_nextSibling`, `_disposed`. No `_queue`, `_pendingDisposal`, `_pendingFirstChild`, `_prevSibling`, `_config`, `_flags`, `_snapshotScope`, no `dispose` method on the owner itself.
- `disposeOwner(owner, self?)` is a free function (called from `createErrorBoundary` and the streaming `createLoadingBoundary` in `hydration.ts` for retry-on-async). `createRoot` wraps it in the closure passed to `init`.
- Forward-only sibling chain — `_firstChild` / `_nextSibling`, no `_prevSibling`. SSR never disposes individual descendants, only entire subtrees on boundary retry, so the back-pointer is dead weight.
- Context map inheritance is identical to upstream: `_context: parent?._context ?? defaultSSRContext`, and `setContext` clones via spread. No allocation until a child writes.

Same pass cleaned up `mapArray` and `repeat`: SSR is single-pass, so the upstream "preserve children across recompute" trick (extra `parent` owner sibling to the memo, `runWithOwner(parent, ...)` wrapper around the per-row loop) is unnecessary. Row owners attach directly under the memo's owner. Saves one allocation + one `runWithOwner` per render of every list.

Per-bench (Benchmark.js, median of 3 runs):

| bench (ops/sec)  | post-`sync: true` | post-lean-owner | delta |
|------------------|------------------:|----------------:|------:|
| `search-results` |            10,195 |          11,411 | `+12%` |
| `color-picker`   |            18,522 |          22,483 | `+21%` |

### Cumulative status (2026-05-07)

Two-step total against the SSR Lane baseline:

| bench (ops/sec)  | baseline | current | total delta |
|------------------|---------:|--------:|------------:|
| `search-results` |    6,797 |  11,411 | `+68%` / `1.68×` |
| `color-picker`   |   14,049 |  22,483 | `+60%` / `1.60×` |

Updated competitor / northstar position:

| bench (ops/sec)  |  react |  inferno | **solid-next** | **solid 1.x** |
|------------------|-------:|---------:|---------------:|--------------:|
| `search-results` |  3,487 |    5,324 |     **11,411** |    **29,094** |
| `color-picker`   | 18,318 |   36,739 |     **22,483** |    **58,881** |

Ratios:

| bench            | react vs next | inferno vs next | solid-1.x vs next |
|------------------|--------------:|----------------:|------------------:|
| `search-results` |         `0.31` (was `0.47`) |           `0.47` (was `0.69`) |             `2.55` (was `3.82`) |
| `color-picker`   |         `0.81` (was `1.32`) |           `1.63` (was `2.59`) |             `2.62` (was `4.12`) |

`solid-next` now sits **above react on both benches** (was below on `color-picker`). 1.x → 2.0 gap closed by ~35-37%, roughly uniform across the two benches, consistent with the "the runtime itself is the bottleneck, not any specific component pattern" theory.

V8 `--prof` summary post-changes:

- **GC: 20.8%** (was 58.1% post-sync, 72.9% baseline).
- Top JS frames: `createSyncMemo` body (mapArray loops) `5.3%`, `resolveSSRNode` (in `dom-expressions`) `2.4%`, `createOwner` `1.4%`, `disposeOwner` `1.3%`. Spread thinly — no single hot site dominates.

### Focus shift: Inferno-on-color-picker as the target

Going forward `color-picker` is the single anchor benchmark for this lane (`search-results` will continue to show nominal gains as a side effect, no need to instrument it as a primary). Solid 1.x stays as a directional reference point — reaching it is not required. **Inferno is the bar**: `36,739` ops/sec on `color-picker` (currently `1.63×` faster than `solid-next`).

### Investigation 3: Lazy template escalation in `dom-expressions/resolveSSR`

Profiling `solid-next/color-picker` post-lean-owner showed allocations were still the dominant cost (`56%` GC). The next fattest source: every call to `ssr()` that had any holes was returning a `{ t: [strings], h: [], p: [] }` shape, even when nothing actually escalated to async.

Refactored `resolveSSR` into a two-mode resolver in `dom-expressions/packages/dom-expressions/src/server.js`:

- **Default mode** accumulates rendered HTML in a single `s` string and returns the lean `{ t: string }` form (matches Solid 1.x's `ssr()` shape — the same shape the no-hole branch already used).
- **Escalated mode** is allocated lazily, on the first hole that actually pushes async work — a function throwing `NotReadyError`, or a child template whose own `h` is non-empty. From that point on the rest of the holes go through the heavy `{ t: [strings], h, p }` machinery so the streaming engine can re-pull them on settle.
- Introduced `tryResolveString(node)` as a "best-effort sync resolver". Returns a string when fully resolvable; returns `{fn, promise}` / `{merge: node}` / `{bail: true}` to signal the kind of escalation needed otherwise.

Streaming engine (`packages/solid/src/server/hydration.ts`) was updated to handle both shapes: the post-loop `ret.t[0]` access becomes `Array.isArray(ret.t) ? ret.t[0] : ret.t`, the `while (ret.p.length)` loop guards on `ret.p` existing, and `SSRTemplateObject` was widened to a union of the lean and heavy shapes.

| bench (ops/sec) | pre-lazy | post-lazy | delta |
|-----------------|---------:|----------:|------:|
| `color-picker`  |   22,483 |    25,124 | `+12%` |

### Investigation 4: Pass-through `ssrRunInScope` + lazy owner capture at escalation

Profile of color-picker after Investigation 3 showed `createMemo.sync` 3.4%, `ssr` 2.3%, `tryResolveString` 1.4%, `disposeOwner`/`createOwner` each 1.3% — but the JSX call sites themselves were also fat.

`ssrRunInScope` was documented as a "pass-through" but was actually allocating per call:

```js
function ssrRunInScope(fn) {
  const owner = getOwner();
  if (!owner) return fn;
  return Array.isArray(fn)
    ? fn.map(hole => () => runWithOwner(owner, hole))
    : () => runWithOwner(owner, fn);
}
```

For `color-picker` this fired once per row (133×): `1` array from `.map()` + `1` wrapper closure per hole. The wrapper preserves owner across async retry — *only relevant when a hole actually escalates*. Sync renders pay the wrap and never use it.

Moved the wrap to `tryResolveString` in `dom-expressions/server.js`: when a function hole throws `NotReadyError`, capture `getOwner()` at that moment and wrap with `runWithOwner` before pushing to `result.h`. Required adding `runWithOwner` to the rxcore import. `ssrRunInScope` itself becomes a true identity function.

| bench (ops/sec) | pre-passthrough | post-passthrough | delta |
|-----------------|----------------:|-----------------:|------:|
| `color-picker`  |          25,124 |           27,500 | `+9.5%` |

### Investigation 5: `mapArray` / `repeat` inline `runWithOwner`

The original mapArray loop wrapped each row in a fresh closure:

```js
runWithOwner(o, () => mapFn(() => items[i], () => i))
```

The outer `() => mapFn(...)` is an extra wrapper closure per row — V8 doesn't escape-analyze this away because `runWithOwner` actually receives it. Inlined `runWithOwner`'s push/pop directly into the loop, which deletes the wrapper:

```js
for (let i = 0; i < len; i++) {
  currentOwner = parentOwner; // reset so createOwner attaches to memo, not previous row
  const o = createOwner();
  currentOwner = o;
  s.push(mapFn(() => items[i], () => i));
}
```

The per-row `() => items[i]` and `() => i` accessors *cannot* be shared across iterations (tried this — `ssr-async > Async in For > async inside For iterations captured as holes` failed because async holes are replayed after the loop completes, with `curI` already at `len-1`).

Same shape applied to `repeat`.

| bench (ops/sec) | pre-inline | post-inline | delta |
|-----------------|-----------:|------------:|------:|
| `color-picker`  |     27,500 |      28,300 | `+2.9%` |

### Investigation 6: SSR owner pool

After Investigations 3-5, `createOwner` / `disposeOwner` were still showing in the profile (`1.3%` + `1.3%`). With `For` rendering 133+ owners per render — and `renderToString` disposing the entire tree at end-of-render — each render allocates and immediately abandons that many objects. Pooling reclaims them.

Added a render-spanning freelist in `packages/solid/src/server/signals.ts`:

- `OWNER_POOL_MAX = 4096` — bounds memory.
- `createOwner` pops from the pool and overwrites all 9 fields (preserves V8's monomorphic hidden class). Falls back to `{ ... }` literal when empty.
- `disposeOwner` pushes back, after clearing `_parent` / `_nextSibling` to drop heavy references.
- Leaf fast path in `disposeOwner`: when `_firstChild` and `_disposal` are both null (the typical row case), skip the recursion / `_childCount` reset / `_disposal` invocation block entirely.

Steady-state owner allocation drops to `0` for renders below the pool cap.

| bench (ops/sec) | pre-pool | post-pool | delta |
|-----------------|---------:|----------:|------:|
| `color-picker`  |   28,300 |    31,000 | `+9.5%` |

### Investigation 7: Inline `ssr()` (avoid rest-args allocation)

`ssr(t, ...nodes)` allocates a `nodes` array on every call. With `~140` `ssr()` invocations per `color-picker` render that's `~140` extra arrays. Inlined `resolveSSR`'s body into `ssr` and walk `arguments` directly:

```js
export function ssr(t) {
  const len = arguments.length;
  if (len === 1) return { t };
  let s = t[0];
  let result = null;
  for (let i = 1; i < len; i++) {
    const hole = arguments[i];
    const ht = typeof hole;
    if (ht === "string") { /* inline string fast path */ }
    else if (ht === "number") { /* inline */ }
    else if (hole == null || ht === "boolean") { /* skip */ }
    else { /* fall through to tryResolveString / escalation */ }
    // ...
  }
  // ...
}
```

The inline string/number/null/bool fast paths skip the `tryResolveString` function call for the typical "all-static-after-eval" hole shape. `resolveSSR` is removed (was the only caller).

| bench (ops/sec) | pre-inline | post-inline | delta |
|-----------------|-----------:|------------:|------:|
| `color-picker`  |     31,000 |      31,300 | noise (`+1%`) |

V8 was already inlining the rest-args spread well; the visible win was small. The cleanup is still worth keeping for clarity / smaller bundle, but not a perf lever.

### Investigation 8: `mapArray` / `repeat` row-owner elision (id mutation)

The hottest list path was still allocating + linking + disposing one pooled owner per row. Solid 1.x handles this cleaner: its `For` is a tight `simpleMap` loop with **no per-row owner** at all; row identifiers come from a shared `sharedConfig.context.count`/`id` rather than the owner tree.

Replicated the same shape on the SSR side. Per row in `mapArray` / `repeat`:

- Don't call `createOwner()`. `currentOwner` stays = the memo's owner across all iterations.
- Mutate the memo owner's `id` to `formatChildId(origId, origChildCount + i)` and reset `_childCount` to 0. Any nested `createOwner` (compiler-emitted memos, providers, boundaries) under the row computes its id under that synthetic row prefix — the exact id the **client** produces from its real per-row owner.
- After the loop, restore `parent.id = origId` and advance `parent._childCount = origChildCount + len` so siblings after `<For>` get the right next id.

```js
const parent = currentOwner;
const origId = parent.id;
const origChildCount = parent._childCount;
try {
  for (let i = 0, len = items.length; i < len; i++) {
    if (origId !== undefined) parent.id = formatChildId(origId, origChildCount + i);
    parent._childCount = 0;
    s.push(mapFn(() => items[i], () => i));
  }
} finally {
  parent.id = origId;
  parent._childCount = origChildCount + items.length;
}
```

Hydration id parity is preserved: client `mapArray` allocates a row owner with id `formatChildId(memo.id, i)`, server synthesizes the exact same prefix. Client retains its row owners — they're essential for client-side updates / per-row reactivity, this elision is **server-only**.

Why shared accessors aren't needed (and why per-row closures are still cheap): the row callback runs once per render. Sync `NotReadyError` from anywhere inside it propagates up through this `sync: true` createMemo (which doesn't latch) → out to the engine's hole replay → the **whole** `mapArray` reruns from scratch with fresh state. Async retries always live in their own nested owners (compiler-emitted memos, boundaries) whose ids and captured state are snapshotted at owner-creation time, so restoring `parent.id` afterwards doesn't disturb them.

| bench (ops/sec) | pre | post | delta |
|-----------------|----:|-----:|------:|
| `color-picker`  | 31,300 | 36,100 | `+15.3%` |

All `408` solid + `81` solid-web SSR/streaming + `13` hydration tests still pass.

### Investigation 9: Compiler — drop `ssrRunInScope` from emission

`ssrRunInScope` was historically used to wrap each dynamic SSR expression so async retries could re-enter under the original owner. Investigation 4 moved that owner-capture into `tryResolveString`'s `NotReadyError` handler in `dom-expressions/server.js` — `getOwner()` is now snapshotted lazily at the moment a function-typed hole escalates to async, so the runtime `ssrRunInScope` became a literal `(fn) => fn` no-op. The compiler still emitted the wrap on every dynamic, in two shapes:

```js
ssrRunInScope([fn1, fn2, ...])  // grouped: multiple dynamics on one element → _v$[0], _v$[1], ...
ssrRunInScope(fn)               // bare: single dynamic                       → _v$
```

Per render: 1 throwaway array literal per element-with-multiple-dynamics, 1 dead function call per element-with-any-dynamic.

In `babel-plugin-jsx-dom-expressions/src/ssr/element.js`, `hoistExpression` now treats every dynamic the same way — collect into `result.declarations` with one fresh `_v$N` identifier per dynamic, no `ssrRunInScope` wrap, no group-shared array. `wrapDynamics` is gone.

```js
function hoistExpression(path, results, expr, { group, post, skipWrap } = {}) {
  // `ssrRunInScope` wrap dropped — runtime no-op (owner-capture moved to
  // `tryResolveString` on `NotReadyError`). What stays is the per-dynamic
  // temp variable: `ssr()`'s call-site IC stays specialized when each arg
  // is a stable `Identifier` reference, vs polymorphic when arrow literals
  // are inlined directly into the argument list.
  const variable = path.scope.generateUidIdentifier("v$");
  post
    ? results.postDeclarations.push(t.variableDeclarator(variable, expr))
    : results.declarations.push(t.variableDeclarator(variable, expr));
  return variable;
}
```

The temp-var pattern is intentional: an earlier attempt to inline arrow literals directly into `ssr()` args (skipping the temp var) regressed `color-picker` ~3% — the `ssr()` call site was megamorphizing on the mixed string/arrow argument shapes. Keeping each arg as a stable `_v$N` identifier preserves the IC.

What's saved per element-with-dynamics:
- 1 `ssrRunInScope` import + 1 dead function call site.
- For multi-dynamic groupings: 1 throwaway array literal per render.
- For single-dynamic groupings (the `<For>` row case): 0 indexing overhead (`_v$` directly instead of `_v$[0]`).

All `118` dom-expressions transform tests pass after regenerating SSR fixtures.

| bench (ops/sec) | pre | post | delta |
|-----------------|----:|-----:|------:|
| `color-picker`  | 36,100 | ~39,650 | `+10%` |

### Investigation 10: Compiler — drop `createComponent` from SSR emission

Server-side `createComponent` is a one-liner: `Comp(props || ({} as T))`. The compiler always emits a real props object (an `t.objectExpression` is unconditionally pushed before the call site), so the `|| {}` fallback never fires in compiled output — it's a wrapper around a single function call with no extra work.

In `babel-plugin-jsx-dom-expressions/src/shared/component.js`, gated emission on `getConfig(path).generate === "ssr"`: SSR mode emits `Comp(props)` directly; DOM mode keeps the `_$createComponent(Comp, props)` call (its DOM-side runtime does real work — `untrack`, dev metadata).

```js
const componentArgs = [tagId, props[0]];
if (getConfig(path).generate === "ssr") {
  exprs.push(t.callExpression(tagId, [props[0]]));
} else {
  exprs.push(t.callExpression(registerImportMethod(path, "createComponent"), componentArgs));
}
```

Bundle effect: `r-server` no longer needs to import `createComponent`, every `<Foo .../>` site loses one indirection. All `118` babel-plugin transform tests pass after fixture regen — SSR fixtures show direct calls (`Component({...})`, `_$For({...})`) where they previously had `_$createComponent(Component, {...})`.

| bench (ops/sec) | pre | post (run 1) | post (run 2) | delta |
|-----------------|----:|-------------:|-------------:|------:|
| `color-picker`  | 39,650 | 37,478 | 37,421 | noise |
| `inferno` (control) | 41,656 | 39,558 | 39,067 | also down `~6%` |

Both `solid-next` and `inferno` dropped `~5.6%` in the same session (likely thermal/machine-state noise). The **solid-next/inferno ratio is preserved** (`0.952` → `0.953`), so this is a wash on perf — V8 was already inlining the trivial `createComponent` wrapper in steady state.

Kept the change anyway: smaller bundles (no `createComponent` import / wrapper call), more direct compiled output, and the runtime `createComponent` is preserved for hand-written / non-compiled callers.

### Investigation 11: Compiler — drop IIFE wrap around SSR templates

Every SSR template emission with `var _v$N` temp declarations was wrapped in an IIFE:

```js
return (() => {
  var _v$4 = () => ssrClassName(...),
    _v$5 = escape(name);
  return ssr(_tmpl$3, _v$4, ssrStyleProperty(...), _v$5);
})();
```

The IIFE only existed to give the `var` declarations a scope inside an expression position. In `babel-plugin-jsx-dom-expressions/src/ssr/template.js`, replaced with **scope-hoisted `var` + flat assignment statements** (with sequence-expression fallback for non-statement positions):

```js
function children(color, i) {
  var _v$4, _v$5;                                                  // hoisted
  const { name, hex } = color();
  _v$4 = () => ssrClassName(...);
  _v$5 = escape(name);
  return ssr(_tmpl$3, _v$4, ssrStyleProperty(...), _v$5);
}
```

Implementation:
```js
const declarators = [...result.declarations, ...result.postDeclarations].filter(Boolean);
if (!declarators.length) return ssrCall;
for (const d of declarators) path.scope.push({ id: d.id, kind: "var" });

// Common case: JSX is the direct `return` argument — emit flat statements.
if (t.isReturnStatement(path.parent) && path.parent.argument === path.node) {
  path.parentPath.insertBefore(
    declarators.map(d =>
      t.expressionStatement(t.assignmentExpression("=", d.id, d.init))
    )
  );
  return ssrCall;
}

// Fallback: ternary branches, array elements, function args — sequence expr.
return t.sequenceExpression([
  ...declarators.map(d => t.assignmentExpression("=", d.id, d.init)),
  ssrCall
]);
```

`path.scope.push` is the babel API for hoisting a `var` declaration to the nearest function/program scope's hoist target. Each declarator becomes a bare `var _v$N;` at the top of the surrounding function. The IIFE block-of-decls becomes either flat statements (when in `return` position, the dominant case) or a comma sequence (when control-flow gating matters).

The `return`-position split-out is conditional-flow-safe: babel auto-wraps single-statement `if (cond) return <jsx/>;` into a block, so assignments stay under the `cond` gate. Sequence-expression fallback preserves correct evaluation order for ternary branches / array elements / function arguments where lifting assignments to the outer statement would change observable side-effect ordering.

Why `var` is safe: function-scoped (not block-scoped, no TDZ), hoisted, each invocation of the surrounding function gets a fresh activation-record copy. Closures captured during one invocation hold the value object, not the variable slot — no aliasing across recursive/concurrent calls.

What's saved per SSR template eval site:
- 1 IIFE arrow closure allocation (per eval, per invocation of the surrounding function).
- 1 function-call frame.
- For per-row `<For>` bodies: ~133 closures/render in `color-picker`.

| bench (ops/sec) | pre | post (run 1) | post (run 2) | delta |
|-----------------|----:|-------------:|-------------:|------:|
| `color-picker`  | 37,449 | 37,398 | 37,349 | noise |
| `inferno` (control) | 39,313 | 38,028 | 37,612 | also down ~3% |

Wash on real-benchmark perf — V8 efficiently inlines hot-path IIFEs after warmup. Profiled ops/sec (with `--prof` overhead) showed +16% though, suggesting the call-frame elimination is real, just dominated by faster work elsewhere in unprofiled steady state.

Kept for output quality: smaller bundles (no per-template IIFE wrap), cleaner reading compiled output, and a documented babel technique for `var`-hoisting + sequence-expressions that can be applied to other templating call sites (e.g., the DOM client `createTemplate` which has the same IIFE pattern around `result.decl` + `result.exprs` + `return result.id`).

All `118` dom-expressions transform tests pass after fixture regen.

### Investigation 12: Compiler — extend IIFE-drop to DOM and Universal

Same technique applied in `babel-plugin-jsx-dom-expressions/src/dom/template.js` and `src/universal/template.js`. DOM/Universal `createTemplate` had a structurally similar IIFE wrap with mixed content (var declarations + expression statements + dynamic effect wrappers + post expressions):

```js
return (() => {
  var _el$ = _$template$();
  _$insert(_el$, …);
  _$effect((_v$) => …);
  return _el$;
})();
```

After:

```js
const template = props => {
  var _el$;
  _el$ = _$template$();
  _$insert(_el$, …);
  _$effect((_v$) => …);
  return _el$;
};
```

Two extensions vs the SSR version:

1. **Mixed-shape statement list.** DOM `createTemplate` accumulates `result.decl` (a `var X = init` block), `result.exprs` (expression statements + occasional `var _ref$ = …` declarations from event handlers), `wrapDynamics(...)` output, and `result.postExprs`. The flatten loop walks this list, hoisting any simple-identifier declarators via `path.scope.push` (`var _el$, _ref$2;` at top of function/program), splitting their initializers into assignment statements, and passing other entries through unchanged.

2. **Pattern declarators stay in place.** Hydratable mode emits `var [_el$, _co$] = _$getNextMarker(...)` from `getNextMarker`, where `d.id` is an `ArrayPattern`. Bare `var [a, b];` (no init) is invalid — destructuring patterns require an initializer. These declarators are kept as full `var [a, b] = init;` statements in the flat list (still function-scoped, just declared mid-block instead of at the top). Confirmed working in `__dom_hydratable_fixtures__/components/output.js`:
   ```js
   const template = props => {
     var _el$6, _el$9, _el$11, _el$13;                 // simple ids hoisted
     ...
     _el$6 = _$getNextElement(_tmpl$4);                // assignment
     _el$9 = _el$6.firstChild;
     var [_el$10, _co$2] = _$getNextMarker(...);       // pattern stays in place
     _el$11 = _el$10.nextSibling;
     ...
     return _el$6;
   };
   ```

3. **Statement-position predicate widened.** All three template emitters (`ssr`, `dom`, `universal`) detect both:
   - `return <jsx/>;` — JSX is the entire return argument.
   - `const/let/var x = <jsx/>;` — JSX is the entire variable initializer.

   Both lift safely to before the parent statement. The module-level `const template = <jsx/>;` form (very common in Universal/DOM tests + benchmarks) is now also flat — see `__universal_fixtures__/attributeExpressions/output.js`:
   ```js
   var _el$, _el$2, _el$3, …                           // hoisted to module top
   _el$ = _$createElement("div");                       // assignments at module scope
   _$insertNode(_el$, _el$2);
   …
   const template = _el$;                               // bare expression
   ```

4. **Fallback.** Anywhere outside these two predicates (ternary branches, array literals, function args, logical expressions, getters), the IIFE wrap is preserved. Lifting in those positions would change observable evaluation order (conditional/positional gates), and the IIFE block-statement is already line-formatted and readable.

All `118` dom-expressions transform tests pass after fixture regen across all 11 SSR/DOM/Universal/hydratable fixture directories.

| bench (ops/sec) | run 1 | run 2 | run 3 | notes |
|-----------------|------:|------:|------:|------|
| `color-picker` solid-next | 37,914 | 43,769 | 44,020 | |
| `color-picker` inferno    | —      | —      | 43,434 | ±13% variance |

SSR bundle is identical to pre-Inv-12 (DOM+Universal changes don't affect the SSR-output path for this benchmark). The variance is run-to-run thermal/machine state. Net for this session: kept Inferno parity, output is significantly more readable across all three target modes.

### Investigation 13: Try inlining SSR `hoistExpression` (reverted)

Re-tested Investigation 9's "no temp vars" hypothesis with a clean baseline. The compiler's `ssr/element.js#hoistExpression` was changed to bypass the temp-var indirection and return the dynamic expression directly:

```js
function hoistExpression(path, results, expr) {
  return expr;  // inline; was: emit `var _v$N = expr` and return identifier
}
```

This produces dramatically cleaner SSR output:

```js
// Before
function children(color, i) {
  var _v$4, _v$5;
  const { name, hex } = color();
  _v$4 = () => ssrClassName(...);
  _v$5 = escape(name);
  return ssr(_tmpl$3, _v$4, ssrStyleProperty(...), _v$5);
}

// After
function children(color, i) {
  const { name, hex } = color();
  return ssr(_tmpl$3, () => ssrClassName(...), ssrStyleProperty(...), escape(name));
}
```

**Ordering analysis confirmed correct.** JS evaluates function args left-to-right *before* the call, which exactly matches the side-effect order of the original sequential `_v$N = init` assignments. Nested component IDs / hydration scope are unaffected — the same components are invoked in the same positional order under the same parent owner.

**Perf result on `color-picker` (2 runs each, same machine, back-to-back):**

| state | run 1 | run 2 | inferno-ratio |
|-------|------:|------:|-------------:|
| Inv 12 (temp vars) | 37,368 | 37,036 | ~0.95 |
| **Inv 13 (inlined)** | **36,467** | **35,468** | **~0.93** |

`~3%` regression, reproducing Investigation 9's measurement. Inferno was rock-stable across both pairs (`±0.21–1.20%`), so this isn't thermal noise — it's a real cost from `ssr()`'s call-site IC moving from monomorphic-on-`Identifier` args to polymorphic-on-mixed-shape args.

**Reverted** — kept the temp-var hoisting. The `_v$N` indirection is "pointless" by ordering / scope semantics (which is what the original `ssrRunInScope` wrap protected) but is still earning its keep purely for IC stability. Updated the comment in `hoistExpression` to make this rationale explicit so future readers don't try the same experiment a third time.

### Cumulative status (2026-05-07 — end of session)

| bench (ops/sec) | baseline | current | total delta |
|-----------------|---------:|--------:|------------:|
| `color-picker`  |   14,049 |  39,650 | `+182%` / `2.82×` |

Updated competitor / northstar position (3-run average, run-to-run variance ±5%):

| bench (ops/sec) |  react |  inferno | **solid-next** | **solid 1.x** |
|-----------------|-------:|---------:|---------------:|--------------:|
| `color-picker`  | 20,720 |   41,656 |     **39,651** |    **61,514** |

Ratios:

| bench           | react vs next | inferno vs next | solid-1.x vs next |
|-----------------|--------------:|----------------:|------------------:|
| `color-picker`  | `0.52` (was `0.81`) | `1.05` (was `1.63`) | `1.55` (was `2.62`) |

**Inferno parity reached.** `solid-next` is within `5%` of Inferno on `color-picker` SSR — well within run-to-run noise (individual runs put us anywhere from `-6.5%` to `-1.6%`). solid-next is also `1.91×` ahead of React.

Tried and abandoned:

- **Copy-on-write `escape()` for arrays** — replaced `s.slice()` + reassignment with a CoW that only allocates when `escape(item) !== item`. Neutral on `color-picker` (the eager `slice` is cheap when V8 has the array's element kind monomorphic, and the per-iteration extra branch absorbs whatever GC saving exists).

### Investigation 14: Lazy `createSerializer` + `createAssetTracking` (2026-05-08, reverted)

After Investigation 13, the CPU profile didn't surface an obvious next hotspot, so switched to a sample-based heap profile of just the steady-state loop (`heap-prof-loop.cjs` connects to `node:inspector` after a 1k warmup, samples at `1024`-byte intervals across 10k iters with forced `global.gc()` every 1024 iters; `analyze-heap-prof.cjs` aggregates `selfSize` per call frame).

The profile showed `~75%` of per-render heap pressure on `color-picker` was infrastructure the app never uses:

| % | site |
|---|------|
| 29.6% | `createAssetTracking` (Map/Set + closures) |
| 28.1% | native `Map` and `Set` constructors |
| 17.0% | `createSerializer` (seroval `Serializer` instance + plugins) |

Built two lazy factories: `createLazySerializer(opts)` in `serializer.js` deferred `new Serializer({...})` until first `write()`; lazy `createAssetTracking` in `server.js` deferred Map/Set allocation until first write, with shared `EMPTY_MAP`/`EMPTY_SET` constants for read paths, and method-based mutation (`addEmittedAsset`, `addBoundaryStyle`) replacing direct map access in `registerAsset` and `propagateBoundaryStyles`.

**Result on `color-picker`:**

| state | run 1 | run 2 | run 3 |
|-------|------:|------:|------:|
| Inv 13 baseline | 39,650 |   —   |   —   |
| Inv 14 (lazy infra) | 37,407 | 38,428 | 36,943 |

**No throughput change** (within run-to-run noise). The heap profile change was real — `createSerializer` and native `Map`/`Set` constructors disappeared as top allocators — but ops/sec didn't move.

Two retroactively-obvious reasons:

1. The bench forces `global.gc()` every 1024 iters, which hides natural-cycle GC reduction. Reducing total bytes `0.75×` doesn't translate to fewer wall-clock pauses when the pauses are scheduled, not allocation-pressure-driven.
2. The new lazy tracking object trades Map/Set internals for `~11` method closures per render. Heap profile showed `~17MB` still attributed to `createAssetTracking` — we shifted allocation shape, not magnitude.

**Reverted.** `color-picker` is CPU-bound, not GC-bound. The lazy infrastructure also penalizes the realistic case (apps that actually `serialize()` for hydration): they pay the lazy-check overhead on every `write()` call without ever benefiting from the deferred allocation. Worth revisiting only if a real-world app shows GC pauses dominating in production, or if the lazy structure can be applied in a way that's free for the common case.

What this measurement does tell us going forward:

- GC is **not** the bottleneck on `color-picker` SSR. CPU optimization is the only remaining lever.
- Likely targets for future CPU-profile work: `ssr()` arg-walking, `escape()` tagged-template branching, `createMemo`/`mapArray` per-row work, `{ t, h, p }` template-shape access overhead, owner pool deque ops.

### Investigation 15: `escape()` single-pass fast scan (2026-05-08)

Built `cpu-prof-loop.cjs` (mirrors `heap-prof-loop.cjs` — connects `node:inspector` after warmup, `Profiler.start` / `Profiler.stop` so the profile contains *only* the steady-state loop) plus `analyze-cpu-prof.cjs` (sorts by self/total time per call frame). Ran 50k iters at 100µs sampling on `color-picker` solid-next.

**Top SELF-time hotspots (pre-fix, total wall 1410ms):**

| % | self ms | site |
|---|---:|---|
| 19.8% | 279 | `escape` |
| 17.2% | 242 | `For` row callback body |
| 10.6% | 150 | `createSyncMemo.pull` (anon under `pull`) |
| 9.5%  | 134 | `ssr()` |
| 9.1%  | 129 | `tryResolveString` |
| 7.0%  | 99  | `(garbage collector)` |
| 5.3%  | 75  | `createMemo.sync` (mapArray memo body) |
| 4.4%  | 62  | `formatChildId` |

`escape()` was the cleanest single source: ~420 calls per render (140 names + 140 hex + 140-elem array recurse), each calling `s.indexOf(delim)` and `s.indexOf("&")` upfront before the no-escape early exit. That walked the whole string twice in the (vastly hot) "no special chars" case.

**Fix.** Single forward `charCodeAt` loop in `escape()`. If no `&` (`38`), `<` (`60`), or `"` (`34`) is found, return immediately. Otherwise hand off to a new `escapeSlow(s, attr, start)` helper seeded from the first hit's index so the prefix isn't re-scanned. Slow path is structurally identical to the old function — just gated behind the fast scan.

```js
const delimCode = attr ? 34 : 60;
const len = s.length;
for (let i = 0; i < len; i++) {
  const c = s.charCodeAt(i);
  if (c === 38 || c === delimCode) return escapeSlow(s, attr, i);
}
return s;
```

Splitting into `escape()` + `escapeSlow()` keeps the hot function small enough that V8 inlines it into callers (we observed this in the post-fix profile — `escape`'s self-time *frame* shrank not just because the work shrank, but because the work moved up the stack into the caller, which is the optimal outcome).

**Perf result on `color-picker` (3 runs, post-fix):**

| | run 1 | run 2 | run 3 | avg |
|---|------:|------:|------:|-----:|
| pre-Inv 15  | 36,943 | 38,428 | 37,407 | 37,592 |
| **post-Inv 15** | **39,234** | **38,637** | **39,158** | **39,010** |
| inferno (same run) |   —    |   —    | 39,138 | ~39,138 |

`+3.8%` on a noisy bench (variance band ±5%), but the underlying CPU profile shows the cause cleanly:

| % | site | pre | post | Δ |
|---|------|---:|---:|---:|
| `escape` self | 279ms | **82ms** | `−71%` |
| `createMemo.sync` self | 75ms | 278ms | (attribution shift — escape inlined into caller) |
| **total wall** | **1410ms** | **1320ms** | **`−6.4%`** |

Inferno parity reached on the bench: `solid-next` is at `~1.00×` Inferno (39,010 vs 39,138), within noise. Pulled across the line by a single localized change.

**Tools added:**
- `cpu-prof-loop.cjs` — steady-state CPU sampler via `node:inspector`.
- `analyze-cpu-prof.cjs` — top self-time / total-time call frames from `.cpuprofile`.

**Next CPU-profile targets** (per post-fix profile, in order of size + tractability):
1. `tryResolveString` 8.1% self — reorder `Array.isArray(node)` / `node.h` / `Array.isArray(node.t)` checks; the `{ t: string }` no-hole case is the hot path and currently runs last.
2. `formatChildId` 4.4% self — `id.toString(36) + String.fromCharCode + concat` per child. Could memoize per-owner prefix.
3. `escape()` array branch — color-picker's `escape(For(...))` slices a 140-element array and recursively escapes each `{ t: string }`, all of which return as-is. Compiler signal that the array is already-safe could elide this entirely.
4. `createSyncMemo.pull` try/catch + `runWithOwner` overhead.

### `search-results` re-enabled (post-Inv 15 baseline)

Restored `search-results` to the bench harness for a second look. Component shape is structurally different from `color-picker`: a flat 50-row list where each `<Item>` is its own component with `createSignal`, multiple dynamic JSX expressions, and a `memo()` wrap on a conditional ternary.

| bench (ops/sec) |  react |  inferno | **solid-next** | **solid 1.x** |
|-----------------|-------:|---------:|---------------:|--------------:|
| `search-results` | 3,482 | 5,281 | **12,500** | **28,000** |
| `color-picker`  | 18,050 | 36,393 | **38,868** | **55,929** |

Solid-next is `2.4×` faster than React and `2.4×` faster than Inferno on `search-results`, but Solid 1.x is `2.2×` ahead — the largest remaining 1.x→2.0 gap.

CPU profile (30k iters, 100µs sampling):

| % self | site |
|---:|---|
| 14.9% | `Item` body |
| 13.6% | `(garbage collector)` |
| 11.5% | `_v$4` (compiler-emitted closure for one of the dynamic JSX exprs) |
| 10.5% | `_v$2` |
| 10.0% | `_v$5` |
| 8.7%  | `tryResolveString` |
| 7.1%  | `ssr` |
| 3.8%  | `createOwner` (50× `_$memo()` ternary wraps) |
| 2.7%  | `_v$6` |
| 2.2%  | `createMemo.sync` (mapArray memo body) |

The dominant cost (`~38%` combined `_v$N` self-time) is the compiler's defensive-closure pattern for dynamic JSX expressions. Each `<Item>` allocates ~5 `() => …` closures that are walked + invoked by `tryResolveString`. Solid 1.x emits a single `ssr()` call with eagerly-computed args (no closures, no per-row owners on the conditional ternary) — that structural difference is most of the `2.2×` gap.

### Investigation 16: Inline `runWithOwner` inside `createSyncMemo.pull` (2026-05-08)

Targeted the per-pull closure allocation visible on `color-picker`'s post-Inv 15 profile (`createSyncMemo.pull` showed an `(anon)` child frame at `10.6%` self — the `() => compute(value)` arrow handed to `runWithOwner`). Inlined the owner swap directly:

```ts
function pull(): T | undefined {
  const prev = currentOwner;
  currentOwner = owner;
  try {
    value = compute(value) as T;
    error = undefined;
    cached = true;
    return value;
  } catch (err) {
    if (err instanceof NotReadyError) throw err;
    error = err;
    cached = true;
    throw err;
  } finally {
    currentOwner = prev;
  }
}
```

Saves one closure allocation + one `runWithOwner` frame per pull. Hot for any compiler-emitted `_$memo()` (e.g. ternary wraps) and for every `mapArray`/`repeat` row callback memo, plus all internal control-flow primitives (Show, Switch, children, lazy outer).

| bench (ops/sec, 2 runs) | pre-Inv 16 | post-Inv 16 | delta |
|-------------------------|----------:|-----------:|------:|
| `color-picker` | 39,010 | 38,855 / 38,881 | flat |
| `search-results` | ~12,500 | 12,520 / 12,853 | flat |

Wall-time flat on both benches but the *structural* simplification is real:

| frame | pre | post |
|-------|----:|----:|
| color-picker `(anon under pull)` self | 10.6% | gone |
| color-picker `pull` self | ~5% | 14.3% |
| search-results `(anon under pull)` self | not measured | gone |
| search-results `pull` self | — | 1.5% |

Work that V8 was attributing to the inner arrow (`(anon)` frame) folds into `pull`'s self-time — same total, fewer call frames, fewer per-pull allocations. V8's escape analysis was already eliminating the `() => compute(value)` arrow allocation in steady state in many cases, which explains the flat wall-time. The inline removes the call-site fragility — pull stays monomorphic and inlinable into callers.

Kept for: smaller hot-path call graph, slightly less GC pressure (closure escape isn't always reliable across IC tier transitions), and clearer intent. Tests: all `408` `solid-js` tests pass.

### Investigation 17: Grouped dynamic-attribute closures (2026-05-09)

Followed up on the post-Inv-15 `search-results` profile (`~38%` combined `_v$N` self-time). The compiler emits one `() => …` closure per dynamic attribute / textContent expression and passes it as a hole to `ssr()`. Each closure is a fresh allocation per render and a fresh callsite for `tryResolveString`'s `typeof === "function"` dispatch. For an `<Item>` with 6 dynamic exprs that's 6 allocations + 6 closure invocations + 6 trips through `tryResolveString` per row, every row.

**Idea.** Coalesce contiguous attribute/textContent closures into a single grouped function that returns an array of values. The runtime calls the group once and dequeues across the N hole positions. Inserts/children stay separate — only attribute-class expressions are grouped. Cross-element grouping is allowed (no benefit in restricting to per-element only); a child insert at any hole position breaks the run, so isolation is preserved.

**Compiler emission** (search-results `Item`):

```js
var _g$ = _$ssrGroup(
  () => [
    _$ssrStyleProperty("background-color:", purchased() ? "#f1c40f" : ""),
    _$escape(item().title),
    _$ssrAttribute("href", "/buy/" + _$escape(item().id, true)),
    _$ssrAttribute("src", _$escape(item().image, true)),
    _$ssrAttribute("alt", _$escape(item().title, true)),
    _$escape(item().price)
  ],
  6
);
return _$ssr(_tmpl$, _g$, _g$, _g$, _g$, _g$, _g$, _v$7);
```

`_$ssrGroup(fn, n)` tags `fn.$g = n` and returns it. The same identifier is repeated `n` times in the `ssr()` call so positional structure is preserved.

**Runtime fast-path** in `ssr()` (placed at the *end* of the typeof chain — after `string`/`number`/`null`/`boolean` — so non-function holes never pay for the function check):

```js
} else if (ht === "function" && hole.$g) {
  if (lastGroup === hole) {
    // Continuation: dequeue from cache.
    value = lastGroupArr[lastGroupIdx++];
  } else {
    // First hit: call helper that wraps try/catch.
    const r = ssrFirstGroupHit(hole);
    // ...
  }
}
```

The `try/catch` lives in `ssrFirstGroupHit` (out of the hot loop) so the loop body is keyword-free. On `NotReadyError`, the helper returns an escalation tuple; the runtime emits N retry slots that all reference the same group identity, so a single retry pass produces all values.

**Preflight (hand-edited bundles, 2 rounds, `solid-next/inferno` ratio):**

| variant | search-results | color-picker |
|---|---|---|
| Sync-only proto, branch first | +12.9% | −1.9% (noise) |
| NotReady-aware, branch first | gains held | **−3% regression** |
| NotReady-aware, branch end-of-typeof | +13.6% | flat (+0.6%) |
| Helper-pattern, branch end-of-typeof | +13.7% | flat (+0.3%) |

The branch placement matters more than the keyword-vs-helper split: putting the function check first forces every non-function hole through one extra `typeof === "function"` evaluation, which `color-picker` (no groupings) measurably regresses on. End-of-typeof keeps the original cheap holes on their original path.

**Real compiler results (after rebuilding bundles, 2 rounds):**

| bench | round 1 ratio | round 2 ratio | avg | vs pre-Inv-17 baseline |
|-------|-------------:|--------------:|----:|----------------------:|
| `search-results` | 2.699 | 2.610 | **2.654** | `+15.4%` |
| `color-picker`   | 1.046 | 1.041 | **1.044** | `+4.4%` (within noise) |

`color-picker` stays flat — its bundle has no `ssrGroup` calls (no element has ≥2 contiguous dynamic attrs), and the new branch is gated by `hole.$g` so unrelated bundles only pay one extra typeof+property check on the cold path.

**Files changed:**

- `dom-expressions/src/server.js`: added `ssrGroup`, `ssrFirstGroupHit`, group fast-path in `ssr()`.
- `babel-plugin-jsx-dom-expressions/src/ssr/element.js`: tracks `groupable` set in `results`, marks textContent attribute closures, emits `_$ssrGroup(() => […], N)` for runs ≥2 with N copies of the identifier in the ssr() call. textContent stays a "child" in the AST (so insertion semantics are unchanged) but is flagged so `transformChildren` passes `{ group: true }` to `hoistExpression`.

**Hydration-id safety.** Inserts/children stay outside groups by construction. Attribute/textContent expressions never allocate hydration ids (they read settled signal/memo/resource values and format them — no `getNextContextId`/owner creation). Hydration only matches the final settled HTML, so even retry-driven re-evaluation of a group fn doesn't affect ids.

**Retry cost (addressed).** First sketch had each retry slot call `escFn()[idx]` independently — `N²` attribute evaluations on a successful retry pass for an `N`-slot group, and another `N²` on every failure pass. Replaced with a module-scoped `(_lastGroupFn, _lastGroupArr, _lastGroupErr)` cache consulted by every grouped slot. Slots fire contiguously in queue order, so within a pass slot 0 evaluates `state.fn()` once and caches the array (success) or error (failure) on the module slots; slots `1..N-1` short-circuit on `_lastGroupFn === state.fn`. Cache invalidates two ways: a different `state.fn` (next group's slot 0), or the same `state.fn` re-firing at `idx === 0` (next retry pass for the same group, including the solo-group case where no other fn fires between passes). Net cost: 1 evaluation per group per pass — `N²` → `N` on success, `N²` → `1` on failure — with no per-state bookkeeping.

**Tests.** All `118` `babel-plugin-jsx-dom-expressions` fixtures pass (6 SSR fixtures regenerated for the new emission). All `176` `dom-expressions` SSR runtime tests, `81` `solid-web` server tests, `13` `solid-web` hydration tests, and `405` `solid-js` tests pass.

### Investigation 18: Mode-specific control-flow callback shapes (2026-05-12)

This revisits the older raw-row diagnostic as an actual API/runtime shape instead of a bundle patch:

- Default / keyed-by-reference `mapArray` and `<For>` pass a raw row value.
- `keyed: false` passes a row accessor and a raw index.
- A custom key function passes a row accessor and index accessor.
- `<Show>` / `<Match>` follow the same "raw when callback owns the value, accessor when the value can change in-place" rule.

Reasoning: the default keyed row is not reactive inside the row callback. Requiring `row().id` reads like reactive work but is only an accessor closure call around a stable per-row value. The migration surface is also smaller than the original 2.0 shape because it moves the common keyed forms closer to 1.x.

Tier-2 DOM (`js-framework-benchmark`, focused CPU suite, `--count 5`, total medians):

| bench | vanilla | solid 1.9.12 | solid-next |
|-------|--------:|-------------:|-----------:|
| `01_run1k` | 32.6 | 33.1 | 34.3 |
| `02_replace1k` | 34.8 | 37.2 | 37.3 |
| `03_update10th1k_x16` | 19.3 | 18.7 | 20.5 |
| `05_swap1k` | 20.9 | 23.3 | 24.6 |
| `07_create10k` | 330.3 | 353.1 | 356.6 |
| `08_create1k-after1k_x2` | 37.7 | 39.4 | 39.0 |
| `09_clear1k_x8` | 15.9 | 19.9 | 17.0 |

Reading:

- The client DOM shape is broadly close to Solid 1 and better than the previous accessor-heavy application shape, especially where row creation/clear paths were paying for extra accessor closures/calls.
- This is enough to validate the semantic direction, but it is not a universal Tier-2 win: some rows remain slightly behind Solid 1 and vanilla still defines the lower bound on script work.

Tier-2 SSR (`isomorphic-ui-benchmarks`, ops/sec):

| bench | react | inferno | solid 1.x | solid-next |
|-------|------:|--------:|----------:|-----------:|
| `search-results` | 3,480 | 5,417 | 28,874 | 14,159 |
| `color-picker` | 18,402 | 37,006 | 57,963 | 38,968 |

Reading:

- No meaningful SSR movement from the raw-row/control-flow callback change.
- This did **not** provide the hoped-for final SSR push. The Solid 1.x gap already existed before this experiment and remains basically unchanged.
- The likely explanation is that SSR's hot cost is no longer the per-row accessor shape. The previous investigations already recovered the large allocator/runtime costs; the remaining gap is more likely in generated SSR expression structure and server string-resolution work.

Tier-2 reconcile (`solid-uibench`, median sample time, lower better). Correct gold standard is Solid `0.14.0`, not Solid 1.9:

| mode | group | solid-next | solid 0.14 |
|------|-------|-----------:|-----------:|
| sCU on | overall | 0.3 | 0.2 |
| sCU on | table | 0.3 | 0.2 |
| sCU on | anim | 0.2 | 0.2 |
| sCU on | tree | 0.5 | 0.3 |
| sCU off | overall | 0.4 | 0.3 |
| sCU off | table | 0.3 | 0.2 |
| sCU off | anim | 0.3 | 0.2 |
| sCU off | tree | 0.6 | 0.4 |

Reading:

- Against the real UIBench northstar, Solid 2 is still behind in both sCU modes.
- The mode-specific callback shape is still a semantic win: callback types now describe ownership/reactivity instead of papering over it with accessors everywhere.
- It should not be messaged as an SSR optimization. The docs/migration story should frame it as "callback shape follows whether the value can change inside the same callback instance," with client hot-path cleanup as supporting evidence.

Remaining SSR guesses after this miss:

- **Compiler-emitted dynamic closures.** `search-results` previously showed large self-time in `_v$N` dynamic closures. Grouping helped, but Solid 1.x's SSR output still does more eager argument computation and less function-hole replay work.
- **`tryResolveString` / `ssr()` dispatch.** The hot path still walks generalized string/object/function/array/template shapes that preserve async semantics. Solid 1.x has less general machinery.
- **Hydration-id formatting and owner/context bookkeeping.** Most large wins have already landed (lean owners, owner pooling, mapArray row-owner elision), but residual `formatChildId`, memo pull, and row callback scaffolding remain.
- **Template escaping / array escaping shape.** `escape()` was improved, but array/template result escaping still does conservative passes that Solid 1.x may avoid through simpler output.

Net: keep the callback-shape change for API truth and client performance, but treat SSR as a separate remaining compiler/runtime problem. The next SSR work should probably start from a fresh profile comparing Solid 1.x vs `solid-next` generated output for `search-results`, because that benchmark still shows the largest structural gap.

### Investigation 19: Current SSR CPU profiles after callback-shape change (2026-05-12)

Ran direct `node:inspector` CPU profiles around the current built `solid-next` server render functions, bypassing Benchmark.js and profiling only steady-state render loops after warmup:

- `color-picker`: 50k renders
- `search-results`: 30k renders

Also profiled the Solid 1.x server bundles with the same driver for shape comparison.

During setup found a benchmark typo in `benchmarks/search-results/solid-next/server.jsx`:

```js
return renderToString(() => <App searchResultsData={res} />), { noScript: true };
```

This executed `renderToString` but returned the options object via comma operator. Fixed to pass options as the second argument. The competitive rerun stayed basically unchanged:

| bench (ops/sec) | react | inferno | solid 1.x | solid-next |
|-----------------|------:|--------:|----------:|-----------:|
| `search-results` | 3,419 | 5,268 | 29,360 | 14,516 |
| `color-picker` | 18,184 | 35,447 | 57,690 | 39,034 |

Direct-profile throughput:

| bench | solid-next profile loop | solid 1.x profile loop |
|-------|------------------------:|-----------------------:|
| `color-picker` | 38,778 ops/sec | 56,462 ops/sec |
| `search-results` | 14,209 ops/sec | 28,211 ops/sec |

Top self-time frames, `solid-next`:

| bench | frame | self % |
|-------|-------|-------:|
| `color-picker` | `createMemo.sync` | 29.8 |
| `color-picker` | row `children` callback | 16.0 |
| `color-picker` | `ssr` | 10.2 |
| `color-picker` | `_v$4` dynamic closure | 8.7 |
| `color-picker` | `tryResolveString` | 7.8 |
| `color-picker` | `pull` | 7.0 |
| `color-picker` | GC | 6.7 |
| `color-picker` | `formatChildId` | 5.0 |
| `search-results` | `escape` | 34.9 |
| `search-results` | `ssr` | 15.1 |
| `search-results` | GC | 10.2 |
| `search-results` | `Item` | 8.6 |
| `search-results` | `createMemo.sync` | 6.6 |
| `search-results` | `createOwner` | 3.9 |
| `search-results` | `tryResolveString` | 2.6 |
| `search-results` | `pull` | 2.3 |

Top self-time frames, Solid 1.x:

| bench | frame | self % |
|-------|-------|-------:|
| `color-picker` | `escape` | 29.3 |
| `color-picker` | `simpleMap` | 21.3 |
| `color-picker` | `For` | 19.6 |
| `color-picker` | row `children` callback | 7.5 |
| `color-picker` | `App` | 6.4 |
| `color-picker` | GC | 4.5 |
| `search-results` | `escape` | 27.0 |
| `search-results` | `Item` | 22.8 |
| `search-results` | `createComponent` | 19.0 |
| `search-results` | `simpleMap` | 6.3 |
| `search-results` | GC | 4.0 |
| `search-results` | `Index` | 3.5 |

Read:

- `color-picker` is now very clearly dominated by Solid 2's sync memo/control-flow machinery, not the raw row accessor shape. The row callback still costs more than 1.x (`16%` vs `7.5%`), but the bigger structural difference is `createMemo.sync`/`pull`/`tryResolveString`/`ssr` sitting on top of the simple row map. Solid 1 spends most of its time in direct `escape` + `simpleMap`/`For`.
- `search-results` remains an output-shape/string path problem. `escape` + `ssr` alone are ~50% self time in Solid 2. Solid 1 also spends a lot in `escape`, but the surrounding render path is much simpler (`Item` + `createComponent` + `simpleMap`).
- GC is not dominant (`~7-10%` in Solid 2; lower in Solid 1), so the next wins are CPU/code-shape wins.
- The previous guesses were directionally right, but the priority order should be updated:
  1. Reduce server `createMemo.sync`/`pull` overhead for purely synchronous control-flow bodies.
  2. Reduce `ssr()` / `tryResolveString` dispatch for common already-string / template-object paths.
  3. Investigate why `escape` is still such a large part of `search-results` after the single-pass fast scan.
  4. Reduce `formatChildId` / owner-id work if it can be made prefix-cached without hurting hydration parity.

Raw profile artifacts were written under `../isomorphic-ui-benchmarks/profiles/`:

- `color-picker-solid-next-fixed.cpuprofile`
- `search-results-solid-next-fixed.cpuprofile`
- `color-picker-solid1-current.cpuprofile`
- `search-results-solid1-current.cpuprofile`

### Investigation 20: SSR `color-picker` gap-closing ladder (2026-05-12)

Goal: keep stacking unsafe/generated-bundle diagnostics until `solid-next/color-picker` reaches Solid 1.x, then read the remaining structural gap. This is **not** an implementation plan; several steps intentionally violate async/hydration invariants.

Baseline in direct render loops (`100k` renders, same output length `8948` chars/render):

| state | ops/sec |
|-------|--------:|
| Solid 1.x | ~58-70k |
| Solid 2 current | ~38-39k |

#### Step 1: Direct `mapArray` pull (source probe)

Changed SSR `mapArray` to skip the generic `createMemo({ sync: true })` wrapper and use its own memo owner + direct `read()` function.

Competitive `isomorphic-ui-benchmarks` after rebuilding from source:

| bench | solid 1.x | solid-next |
|-------|----------:|-----------:|
| `search-results` | 28,514 | 14,180 |
| `color-picker` | 58,868 | 39,703 |

Read:

- Basically flat on real numbers (`color-picker` only `~+1-2%`, within noise).
- Profile bucket changed from `createMemo.sync` to `read`; the cost is inside the loop/body, not the generic sync memo wrapper.

#### Step 2: Eager row class expression (generated-bundle diagnostic, unsafe)

Changed:

```js
var _v$4 = () => ssrClassName("color" + (selectedColorIndex() === i() ? " selected" : ""));
```

to eager:

```js
var _v$4 = ssrClassName("color" + (selectedColorIndex() === i() ? " selected" : ""));
```

Direct loop:

| state | ops/sec |
|-------|--------:|
| Solid 2 + eager class | ~46-49k |
| Solid 1.x | ~58-59k |

Read:

- This removes a visible function-hole / `tryResolveString` tax.
- Not safe generally: `selectedColorIndex()` / `i()` can suspend or depend on owner context; eager evaluation moves `NotReadyError` outside the normal function-hole capture/retry path.

#### Step 3: Bypass outer `escape(For(...))` array resolution (generated-bundle diagnostic, unsafe)

`color-picker` compiles the list as:

```js
escape(For({ each: colors, children: ... }))
```

Diagnostic replaced that with a direct join of the `For` accessor result's SSR node array:

```js
joinSSRNodes(For({ each: colors, children: ... })())
```

where `joinSSRNodes` does:

```js
let out = "";
for (...) out += nodes[i].t;
```

Direct loop:

| state | ops/sec |
|-------|--------:|
| Solid 2 + eager class + join For | ~52-54k |
| Solid 1.x | ~65-70k |

Read:

- The outer array escape/resolution path is another large chunk.
- Unsafe as written: it assumes every row is a plain sync SSR object with a `.t` string and no async holes, markers, adjacent primitive separators, or nested template arrays.

#### Step 4: Skip per-row hydration id formatting (generated-bundle diagnostic, unsafe)

Disabled the per-row:

```js
owner.id = formatChildId(origId, origChildCount + i);
```

Direct loop:

| state | ops/sec |
|-------|--------:|
| Solid 2 + eager class + join For + no row id | ~59-60k |
| Solid 1.x | ~58-59k |

Read:

- This closes `color-picker` in the direct-loop ladder.
- Unsafe to keep: hydration id parity depends on synthesizing the same per-row owner prefix the client gets from real row owners.

#### Conclusion

For `color-picker`, the remaining 1.x gap is explainable by three buckets:

1. **Function-hole generality** for dynamic row attributes.
2. **Outer array/template resolution** for `For` output.
3. **Per-row hydration id formatting**.

The direct `mapArray` memo-wrapper shortcut is not the main lever. The real work would be finding safe versions of the three unsafe diagnostics:

- a sync-only / no-suspend contract for some generated dynamic expressions, or a cheaper lazy function-hole path;
- a safe fast path for arrays of plain SSR template objects that preserves async holes and separator semantics;
- a row id prefix/cache strategy that preserves hydration parity while avoiding repeated `formatChildId`.

### Investigation 21: Safe plain SSR array fast path (2026-05-12)

Follow-up to Investigation 20, Step 3. Instead of the unsafe generated-bundle `joinSSRNodes(For(...)())` diagnostic, added a narrow runtime fast path in `dom-expressions` SSR:

- `escape(array)` first tries to join the array if every entry is a plain sync SSR object: non-null object, no `h`, and `typeof t === "string"`.
- `tryResolveString(array)` uses the same helper before walking the general recursive resolver.
- Any primitive, async template (`h`), nested template array, function, null, or unusual object shape falls back to the existing resolver, preserving async holes and separator semantics.

Validation:

- `pnpm --filter dom-expressions test`: 21 suites / 440 tests passed.
- `pnpm exec vitest run test/server/flow.spec.ts`: 27 tests passed.

Competitive `isomorphic-ui-benchmarks` after rebuilding `solid-next` with the patched runtime:

| run | bench | react | inferno | solid 1.x | solid-next |
|-----|-------|------:|--------:|----------:|-----------:|
| 1 | `search-results` | 3,534 | 5,419 | 28,532 | 13,774 |
| 1 | `color-picker` | 17,397 | 35,344 | 57,015 | 40,535 |
| 2 | `search-results` | 3,495 | 5,122 | 23,195 | 14,100 |
| 2 | `color-picker` | 17,520 | 37,347 | 59,133 | 40,583 |

Read:

- This is safe and does hit the generated `escape(For(...))` shape in both benchmark bundles.
- `color-picker` improves modestly versus the prior observed `solid-next` result (`~38,968 ops/sec -> ~40,5xx`, roughly `+4%`).
- `search-results` is effectively flat/noisy versus the prior observed result (`~14,159 ops/sec`).
- The large Step 3 diagnostic win did not transfer to the conservative runtime helper. The remaining gap is still mostly in function-hole success cost and row/runtime work around the generated children, not just the recursive array resolver itself.

### Investigation 22: Sync primitive function-hole fast path (2026-05-12)

Follow-up to Investigation 20, Step 2. The unsafe eager-class diagnostic showed a large `color-picker` win by removing the generated function hole:

```js
() => ssrClassName("color" + (selectedColorIndex() === i() ? " selected" : ""))
```

This probe keeps the function hole and async semantics, but adds a narrower success path in `ssr()`:

- When a non-group hole is a function and the accumulated result is still a plain string, call it through `tryResolveFunctionHole`.
- If it returns `string`, `number`, `null`, `undefined`, or `boolean`, handle that directly.
- If it throws `NotReadyError`, preserve the existing `buildAsyncWrap(err, hole)` owner-captured retry path.
- If it returns an object, array, template, or another function, fall back to `tryResolveString(value)`.

This was measured together with Investigation 21's plain-array fast path, because that is the current best safe runtime state.

Validation:

- `dom-expressions` server Jest project: 4 suites / 178 tests passed.
- `vitest run test/server/flow.spec.ts test/server/ssr-async.spec.ts`: 136 tests passed.
- Note: after updating pnpm, package-script invocations hit pnpm's build-approval/dependency-status guard before Jest. Direct package-root Jest was used for `dom-expressions`; the failing pnpm wrapper was not a runtime/test failure.

Competitive `isomorphic-ui-benchmarks` after rebuilding `solid-next` with both safe runtime fast paths:

| run | bench | react | inferno | solid 1.x | solid-next |
|-----|-------|------:|--------:|----------:|-----------:|
| 1 | `search-results` | 3,478 | 5,415 | 29,806 | 14,582 |
| 1 | `color-picker` | 17,969 | 37,558 | 56,740 | 42,562 |
| 2 | `search-results` | 3,509 | 5,318 | 28,653 | 14,136 |
| 2 | `color-picker` | 18,055 | 36,610 | 57,923 | 43,103 |

Read:

- `color-picker` gets a real, repeatable lift: prior current result was `~38,968 ops/sec`, array-only was `~40,5xx`, and array + function-hole fast path is `~42.6-43.1k`.
- `search-results` remains effectively flat/noisy. One run reached `14.6k`, the repeat was `14.1k`, matching prior range.
- This confirms the function-hole success path is a meaningful part of the `color-picker` gap, but still not enough to approach Solid 1.x (`~57-58k` in these runs).
- The remaining `color-picker` gap is likely split between unavoidable closure invocation/owner-row work and hydration id formatting. The unsafe eager-class diagnostic still did more because it removed the closure entirely, not just the recursive resolver after the closure returns.

### Investigation 23: Local row hydration id formatting cache (2026-05-12)

Follow-up to Investigation 20, Step 4. The lazy owner-id materialization probe was a clear regression because it changed every `owner.id` read into an accessor. This probe kept eager `owner.id` semantics and only changed the `mapArray` / `repeat` row loops:

- Precompute the row id's base36 length marker for the current `origChildCount`.
- Increment a local `rowId` counter through the loop.
- Only recompute the marker when crossing `36`, `36^2`, `36^3`, etc.
- Continue assigning `parent.id` eagerly before each row and restoring `parent.id` / `_childCount` in `finally`.

Validation:

- `vitest run test/server/flow.spec.ts test/server/signals.spec.ts test/server/ssr-async.spec.ts`: 183 tests passed.

Competitive `isomorphic-ui-benchmarks` after rebuilding `solid-next` with the row-id cache plus the two prior safe `dom-expressions` fast paths:

| run | bench | react | inferno | solid 1.x | solid-next |
|-----|-------|------:|--------:|----------:|-----------:|
| 1 | `search-results` | 3,526 | 5,346 | 29,357 | 14,802 |
| 1 | `color-picker` | 18,067 | 37,362 | 58,531 | 41,564 |
| 2 | `search-results` | 3,519 | 5,256 | 27,917 | 14,237 |
| 2 | `color-picker` | 17,897 | 37,134 | 58,077 | 42,042 |

Read:

- This shape is not a win. `search-results` remains noise, and `color-picker` regresses versus the prior safe runtime state (`~42.6-43.1k` without this cache).
- The extra branch/counter/marker state in the hot loop appears to cost more than the saved generic `formatChildId` work.
- Reverted the source probe. The safe runtime baseline remains Investigation 21 + 22, without this id-cache change.


## Store Rewrite Lane (2026-08-18): baselines at full functionality

The store rewrite (`src/store/next/`, branch `store-rewrite`; contract in
`packages/solid-signals/INTERNALS-STORE-STATE.md`) reached full-suite green
plus one optimization pass today. Baselines below; per-scenario variance
matters more than totals.

### Tier-1 (in-repo, `pnpm vitest bench --run tests/store/...`)

Legacy = main checkout, next = worktree, same machine back-to-back. The
dbmon SHALLOW row runs identical legacy code in both checkouts — it is a
built-in noise control (measured 1.14x session skew for this pair; treat
sub-15% Tier-1 deltas accordingly).

| bench (mean) | legacy | next | ratio |
|---|---|---|---|
| reconcile read-once tree, 10 of ~12k paths subscribed | 0.87ms | 0.51ms | 0.59x |
| tree reverse 1111 keyed | 4.55 | 4.19 | 0.92x |
| tree shuffle 1111 keyed | 4.47 | 4.74 | 1.06x (rme ±9–11%) |
| dbmon full tick deep | 121.4 | 133.4 | 1.10x |
| dbmon partial tick deep | 126.2 | 137.7 | 1.09x |
| dbmon shallow (control) | 66.2 | 75.2 | 1.14x |

### Tier-2 (browser)

- UIBench (matched morning session, 10-iter): legacy 36.6ms total → next
  27.5ms. Per-test: ZERO regressions >1.1x&0.05ms; wins concentrate in
  keyed structure (moves 0.62x, sort/filter 0.71x) and creation
  (tree/render 0.68x). vs ivi (21.4): we now beat ivi on table/filter;
  remaining gaps are tree/render (creation) and reorders (re-derivation
  stack — phase-2 signature).
- dbmon browser (same-session 30-iter, all columns together): sort 0.92x
  (faster than legacy), mount 1.03x, remount 1.07x, unmount noise — but
  tick 1.21x and tick_partial ~1.2x SLOWER.

### The open regression (the current target)

Both tiers agree in direction: dense value-diff reconcile (dbmon full and
partial tick) is slower than legacy — Tier-1 shows ~1.10x raw (inside the
1.14x control band, so partially environmental, but Tier-2's same-session
1.21x confirms a real gap). Everything else is parity or faster. The
requirement is parity (no regression) before phase 2. Suspects after the
fused-walk pass: per-target adoption bookkeeping (registration WeakMap.set,
ownership WeakSet.has), per-key call overhead in the fused walk
(notifyKeyDiff + setSignal per changed key) vs legacy's monolithic
applyStateFast. Iteration tool: `reconcile-dbmon.bench.ts` (sub-10s loop,
shallow row as control).

### Inline per-key pass + in-process A/B (2026-08-18, later)

Changes: per-key notify body inlined into the fused adoption walk (legacy's
own lesson — extracted helper cost ~7% on CodSpeed); reference-identity
early-continue per key with the FINDING-1 ownership guard (`ov === nv` skips
only unowned backings; accessor-flagged nodes never skip); both-side fetches
done once. Suite green.

New tool: `tests/store/reconcile-dbmon-ab.bench.ts` — the same workload
against next (dispatcher) and legacy (direct import) interleaved in ONE
process. No session/thermal skew; this supersedes cross-checkout Tier-1
comparisons for the transition period. Delete with the legacy modules.

Results (time:4000, both variants same process):

| bench | next | legacy | read |
|---|---|---|---|
| full tick mean | 187.0 | 190.7 | parity (0.98x) |
| full tick min | 146.9 | 133.4 | 1.10x, GC-riddled (rme ±20%) |
| partial mean | 148.9 | 134.4 | 1.11x (rme ±6–12%) |
| partial min | 124.2 | 116.4 | 1.07x |

Verdict: full-tick parity reached in-process; partial holds a residual
~7–10% (borderline vs rme but consistently legacy-favored). Remaining
partial suspects: per-child adoption bookkeeping on value-identical rows
(registration WeakMap.set + adopted-flag bookkeeping per query array/row
even when every key ===-continues). Browser re-validation owed on a cool
machine with the current build.

### A/B corrected for __TEST__ machinery (benchmark mode)

Discovery: default vitest runs define `__TEST__: true`, which makes next pay
its invariant oracles (ingestedRaw WeakSet add PER ADOPTION, no-mutation
assertions on privatize/fold paths) that legacy has no equivalent of — the
earlier A/B numbers overstated next's cost. `--mode benchmark` strips them
(vite.config.ts already provided the mode).

Two benchmark-mode runs, same command minutes apart (means):

| bench | run 1 | run 2 |
|---|---|---|
| full tick next/legacy | 129.5/160.8 = **0.81x** | 139.8/132.0 = 1.06x |
| partial next/legacy | 140.4/131.2 = 1.07x | 155.5/136.8 = 1.14x |
| partial MINS | 115.5/114.8 = 1.01x | 128.7/117.5 = 1.10x |

Verdict: full-tick oscillates AROUND parity (0.81–1.06x) — no measurable
regression remains, and no stable win either; partial reads 1.0–1.14x.
Cross-run variance (bench order, GC epochs, end-of-day thermals) now
exceeds the effect size even in-process. STOP MEASURING HERE. Definitive
read = cool machine, first runs of the day, both A/B runs repeated 3x,
report min-of-means per side. Measurement rule going forward: any
next-vs-legacy claim must come from `--mode benchmark` (the __TEST__
asymmetry biases default-mode numbers against next).

### Read-path flattening + positional-prefix keyed walk (2026-08-18, midday)

Two more single-loop changes (no forks):
1. Trap read path: one `typeof key` gates all brand-symbol compares off the
   hot string path; the common serve case (existing plain node, unchained,
   tracked) is inlined in the trap — readNodeFast, no serveDataKey frame, no
   FORCE compare (only accessor keys hold the sentinel), primitives bail
   before isWrappable.
2. Keyed arrays: positional-prefix fast path (legacy keyedMatch-walk
   parity) — aligned rows descend in place with inline identity skip
   (FINDING-1 guard); prevByKey is built only for the misaligned remainder,
   never on aligned ticks (was: 1000-entry Map per tick).

Browser (octane harness, alternating rounds, current build):
- FULL tick: 1.02/1.08/1.15x pre-prefix → 1.10/1.04x post — parity band.
- PARTIAL tick: was ~1.24x IN BOTH SWEEP ORDERS (the one order-robust
  regression) → 1.03x / 0.97x post-prefix — CLOSED.
- Sweep-order finding: run.mjs's fixed order (solid before solid-next)
  biases the second column; reversed-order run flipped full tick from
  1.17x to 1.045x. Alternating per-round loops are the trustworthy method;
  medians from single fixed-order sweeps are not.
- Suite + next-gate green throughout.

Status vs the no-regression bar: full and partial tick both in the
alternating-measurement parity band (0.97–1.15x swings, centered ~1.05);
sort/mount/unmount at parity or faster. Cool-machine confirmation still
recommended for the record.
