# Async rules — scenarios, as screens

**Status: DRAFT (2026-10-07), paired with [`RULES-DERIVED.md`](./RULES-DERIVED.md).** One or two worked scenarios per derived rule: the action, then what is on screen, `latest`/`isPending`, and which effects ran — frame by frame. These are the judge for the docs, the tests and the fuzzer alike: a test pins a scenario's table; a fuzzer oracle case is a scenario with the setup generated. Open questions are laid out the same way in [`OPEN-QUESTIONS.md`](./OPEN-QUESTIONS.md).

**Conventions.**

- Code is the minimum that produces the screen; `fetchX(v)` is an async source answering `v` after a gate the scenario releases by hand.
- **Screen** lists the on-screen readers as `name value`, separated by `|`. `—` means unchanged from the previous frame. `(empty)` means a slot with no content yet. `[fallback]` is a `<Loading>` on its fallback.
- **`latest` / `isPending`** lists only what the scenario is about. `throws` means `NotReadyError`.
- **Effects ran** names the render effects that applied this frame; `—` means none.
- **Provenance.** _Pinned_ names the test that asserts the table. _From the rule text_ means the table is derived from the archive's own frames and is not yet pinned — it should become a test.
- The wrong screen each scenario rules out is in the last row, marked **✗**.

---

## A. Holds (D-1–D-11)

### S-1. Navigation: page B appears whole — D-1, F-2, F-7

_From the rule text (`05-async-data.md`, A15)._

```tsx
const [id, setId] = createSignal(1);
const product = createMemo(() => fetchProduct(id()));
const comments = createMemo(() => fetchComments(id()));
<h1>{product().name}</h1>
<Loading fallback="spinner"><ul>{comments()}</ul></Loading>
// primed: both answered for id = 1
```

| #   | Action              | Screen                                                                                          | `latest` / `isPending`                                            | Effects ran |
| --- | ------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------- |
| 0   | primed              | `h1 A \| ul comments-A`                                                                         | `isPending(id)` false                                             | h1, ul      |
| 1   | `setId(2); flush()` | — (held on `product(2)`, `comments(2)`)                                                         | `latest(id)` 2 · `isPending(id)` true · `isPending(product)` true | —           |
| 2   | `comments(2)` lands | — (still held on `product(2)`)                                                                  | —                                                                 | —           |
| 3   | `product(2)` lands  | `h1 B \| ul comments-B`                                                                         | `isPending(id)` false                                             | h1, ul      |
| ✗   |                     | `h1 B \| ul comments-A` after 3 with comments landing later, or `h1 A \| ul comments-B` after 2 |                                                                   |             |

The shown boundary keeps `comments-A` through the hold (F-5); if `product(2)` lands first the frame waits on `comments(2)` the same way.

### S-2. A memo that starts reading a held value reveals with it — D-1 (#3408)

_Pinned: `tests/held-conditional-memo.test.ts`._

```tsx
const [count, setCount] = createSignal(0);
const [show, setShow] = createSignal(false);
const details = createMemo(() => fetchDetails(count()));
const panel = createMemo(() => (show() ? count() : "hidden"));
<p>Count {count()}</p> <p>Details {details()}</p> <p>Panel {panel()}</p>
```

| #   | Action                              | Screen                                              | `latest` / `isPending`                                                 | Effects ran |
| --- | ----------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------- | ----------- |
| 0   | primed                              | `Count 0 \| Details 0 \| Panel hidden`              |                                                                        | all         |
| 1   | `setCount(1); flush()`              | — (held on `details(1)`)                            | `latest(count)` 1 · `isPending(count)` true · `isPending(panel)` false | —           |
| 2   | `setShow(true); flush()` — mainline | — (`panel`'s pass read the held `count` and joined) | `latest(panel)` 1 · `isPending(panel)` true                            | —           |
| 3   | `details(1)` lands                  | `Count 1 \| Details 1 \| Panel 1`                   | all false                                                              | all         |
| ✗   |                                     | after 2: `Count 0 \| Details 0 \| Panel 1`          |                                                                        |             |

<!-- ruling:S-3 -->
### S-3. A mount during a hold: a derivation born held holds the mount; the branch appears whole at the commit — D-1, D-3 (A29)

_Generated from `packages/web/test/async-gen/rulings/S-3.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: standing. Pins also: `tests/born-held.test.ts`._

```tsx
const [x, setX] = createSignal(0);
const [open, setOpen] = createSignal(0);
const [title, setTitle] = createSignal(0);
const slow = createMemo(async () => fetch(1 + x()));
const ten = createMemo(() => 1 + x());
<span>{x()}</span>
<span>{slow()}</span>
<span>{title()}</span>
<Show when={open()}> {/* creates ten when it opens */}
  <span>{ten()}</span>
  <span>{x()}</span>
</Show>
```

| # | Action                                      | Screen                                              | Notes                                                                                                                               |
| --- | ------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 0 | slow(1) lands; tick                         | `x 0 \| slow 1 \| title 0`                          | primed                                                                                                                              |
| 1 | setX(1) in an action; flush()               | —                                                   | held on `slow`                                                                                                                      |
| 2 | setOpen(1); flush()                         | —                                                   | `ten` is born held: its first pass read the held `x`; `<p>{ten()}</p>` throws, so it holds the mount and the branch is not attached |
| 3 | setTitle(1); flush()                        | `x 0 \| slow 1 \| title 1`                          | an unrelated mainline write shows at once — not swallowed into the action                                                           |
| 4 | the action lands; tick; slow(2) lands; tick | `x 1 \| slow 2 \| title 1 \| ten 2 \| x 1`          | the commit reveals everything, the branch whole                                                                                     |
| ✗ |                                             | after 2: `x 0 \| slow 1 \| title 0 \| ten 2 \| x 0` | `ten 2` beside `x 0`: the published future                                                                                          |
| ✗ |                                             | after 2: `x 0 \| slow 1 \| title 0 \| ten 1 \| x 0` | `ten 1`: a committed value `ten` never had (the N1 reading)                                                                         |
| ✗ |                                             | after 2: `x 0 \| slow 1 \| title 0 \| x 0`          | the branch attached around an empty slot                                                                                            |
<!-- /ruling -->

### S-4. One hole, two sources: an unrelated sync write passes through — D-3 (A15 shared hole)

_Pinned: `tests/shared-effect-no-entangle.test.ts`._

```tsx
const [a, setA] = createSignal(0);
const [b, setB] = createSignal(0);
const detailsA = createMemo(() => fetchDetails(a()));
<p>
  {b()}:{detailsA()}
</p>; // one compiled hole
```

| #   | Action                                         | Screen                                                      | `latest` / `isPending` | Effects ran |
| --- | ---------------------------------------------- | ----------------------------------------------------------- | ---------------------- | ----------- |
| 0   | primed                                         | `0:0`                                                       |                        | p           |
| 1   | `setA(1); flush()`                             | — (held on `detailsA(1)`)                                   | `isPending(a)` true    | —           |
| 2   | `setB(1); flush()` — plain, or a sync `action` | `1:0` (b's pass; `detailsA` read stale)                     | `isPending(b)` false   | p           |
| 3   | `detailsA(1)` lands                            | `1:1`                                                       | `isPending(a)` false   | p           |
| ✗   |                                                | after 2: `0:0` (b held by a's hold it does not derive from) |                        |             |

Contrast: `const sum = createMemo(() => b() + detailsA())` rendered beside — the `b` write flows into a memo the hold holds, so `b = 1` waits with `a = 1` and `Sum 2` reveals with `1:1`.

### S-5. Membership is the tick's — D-4

_Pinned: `tests/tick-scoped-pass-transaction.test.ts`._

```tsx
// two holds: A (a = 1 held on slowA) and B (b = 1 held on slowB)
const mountA = () => createRoot(() => <p>{createMemo(() => a())()}</p>);
const mountB = () => createRoot(() => <p>{createMemo(() => b())()}</p>);
```

| #   | Action                                 | Screen                                                            | `isPending`                                | Effects ran |
| --- | -------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------ | ----------- |
| 1   | `mountA(); mountB(); flush()`          | neither root attached — one frame over two holds; the holds merge | `isPending(a)`, `isPending(b)` true        | —           |
| 2   | `slowA` lands                          | — (merged hold waits on `slowB`)                                  | both true                                  | —           |
| 3   | `slowB` lands                          | `pA 1 \| pB 1`                                                    | both false                                 | pA, pB      |
| 1′  | `mountA(); flush(); mountB(); flush()` | neither root attached; two frames, independent holds              |                                            | —           |
| 2′  | `slowA` lands                          | `pA 1`; `pB`'s root not attached                                  | `isPending(a)` false · `isPending(b)` true | pA          |
| 3′  | `slowB` lands                          | `pA 1 \| pB 1`                                                    |                                            | pB          |

<!-- ruling:S-6 -->
### S-6. A new async memo a render effect consumes waits with the hold — D-1, F-2 (#3800)

_Generated from `packages/web/test/async-gen/rulings/S-6.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: standing. Pins also: `tests/issue-3800-repro.test.ts`._

**Case 1.**

```tsx
const [count, setCount] = createSignal(1);
const [open, setOpen] = createSignal(0);
const slow = createMemo(async () => fetch(1 + count()));
const fast = createMemo(async () => fetch(1 + count()));
<span>{count()} {slow()}</span>
<Show when={open()}> {/* creates fast when it opens */}
  <span>{fast()}</span>
</Show>
```

| # | Action                                    | Screen                                 | Notes                                                                                                                            |
| --- | ----------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 0 | slow(2) lands; tick                       | `count 1 \| slow 2`                    | primed                                                                                                                           |
| 1 | setCount(2); flush(); setOpen(1); flush() | —                                      | `setCount(2)` held on `slow`; the child branch mounts: `fast` is born held and throws, so it holds its mount and is not attached |
| 2 | fast(3) lands; tick                       | —                                      | `fast`'s answer lands while the hold is live: `slow` is still out, so the hold waits and the answer does not show                |
| 3 | slow(3) lands; tick                       | `count 2 \| slow 3 \| fast 3`          | `slow(2)` lands: parent and child together                                                                                       |
| ✗ |                                           | after 2: `count 1 \| slow 2 \| fast 3` | the child beside the parent still on the old value                                                                               |
| ✗ |                                           | after 1: `count 1 \| slow 2`           | `child (empty)` on screen                                                                                                        |

**Case ′.**

```tsx
const [count, setCount] = createSignal(1);
const [open, setOpen] = createSignal(0);
const slow = createMemo(async () => fetch(1 + count()));
const fast = createMemo(async () => fetch(1 + count()));
<span>{count()} {slow()}</span>
<Show when={open()}> {/* creates fast when it opens */}
  <span>{fast()}</span>
</Show>
```

| # | Action                                                         | Screen                        | Notes                                                                                                                                    |
| --- | -------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | slow(2) lands; tick                                            | `count 1 \| slow 2`           |                                                                                                                                          |
| 1 | setCount(2); flush(); setOpen(1); flush(); slow(3) lands; tick | —                             | `slow(2)` lands first: `fast` is still out, so the parent does not show yet (the hold waits for the child a render effect consumes, F-2) |
| 2 | fast(3) lands; tick                                            | `count 2 \| slow 3 \| fast 3` |                                                                                                                                          |
| ✗ |                                                                | after 1: `count 2 \| slow 3`  | the parent revealed around an empty child slot                                                                                           |

The sync twin (S-3's `ten`) already waits; the asymmetry was the bug.
<!-- /ruling -->

### S-7. Root mount with uncaught async waits to attach; with a boundary it shows the fallback — D-6, D-12

_From `08-dev-diagnostics.md` and `boundary-not-born-held-3540.test.ts`._

```tsx
render(() => <Profile user={asyncUser()} />, root); // (a)
render(
  () => (
    <Loading fallback={<Spinner />}>
      <Profile user={asyncUser()} />
    </Loading>
  ),
  root
); // (b)
```

| #   | Action            | Screen (a)                                                | Screen (b)                                                                                 | Notes                                    |
| --- | ----------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------- |
| 0   | `render()`        | `root` empty — DEV warns `ASYNC_OUTSIDE_LOADING_BOUNDARY` | `Spinner`                                                                                  | (a) nothing can show a fallback; (b) F-4 |
| 1   | `asyncUser` lands | `Profile` attached atomically                             | `Profile`                                                                                  |                                          |
| ✗   |                   |                                                           | (b) `root` empty until the landing — "renders nothing" (the 2026-10-06 reading, withdrawn) |                                          |

### S-8. An action holds its writes; display-ahead readers show them — D-7, F-2, F-6, F-10

_From the rule text (A26, A28, A19)._

```tsx
const [x, setX] = createSignal(0);
<p>{x()}</p> <p>latest {latest(x)}</p> <p>{isPending(x) ? "saving" : "idle"}</p>
const save = action(function* () { setX(1); yield api.save(); });
```

| #   | Action                              | Screen                            | `latest` / `isPending`                                 | Effects ran  |
| --- | ----------------------------------- | --------------------------------- | ------------------------------------------------------ | ------------ |
| 0   | primed                              | `0 \| latest 0 \| idle`           |                                                        | all          |
| 1   | `save()` — before any flush         | —                                 | `latest(x)` 0 (unflushed, F-10) · `isPending(x)` false | —            |
| 2   | `flush()`                           | `0 \| latest 1 \| saving`         | `latest(x)` 1 · `isPending(x)` true                    | latest, idle |
| 3   | `api.save()` resolves, body returns | `1 \| latest 1 \| idle`           | false                                                  | x, idle      |
| ✗   |                                     | after 1: `latest 1`; after 2: `1` |                                                        |              |

### S-9. `yield` is the hold-safe suspension; a fresh write after `await` escapes — D-7 (A26)

_Pinned: `tests/action-await-contract.test.ts`._

```ts
const run = action(async function* () {
  setA(1);            // held
  await api.x();      // the hold cannot follow a bare await
  setB(1);            // a FRESH signal: escapes, commits ambiently
  yield;              // re-entry
  setC(1);            // held again
});
<p>{a()} {b()} {c()}</p>
```

| #   | Action                               | Screen  | Notes                                                                                           |
| --- | ------------------------------------ | ------- | ----------------------------------------------------------------------------------------------- |
| 0   | primed                               | `0 0 0` |                                                                                                 |
| 1   | `run(); flush()`                     | —       | `a = 1` held                                                                                    |
| 2   | `api.x()` resolves; `setB(1)`; flush | `0 1 0` | `b` escaped — the documented escape; a signal the action _already_ holds would rejoin even here |
| 3   | `yield`; `setC(1)`                   | —       | `c` held with `a`                                                                               |
| 4   | body returns                         | `1 1 1` | one frame for `a`, `c`                                                                          |

### S-10. A write is a proposal — D-8 (A34)

_Pinned: `tests/write-proposals-3494.test.ts`._

```tsx
const [count, setCount] = createSignal(0); const [show, setShow] = createSignal(true);
const details = createMemo(() => fetchDetails(count()));
<p>{show() ? details() : "hidden"}</p> <p>Count {count()}</p>
```

| #   | Action                                                                     | Screen                                                                                                        | `isPending`              | Effects ran |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------ | ----------- |
| 0   | primed                                                                     | `0 \| Count 0`                                                                                                |                          | all         |
| 1   | `setCount(1); flush()`                                                     | — (held on `details(1)`)                                                                                      | `isPending(count)` true  | —           |
| 2   | `setShow(false); setShow(true); flush()` — nets to committed               | — (no proposal: `show` not held)                                                                              | `isPending(show)` false  | —           |
| 3   | `setShow(false); flush()` — plain mainline                                 | `hidden \| Count 1` — the hide publishes; dropping `details`' last reader releases the hold in the same drain | `isPending(count)` false | both        |
| 2′  | variant at 2: `setA(1); setCount(1); flush()` — a repeat of the held value | — (`A` waits with `count`: two suggestions for one slot finish together)                                      |                          | —           |
| ✗   |                                                                            | after 2: `isPending(show)` true and the later hide lost; after 2′: `A 1` published alone                      |                          |             |

### S-11. Entanglement through a shared derivation; a reveal that discovers a flight — D-9 (A15)

_Pinned: `tests/spec-async-semantics.test.ts` (A15), `tests/first-observer-stale-reader.test.ts` (#3458)._

```tsx
const a = createMemo(() => fetchA(x())); const b = createMemo(() => fetchB(y()));
const sum = createMemo(() => a() + b());
<p>A {a()}</p> <p>B {b()}</p> <p>Sum {sum()}</p>
```

| #   | Action                                     | Screen                                               | Effects ran |
| --- | ------------------------------------------ | ---------------------------------------------------- | ----------- |
| 1   | `setX(1); flush()` then `setY(1); flush()` | — (two flights, one shared on-screen derivation)     | —           |
| 2   | `a(1)` lands                               | — (one unit; waits on `b(1)`)                        | —           |
| 3   | `b(1)` lands                               | `A 1 \| B 1 \| Sum 2`                                | all         |
| 1″  | without `Sum`: the same two writes         | `A 1` at `a`'s landing, `B 1` at `b`'s — independent | A, then B   |

First observer (#3458): `<Show when={show()}><p>B {b()}</p></Show>` closed, `b(1)` in flight with nothing displaying it, `count = 1` held on `a(1)`. `setShow(true)` reveals a reader of `b` for the first time: the reveal joins the hold, and `Count 1 | A 1 | B 1` publishes once, when both have landed — never `Count 1 | A 1` beside `B 0`.

### S-12. The committed frame keeps its inputs — D-10 (A30)

_Pinned: `tests/held-conditional-memo.test.ts`, `tests/held-frame-dependencies.test.ts`._

```tsx
const [fixed, setFixed] = createSignal(false);
const [count, setCount] = createSignal(0);
const slow = createMemo(() => fetchSlow(fixed()));
const selected = createMemo(() => (fixed() ? 2 : count()));
<p>
  Fixed {fixed()} | Count {count()} | Selected {selected()} | Slow {slow()}
</p>;
```

| #   | Action                            | Screen                                                                                             | Notes                           |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------- |
| 0   | primed                            | `false \| 0 \| 0 \| 0`                                                                             |                                 |
| 1   | `setFixed(true); flush()`         | — (held on `slow(true)`; `selected`'s held pass is `2` and stopped reading `count`)                |                                 |
| 2   | `setCount(1); flush()` — mainline | — (the write reaches `selected` through the kept input; its pass reads the held `fixed` and joins) | `Count 1` reveals with the hold |
| 3   | `slow` lands                      | `true \| 1 \| 2 \| 1`                                                                              |                                 |
| ✗   |                                   | after 2: `Count 1` beside `Selected 0` / `Fixed false`                                             |                                 |

Render-effect arm: `{show() ? count() : "hidden"}` held on `show → false` re-derives `Panel 1` beside `Count 1` at once (the effect is a leaf), then `hidden` at the commit.

### S-13. The last on-screen reader leaving releases the hold — D-11 (O3)

_Pinned: `tests/posture-born-held-and-observation.test.ts` (`gatedAway`)._

```tsx
const [count, setCount] = createSignal(0); const [show, setShow] = createSignal(true);
const details = createMemo(() => fetchDetails(count()));   // never lands in this scenario
<p>Count {count()}</p> <Show when={show()}><p>{details()}</p></Show>
```

| #   | Action                    | Screen                                                                   | `isPending`             |
| --- | ------------------------- | ------------------------------------------------------------------------ | ----------------------- |
| 1   | `setCount(1); flush()`    | — (held on `details(1)`)                                                 | `isPending(count)` true |
| 2   | `setShow(false); flush()` | `Count 1` — the gate closed, no on-screen reader derives from the flight | false                   |
| ✗   |                           | `Count 0` forever                                                        |                         |

---

## B. Boundaries (D-12–D-21)

### S-14. A fresh `<Loading>` a separate change mounts over a held value shows its fallback now — D-12 (#3540)

_Ruled 2026-09-18 (#3540) and reaffirmed 2026-10-09. Pinned by `tests/boundary-not-born-held-3540.test.ts`, `tests/loading-fallback-in-flush-3540.test.ts`, and `tests/direction-rule-probe.test.ts` (boundary shape). The verdict cell is F-9 and D-22._

```tsx
const [count, setCount] = createSignal(0);
const slow = createMemo(() => fetchSlow(count()));
<p>Count {count()}</p> <p>Slow {slow()}</p>               // Slow holds save's frame; Count does not hold
const save = action(function* () { setCount(1); yield gate; });
// a separate change, while save() is open:
<Show when={open()}>
  {() => {
    const m = createMemo(() => count());                  // born held: value 1, in save's hold
    return <Loading fallback="fallback"><p>count {m()}</p></Loading>;   // view
  }}
</Show>
```

| #   | Action                                                                         | Screen                                                                                                                                                                                                                       | `latest` / `isPending`                                                                                                   | Effects ran |
| --- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------- |
| 0   | primed                                                                         | `Count 0 \| Slow 0`                                                                                                                                                                                                          |                                                                                                                          |             |
| 1   | `save(); flush()`                                                              | — (held on `slow(1)`)                                                                                                                                                                                                        | `isPending(count)` true                                                                                                  | —           |
| 2   | `setOpen(true); flush()`                                                       | `Count 0 \| Slow 0 \| [fallback]` — `m`'s read is caught, so it holds nothing; `setOpen` never entangles with `save`, and its frame shows now                                                                                | `isPending(count)` true · `isPending(view)` false · `isPending(m)` holds its reader (no committed value) · `latest(m)` 1 | view        |
| 3   | `gate`, `slow(1)` lands                                                        | `Count 1 \| Slow 1 \| count 1` — the content arrives with `save`'s commit                                                                                                                                                    | all false                                                                                                                | all         |
| 2b  | at 2, plus `<span>{m()}</span>` beside the boundary in the same branch         | `Count 0 \| Slow 0` — the span throws and holds `setOpen`'s frame (F-2); at 3 the branch appears with `count 1`, and the fallback is never seen                                                                              |                                                                                                                          | —           |
| 2c  | at 2, plus `<span>{isPending(m) ? "updating" : ""}</span>` beside the boundary | as 2b — `isPending(m)` holds its reader as the read does. Inside the boundary instead (the recommended place, D-23), it is caught with the content: `Count 0 \| Slow 0 \| [fallback]`, then `count 1` and an empty span at 3 |                                                                                                                          | —           |
| ✗   |                                                                                | after 2: `Count 0 \| Slow 0` with the fallback kept off screen for `Count` and `Slow` (a draft of 2026-10-09, withdrawn); a slot showing neither fallback nor content; or `count 1` beside `Count 0`                         |                                                                                                                          |             |

### S-15. A boundary whose own mount is held appears at that hold's commit — D-13

_Ruled 2026-10-06; one shape pinned `it.fails` (`loading-fallback-in-flush-3540.test.ts` "a boundary mounted by a pass that joined the hold…")._

```tsx
const [x, setX] = createSignal(false);
const slow = createMemo(() => fetchSlow(x()));
<p>Slow {slow()}</p>
<Show when={x()}><Loading fallback="fallback"><Content /></Loading></Show>  // Content's data is loading
const open = action(function* () { setX(true); yield gate; });
```

| #   | Action                 | Screen                                                                                               | Notes                                     |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 0   | primed                 | `Slow false \| (closed)`                                                                             |                                           |
| 1   | `open(); flush()`      | — (`x = true` held on `slow(true)`; the `Show` is held, so the boundary is not on screen)            | nothing to see                            |
| 2   | `slow` lands           | `Slow true \| [fallback]` — the boundary appears, on its fallback because `Content` is still loading | the hold did not wait for `Content` (F-4) |
| 3   | `Content`'s data lands | `Slow true \| content`                                                                               |                                           |
| ✗   |                        | after 1: `[fallback]` beside `Slow false` (today, for the memo-mounted form — the `it.fails`)        |                                           |

### S-16. A `Loading` reset ends the hold on writes only its readers observed; an outside reader keeps it — D-14 (A33, #3375)

_Pinned: `tests/async-chain-supersession.test.ts`._

```tsx
const [page, setPage] = createSignal(0); const [count, setCount] = createSignal(0);
const pageData = createMemo(() => fetchPage(page()));
const details = createMemo(() => fetchDetails(pageData(), count()));
<Loading on={page()} fallback="Loading...">Details {details()}</Loading>  <p>Sum {page() + count()}</p>
```

| #   | Action                                       | Screen                                                                                                                                                           | Notes                                     |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 0   | primed                                       | `Details d(0,0) \| Sum 0`                                                                                                                                        |                                           |
| 1   | `setCount(1); flush()`                       | — (`details` re-asks under the shown boundary → forwarded → held)                                                                                                | F-5: the shown boundary keeps its content |
| 2   | `setPage(1); flush()`                        | `Loading... \| Sum 2` — one frame: the reset puts `details`' only reader behind the fallback, the `count = 1` hold is over, `page = 1` joins and commits with it | F-3                                       |
| 3   | `details(1,1)` lands                         | `Details d(1,1) \| Sum 2`                                                                                                                                        | the boundary alone waited                 |
| 2′  | variant: `<p>Outside {details()}</p>` beside | `Sum 0` stays until `details` lands — the outside reader holds                                                                                                   |                                           |
| ✗   |                                              | after 2: `Details d(0,0) \| Sum 0` (the reset not releasing); or `Sum 2` with `Outside d(0,0)` in the variant                                                    |                                           |

### S-17. After a reset the fallback stays until every reader under it settles — D-14 (#3459)

_Pinned: `tests/loading-reset-collects-forwarded-3459.test.ts`._

```tsx
<p>B {b()}</p>
<Loading on={k()} fallback="Loading"><p>Fast {fast()}</p><p>Slow {slow()}</p></Loading>
// setB(1) re-asked slow under the shown boundary (forwarded, held); then:
```

| #   | Action             | Screen                                                            | Notes                                    |
| --- | ------------------ | ----------------------------------------------------------------- | ---------------------------------------- |
| 1   | `setK(1); flush()` | `B 1 \| Loading` — the released write commits; the boundary waits |                                          |
| 2   | `fast` lands       | —                                                                 | the forwarded `slow` is still in the air |
| 3   | `slow` lands       | `B 1 \| Fast 1 \| Slow 1`                                         | one coherent reveal                      |
| ✗   |                    | after 2: `B 1 \| Fast 1 \| Slow 0`                                |                                          |

### S-18. `on` follows the frame of the change — D-15 (#3575)

_Pinned: `tests/loading-on-frame-following-3540.test.ts` §1–§2; `05-async-data.md`._

```tsx
const [id, setId] = createSignal(1);
const product = createMemo(() => fetchProduct(id()));   // read in the shell, outside the boundary
const comments = createMemo(() => fetchComments(id()));
<h1>{product().name}</h1>
<Loading on={id()} fallback="spinner"><ul>{comments()}</ul></Loading>
```

| #   | Action                                      | Screen                                                                               | Notes                                                                                              |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 0   | primed                                      | `A \| comments-A`                                                                    |                                                                                                    |
| 1   | `setId(2); flush()`                         | — (the shell's `product(2)` holds the frame; the screen stays on A)                  | entered: the fallback is the display, and it is not shown; it is seen only if the hold lifts first |
| 2   | `product(2)` lands (comments still loading) | `B \| spinner` — the fallback lands with B, not beside A                             |                                                                                                    |
| 3   | `comments(2)` lands                         | `B \| comments-B`                                                                    |                                                                                                    |
| 2′  | if `comments(2)` lands before `product(2)`  | — then `B \| comments-B` at `product`'s landing: no spinner ever                     |                                                                                                    |
| 1″  | nothing outside holds (no shell read)       | `A \| spinner` immediately at 1, then `comments-B` at its landing                    |                                                                                                    |
| ✗   |                                             | `A \| spinner` while the shell still shows A (the 2026-09-19 eager re-arm, rejected) |                                                                                                    |

### S-19. A same-source outside read: the fallback is armed off screen and never seen — D-16

_Pinned: `loading-on-frame-following-3540.test.ts` §3. Ruled 2026-10-09._

```tsx
<Loading on={id()} fallback="spinner">{data()}</Loading>
<Loading fallback="spinner">{data()}</Loading>          // B: reads the same data(), holds the frame
```

| #   | Action                                         | Screen                                                                                                  | Notes                                                                               |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | `setId(2); flush()`                            | `A \| A` — entered: the fallback is the display, and it is not shown                                    | the hold is `data(2)`, which is what the fallback waits on. DEV once, at the change |
| 2   | `data(2)` lands                                | `B \| B`                                                                                                | the hold lifts with the data, so the fallback is never painted                      |
| 1′  | a header reads `latest(id)` beside `on={id()}` | `1 \| A` — the header shows the new id; the boundary's old content stays; the fallback stays off screen | F-6. The header does not pull the fallback on screen                                |
| ✗   |                                                | `spinner \| A` at 1                                                                                     | rejected 2026-10-09 — a visible spinner beside the outside reader's stale data      |

### S-20. The action outlasts the data: a race the fallback lost, not reported — D-16

_Pinned: `loading-on-frame-following-3540.test.ts` §5; `loading-on-latest-fallback-4337.test.ts` (the fallback reads `latest`)._

| #   | Action                                                        | Screen                                               | Notes                                                        |
| --- | ------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ |
| 1   | `action(function* () { setId(2); yield longer; })(); flush()` | `A` (held)                                           | entered: the fallback is the display, and it is not shown    |
| 2   | `comments(2)` lands                                           | — (the action is still open)                         |                                                              |
| 3   | the action ends                                               | `B \| comments-B` — the fallback was never displayed | legitimate; nothing reported                                 |
| 1′  | the action ends _before_ `comments(2)` lands                  | `B \| spinner` with the commit, then `comments-B`    | the race the fallback won                                    |
| 1″  | the fallback reads `latest(id)`                               | as 1–3: `A` held, then `B \| comments-B`             | the fallback's `latest` does not pull the swap ahead (#4337) |

<!-- ruling:S-21 -->
### S-21. A display-ahead read in `on` shows the fallback now, beside the held frame — D-17

_Generated from `packages/web/test/async-gen/rulings/S-21.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: standing. Pins also: `tests/loading-on-frame-following-3540.test.ts`, `tests/loading-on-rearm-reveal-3540.test.ts`._

```tsx
const [id, setId] = createSignal(1);
const product = createMemo(async () => fetch(1 + id()));
const comments = createMemo(async () => fetch(1 + id()));
<span>{product()}</span>
<Loading fallback="[fallback]" on={[latest(id)]}>
  <span>{comments()}</span>
</Loading>
```

| # | Action                                    | Screen                             | Notes                                                                                                                                    |
| --- | ----------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | product(2) lands; comments(2) lands; tick | `product 2 \| comments 2`          | primed                                                                                                                                   |
| 1 | setId(2); flush()                         | `product 2 \| [fallback]`          | the new id's loading state inside the old page: `on` read `latest(id)`, whose frame has landed; the shell's read of `product` stays held |
| 2 | product(3) lands; tick                    | `product 3 \| [fallback]`          |                                                                                                                                          |
| 3 | comments(3) lands; tick                   | `product 3 \| comments 3`          | content that reads nothing held reveals when it lands                                                                                    |
| ✗ |                                           | after 1: `product 2 \| comments 2` | the swap travelled with the shell's frame                                                                                                |
<!-- /ruling -->

<!-- ruling:S-48 -->
### S-48. `on={id()}`: the `on` pass reads the held value plainly, so the swap lands with the write's frame — D-17 (#3540)

_Generated from `packages/web/test/async-gen/rulings/S-48.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: standing. Pins also: `tests/loading-on-frame-following-3540.test.ts`._

```tsx
const [id, setId] = createSignal(1);
const product = createMemo(async () => fetch(1 + id()));
const comments = createMemo(async () => fetch(1 + id()));
<span>{product()}</span>
<Loading fallback="[fallback]" on={[id()]}>
  <span>{comments()}</span>
</Loading>
```

| # | Action                                    | Screen                             | Notes                                                                                  |
| --- | ----------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------- |
| 0 | product(2) lands; comments(2) lands; tick | `product 2 \| comments 2`          | primed                                                                                 |
| 1 | setId(2); flush()                         | —                                  | the `on` pass read the held `id`: it is the hold's work and its re-arm is held with it |
| 2 | product(3) lands; tick                    | `product 3 \| [fallback]`          | `product(2)` lands: the frame commits and the swap lands with it                       |
| 3 | comments(3) lands; tick                   | `product 3 \| comments 3`          |                                                                                        |
| ✗ |                                           | after 1: `product 2 \| [fallback]` | the fallback ahead of the frame the plain read belongs to                              |
<!-- /ruling -->

<!-- ruling:S-49 -->
### S-49. A mixed `on`: a plain read of a held value makes the re-arm wait — D-17

_Generated from `packages/web/test/async-gen/rulings/S-49.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: ruled-not-built._

```tsx
const [id, setId] = createSignal(1);
const [filter, setFilter] = createSignal(0);
const product = createMemo(async () => fetch(1 + id()));
const comments = createMemo(async () => fetch(1 + id()));
<span>{product()}</span>
<Loading fallback="[fallback]" on={[latest(id), filter()]}>
  <span>{comments()}</span>
</Loading>
```

| # | Action                                         | Screen                             | Notes                                                                                                                                     |
| --- | ---------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | product(2) lands; comments(2) lands; tick      | `product 2 \| comments 2`          | primed                                                                                                                                    |
| 1 | action: setId(2), setFilter(1); flush()        | —                                  | `filter()` is a plain read of a held staging: the `on` pass is the hold's work and the re-arm waits, whatever `latest(id)` beside it read |
| 2 | the action lands; tick; product(3) lands; tick | `product 3 \| [fallback]`          | the hold commits: the swap lands with the frame                                                                                           |
| 3 | comments(3) lands; tick                        | `product 3 \| comments 3`          |                                                                                                                                           |
| ✗ |                                                | after 1: `product 2 \| [fallback]` | today's screen: one probe made the whole `on` pass a verdict reader                                                                       |
<!-- /ruling -->

### S-22. A fallback that itself reads pending data — D-18

_Pinned: `tests/loading-on-rearm-reveal-3540.test.ts`._

```tsx
<Loading fallback="outer">
  <Loading on={id()} fallback={<Meta m={meta()} />}>
    {" "}
    {/* meta() is async */}
    {content()}
  </Loading>
</Loading>
```

| #   | Action                                                           | Screen                                                           | Notes                                                  |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| 0   | initial load, `content` and `meta` pending                       | `outer` — the inner fallback's pending is the parent's           |                                                        |
| 1   | both land                                                        | `content`                                                        |                                                        |
| 2   | `setId(2); flush()` — re-arm; `meta(2)` and `content(2)` pending | `content(1)` — the old content stays until the fallback can show | the parent never drops to `outer` for a child's re-arm |
| 3   | `meta(2)` lands                                                  | `Meta(2)` — the fallback                                         |                                                        |
| 4   | `content(2)` lands                                               | `content(2)`                                                     |                                                        |
| 3′  | if `content(2)` lands before `meta(2)`                           | `content(2)` — the fallback is never seen                        |                                                        |

### S-23. Queued runs behind a fallback wait; portals included — D-19

_From §27 7g (2026-10-02)._

| #   | Action                                                                                         | Screen                                              | Notes                                                   |
| --- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| 0   | first render: `<Loading fallback="…"><Portal mount={body}>…</Portal><p>{data()}</p></Loading>` | `[fallback]`; `document.body` has no portal content | the portal's `schedule: true` run waits in the boundary |
| 1   | `data` lands                                                                                   | content; the portal appears in `body`               | released at the reveal                                  |
| ✗   |                                                                                                | portal content in `body` while the fallback shows   |                                                         |

### S-24. An armed boundary lets a lane reveal immediately — D-21

_The disarmed row is F-5, pinned by `tests/fuzz-findings-l2.test.ts` "F6: a lane holds through a Loading boundary showing content". The armed row is that ruling's fallback half, the lane form of D-12._

```tsx
const [id, setId] = createSignal(0);
const details = createMemo(() => fetchDetails(latest(id)));
<Header id={latest(id)} />
<Loading fallback="loading"><Details value={details()} /></Loading>
```

| #   | Action                                                                   | Header (`latest(id)`)                                                   | Details   | Notes                                                                                            |
| --- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------ |
| 0   | primed, boundary fresh (armed)                                           | 0                                                                       | `loading` | the first load is the boundary's                                                                 |
| 1   | `setId(1); flush()` — `details(1)` in flight, still under the fallback   | 1                                                                       | `loading` | the flight does not hold the lane; the header reveals now                                        |
| 2   | `details(1)` lands                                                       | 1                                                                       | 1         |                                                                                                  |
| 1′  | the same write once the boundary has shown content (disarmed — F-5, F-6) | 0                                                                       | 0         | the boundary forwards, so the lane holds on `details` exactly as with no boundary there. Pinned. |
| 2′  | `details(1)` lands                                                       | 1                                                                       | 1         | together                                                                                         |
| ✗   |                                                                          | on 1: header `0` beside `loading`; on 1′: header `1` beside details `0` |           |                                                                                                  |

---

## C. Display-ahead readers and verdicts (D-22–D-31)

<!-- ruling:S-25 -->
### S-25. Nothing shows a write before its flush; then every channel at once — D-22 (A28)

_Generated from `packages/web/test/async-gen/rulings/S-25.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: standing. Pins also: `tests/latest-held-till-flush.test.ts`, `tests/latest-repeated-writes.test.ts`._

**Case 1.**

```tsx
const [count, setCount] = createSignal(20);
const doubled = createMemo(() => 1 + count());
<span>{count()}</span>
<span>{latest(count)}</span>
<span>{latest(doubled)}</span>
<span>{isPending(count)}</span>
```

| # | Action       | Screen                                                                                  | Notes                                                  |
| --- | ------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 0 | render       | `count 20 \| latest(count) 20 \| latest(doubled) 21 \| isPending(count) false`          |                                                        |
| 1 | setCount(30) | —                                                                                       | `setCount(30)` with no flush: nothing shows it         |
| 2 | flush()      | `count 30 \| latest(count) 30 \| latest(doubled) 31 \| isPending(count) false`          | nothing holds: every channel at once                   |
| ✗ |              | after 1: `count 20 \| latest(count) 30 \| latest(doubled) 21 \| isPending(count) false` | `latest(count)` 30 while `latest(doubled)` is still 21 |

**Case ′.**

```tsx
const [count, setCount] = createSignal(20);
const doubled = createMemo(() => 1 + count());
const slow = createMemo(async () => fetch(1 + count()));
<span>{count()}</span>
<span>{latest(count)}</span>
<span>{latest(doubled)}</span>
<span>{isPending(count)}</span>
<span>{slow()}</span>
```

| # | Action                | Screen                                                                                    | Notes                                                                                           |
| --- | --------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 0 | slow(21) lands; tick  | `count 20 \| latest(count) 20 \| latest(doubled) 21 \| isPending(count) false \| slow 21` | primed                                                                                          |
| 1 | setCount(30); flush() | `count 20 \| latest(count) 30 \| latest(doubled) 31 \| isPending(count) true \| slow 21`  | an asyncMemo reader holds `count`: the plain read keeps 20, `latest` shows 30, `isPending` true |
| 2 | slow(31) lands; tick  | `count 30 \| latest(count) 30 \| latest(doubled) 31 \| isPending(count) false \| slow 31` |                                                                                                 |
<!-- /ruling -->

<!-- ruling:S-26 -->
### S-26. `isPending` is about a new question — D-23 (A19, A24)

_Generated from `packages/web/test/async-gen/rulings/S-26.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: standing. Pins also: `tests/question-scoped-pending.test.ts`, `tests/loading-value.test.ts`._

```tsx
const [id, setId] = createSignal(1);
const user = createMemo(async () => fetch(1 + id()));
<Loading fallback="[fallback]">
  <span>{user()} {isPending(user)}</span>
</Loading>
```

| # | Action                 | Screen                                    | Notes                                                                                 |
| --- | ---------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| 0 | render                 | `[fallback]`                              | first load: the probe's own read suspends; nothing observable yet — no verdict (D-24) |
| 1 | user(2) lands; tick    | `user 2 \| isPending(user) false`         | final                                                                                 |
| 2 | setId(2); flush()      | `user 2 \| isPending(user) true`          | an input changed — a new question                                                     |
| 3 | user(3) lands; tick    | `user 3 \| isPending(user) false`         |                                                                                       |
| 4 | refresh(user); flush() | —                                         | `refresh(user)`: a re-ask of the same question is quiet                               |
| 5 | user(3) lands; tick    | —                                         | the fresh value reveals silently                                                      |
| ✗ |                        | after 4: `user 3 \| isPending(user) true` | a re-ask reported as a new question                                                   |

The prose row's `affects()` (rows 5–6) and the optimistic write over `user` (row 7) are not migrated yet.
<!-- /ruling -->

<!-- ruling:S-27 -->
### S-27. `[isPending(x), x()]` is atomic; the `latest` form follows x's own async only — D-23, D-25 (A10, A8)

_Generated from `packages/web/test/async-gen/rulings/S-27.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: standing. Pins also: `tests/latest-isPending-consistency.test.ts`, `tests/createMemo.test.ts`._

**Case 1.**

```tsx
const [n, setN] = createSignal(0);
const x = createMemo(async () => fetch(1 + n()));
const y = createMemo(async () => fetch(1 + x()));
<span data-a0={isPending(x)} data-a1={x()}></span> {/* one effect */}
<span data-a0={isPending(() => latest(x))} data-a1={latest(x)}></span> {/* one effect */}
<span>{y()}</span>
```

| # | Action                             | Screen                                                                                        | Notes                                                                                                                                  |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | x(1) lands; tick; y(2) lands; tick | `isPending(x) false \| x 1 \| isPending(() => latest(x)) false \| latest(x) 1 \| y 2`         | primed                                                                                                                                 |
| 1 | setN(1); flush()                   | `isPending(x) true \| x 1 \| isPending(() => latest(x)) true \| latest(x) 1 \| y 2`           | both channels: x's own fetch is up                                                                                                     |
| 2 | x(2) lands; tick                   | `isPending(x) true \| x 1 \| isPending(() => latest(x)) false \| latest(x) 2 \| y 2`          | `x` landed, `y` still up: the plain channel is a landed answer awaiting reveal; `latest` saw x's own answer — verdicts are per channel |
| 3 | y(3) lands; tick                   | `isPending(x) false \| x 2 \| isPending(() => latest(x)) false \| latest(x) 2 \| y 3`         |                                                                                                                                        |
| ✗ |                                    | after 2: `isPending(x) true \| x 2 \| isPending(() => latest(x)) false \| latest(x) 2 \| y 2` | `[true, x1]`: pending beside the fresh value                                                                                           |

**Case memo.**

```tsx
const [n, setN] = createSignal(0);
const x = createMemo(() => 1 + n() + isPending(n));
<span>{x()}</span>
```

| # | Action                        | Screen         | Notes                                                                                                                                                                                           |
| --- | ----------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | render                        | `x 1`          |                                                                                                                                                                                                 |
| 1 | setN(5) in an action; flush() | `x 2`          | `m = 1 + x + isPending(x)`: the memo probes x and reads it plainly in one pass — the plain read is the screen's 0 and the probe is true, shown now (A10, D-25); the memo is not the hold's work |
| 2 | the action lands; tick        | `x 6`          |                                                                                                                                                                                                 |
| ✗ |                               | after 1: `x 1` | the memo held with the write it probed: the spinner would show only at the commit                                                                                                               |

On a plain signal or sync memo the `latest` form is never pending. The memo case is the pass-level half of D-25: a plain read of a node the pass also probed is the screen's.
<!-- /ruling -->

### S-28. `isPending` never throws unowned; `latest` throws uninitialized everywhere — D-24 (A16, A7)

_Pinned: `tests/spec-async-semantics.test.ts` (A16), `tests/uninitialized-visibility.test.ts`._

| Caller                                                              | `isPending(() => uninit())`                               | `latest(uninit)` |
| ------------------------------------------------------------------- | --------------------------------------------------------- | ---------------- |
| event handler (no owner)                                            | `false`                                                   | throws           |
| component body / computation (an owner)                             | throws — propagates to the boundary                       | throws           |
| `isPending(() => { throw new Error() })`, any scope                 | `false`                                                   | n/a              |
| `isPending(() => store)` — the thunk returns a store, reads nothing | `false` (reads-only; the return value is never inspected) |                  |

<!-- ruling:S-29 -->
### S-29. A display-ahead reader's own async is held — D-25 (A31, #3442)

_Generated from `packages/web/test/async-gen/rulings/S-29.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: standing. Pins also: `tests/ispending-combined-atomic-3442.test.ts`._

```tsx
const [n, setN] = createSignal(0);
const fast = createMemo(async () => fetch(1 + n()));
const slow = createMemo(async () => fetch(1 + n()));
const copy = createMemo(() => 1 + slow());
const both = createMemo(() => 1 + fast() + copy());
<span data-a0={fast()} data-a1={copy()} data-a2={isPending(both)}></span> {/* one effect */}
```

| # | Action                             | Screen                                               | Notes                                                                         |
| --- | ---------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| 0 | fast(1) lands; slow(1) lands; tick | `fast 1 \| copy 2 \| isPending(both) false`          | primed                                                                        |
| 1 | setN(1); flush()                   | `fast 1 \| copy 2 \| isPending(both) true`           |                                                                               |
| 2 | fast(2) lands; tick                | —                                                    | `fast` landed; `copy` computes under its own posture: still pending on `slow` |
| 3 | slow(2) lands; tick                | `fast 2 \| copy 3 \| isPending(both) false`          |                                                                               |
| ✗ |                                    | after 2: `fast 2 \| copy 2 \| isPending(both) false` | `fast` revealed alone with the probe false                                    |
<!-- /ruling -->

<!-- ruling:S-50 -->
### S-50. A memo that probed once, re-run by a sync write, holds the tick — D-25

_Generated from `packages/web/test/async-gen/rulings/S-50.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: ruled-not-built._

```tsx
const [x, setX] = createSignal(0);
const [k, setK] = createSignal(0);
const [probe, setProbe] = createSignal(1);
const m = createMemo(() => 1 + k() + (probe() ? isPending(x) : 0) + x());
<span>{m()} {k()}</span>
```

| # | Action                        | Screen                | Notes                                                                                                                                             |
| --- | ----------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | render                        | `m 1 \| k 0`          |                                                                                                                                                   |
| 1 | setX(1) in an action; flush() | `m 2 \| k 0`          | the probe shows busy now; the plain read of `x` is the screen's 0                                                                                 |
| 2 | setProbe(0); setK(1); flush() | —                     | this run probes nothing: its read of `x` is a plain read of the held staging, so `m` is the hold's work and the tick that wrote `k` holds with it |
| 3 | the action lands; tick        | `m 3 \| k 1`          |                                                                                                                                                   |
| ✗ |                               | after 2: `m 2 \| k 1` | today's screen (published twice): the memo read `x` as the screen's because its last run probed, and `k` broke free                               |
<!-- /ruling -->

### S-30. A `latest()` reader mounted mid-hold shows the committed value and reveals with the lane — D-26 (#3460)

_Pinned: `tests/lane-outside-view.test.ts`._

```tsx
const [v, setV] = createSignal(0);
const details = createMemo(() => fetchDetails(latest(v))); // the latest lane's async
<p>
  Details {details()} | Value {v()}
</p>;
const bump = action(function* () {
  setV(1);
  yield gate;
});
// mid-hold, on a click: <p>Late {latest(v)}</p>
```

| #   | Action                                                        | Screen                                                         | Notes                                                               |
| --- | ------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | `bump(); flush()`                                             | `Details 0 \| Value 0` — the lane holds itself on `details(1)` |                                                                     |
| 2   | mount `Late`; `flush()`                                       | `… \| Late 0` — an outsider shows what is on screen            | entangles nothing                                                   |
| 3   | `details(1)` lands, release                                   | `Details 1 \| Late 1 \| Value 1`                               | one frame                                                           |
| 2′  | a sibling sync write re-runs a reader of `latest(v)` mid-hold | publishes at once with the committed `0`                       | "we wouldn't hold a sync write on a transition. Lanes are the same" |
| ✗   |                                                               | after 2: `Late 1` beside `Details 0`                           |                                                                     |

<!-- ruling:S-31 -->
### S-31. A verdict reader's mount is mainline: `Show when={latest(x)}` → `Loading` shows its fallback — D-1, D-25 (#3851)

_Generated from `packages/web/test/async-gen/rulings/S-31.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: standing. Pins also: `tests/verdict-mount-first-pass-3851.test.ts`._

```tsx
const [x, setX] = createSignal(0);
<span>{x()}</span>
<Show when={latest(x)}>
  <Loading fallback="[fallback]">
    <span>{x()}</span>
  </Loading>
</Show>
```

| # | Action                        | Screen                | Notes                                                                                                                                              |
| --- | ----------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | render                        | `x 0`                 | the `Show` is closed                                                                                                                               |
| 1 | setX(1) in an action; flush() | `x 0 \| [fallback]`   | the `Show` opens ahead (display-ahead); the boundary is a mainline mount whose content read the write the action holds: born held, so the fallback |
| 2 | the action lands; tick        | `x 1 \| x 1`          |                                                                                                                                                    |
| ✗ |                               | after 1: `x 0 \| x 1` | the torn frame #3869 fixed: content 1 beside x = 0                                                                                                 |
<!-- /ruling -->

<!-- ruling:S-46 -->
### S-46. The content a display-ahead `Show` opens reads the screen, whoever opened the hold — D-25

_Generated from `packages/web/test/async-gen/rulings/S-46.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: standing. Pins also: `tests/display-ahead-plain-write-content.test.ts`, `web/test/display-ahead-plain-write-content-s46.spec.tsx`._

**Case 1.**

```tsx
const [id, setId] = createSignal(0);
const detail = createMemo(async () => fetch(1 + id()));
<span>{id()}</span>
<span>{detail()}</span>
<Show when={latest(id)} fallback="[none]">
  <span>{id()}</span>
</Show>
```

| # | Action                | Screen                              | Notes                                                                                                                                                                                    |
| --- | --------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | detail(1) lands; tick | `id 0 \| detail 1 \| [none]`        | primed                                                                                                                                                                                   |
| 1 | setId(1); flush()     | —                                   | the `Show` opens ahead (`latest` asked), but the branch is a mount whose first pass read the staging plainly: born held (D-27), it does not attach until the landing; the fallback stays |
| 2 | detail(2) lands; tick | `id 1 \| detail 2 \| id 1`          |                                                                                                                                                                                          |
| ✗ |                       | after 1: `id 0 \| detail 1 \| id 1` | two plain reads of one signal disagreeing on one screen                                                                                                                                  |
| ✗ |                       | after 1: `id 0 \| detail 1 \| id 0` | the branch attached with the committed value; a mount under a display-ahead reader is born held, not a D-3 leaf                                                                          |
| ✗ |                       | after 1: `id 0 \| detail 1`         | the branch attached with its hole empty (F-2: never an empty slot)                                                                                                                       |

**Case ′.**

```tsx
const [id, setId] = createSignal(0);
const detail = createMemo(async () => fetch(1 + id()));
<span>{id()}</span>
<span>{detail()}</span>
<Show when={latest(id)} fallback="[none]">
  <span>{latest(id)}</span>
</Show>
```

| # | Action                | Screen                             | Notes                                                                |
| --- | --------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| 0 | detail(1) lands; tick | `id 0 \| detail 1 \| [none]`       |                                                                      |
| 1 | setId(1); flush()     | `id 0 \| detail 1 \| latest(id) 1` | content `latest(id)`: the read that asks sees ahead, at its own site |
| 2 | detail(2) lands; tick | `id 1 \| detail 2 \| latest(id) 1` |                                                                      |

**Case ″.**

```tsx
const [id, setId] = createSignal(0);
const detail = createMemo(async () => fetch(1 + id()));
<span>{id()}</span>
<span>{detail()}</span>
<Show when={latest(id)} fallback="[none]">
  <Loading fallback="[fallback]">
    <span>{id()}</span>
  </Loading>
</Show>
```

| # | Action                | Screen                           | Notes                                                |
| --- | --------------------- | -------------------------------- | ---------------------------------------------------- |
| 0 | detail(1) lands; tick | `id 0 \| detail 1 \| [none]`     |                                                      |
| 1 | setId(1); flush()     | `id 0 \| detail 1 \| [fallback]` | S-31's form: the boundary catches the born-held read |
| 2 | detail(2) lands; tick | `id 1 \| detail 2 \| id 1`       |                                                      |
<!-- /ruling -->

### S-39. A later unread value still throws — D-28

_Ruled 2026-10-09. The `n0`-first order already holds the mount. The `latest`-first order still publishes the empty slot; that is the violation._

```tsx
const [s, setS] = createSignal(0);
const n0 = createMemo(async () => fetchEcho(latest(s))); // nobody on screen reads it yet
<Show when={mounted()}>
  <Child a={latest(s)} b={n0()} /> {/* one render effect, either order */}
</Show>;
// an action has set s = 1 and is held; n0(1) is in flight; then setMounted(true)
```

| #   | Action                                       | Screen                                                                                          | Notes                                                                            |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | mount, `n0(1)` in flight — either read order | control off                                                                                     | `n0()` throws; a throw holds the pass. `latest(s)` first does not stop the throw |
| 2   | `n0(1)` lands                                | control on, `[1, 1]`                                                                            |                                                                                  |
| 1′  | the same child inside a fresh `<Loading>`    | control on, `loading`                                                                           | the throw is caught (F-4)                                                        |
| 2′  | `n0(1)` lands                                | control on, `[1, 1]`                                                                            |                                                                                  |
| ✗   |                                              | on 1, `latest` first: control on, slot `(empty)` — `n0()` waited as lane work and did not throw |                                                                                  |

### S-40. A fresh `<Loading>` that reads only `latest` shows it now — D-12, F-6

_Ruled 2026-10-09, from the read-order brief's sibling case (416). Not D-28: this boundary never reads `n0()`. Today's screen is the ✗ row._

```tsx
<p>{n0()}</p>                                          // sibling, in flight, holds
<Loading fallback="loading">{latest(s)}</Loading>      // reads only latest(s)
```

| #   | Action                   | Screen                      | Notes                                                                             |
| --- | ------------------------ | --------------------------- | --------------------------------------------------------------------------------- |
| 1   | mount, `n0(1)` in flight | sibling `0 \| 1`            | the boundary's read has a value, so it shows it. The sibling stays held           |
| 2   | `n0(1)` lands            | sibling `1 \| 1`            |                                                                                   |
| ✗   |                          | sibling `0`, slot `(empty)` | neither the fallback nor `1` — the boundary waited on `n0`, which it did not read |
| ✗   |                          | sibling `0 \| loading`      | the same wait, shown as a fallback                                                |

**The verdict form (ruled 2026-10-31, #4569; D-23, #3373):** a fresh `<Loading>` whose content reads only `isPending` of a first load reveals when the verdict exists. `a0 = async(s)`, `a2 = async(await a0())`; `a0:0` lands, `a2` asks `a2:11`; `setS(1)` re-asks `a0` and marks `a2` pending by propagation while `a2:11` is up and `a2` has no value; `a2:11` lands. `a2`'s question changes only when `a2` re-runs, so the answer is current: `a2` is committed and pending on `a0`. Content that reads `a2` holds (F-2: no screen to keep) — the asymmetry is the rule.

```tsx
<Loading fallback="loading">{isPending(() => a2()) ? "pending" : "settled"}</Loading>
```

| #   | Action                                   | verdict-only content | control: `{a2()}` — alone or beside the probe | Notes                                                                 |
| --- | ---------------------------------------- | -------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| 1   | mount; `a0:0` lands; `a2` asks `a2:11`   | `loading`            | `loading`                                     | first load                                                            |
| 2   | `setS(1)` — re-asks `a0:1`               | `loading`            | `loading`                                     | `a2` pending by propagation, no value, own flight still current       |
| 3   | `a2:11` lands                            | `pending`            | `loading`                                     | `a2` initializes, committed and pending on `a0`; the plain read waits |
| 4   | `a0:1` lands; `a2` re-runs, asks `a2:20` | `pending`            | `loading`                                     |                                                                       |
| 5   | `a2:20` lands                            | `settled`            | `21` / `21 settled`                           |                                                                       |
| ✗   |                                          | after 3: `loading`   |                                               | rejected: a first load kept loading by a supersession no rule has     |

Pinned: `tests/first-load-superseded-answer-4569.test.ts` (also a 3-deep chain and the no-boundary root, which attaches at 3 with `pending`), `packages/web/test/first-load-superseded-answer-4569.spec.tsx`.

<!-- ruling:S-45 -->
### S-45. A first answer landing in the same tick as an action that writes its input: `latest` shows it, the plain read waits — D-22, F-9 (E9)

_Generated from `packages/web/test/async-gen/rulings/S-45.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: ruled-not-built._

**Case leaf.**

```tsx
const [s0, setS0] = createSignal(0);
const m0 = createMemo(async () => fetch(1 + s0()));
<span>{s0()}</span>
<Loading fallback="[fallback]">
  <span>{latest(m0)}</span>
</Loading>
```

| # | Action                                                            | Screen                        | Notes                                                                                                                    |
| --- | ----------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 0 | render                                                            | `s0 0 \| [fallback]`          | first load                                                                                                               |
| 1 | m0(1) lands; setS0(1) in an action; microtask; microtask; flush() | `s0 0 \| latest(m0) 1`        | the answer is the action's (D-4) and `latest` returns it (D-22): the committed `s0 = 0` beside its own answer, one frame |
| 2 | the action lands; tick; m0(2) lands; tick                         | `s0 1 \| latest(m0) 2`        |                                                                                                                          |
| ✗ |                                                                   | after 1: `s0 0 \| [fallback]` | the leaf waited on the action it did not read; a `Loading` reading only `latest` shows what it has (S-40)                |

**Case memo.**

```tsx
const [s0, setS0] = createSignal(0);
const m0 = createMemo(async () => fetch(1 + s0()));
const L = createMemo(() => 1 + latest(m0));
<span>{s0()}</span>
<Loading fallback="[fallback]">
  <span>{L()}</span>
</Loading>
```

| # | Action                                                            | Screen                               | Notes                                               |
| --- | ----------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------- |
| 0 | render                                                            | `s0 0 \| [fallback]`                 | first load                                          |
| 1 | m0(1) lands; setS0(1) in an action; microtask; microtask; flush() | `s0 0 \| L 2`                        | the same screen through a memo `L = latest(m0) + 1` |
| 2 | the action lands; tick; m0(2) lands; tick                         | `s0 1 \| L 3`                        |                                                     |
| ✗ |                                                                   | today, after 1: `s0 0 \| [fallback]` | not yet built — the frames test is `it.fails`       |

**Case plain.**

```tsx
const [s0, setS0] = createSignal(0);
const m0 = createMemo(async () => fetch(1 + s0()));
<span>{s0()}</span>
<Loading fallback="[fallback]">
  <span>{m0()}</span>
</Loading>
```

| # | Action                                                            | Screen               | Notes                                                                      |
| --- | ----------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------- |
| 0 | render                                                            | `s0 0 \| [fallback]` |                                                                            |
| 1 | m0(1) lands; setS0(1) in an action; microtask; microtask; flush() | —                    | a plain read of a first load is loading (F-9); the fallback is right there |
| 2 | the action lands; tick; m0(2) lands; tick                         | `s0 1 \| m0 2`       |                                                                            |
<!-- /ruling -->

---

## D. Writes and optimistic values (D-32–D-37)

### S-32. An optimistic write shows from its flush; held writes beside it; one frame at the end — D-32, D-33 (A17)

_Pinned: `tests/createOptimistic.test.ts`, `tests/spec-async-semantics.test.ts`._

```tsx
const [name, setName] = createSignal("Ann");
const [draft, setDraft] = createOptimistic("Ann");
const [saved, setSaved] = createSignal(false);
<p>
  {draft()} | {saved() ? "saved" : "unsaved"}
</p>;
const rename = action(function* (n) {
  setDraft(n);
  setSaved(true);
  yield api.save(n);
  setName(n);
});
```

| #   | Action                                                                | Screen                                                                                                           | `latest` / `isPending`                                             | Notes                                                                                                         |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 0   | primed                                                                | `Ann \| unsaved`                                                                                                 |                                                                    |                                                                                                               |
| 1   | `rename("Bob")` — before the flush                                    | —                                                                                                                | `draft()` Ann (F-10)                                               |                                                                                                               |
| 2   | `flush()`                                                             | `Bob \| unsaved` — the guess shows; `saved = true` is held                                                       | `isPending(draft)` false (verdict-inert) · `isPending(saved)` true |                                                                                                               |
| 3   | `api.save` resolves, `setName("Bob")`, body returns                   | `Bob \| saved` — revert of the guess and commit of the held writes in one frame; `draft` now rests on its source | false                                                              |                                                                                                               |
| 1″  | ambient: `setDraft("Zed")` with no action and nothing held; `flush()` | `Ann \| unsaved` — nothing applied, the effect never sees `Zed`                                                  |                                                                    | a guess outside a hold does not exist. The one-flush flash (`Ann → Zed → Ann`) was the earlier feasible width |
| ✗   |                                                                       | after 2: `Ann \| unsaved` (guess held) or `Bob \| saved` (held write leaked)                                     |                                                                    |                                                                                                               |

<!-- ruling:S-33 -->
### S-33. A different truth corrects the graph now and the screen at the commit; a never-shown guess is void — D-34 (#3331)

_Generated from `packages/web/test/async-gen/rulings/S-33.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: standing. Pins also: `tests/spec-async-semantics.test.ts`._

```tsx
const [value, setValue] = createSignal(0);
const [double, setDouble] = createOptimistic(async () => fetch(1 + value()));
const related = createMemo(async () => fetch(1 + double()));
<Loading fallback="[fallback]">
  <span>{double()} {related()}</span>
</Loading>
<span>{latest(double)}</span>
<span>{isPending(double)}</span>
```

| # | Action                                        | Screen                                                                         | Notes                                                                                              |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 0 | double(1) lands; tick; related(2) lands; tick | `double 1 \| related 2 \| latest(double) 1 \| isPending(double) false`         | primed                                                                                             |
| 1 | setValue(1); setDouble(3) (a guess); flush()  | `double 1 \| related 2 \| latest(double) 3 \| isPending(double) true`          | the guess's lane holds itself on `related(3)`; `latest` shows the guess                            |
| 2 | double(2) lands; tick                         | `double 1 \| related 2 \| latest(double) 2 \| isPending(double) true`          | the source lands 2 ≠ 3: `related` re-asks from 2 now; the guess never showed, so what showed stays |
| 3 | related(4) lands; tick                        | —                                                                              | the obsolete `related(3)` lands: inert                                                             |
| 4 | related(3) lands; tick                        | `double 2 \| related 3 \| latest(double) 2 \| isPending(double) false`         |                                                                                                    |
| ✗ |                                               | after 2: `double 3 \| related 4 \| latest(double) 2 \| isPending(double) true` | a frame showing `double 3`: a dead, invisible guess                                                |
<!-- /ruling -->

### S-34. Provenance: an older action's late answer never corrects a newer guess — D-35 (Q-D)

_Pinned: `tests/store/lane-authority-twins.test.ts`, `tests/createOptimistic.test.ts` (CategoryDisplay)._

```tsx
const [cat, setCat] = createOptimistic(() => fetchCategory(id()));
<p>{cat()}</p>;
// action 1: setId(1); setCat("news");   action 2 (rapid): setId(2); setCat("finance")
```

| #   | Action                            | Screen                                               | `latest(cat)` | `isPending(cat)` | Notes                                   |
| --- | --------------------------------- | ---------------------------------------------------- | ------------- | ---------------- | --------------------------------------- |
| 1   | both actions open                 | `finance`                                            | finance       | true             |                                         |
| 2   | action 1's answer `news` lands    | `finance` — an older question; staged, moves nothing | finance       | true             | no downstream re-derivation, no flicker |
| 3   | action 2's answer `finance` lands | `finance`                                            | finance       | false            | a silent confirm                        |
| 4   | both end                          | `finance`                                            |               |                  |                                         |
| ✗   |                                   | after 2: `news`                                      |               |                  |                                         |

### S-35. The body's end corrects a guess nothing authoritative is answering — D-35 (#3427)

_Pinned: `tests/optimistic-lane-release.test.ts`, `tests/body-end-supersession-visibility.test.ts`._

| #   | Action                                                                                                    | Screen                                   | `latest` / `isPending`                                                     | Notes                                                           |
| --- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | `action(function* () { setGuess(5); yield api.unrelated(); })()` — the guess's own source is not re-asked | `5`                                      | `isPending(guess)` false                                                   |                                                                 |
| 2   | the body returns                                                                                          | `5` (display unchanged until the commit) | `latest(guess)` = committed truth · `isPending(guess)` true iff it differs | the correction starts now, not after an obsolete derived flight |
| 3   | the hold commits                                                                                          | the truth                                | false                                                                      |                                                                 |

<!-- ruling:S-44 -->
### S-44. An outside input change under a guess is held with the guess's hold — D-34, F-1 (#4336)

_Generated from `packages/web/test/async-gen/rulings/S-44.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: ruled-not-built. Pins also: `tests/optimistic-question-change-4336.test.ts`, `tests/optimistic-layered-filter-4336.test.ts`._

```tsx
const [sel, setSel] = createSignal(3);
const [comments, setComments] = createOptimistic(async () => fetch(1 + sel()));
<span>{sel()} {comments()}</span>
<span>{latest(comments)}</span>
<span>{isPending(comments)}</span>
```

| # | Action                                             | Screen                                                                                   | Notes                                                                                      |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 0 | comments(4) lands; tick                            | `sel 3 \| comments 4 \| latest(comments) 4 \| isPending(comments) false`                 | primed                                                                                     |
| 1 | action: setComments(9); refresh(comments); flush() | `sel 3 \| comments 9 \| latest(comments) 9 \| isPending(comments) false`                 | the guess shows; verdict-inert                                                             |
| 2 | setSel(1); flush()                                 | `sel 3 \| comments 9 \| latest(comments) 9 \| isPending(comments) true`                  | a new question, not the guess's source answering: the change is held with the post         |
| 3 | comments(2) lands; tick                            | —                                                                                        | issue 1's answer lands: still held; `latest(comments)` is the displayed guess (Decision 3) |
| 4 | the action lands; tick                             | —                                                                                        | the post settles; its refresh re-asks issue 1                                              |
| 5 | comments(2) lands; tick                            | `sel 1 \| comments 2 \| latest(comments) 2 \| isPending(comments) false`                 | one frame                                                                                  |
| ✗ |                                                    | after 3: `sel 1 \| comments 2 \| latest(comments) 2 \| isPending(comments) false`        | a `sel 1` frame before the post settles                                                    |
| ✗ |                                                    | today, after 2: `sel 3 \| comments 9 \| latest(comments) 9 \| isPending(comments) false` | not yet built — the frames test is `it.fails`                                              |

The prose row's 1″/1⁗ (an optimistic `sel`), 1‴ (a keyed store) and the layered two-action case are not migrated yet.
<!-- /ruling -->

---

## E. First loads, stores, errors (D-6, D-30, D-38, D-39, D-41, D-42)

### S-36. A declared first paint is loading, not pending — D-30 (A27)

_Pinned: `tests/loading-value.test.ts`, `tests/visibility-oracle.test.ts` (loading window)._

```tsx
const feed = createMemo(() => fetchFeed(id()), { loadingValue: { provisional: true, items: [] } });
<Loading fallback="never shown">
  <Feed data={feed()} dim={isPending(feed)} />
</Loading>;
```

| #   | Action                              | Screen                                              | `isPending(feed)` | Notes                                                                |
| --- | ----------------------------------- | --------------------------------------------------- | ----------------- | -------------------------------------------------------------------- |
| 0   | mount                               | placeholder rows (commit #0) — no fallback, no hold | false             | the window; first-load affordances live in the value (`provisional`) |
| 1   | `fetchFeed(1)` lands                | real rows                                           | false             | the window closes; the node is an ordinary memo now                  |
| 2   | `setId(2); flush()`                 | real rows (held)                                    | true              | a new question                                                       |
| 0′  | mounted inside a live action's hold | placeholder now; the hold does not wait for it      | false             | hydration parity: `isPending` is never `true` on creation            |

### S-37. A derived store's seed is never visible; pending is per key — D-30 (A25, A22, A9)

_Pinned: `tests/store/createProjection.async.test.ts`, `tests/strict-read-pending-store.test.ts`, `tests/spec-async-semantics.test.ts` (A22)._

```ts
const [state] = createStore(() => fetchState(id()), { a: 0, b: 0 }); // seed
```

| #   | Action                                                      | `state.a` tracked        | `state.a` untracked / `"a" in state`                        | `isPending(() => state.a)` | `isPending(() => state.b)`                |
| --- | ----------------------------------------------------------- | ------------------------ | ----------------------------------------------------------- | -------------------------- | ----------------------------------------- |
| 0   | before the first landing                                    | suspends to the boundary | throws (`PENDING_ASYNC_UNTRACKED_READ` in a component body) | false                      | false                                     |
| 1   | lands `{a: 1, b: 1}`                                        | 1                        | 1                                                           | false                      | false                                     |
| 2   | `setId(2); flush()` — the derive re-asks                    | 1 (stale)                | 1                                                           | true                       | true (the whole family re-asks)           |
| 2′  | instead: a held plain write `setState("a", 5)` in an action | 1 (held)                 | 1                                                           | true                       | **false** — per key; the sibling is final |
| 3   | `refresh(state)` bare                                       | 1                        | 1                                                           | false                      | false — a quiet re-ask                    |

### S-38. An error is a boundary returning to its fallback; a write beside an old error — D-39 (§27 7b)

_Pinned: `packages/web/test/loading.spec.tsx` (#2700/#2701 re-pinned 2026-10-02), `tests/createErrorBoundary.test.ts`._

```tsx
const [count, setCount] = createSignal(0);
const data = createMemo(() => fetchOrFail(count()));     // rejects for every count
<p>{count()}</p>
<Errored fallback={e => `Fetch error for ${e().count}`}>
  <Loading fallback="loading">{data()}</Loading>          {/* never shows content */}
</Errored>
```

| #   | Action                   | Screen                                                                                                       | Notes                                                                                                                       |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 0   | first load fails         | `0 \| Fetch error for 0`                                                                                     | the error fallback is the display; readers behind it hold nothing                                                           |
| 1   | `setCount(1); flush()`   | `1 \| Fetch error for 0` — the write publishes beside the old error; the inner `loading` is hidden behind it | a pending is not a value; "what we can't have happen is the error fallback just clear and see some broken state underneath" |
| 2   | `fetchOrFail(1)` rejects | `1 \| Fetch error for 1`                                                                                     |                                                                                                                             |
| ✗   |                          | after 1: `1 \| loading` (the error clearing for a pending); or `0` held by the errored flight                |                                                                                                                             |

`<Errored>` never catches a pending: `ASYNC_OUTSIDE_LOADING_BOUNDARY` is a warning (A6).

Row 1 holds because the errored source itself re-asks. Once it has its new answer, the recovery re-arms the subtree (#4627): the inner `<Loading>`, never shown — or shown before the error — catches what is still pending in the replacement frame, and its fallback shows beside the recovered content. A pending read directly under the `<Errored>` with no `<Loading>` between still keeps the error up, and a recovery held with an action reveals with it (D-41).

### S-42. A held rejection reveals with its frame — D-41 (#3886)

_Pinned: `tests/error-is-an-answer.test.ts`._

```tsx
const [count, setCount] = createSignal(1);
const data = createMemo(() => fetchOrFail(count()));  // rejects for count 2
const slow = createMemo(() => fetchSlow(count()));    // answers later than data
<p>{count()}</p>
<Errored fallback={e => `Error ${e().count}`}>{data()}</Errored>
<p>{slow()}</p>
createEffect(data, { effect: v => log(v), error: e => log(e) });
```

| #   | Action                   | Screen                                                                                           | `data()` untracked | `isPending(data)` | `latest(data)`   | effect log   | Notes                                                         |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------ | ------------------ | ----------------- | ---------------- | ------------ | ------------------------------------------------------------- |
| 0   | both landed for 1        | `1 \| 1 \| 1`                                                                                    | 1                  | false             | 1                | `1`          |                                                               |
| 1   | `setCount(2); flush()`   | `1 \| 1 \| 1` — held: `slow(2)` is in flight                                                     | 1                  | true              | throws NotReady  | `1`          | a change that needs async is held (F-2)                       |
| 2   | `fetchOrFail(2)` rejects | `1 \| 1 \| 1` — still held on `slow(2)`; the error settled `data`                                | 1                  | true              | throws `Error 2` | `1`          | settled, not shown: the error is staged like a value would be |
| 3   | `fetchSlow(2)` lands     | `2 \| Error 2 \| 2`                                                                              | throws `Error 2`   | false             | throws `Error 2` | `1, Error 2` | one frame: input, error fallback and sibling                  |
| ✗   |                          | after 2: `1 \| Error 2 \| 1` with the arm already run — the screen before D-41, F-1's torn frame |                    |                   |                  |              |                                                               |

The hold did not wait on the rejection: step 3 lands as soon as `slow(2)` does, whether `data(2)` rejected before or after it.

### S-47. `try/catch` around a reactive read: caught on one pass, bypassed on the next — D-42, F-12

_Pinned: `tests/try-catch-reactive-read.test.ts` (the not-ready bypass as it is; not a target) and `tests/errored-reader-4486.test.ts` (the error twin's ruled screens, `it.fails` today)._ (S-46 is #4466's.)

```tsx
const [id, setId] = createSignal(0);
const data = createMemo(() => fetchData(id())); // async
const guarded = createMemo(() => {
  try {
    return data();
  } catch {
    return "caught"; // written as if `data()` were an `await`
  }
});
<p>{guarded()}</p>;
```

| #   | Action               | Screen            | `guarded` ran | Notes                                                                                                                                        |
| --- | -------------------- | ----------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | mount                | `caught`          | yes           | the first pass read `data` loading; the catch fired and the memo completed — the first load is masked: no fallback, no hold                  |
| 1   | `fetchData(0)` lands | `d0`              | yes           | the dependency registered before the throw, so the memo re-runs at the landing                                                               |
| 2   | `setId(1); flush()`  | `d0` — held       | **no**        | `data` goes pending; `guarded` is marked pending by propagation, not run. The catch never sees it; the write is held through `guarded` (F-2) |
| 3   | `fetchData(1)` lands | `d1`              | yes           |                                                                                                                                              |
| ✗   |                      | after 2: `caught` | —             | what the author expected: the catch to run on every pending. It runs only on a pass that happens to execute while the source is pending      |

The error twin, under `<Errored fallback={e => ...}>` with a sync `source` that throws when `mode() === 1`. For errors the catch is fully inert (F-12, #4410 amendment, confirmed 2026-10-30 on #4486): a reader of an errored memo is errored with it whether or not it catches — on the change and on a pass that runs over the already-errored source alike. The two halves differ until ruled otherwise: for not-ready the catch is bypassed on the change and masks on the pass.

| #   | Action                          | Screen         | `guarded` ran | Notes                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------------------------- | -------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | mount, `mode = 0`               | `m0`           | yes           |                                                                                                                                                                                                                                                                                                                                                                                                            |
| 1   | `setMode(1); flush()`           | `errored:boom` | **no**        | `source` errors; `guarded` is marked errored, not run; the error reaches `<Errored>` as if the catch were not there                                                                                                                                                                                                                                                                                        |
| 2   | `setMode(2); flush()`           | `m2`           | yes           |                                                                                                                                                                                                                                                                                                                                                                                                            |
| 0′  | mounted with `mode = 1` already | `errored:boom` | yes           | the same code, the same outcome: a reader of an errored memo is errored with it whether or not it catches (#4410, #4486). Deviation today: `caught` at mount and on the first re-run; on the second the boundary errors (a halt, without one) with the memo still reading `caught` — pinned `it.fails`; accepted 2026-10-30 (#4486 closed: reachable only through a catch `CAUGHT_REACTIVE_READ` warns on) |

### S-43. A held recovery keeps the shown error; recovering to the last good value is a change — D-41, D-39 (#3886)

_Pinned: `tests/error-is-an-answer.test.ts`._ Continues S-42 from step 3; `fetchOrFail(3)` resolves to `1`, the value shown before the error.

| #   | Action                        | Screen                                                                                                                                                                                                                                                                 | `data()` untracked | `isPending(data)` | effect log      | Notes                                                                  |
| --- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ----------------- | --------------- | ---------------------------------------------------------------------- |
| 3   | (S-42's end)                  | `2 \| Error 2 \| 2`                                                                                                                                                                                                                                                    | throws `Error 2`   | false             | `1, Error 2`    |                                                                        |
| 4   | `setCount(3); flush()`        | `2 \| Error 2 \| 2` — held: both re-ask                                                                                                                                                                                                                                | throws `Error 2`   | true              | `1, Error 2`    | the error stays the display through the retry (D-39)                   |
| 5   | `fetchOrFail(3)` resolves `1` | `2 \| Error 2 \| 2` — still held on `slow(3)`                                                                                                                                                                                                                          | throws `Error 2`   | true              | `1, Error 2`    | settled, not shown                                                     |
| 6   | `fetchSlow(3)` lands          | `3 \| 1 \| 3`                                                                                                                                                                                                                                                          | 1                  | false             | `1, Error 2, 1` | `1` equals the last good value and is still a new answer: the arm runs |
| ✗   |                               | after 5: `2 \| 1 \| 2` (the error clearing ahead of its frame); after 6: the arm never runs with `1` — before D-41, and then also with nothing held at all (an async landing equal to the last good value is swallowed by the equality gate while the node is errored) |                    |                   |                 |                                                                        |

## F. Declared lag (D-40)

### S-41. Independent panels over one selection: the write shows now, each panel lags to its own landing — D-40

_Pinned: `tests/create-deferred.test.ts`._

```tsx
const [period, setPeriod] = createSignal(1);
const fast = createDeferred(() => fetchFast(period())); // lands in 200ms
const slow = createDeferred(() => fetchSlow(period())); // lands in 10s
<h1>Period {period()}</h1>
<Panel class={{ stale: isPending(() => fast()) }} rows={fast()} />
<Panel class={{ stale: isPending(() => slow()) }} rows={slow()} />
```

| #   | Action                                                            | Screen                                                                           | `isPending` fast / slow | Notes                                                                                   |
| --- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| 0   | both first loads land                                             | `Period 1` · fast 1 · slow 1                                                     | false / false           | the first loads held (or suspended to a boundary) like any                              |
| 1   | `setPeriod(2); flush()`                                           | `Period 2` · fast 1 · slow 1                                                     | true / true             | the write shows now; nothing holds on the panels                                        |
| 2   | `fetchFast(2)` lands                                              | `Period 2` · **fast 2** · slow 1                                                 | false / true            | the landing is its own change                                                           |
| 3   | `fetchSlow(2)` lands                                              | `Period 2` · fast 2 · **slow 2**                                                 | false / false           |                                                                                         |
| 1′  | instead: plain async memos                                        | `Period 1` · fast 1 · slow 1 until 3                                             | true / true             | the default: one hold, gated on the slowest (F-2)                                       |
| 1″  | instead: `period` is held (another reader of it is still loading) | `Period 1` · fast 1 · slow 1                                                     | true / true             | a re-ask that read the held period lands into that hold and shows with its commit (F-7) |
| ✗   |                                                                   | after 1: `Period 1` held for the panels; or after 1″: `fast 2` beside `Period 1` |                         | the first is the hold D-40 removes; the second leads the hold                           |

## G. A question is asked only of the truth (ruled 2026-11-07)

Six rows ruled in one sitting, prompted by the `experiment/unified-updates` branch (GabbeV): its tests were run against `next` and the screens that differed were put on a table. The ruling that settled them is F-2's producer clause and F-6's limit: nothing asks of the value the screen keeps; the display is the one place a value may sit beside the verdict about its successor, because the display is declared, terminal, and keeps rather than computes. S-51, S-53, S-54, S-56 and S-57 are ruled and not built; S-52's #4349 shape is ruled and not built; S-55 is standing.

<!-- ruling:S-51 -->
### S-51. A question is asked only of the truth: an async derivation of a held value is the hold's, never a display-ahead pass — F-2, F-6, D-25 (#4677)

_Generated from `packages/web/test/async-gen/rulings/S-51.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: standing. Pins also: `tests/ispending-async-derivation-4677.test.ts`._

```tsx
const [id, setId] = createSignal(0);
const details = createMemo(async () => fetch(1 + id()));
const badge = createMemo(async () => fetch(1 + id() + isPending(id)));
<span>{id()} {details()} {isPending(id)} {badge()}</span>
```

| # | Action                                 | Screen                                                        | Notes                                                                                                                                                                                                            |
| --- | -------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | details(1) lands; badge(1) lands; tick | `id 0 \| details 1 \| isPending(id) false \| badge 1`         | primed                                                                                                                                                                                                           |
| 1 | setId(2); flush()                      | `id 0 \| details 1 \| isPending(id) true \| badge 1`          | `setId(2)`: `badge` asks, so it is the hold's and asks once, of the truth — `badge(2, false)`; nothing seats the `isPending(id)` hole in a lane, so it shows `true` now beside the kept badge (ruled 2026-11-07) |
| 2 | details(3) lands; tick                 | —                                                             | one answer landed; the frame holds on the other                                                                                                                                                                  |
| 3 | badge(3) lands; tick                   | `id 2 \| details 3 \| isPending(id) false \| badge 3`         | the frame                                                                                                                                                                                                        |
| 4 | nothing to settle; tick                | —                                                             | no third flight was ever asked                                                                                                                                                                                   |
| ✗ |                                        | after 3: `id 0 \| details 1 \| isPending(id) true \| badge 2` | `badge(0, true)`: a question asked with the value the screen keeps, and its answer shown                                                                                                                         |

Built 2026-11-07 (`askerJoins`): the badge, an asker, reads the staging and is the frame's; the `truth-asks` oracle finds nothing here now.

The #4677 issue's other order (the stale answer landing first) disappears with the stale question. L2's rule 6 (2026-10-04), which seated a verdict reader's whole pass in a lane, is narrowed by this ruling to passes that do not ask: F-6's limit.
<!-- /ruling -->

<!-- ruling:S-52 -->
### S-52. `[isPending(x), x()]` in one pass shows pending beside the committed value — the display's declared inconsistency, in a render effect or a memo alike — D-25, D-23, F-6 (#4349, #3905)

_Generated from `packages/web/test/async-gen/rulings/S-52.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: standing. Pins also: `tests/action-refresh-ispending-loop-4349.test.ts`, `tests/latest-isPending-consistency.test.ts`._

**Case 1.**

```tsx
const [s, setS] = createSignal(41);
const x = createMemo(async () => fetch(1 + s()));
<span data-a0={isPending(x)} data-a1={x()}></span> {/* one effect */}
```

| # | Action                              | Screen                                | Notes                                                                                                                                               |
| --- | ----------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | x(42) lands; tick                   | `isPending(x) false \| x 42`          | primed                                                                                                                                              |
| 1 | action (no yield): setS(1); flush() | `isPending(x) true \| x 42`           | the display keeps `42` beside the verdict about its successor, whatever the action's shape (ruled 2026-11-07; the #4349 pin held this shape as one) |
| 2 | x(2) lands; tick                    | `isPending(x) false \| x 2`           | the frame                                                                                                                                           |
| ✗ |                                     | after 1: `isPending(x) false \| x 42` | the pair held as one: the spinner only at the commit                                                                                                |

**Case ′.**

```tsx
const [s, setS] = createSignal(41);
const x = createMemo(async () => fetch(1 + s()));
<span data-a0={isPending(x)} data-a1={x()}></span> {/* one effect */}
```

| # | Action                   | Screen                       | Notes                                                 |
| --- | ------------------------ | ---------------------------- | ----------------------------------------------------- |
| 0 | x(42) lands; tick        | `isPending(x) false \| x 42` | primed                                                |
| 1 | action: setS(1); flush() | `isPending(x) true \| x 42`  | the same with the action open: today's screen already |
| 2 | the action lands; tick   | —                            |                                                       |
| 3 | x(2) lands; tick         | `isPending(x) false \| x 2`  |                                                       |

**Case ″.**

```tsx
const [s, setS] = createSignal(41);
const x = createMemo(async () => fetch(1 + s()));
const both = createMemo(() => 1 + isPending(x) + x());
<span>{both()}</span>
```

| # | Action                              | Screen    | Notes                                                                                                                                             |
| --- | ----------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | x(42) lands; tick                   | `both 43` | primed: `1 + 0 + 42`                                                                                                                              |
| 1 | action (no yield): setS(1); flush() | `both 44` | `1 + 1 + 42`: the memo is display — it feeds a binding and asks nothing — so hoisting the pair into it changes no screen (S-27's memo row, 11-05) |
| 2 | x(2) lands; tick                    | `both 3`  |                                                                                                                                                   |

Ruled 2026-11-07. The display — render effects, compiled bindings, user effects, and the sync derivations that feed them — may hold the value it showed beside the verdict about its successor, because it is declared (`isPending`, `latest`), terminal, and keeps rather than computes. That is the one inconsistency the screen is allowed, and the only consumer barred from it is one that asks (S-51). The #4349 pin's held shape was the odd one out: the action's body ending inside the call is not a reason for the display to wait.
<!-- /ruling -->

<!-- ruling:S-53 -->
### S-53. `latest` shows a held recovery ahead, as it shows a held value: the boundary recovers while the action is open — D-41, D-22, F-6 (#4403)

_Generated from `packages/web/test/async-gen/rulings/S-53.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: standing. Pins also: `tests/errored-recovery-wedge-4403-4404-4405.test.ts`._

**Case 1.**

```tsx
const [s, setS] = createSignal(0);
const m = createMemo(() => 1 + s()); // throws when the input % 4 === 2
<Errored fallback="[error]">
  <Show when={latest(m)} fallback="[none]">
    <span>{latest(s)}</span>
  </Show>
</Errored>
```

| # | Action                   | Screen             | Notes                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | render                   | `latest(s) 0`      |                                                                                                                                                                                                                                                                                                                                                                                               |
| 1 | setS(1); flush()         | `[error]`          | `m = 2` throws: the boundary shows its fallback                                                                                                                                                                                                                                                                                                                                               |
| 2 | action: setS(0); flush() | `latest(s) 0`      | the action writes `s = 0` back and stays open: `latest(m)` is the newest answer `m` produced — the recovery, a change of answer though equal to the last good value (D-41) — so the `Show` it gates opens now and the content's `latest(s)` shows the held write (ruled 2026-11-07: value and error are symmetric under `latest`, as D-41 already lets `latest` throw a proposed error early) |
| 3 | the action lands; tick   | —                  | the action lands: nothing changes                                                                                                                                                                                                                                                                                                                                                             |
| ✗ |                          | after 2: `[error]` | the error kept until the action lands — D-41's mirror clause, which applies to a plain read, not to `latest`                                                                                                                                                                                                                                                                                  |

**Case ′.**

```tsx
const [s, setS] = createSignal(0);
const m = createMemo(() => 1 + s()); // throws when the input % 4 === 2
<Errored fallback="[error]">
  <Show when={latest(m)} fallback="[none]">
    <span>{s()}</span>
  </Show>
</Errored>
```

| # | Action                   | Screen             | Notes                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0 | render                   | `s 0`              |                                                                                                                                                                                                                                                                                                                          |
| 1 | setS(1); flush()         | `[error]`          | `m = 2` throws: the boundary shows its fallback                                                                                                                                                                                                                                                                          |
| 2 | action: setS(0); flush() | —                  | the `Show` opens ahead as in case 1, but its content's first pass reads the held `s` plainly: born held (S-46), the mount attaches at the landing and the `Show`'s switch waits with it — the boundary keeps its fallback meanwhile; a `<Loading>` inside the `Show` would show ahead (S-31). Built 2026-11-08 with S-58 |
| 3 | the action lands; tick   | `s 0`              | the action lands: the branch attaches                                                                                                                                                                                                                                                                                    |
| ✗ |                          | after 2: `(empty)` | the branch attached with its hole empty (F-2: never an empty slot) — S-46's plain row, #4417's mechanism; before S-53 the shown error masked it here, and until S-58 the action's open hold let the lane reveal it                                                                                                       |
| ✗ |                          | after 2: `s 1`     | the branch attached with the committed `s` beside a `Show` opened by the hold's recovery (S-46 ✗: a mount under a display-ahead reader is born held, not a D-3 leaf)                                                                                                                                                     |
<!-- /ruling -->

<!-- ruling:S-54 -->
### S-54. `isPending` of a ready answer the frame still holds: cleared, or pending until it shows — D-23

_Generated from `packages/web/test/async-gen/rulings/S-54.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: standing._

```tsx
const [a, setA] = createOptimistic(0);
const [b, setB] = createOptimistic(0);
const left = createMemo(async () => fetch(1 + a()));
const right = createMemo(async () => fetch(1 + b()));
const total = createMemo(() => 1 + left() + right());
<span>{left()} {total()}</span>
<span>{isPending(left)}</span>
```

| # | Action                              | Screen                                                | Notes                                                                                                                                                                                                     |
| --- | ----------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | left(1) lands; right(1) lands; tick | `left 1 \| total 3 \| isPending(left) false`          | primed                                                                                                                                                                                                    |
| 1 | action: setA(1), setB(1); tick      | `left 1 \| total 3 \| isPending(left) true`           | both guessed: `left(1)` and `right(1)` are out under the action's hold                                                                                                                                    |
| 2 | left(2) lands; tick                 | —                                                     | `left`'s answer (2, not the shown 1) lands beneath the hold: not showable while the frame holds on `right`, so still a question without a committed answer — `pending` stays (ruled and built 2026-11-07) |
| 3 | right(2) lands; tick                | `left 2 \| total 5 \| isPending(left) false`          | `right` lands: the frame shows                                                                                                                                                                            |
| 4 | the action lands; tick              | `left 2 \| total 5 \| isPending(left) true`           | the action ends: the guesses revert and both re-fetch                                                                                                                                                     |
| ✗ |                                     | after 2: `left 1 \| total 3 \| isPending(left) false` | `pending` clearing for an answer the frame cannot show yet                                                                                                                                                |
<!-- /ruling -->

<!-- ruling:S-55 -->
### S-55. `refresh` of an optimistic derivation under a guess: the authoritative view replaces the guess, or the guess stays until its action ends — F-11, D-34

_Generated from `packages/web/test/async-gen/rulings/S-55.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: standing._

```tsx
const [s0, setS0] = createSignal(0);
const [first, setFirst] = createOptimistic(() => 1);
const doubled = createMemo(() => 1 + first());
const [second, setSecond] = createOptimistic(() => 1 + doubled());
<span>{first()} {doubled()} {second()}</span>
```

| # | Action                         | Screen                                       | Notes                                                                                                                               |
| --- | ------------------------------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 0 | render                         | `first 1 \| doubled 2 \| second 3`           |                                                                                                                                     |
| 1 | action: setFirst(5); flush()   | `first 5 \| doubled 6 \| second 7`           | A guesses `first = 5`: shown, derived through                                                                                       |
| 2 | action: setSecond(10); flush() | `first 5 \| doubled 6 \| second 10`          | B guesses `second = 10`                                                                                                             |
| 3 | refresh(second); tick          | `first 5 \| doubled 6 \| second 7`           | `refresh(second)` while both are open: the re-ask's answer is the authoritative view (`doubled + 1`), and it replaces B's guess now |
| 4 | the action lands; tick         | —                                            | B ends                                                                                                                              |
| 5 | the action lands; tick         | `first 1 \| doubled 2 \| second 3`           | A ends: everything reverts                                                                                                          |
| ✗ |                                | after 3: `first 5 \| doubled 6 \| second 10` | the guess kept until its action ends although its own source answered differently (F-11)                                            |

Standing (confirmed 2026-11-07). The `refresh` promise's value is not observable here; it resolves to the authoritative view. `s` is unused.
<!-- /ruling -->

<!-- ruling:S-56 -->
### S-56. A guess before the first answer is the newest value the node has produced: it shows, and the first answer judges it — F-11, D-22, D-2

_Generated from `packages/web/test/async-gen/rulings/S-56.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: standing. Pins also: `tests/createOptimistic.test.ts`, `tests/uninitialized-visibility.test.ts`, `tests/superseded-before-first-commit.test.ts`._

```tsx
const [sel, setSel] = createSignal(3);
const [comments, setComments] = createOptimistic(async () => fetch(1 + sel()));
<Loading fallback="[fallback]">
  <span>{comments()} {latest(comments)}</span>
</Loading>
```

| # | Action                            | Screen                             | Notes                                                                                                                                                                                                             |
| --- | --------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | render                            | `[fallback]`                       | first load                                                                                                                                                                                                        |
| 1 | setComments(9) (a guess); flush() | `comments 9 \| latest(comments) 9` | the guess is the first value the node produced: `latest` shows it, the plain read shows it in place of the fallback (ruled 2026-11-07); a function-form setter receives `undefined`                               |
| 2 | comments(4) lands; tick           | `comments 4 \| latest(comments) 4` | the first answer lands and judges the guess (F-11)                                                                                                                                                                |
| ✗ |                                   | after 1: `[fallback]`              | the guess refused — the dev guard `OPTIMISTIC_WRITE_BEFORE_LOAD` (2026-11-03, #4656), a policy from before the lane model; it stays for derived optimistic stores only, whose engine cannot show such a guess yet |
<!-- /ruling -->

<!-- ruling:S-57 -->
### S-57. A change whose derivation became a guess's lane work holds on that flight, and reveals with the lane — F-2, F-1, F-6

_Generated from `packages/web/test/async-gen/rulings/S-57.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: standing._

**Case 1.**

```tsx
const [ordinary, setOrdinary] = createSignal(0);
const [view, setView] = createOptimistic(() => 1);
const label = createMemo(async () => fetch(1 + view() + ordinary()));
<span>{view()} {ordinary()} {label()}</span>
```

| # | Action                      | Screen                                      | Notes                                                                                                                                                                                                                           |
| --- | --------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | label(2) lands; tick        | `view 1 \| ordinary 0 \| label 2`           | primed                                                                                                                                                                                                                          |
| 1 | action: setView(5); flush() | —                                           | the guess waits for its own async, `label(5, 0)` (F-6); the action's yield keeps it live, not off screen                                                                                                                        |
| 2 | setOrdinary(10); flush()    | —                                           | `setOrdinary(10)` needs `label` to show, and `label`'s only pending answer is the lane's `label(5, 10)`: the write is held on it (F-2, whatever the async's source) and its frame is entangled with the lane (ruled 2026-11-07) |
| 3 | label(16) lands; tick       | `view 5 \| ordinary 10 \| label 16`         | `label(5, 10)` lands: the write and the lane reveal as one frame — the only consistent screen that contains `10`                                                                                                                |
| 4 | label(6) lands; tick        | —                                           | `label(5, 0)` was superseded by the re-ask: its answer lands nothing (today already)                                                                                                                                            |
| 5 | the action lands; tick      | —                                           | the action ends; the guess reverts after this script                                                                                                                                                                            |
| ✗ |                             | after 2: `view 1 \| ordinary 10 \| label 2` | `ordinary = 10` beside `label(1, 0)`: a new value beside a stale derivation of it (F-1); before the build the plain write's frame had no consequence of its own to wait for, because the lane took the derivation               |

**Case ′.**

```tsx
const [ordinary, setOrdinary] = createSignal(0);
const [view, setView] = createOptimistic(() => 1);
const label = createMemo(() => 1 + view() + ordinary());
<span>{view()} {ordinary()} {label()}</span>
```

| # | Action                          | Screen                              | Notes                                                 |
| --- | ------------------------------- | ----------------------------------- | ----------------------------------------------------- |
| 0 | render                          | `view 1 \| ordinary 0 \| label 2`   |                                                       |
| 1 | action: setView(11); flush()    | `view 11 \| ordinary 0 \| label 12` | a sync derivation of the guess shows with it          |
| 2 | action: setOrdinary(2); flush() | —                                   | B's write is held; `label` is the hold's work         |
| 3 | the action lands; tick          | `view 11 \| ordinary 2 \| label 14` | B lands: the guess and the truth combine in one frame |
| 4 | the action lands; tick          | `view 1 \| ordinary 2 \| label 4`   | A ends: the guess reverts                             |

Standing today: the peers coordinate (the experiment's accepted C2 reading).

The experiment's A2 row. Ruled 2026-11-07 for case 1: F-2 as written. F-6's lane exemption was for the guess's own hold, the action; it never released an unrelated write from its own consequence. A lane's superseded question holds nothing, which today already does.
<!-- /ruling -->

<!-- ruling:S-58 -->
### S-58. A display-ahead gate is the same mainline mount with any number of memos between the probe and the branch — D-25, F-1 (#4708, #4405)

_Generated from `packages/web/test/async-gen/rulings/S-58.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: standing. Pins also: `tests/verdict-mount-first-pass-3851.test.ts`, `web/test/display-ahead-gate-hops.spec.tsx`, `tests/zombie-errored-retry-4405.test.ts`._

**Case 1.**

```tsx
const [id, setId] = createSignal(0);
const detail = createMemo(async () => fetch(1 + id()));
<span>{id()}</span>
<span>{detail()}</span>
<Show when={latest(id)} fallback="[none]">
  <span>{id()}</span>
</Show>
```

| # | Action                | Screen                              | Notes                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | --------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | detail(1) lands; tick | `id 0 \| detail 1 \| [none]`        | primed                                                                                                                                                                                                                                                                                                                                                                                                  |
| 1 | setId(1); flush()     | —                                   | the gate opens ahead (`latest` asked) and mounts a branch whose first pass reads the staging plainly: born held, it attaches at the landing and the fallback stays — through `<Show>` (two memos between the probe and the branch), a truthiness memo and a branch memo (one), or one memo that probes and mounts (none). Ruled 2026-11-08: D-25's third sentence is about the gate, not about `<Show>` |
| 2 | detail(2) lands; tick | `id 1 \| detail 2 \| id 1`          |                                                                                                                                                                                                                                                                                                                                                                                                         |
| ✗ |                       | after 1: `id 0 \| detail 1`         | the branch attached with its hole empty (F-2: never an empty slot) — the one-hop gate before S-58: the probe's own reader was published with its frame when the probe re-derived to the same value at the seam (`keepReaders`), where `<Show>`'s truthiness memo kept the branch one read away                                                                                                          |
| ✗ |                       | after 1: `id 0 \| detail 1 \| id 0` | the branch attached with the committed value: a mount under a display-ahead reader is born held, not a D-3 leaf (S-46)                                                                                                                                                                                                                                                                                  |

**Case ′.**

```tsx
const [id, setId] = createSignal(0);
const detail = createMemo(async () => fetch(1 + id()));
const m1 = createMemo(() => 1 + id() + latest(detail)); // throws when the input % 4 === 0
const m2 = createMemo(() => 1 + latest(detail) + m1()); // throws when the input % 4 === 1
<Show when={isPending(detail)} fallback="[none]">
  <span data-a0={latest(m2)} data-a1={detail()}></span> {/* one effect */}
</Show>
```

| # | Action                | Screen                              | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --- | --------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | detail(1) lands; tick | `[none]`                            | primed: `isPending(m0)` is false                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 1 | setId(1); tick        | —                                   | the write re-asks `m0`; `isPending(m0)` opens the gate, and the mount's one grouped effect reads `latest(m2)` ahead beside `m0()` plainly: the window it opened does not make it a D-3 leaf of the screen — it is the mount a probing pass opened, born held on its plain read of the flight, and the fallback stays until the landing, where `isPending` is false again (ruled 2026-11-08: neither hop count nor grouping changes a mount's seat, even when its own pass reads ahead of the same node) |
| ✗ |                       | after 1: `latest(m2) 4 \| detail 1` | the branch attached with the committed value beside its own ahead read — through a hand-written gate, grouped, before this case was built; `<Show>` and the split leaf already kept the fallback                                                                                                                                                                                                                                                                                                        |

**Case ″.**

```tsx
const [id, setId] = createOptimistic(0);
const detail = createMemo(async () => fetch(1 + id()));
const m1 = createMemo(() => 1 + id() + latest(detail));
const m2 = createMemo(() => 1 + latest(detail) + m1());
<Show when={isPending(detail)} fallback="[none]">
  <span data-a0={latest(m2)} data-a1={detail()}></span> {/* one effect */}
</Show>
```

| # | Action                 | Screen                              | Notes                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ---------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | detail(1) lands; tick  | `[none]`                            | primed                                                                                                                                                                                                                                                                                                                                                                                       |
| 1 | action: setId(1); tick | —                                   | case ′'s write inside an action, as a guess on `id`: the lane re-asks `detail`, `isPending(detail)` opens the gate in the lane, and the mount's first pass reads the lane's flight plainly — born held on it, not served the screen as lane work is (A15's stale reader, D-28): served, it would initialize with S-46's frame inside the lane's, revealed at the landing. The fallback stays |
| 2 | the action lands; tick | —                                   | the action landed; the truth re-asks `detail` and the same mount still waits on the flight (its first pass never completed): the fallback stays. Not a hold the lane's work joined — a lane never makes a flush the hold's (D-37); `frameRead`'s mount arm is for a mainline pass, or a lane pass reading a pending node                                                                     |
| 3 | detail(2) lands; tick  | —                                   | `detail` answered: `isPending` is false again                                                                                                                                                                                                                                                                                                                                                |
| ✗ |                        | after 1: `latest(m2) 5 \| detail 1` | the branch attached inside the lane with the committed value beside the lane's own derivation                                                                                                                                                                                                                                                                                                |
| ✗ |                        | after 2: `latest(m2) 4 \| detail 1` | the mount the lane served the screen revealed at the action's landing with the committed value — S-46's frame, through `<Show>`, a truthiness memo and a split leaf before this case was built (the single-memo gate re-created its branch at the landing and escaped it); it then stayed on screen after `detail` answered (F-1)                                                            |

**Case ‴.**

```tsx
const [id, setId] = createOptimistic(0);
const detail = createMemo(async () => fetch(1 + id()));
<Show when={isPending(detail)} fallback="[none]">
  <span data-a0={detail()}></span> {/* one effect */}
</Show>
```

| # | Action                                        | Screen              | Notes                                                                                                                                                                                                            |
| --- | --------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | detail(1) lands; tick                         | `[none]`            | primed                                                                                                                                                                                                           |
| 1 | action: setId(1); tick                        | —                   | the plain-only leaf (S-46's row) under the same guess: the same seat in a lane as in a mainline flush — born held on the lane's flight, the fallback stays through the lane, the action's landing and the answer |
| 2 | the action lands; tick; detail(2) lands; tick | —                   |                                                                                                                                                                                                                  |
| ✗ |                                               | after 1: `detail 1` | the branch attached inside the lane with the committed value (S-46 ✗2, in a lane) — every gate shape before this case was built; the frame then stayed on screen after `detail` answered                         |

**Case ⁗.**

```tsx
const [id, setId] = createSignal(0);
const detail = createMemo(async () => fetch(1 + id()));
<span>{id()}</span>
<span>{detail()}</span>
<Show when={latest(id)} fallback="[none]">
  <Errored fallback="[error]">
    <span>{id()}</span>
  </Errored>
</Show>
```

| # | Action                | Screen                       | Notes                                                                                                                                                                                                                                        |
| --- | --------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | detail(1) lands; tick | `id 0 \| detail 1 \| [none]` | primed                                                                                                                                                                                                                                       |
| 1 | setId(1); flush()     | —                            | case 1 with an `<Errored>` around the branch's content: the boundary is part of the mount, so the content's first pass is the mount's and is born held — the fallback stays through every gate shape                                         |
| 2 | detail(2) lands; tick | `id 1 \| detail 2 \| id 1`   |                                                                                                                                                                                                                                              |
| ✗ |                       | after 1: `id 0 \| detail 1`  | the branch attached with its hole empty (F-2): the mount stamp (S-46) did not reach a first pass the mount's boundary created, so the content behind it was served as a plain leaf — through a hand-written gate, before this case was built |

**Case ⁗′.**

```tsx
const [id, setId] = createSignal(2);
const [s1, setS1] = createSignal(3);
const detail = createMemo(() => 1 + id() + latest(s1)); // throws when the input % 4 === 0
const m1 = createMemo(() => 1 + detail() + s1()); // throws when the input % 4 === 1
<Show when={m1()}>
  <span></span>
</Show>
```

| # | Action                                                  | Screen         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | render                                                  | `(empty)`      |                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 1 | setS1(2) in an action; the action lands; setId(3); tick | `[root error]` | #4405's minimized shape: the action's landing, a write that poisons `m1` and (variant) a remount of the gate in one tick                                                                                                                                                                                                                                                                                                                                       |
| 2 | setS1(1) in an action                                   | —              | a second action re-asks `detail` through `latest(s1)`; the remounted gate's old content is a zombie until the hold lands and reads the same errored memo. It settles in every hop count: before this case was built the one-hop gate looped ("Potential Infinite Loop Detected") — the zombie retried the errored memo every round (a later cycle's retry, PJ-R35), and the fresh error re-derived the live gate, whose retry next round re-derived the zombie |

PR #4708 pinned a hop-less `<Show>` as never painting; with real JSX it paints at the landing and tears only during the flight, the same way `<Show>` did before S-46. The runner's `gate` variant here is the gate as written by hand, not an emulation. Cases ″ and ‴ (2026-11-08, #4723 review): the same mount under a guess lane — the write inside an action on an optimistic `id` — is the same mount; lane work served the screen (A15) is the one exception D-25 makes for no leaf a probing pass opened.
<!-- /ruling -->

### S-59. A store guess's slot is the point of write: a whole-array rewrite is the rows it changed — D-33, F-11, D-41

Keyed `createOptimisticStore` over an async `list`; two actions guess into it and `refresh`. `assign(4)` guesses `a = "guest"` on row 4, lands, and its refresh is in flight; `close(1)` guesses `closed = true` on row 1; the refresh fails; `close(4)` guesses. Two setters: the field edit (`d.find(r => r.id === id).closed = true`) and the whole-array rewrite (`v = d.map(...); d.length = v.length; v.forEach((x, i) => d[i] = x)` — a reconcile-style setter, a `rows.map` lowering).

| #   | Action                                        | Screen (both setters)             | Notes                                                                                                                                                                                            |
| --- | --------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0   | `fetch` lands #1, #3, #4                      | `[#1 -][#3 -][#4 -]`              | primed                                                                                                                                                                                           |
| 1   | `assign(4)`; tick                             | `[#1 -][#3 -][#4 guest]`          | the guess shows (F-11)                                                                                                                                                                           |
| 2   | `assign:4` lands; its refresh is in flight    | —                                 | a refresh re-asks the same question and holds nothing new (D-34)                                                                                                                                 |
| 3   | `close(1)`; tick                              | `[#3 -][#4 guest]`                | a second guess, on row 1: its own carrier and lane — it shows from its flush. The rewrite recorded one changed key (row 1); carried rows are not writes, so the two guesses share no slot (D-33) |
| 4   | the refresh fails                             | `list error: down`                | the error is the list's answer (D-41); the guesses are on rows, not on the list, so nothing outranks it                                                                                          |
| 5   | `close(4)`; tick                              | —                                 | a guess under the error waits behind it                                                                                                                                                          |
| 6   | `close:1`, `close:4` land; the re-ask answers | `[#3 -]`                          |                                                                                                                                                                                                  |
| ✗   |                                               | after 3: `[#1 -][#3 -][#4 guest]` | the rewrite escalated to a guess on the list, shared with assign's: the close write joined assign's lane, blocked on its refresh (#4724 row 1)                                                   |
| ✗   |                                               | after 4: `[#3 -][#4 guest]`       | the guess on the list outranked the derive's error, and the merged hold never committed it (#4724 rows 2–3)                                                                                      |

_Ruled 2026-11-08 (the point of write); built 2026-11-09 on the guess carrier (store/optimistic.ts, S2). Pin: `packages/web/test/optimistic-store-guess-point-of-write-4724.spec.tsx`, both setters._

<!-- ruling:S-60 -->
### S-60. A branch born into a hold that asks because of a display-ahead value does not hold the hold — F-6, D-25 (#4544)

_Generated from `packages/web/test/async-gen/rulings/S-60.ts` (`RULINGS_WRITE=1 pnpm exec vitest run test/async-gen/rulings` in `packages/web`); do not edit inside the markers. Status: standing. Pins also: `tests/verdict-memo-held-branch-4544.test.ts`._

```tsx
const [session, setSession] = createSignal(0);
const gate = createMemo(async () => fetch(1 + session()));
const params = createMemo(() => 1 + session() + isPending(session));
const load = createMemo(async () => fetch(1));
<span>{gate()}</span>
<Show when={session()}> {/* creates params, load when it opens */}
  <span data-a0={params()} data-a1={load()}></span> {/* one effect */}
</Show>
```

| # | Action                 | Screen                         | Notes                                                                                                                                                                                                                                                    |
| --- | ---------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 | gate(1) lands; tick    | `gate 1`                       | primed; the branch is closed                                                                                                                                                                                                                             |
| 1 | setSession(1); flush() | —                              | `gate` holds the write; the branch opens in the hold's world, born held (D-27), and its one effect reads `params` — a verdict reader that pass (it probed `isPending(session)` beside `session()`, F-6): the screen's `session` — and asks `load` for it |
| 2 | gate(2) lands; tick    | `gate 2`                       | `gate` answers and the hold lands: the load the branch asked for derives from a display-ahead read, so it does not hold the hold (F-6, #4544). `params` re-derives at the landing (A15), and the branch's effect waits on its own load                   |
| 3 | load(1) lands; tick    | `gate 2 \| params 2 \| load 1` | the load answers; the branch shows                                                                                                                                                                                                                       |
| ✗ |                        | after 2: `gate 1`              | the hold waited for the branch's load: a frame born into the hold, pending on what a settled verdict reader's display-ahead value asked for, counted as the hold's own pending observer (`blockedBy` without the `CONFIG_AHEAD` exemption)               |

Reached by no random generator case in 50,000 × 3 seeds (size pass, 2026-11-10): the grammar emits neither `isPending` memo inputs nor owned branches. The hole must be one effect with both reads (a grouped leaf): split into one effect per hole, the effect that goes pending never read the verdict reader and holds as any born-held effect does.
<!-- /ruling -->
