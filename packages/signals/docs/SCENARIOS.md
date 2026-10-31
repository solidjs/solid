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

### S-3. A mount during a hold: a derivation born held holds the mount; the branch appears whole at the commit — D-2, D-3 (A29)

_Pinned: `tests/born-held.test.ts`, for a direct mount (see the note under the table); the click-mounted branch below is not pinned yet._

```tsx
const [x, setX] = createSignal(0);
const slow = createMemo(() => fetchSlow(x()));
<h1>{x()}</h1> <i>{slow()}</i>
const save = action(function* () { setX(1); yield gate; });
// on a click, while save() is open:
const m = createMemo(() => x() * 10);
<p>{m()}</p> <span>{x()}</span>
```

| #   | Action                                                 | Screen                                                                                                                                                             | `latest` / `isPending`                                                                          | Effects ran                 |
| --- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------- |
| 0   | primed                                                 | `h1 0 \| i 0`                                                                                                                                                      |                                                                                                 | h1, i                       |
| 1   | `save(); flush()`                                      | — (held on `slow(1)`)                                                                                                                                              | `latest(x)` 1 · `isPending(x)` true                                                             | —                           |
| 2   | mount `m`, `<p>`, `<span>`; `flush()`                  | `h1 0 \| i 0` — `<p>{m()}</p>` throws, so it holds the mount; the branch is not attached                                                                           | `untrack(m)` throws · `latest(m)` 10 · `isPending(m)` holds its reader (owned), false (unowned) | —                           |
| 3   | `setTitle("t"); flush()` — an unrelated mainline write | `… \| title t` at once (not swallowed into the action)                                                                                                             |                                                                                                 | title                       |
| 4   | `gate` releases, `slow(1)` lands, body returns         | `h1 1 \| i 1 \| p 10 \| span 1`                                                                                                                                    | `isPending(x)` false · `isPending(m)` false                                                     | h1, i, p, span (first runs) |
| ✗   |                                                        | after 2: `p 10` beside `h1 0` (the published future); `p 0` (a committed value `m` never had); or `p (empty) \| span 0` (the branch attached around an empty slot) |                                                                                                 |                             |

The `p 0` row is the N1 reading (reverted 2026-10-02). The `p 10` row beside `h1 0` is the published future. Both are rejected (ruled 2026-10-09, D-2). The empty slot is rejected the same day: a born-held read with no boundary to catch it holds the change that mounted it (F-2). Inside a fresh `<Loading>` the read is caught instead and the branch attaches on its fallback (D-12). `latest(m)` is its pending value; `isPending(m)` has no verdict until the commit, because `m` has nothing committed to judge — inside an owner its reader is held as the read is, and runs at the commit (F-9, D-23).

Mounted directly instead of by a click-opened branch — the shape the pin covers — nothing gates the bindings: `<span>{x()}</span>` shows the committed `0` now and `1` at the commit (D-3), and only `<p>{m()}</p>` waits for the commit. Effects ran at row 2: span (`0`); at row 4: h1, i, p (first run), span (`1`).

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

### S-6. A new async memo a render effect consumes waits with the hold — D-2, F-2 (#3800)

_The value half is ruled 2026-10-09 and built in #3977 (U-1): the child does not show beside the parent still on the old value. The hold also waits for the child, because a render effect outside a boundary consumes it (F-2). Row E1 was F-8 and is rejected._

```ts
const [count, setCount] = createSignal(1);
const slow = createMemo(() => fetchSlow(count()));      // ~1 s
<p>parent {count()} {slow()}</p>
setCount(2); flush();                                   // held on slow(2)
const fast = createMemo(() => Promise.resolve(count())); // created during the hold
<p>child {fast()}</p>
```

| #   | Action                                                     | Screen                                                                   | `isPending`             | Effects ran   |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------- | ------------- |
| 0   | `setCount(2); flush()`, mount `child`                      | `parent 1 1` — `child` throws, so it holds its mount; it is not attached | `isPending(count)` true | —             |
| 1   | `fast`'s promise resolves (the hold is live)               | — (`slow` is still out, so the hold waits; the answer does not show)     | —                       | —             |
| 2   | `slow(2)` lands                                            | `parent 2 2 \| child 2`                                                  | false                   | parent, child |
| E1  | variant — `fast` slower than `slow`: `slow(2)` lands first | — (`fast` is still out; the parent does not show yet)                    |                         | —             |
| E1′ | then `fast` lands                                          | `parent 2 2 \| child 2`                                                  |                         | parent, child |
| ✗   |                                                            | after 1: `parent 1 1 \| child 2`; at 0 or E1: `child (empty)` on screen  |                         |               |

The sync twin (`createMemo(() => count())`) already waits (S-3); the asymmetry is the bug.

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

### S-21. A display-ahead read in `on` shows the fallback now, beside the held frame — D-17

_Pinned: `loading-on-frame-following-3540.test.ts` §4; `loading-on-rearm-reveal-3540.test.ts`._

```tsx
<h1>{product().name}</h1>
<Loading on={latest(id)} fallback="spinner"><ul>{comments()}</ul></Loading>
```

| #   | Action              | Screen                                                                    | Notes                                                                     |
| --- | ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | `setId(2); flush()` | `A \| spinner` — the new id's loading state inside the old page           | `on` read `latest(id)`, whose frame has landed; reads of `id()` stay held |
| 2   | `product(2)` lands  | `B \| spinner`                                                            |                                                                           |
| 3   | `comments(2)` lands | `B \| comments-B` — content that reads nothing held reveals when it lands |                                                                           |

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

### S-25. Nothing shows a write before its flush; then every channel at once — D-22, D-32 (A28)

_Pinned: `tests/latest-held-till-flush.test.ts`, `tests/latest-repeated-writes.test.ts`._

```ts
const [count, setCount] = createSignal(20);
const doubled = createMemo(() => count() * 2);
```

| #   | Action                                    | `count()` (untracked)                                     | `latest(count)` | `latest(doubled)` | `isPending(count)` |
| --- | ----------------------------------------- | --------------------------------------------------------- | --------------- | ----------------- | ------------------ |
| 1   | `setCount(30)` — no flush                 | 20                                                        | 20              | 40                | false              |
| 2   | `flush()` — nothing holds                 | 30                                                        | 30              | 60                | false              |
| 2′  | `flush()` — an async reader holds `count` | 20                                                        | 30              | 60                | true               |
| ✗   |                                           | after 1: `latest(count)` 30 while `latest(doubled)` is 40 |                 |                   |                    |

### S-26. `isPending` is about a new question — D-23 (A19, A24)

_Pinned: `tests/question-scoped-pending.test.ts`, `tests/loading-value.test.ts`._

```tsx
const [id, setId] = createSignal(1);
const user = createMemo(() => fetchUser(id()));
<Loading fallback="…">
  <p>{user().name}</p> <p>{isPending(user) ? "updating" : ""}</p>
</Loading>;
```

| #   | Action                                                             | Screen                                                               | `isPending(user)`                                 | Why                                                                      |
| --- | ------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| 0   | first load                                                         | `[fallback]` (the probe's own read suspends; nothing observable yet) | no verdict — throws here (owned), `false` unowned | a first load is loading, not pending (D-24)                              |
| 1   | `user(1)` lands                                                    | `Ann \| `                                                            | false                                             | final                                                                    |
| 2   | `setId(2); flush()`                                                | `Ann \| updating`                                                    | true                                              | an input changed — a new question                                        |
| 3   | `user(2)` lands                                                    | `Bob \| `                                                            | false                                             |                                                                          |
| 4   | `refresh(user); flush()`                                           | `Bob \| `                                                            | false                                             | a re-ask of the same question is quiet; the fresh value reveals silently |
| 5   | `action(function* () { affects(user); refresh(user); yield … })()` | `Bob \| updating`                                                    | true                                              | a declared reload                                                        |
| 6   | the action's refetch lands and it ends                             | `Bob′ \| `                                                           | false                                             |                                                                          |
| 7   | an optimistic write to a `createOptimistic` over `user`            | shows the guess                                                      | false                                             | verdict-inert                                                            |

### S-27. `[isPending(x), x()]` is atomic; the `latest` form follows x's own async only — D-23 (A10, A8)

_Pinned: `tests/latest-isPending-consistency.test.ts`, `tests/createMemo.test.ts`._

```ts
const [n, setN] = createSignal(0);
const x = createMemo(() => fetchX(n())); // async
const y = createMemo(() => fetchY(x())); // async downstream, rendered
```

| #   | Action                                            | `[isPending(x), x()]` in one scope             | `[isPending(() => latest(x)), latest(x)]`                               | Notes                                                 |
| --- | ------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | `setN(1); flush()`                                | `[true, x0]`                                   | `[true, x0]`                                                            | both channels: x's own fetch is up                    |
| 2   | `x(1)` lands; `y(1)` still up — the frame is held | `[true, x0]` — a landed answer awaiting reveal | `[false, x1]` — `latest` saw x's own answer; its verdict is per channel | never `[true, x1]` in either order, on either channel |
| 3   | `y(1)` lands                                      | `[false, x1]`                                  | `[false, x1]`                                                           |                                                       |

On a plain signal or sync memo the `latest` form is never pending.

### S-28. `isPending` never throws unowned; `latest` throws uninitialized everywhere — D-24 (A16, A7)

_Pinned: `tests/spec-async-semantics.test.ts` (A16), `tests/uninitialized-visibility.test.ts`._

| Caller                                                              | `isPending(() => uninit())`                               | `latest(uninit)` |
| ------------------------------------------------------------------- | --------------------------------------------------------- | ---------------- |
| event handler (no owner)                                            | `false`                                                   | throws           |
| component body / computation (an owner)                             | throws — propagates to the boundary                       | throws           |
| `isPending(() => { throw new Error() })`, any scope                 | `false`                                                   | n/a              |
| `isPending(() => store)` — the thunk returns a store, reads nothing | `false` (reads-only; the return value is never inspected) |                  |

### S-29. A verdict reader's own async is held — D-25 (A31, #3442)

_Pinned: `tests/ispending-combined-atomic-3442.test.ts`._

```tsx
const fast = createMemo(() => fetchFast(n()));
const slow = createMemo(() => fetchSlow(n()));
const copy = createMemo(() => slow()); // a sync wrapper
<p>
  Fast {fast()} | Slow {copy()} | Pending {String(isPending(() => [fast(), copy()]))}
</p>;
```

| #   | Action             | Screen                                       | Notes                                                          |
| --- | ------------------ | -------------------------------------------- | -------------------------------------------------------------- |
| 1   | `setN(1); flush()` | `Fast 0 \| Slow 0 \| Pending true`           |                                                                |
| 2   | `fast(1)` lands    | —                                            | `copy` computes under its own posture: still pending on `slow` |
| 3   | `slow(1)` lands    | `Fast 1 \| Slow 1 \| Pending false`          |                                                                |
| ✗   |                    | after 2: `Fast 1 \| Slow 0 \| Pending false` |                                                                |

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

### S-31. A verdict reader's mount is mainline: `Show when={latest(x) > 0}` → `Loading` shows its fallback — D-27 (#3851)

_Pinned: `tests/verdict-mount-first-pass-3851.test.ts`._

```tsx
const [x, setX] = createSignal(0);
<p>{x()}</p>
<Show when={latest(x) > 0}>
  <Loading fallback="fallback">content {x()}</Loading>
</Show>
const save = action(function* () { setX(1); yield gate; });
```

| #   | Action               | Screen                                                                                                                                                            | Notes |
| --- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 0   | primed               | `0 \| (closed)`                                                                                                                                                   |       |
| 1   | `save(); flush()`    | `0 \| [fallback]` — the `Show` opens ahead (display-ahead); the boundary is a mainline mount whose content read the write the action holds → born held → fallback |       |
| 2   | `gate`, body returns | `1 \| content 1`                                                                                                                                                  |       |
| ✗   |                      | after 1: `0 \| content 1` (the torn frame #3869 fixed)                                                                                                            |       |

### S-46. The content a display-ahead `Show` opens reads the screen, whoever opened the hold — D-27, D-37

_Ruled 2026-10-30 ("actions aren't special — they are a way to extend the hold"). Pinned: `tests/display-ahead-plain-write-content.test.ts` (signals, passes) and `web/test/display-ahead-plain-write-content-s46.spec.tsx` (through `Show` + `insert`; the plain row is `test.fails` — today the branch attaches with its text hole empty, `selected: ` and nothing, F-2's empty slot and #4417's mechanism). S-31's rule in the plain-write, no-boundary form: a write to `id` is held because an async memo over it is on screen; no action, no `Loading`._

```tsx
const [id, setId] = createSignal(0);
const detail = createMemo(() => fetchDetail(id()));
<p>{id()}</p> <p>{detail()}</p>
<Show when={latest(id) > 0} fallback="none">
  <p>selected: {id()}</p>          {/* a plain read, under the display-ahead Show */}
</Show>
// primed: detail answered for id = 0
```

| #   | Action                                           | Screen                                                                                                                                                                                                       | Notes                                                                |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| 0   | primed                                           | `0 \| none \| d0`                                                                                                                                                                                            |                                                                      |
| 1   | `setId(1); flush()` — `fetchDetail(1)` in flight | `0 \| none \| d0` — the `Show` opens ahead (`latest` asked), but the branch is a mount whose first pass read the staging plainly: born held (D-27), it does not attach until the landing; the fallback stays | a plain `id()` means one thing on the whole screen — the `0` outside |
| 1′  | same, content `selected: {latest(id)}`           | `0 \| selected: 1 \| d0`                                                                                                                                                                                     | the read that asks sees ahead, at its own site                       |
| 1″  | same, content inside a `<Loading fallback>`      | `0 \| [fallback] \| d0`                                                                                                                                                                                      | S-31's form: the boundary catches the born-held read                 |
| 2   | `fetchDetail(1)` lands                           | `1 \| selected: 1 \| d1`                                                                                                                                                                                     |                                                                      |
| ✗   |                                                  | after 1: `0 \| selected: 1 \| d0` — two plain reads of one signal disagreeing on one screen                                                                                                                  |                                                                      |
| ✗   |                                                  | after 1: `0 \| selected: 0 \| d0` — the branch attached with the committed value; a mount under a display-ahead reader is born held, not a D-3 leaf                                                          |                                                                      |
| ✗   |                                                  | after 1: `0 \| selected: (empty) \| d0` — the branch attached with its hole empty (F-2: never an empty slot). Today's screen through `Show` + `insert`                                                       |                                                                      |

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

### S-45. A first answer landing in the same tick as an action that writes its input: `latest` shows it, the plain read waits — D-22, F-9 (async generator E9)

_Ruled 2026-10-28. The leaf form and the through-a-memo form show the same screen; today the leaf keeps the fallback up until the action ends — that is the ✗ row._

```tsx
const m0 = createMemo(() => fetch(s0()));              // first load, no committed value
<p>{s0()}</p>
<Loading fallback="loading">{latest(m0)}</Loading>     // or: {L()} with L = createMemo(() => latest(m0))
const save = action(function* () { setS0(1); yield gate; });
```

| #   | Action                                                       | Screen                  | Notes                                                                                                                    |
| --- | ------------------------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 0   | mount                                                        | `0 \| loading`          | first load                                                                                                               |
| 1   | `save()` and `m0`'s first answer `2` land in one tick; flush | `0 \| 2`                | the answer is the action's (D-4) and `latest` returns it (D-22): the committed `s0 = 0` beside its own answer, one frame |
| 2   | `gate`, body returns; `m0(1)` lands                          | `1 \| m0(1)`            |                                                                                                                          |
| ✗   |                                                              | after 1: `0 \| loading` | the leaf waited on the action it did not read; a `Loading` reading only `latest` shows what it has (S-40)                |
| —   | the same with `{m0()}` in place of `latest(m0)`              | `0 \| loading` until 2  | a plain read of a first load is loading (F-9); the fallback is right there                                               |

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

### S-33. A different truth corrects the graph now and the screen at the commit; a never-shown guess is void — D-34 (#3331, fuzzer finding F6 vs A18 (c))

_Pinned: `tests/spec-async-semantics.test.ts` "#3331", re-pinned 2026-10-05._

```tsx
const [value, setValue] = createSignal(0);
const [double, setDouble] = createOptimistic(() => fetchDouble(value())); // truth = v * 2
const related = createMemo(() => fetchRelated(double())); // downstream async
<Loading fallback="loading">
  double={double()} async={related()}
</Loading>;
// click: setValue(1); setDouble(3)   (the truth will be 2)
```

| #   | Action                               | Screen                                                                                              | `double()` untracked                              | `latest(double)` | `isPending(double)` |
| --- | ------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------- | ------------------- |
| 0   | primed                               | `double=0 async=0`                                                                                  | 0                                                 | 0                | false               |
| 1   | `setValue(1); setDouble(3); flush()` | — (the guess's lane holds itself on `related(3)`)                                                   | 3                                                 | 3                | true                |
| 2   | source lands `2` ≠ 3                 | — ; `related` re-asks from `2` now                                                                  | **0** — the guess never showed; what showed stays | 2                | true                |
| 3   | the obsolete `related(3)` lands      | — (inert)                                                                                           | 0                                                 | 2                | true                |
| 4   | `related(2)` lands                   | `double=2 async=2`                                                                                  | 2                                                 | 2                | false               |
| ✗   |                                      | after 2: untracked `3` (a dead, invisible guess — the pre-#3811 pins); any frame showing `double=3` |                                                   |                  |                     |

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

### S-44. An outside input change under a guess is held with the guess's action — D-34, F-1 (#4336)

_Pinned: `tests/optimistic-question-change-4336.test.ts`, `tests/optimistic-layered-filter-4336.test.ts`, `tests/optimistic-held-write-leak.test.ts`, `tests/loading-on-latest-fallback-4337.test.ts`._

```tsx
const [sel, setSel] = createSignal(3);
const [comments, setComments] = createOptimistic(() => fetchComments(sel())); // or createOptimisticStore
<p>
  #{sel()}: {comments().join(" | ")}
</p>;
const post = action(function* (text) {
  setComments(c => [...c, `${text} (sending)`]);
  yield api.post(text);
  refresh(comments);
});
```

| #   | Action                                                                                          | Screen                                                                                                             | `latest` / `isPending`                                 | Notes                                                       |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------- |
| 0   | primed; `post("mine")`                                                                          | `#3: dana \| mine (sending)`                                                                                       | `isPending(comments)` false (verdict-inert)            |                                                             |
| 1   | outside: `setSel(1)`; `flush()`                                                                 | `#3: dana \| mine (sending)` — the change is held with the post                                                    | `latest(sel)` 1 · `isPending(comments)` true           | a new question, not the guess's source answering            |
| 2   | issue 1's answer `[]` lands                                                                     | `#3: dana \| mine (sending)`                                                                                       | `latest(comments)` `[]` · true · untracked: the screen |                                                             |
| 3   | the post settles; its `refresh` re-asks 1                                                       | `#3: dana \| mine (sending)`                                                                                       | true                                                   | the action's refresh after the change stays pending (F-9)   |
| 4   | issue 1's answer `["mine"]` lands                                                               | `#1: mine` — one frame                                                                                             | false                                                  |                                                             |
| 1′  | `refresh(comments)` instead of `setSel(1)`                                                      | `#3: dana \| mine (sending)` until the post commits                                                                | `isPending(comments)` false                            | the same question: nothing new is held (#4329)              |
| 1″  | `sel` a `createOptimistic` over the saved selection; `action { setSel(1); yield; setSaved(1) }` | `#3: dana \| mine (sending)` until issue 1's answer, then `#1: ` — the input's lane waits for its own answer (F-6) |                                                        | the post's guess does not answer issue 1                    |
| 1⁗  | as 1″, but the action ends without `setSaved` (a pure revert)                                   | `#1: ` until issue 3's re-ask lands, then `#3: dana \| mine (sending)` — one frame; the post lands later as usual  |                                                        | the displaced guess comes back with the revert (D-33)       |
| 1‴  | keyed: `comments[id] = rows`, the post guessed on `comments[3]`; `setSel(1)`                    | `#1: ` once issue 1's answer lands, not waiting for the post; back on 3: `#3: dana \| mine (sending)`              |                                                        | a key with no guess is an ordinary pending read (F-2)       |
| ✗   |                                                                                                 | any `#1:` frame before 4, e.g. `#1: dana \| mine (sending)`                                                        |                                                        | the same with `#{sel()}` and the list in two render effects |

Layered: action A guesses `milk`, action B sets a filter optimistically over it. The filter shows at once in both settle orders, `milk` stays until A commits, and when B settles first nothing on screen changes (D-33, D-35). A held write read before the action's first lane read (`setG("b"); yield go; setOther(1)`) shows only at the commit. Boundary (#4337): a keyed list under `<Loading on={filter()}>` whose fallback reads `latest(filter)`, an action that guesses a row and refreshes, and `filter` set outside: the change is held with the action (row 3's guess is still read) and the boundary never leaves its content for it — no `loading` frame beside the held `filter`, toggled back or not; without the hold the fallback shows with the change and clears at its answer (S-20, D-17). Pinned by `tests/loading-on-latest-fallback-4337.test.ts`.

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
