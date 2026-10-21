---
name: solid-2.0
description: Solid 2.0 primer for coding agents. Use when writing, reviewing or migrating Solid 2.0 code (solid-js 2.x, @solidjs/web). The API differs from Solid 1.x and from React; read this before generating, then check unfamiliar names against node_modules/solid-js/CHEATSHEET.md.
---

# Solid 2.0 for agents

Solid is not React, and 2.0 is not 1.x. Pattern-matching from either is the
dominant bug source. Every name below is a `solid-js` export unless noted;
DOM APIs (`render`, `hydrate`, `Portal`, `dynamic`) are in `@solidjs/web`.

## Three rules

1. **Props are read, not destructured; pass values, not accessors.**
   - Wrong: `function C({ name }) {}` and `<C value={count} />`
   - Right: `function C(props) { return <p>{props.name}</p>; }` and `<C value={count()} />`
2. **`createEffect` takes two functions: compute (tracks), then apply (side effects).**
   - Wrong: `createEffect(() => { el.title = count(); });`
   - Right: `createEffect(() => count(), v => { el.title = v; });`
3. **Stores are written through the draft.**
   - Wrong: `setStore("user", "name", "B")` or `setStore(produce(s => ...))`
   - Right: `setStore(s => { s.user.name = "B"; });`

## 1.x → 2.0 corrections

Nothing in the left column exists in 2.0.

| Wrong (1.x)                                    | Right (2.0)                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| `import { createStore } from "solid-js/store"` | `import { createStore } from "solid-js"`                          |
| `import { render } from "solid-js/web"`        | `import { render } from "@solidjs/web"`                           |
| `"jsxImportSource": "solid-js"`                | `"jsxImportSource": "@solidjs/web"`                               |
| `createEffect(fn)` (one argument)              | `createEffect(compute, apply)`                                    |
| `onMount(fn)`                                  | `onSettled(() => { setup(); return cleanup; })`                   |
| `createEffect(on(dep, fn))`                    | `createEffect(() => dep(), v => fn(v))`                           |
| `const [d] = createResource(id, fetchX)`       | `const d = createMemo(() => fetchX(id()))` under `<Loading>`      |
| `d.loading` / `d.error`                        | `<Loading>` or `isPending(() => d())` / `<Errored>`               |
| `refetch()`                                    | `refresh(d)` (`affects(d); refresh(d)` to read as pending)        |
| `<Suspense>` / `<SuspenseList>`                | `<Loading>` / `<Reveal>`                                          |
| `<ErrorBoundary>`                              | `<Errored fallback={(err, reset) => ...}>` (heals automatically)  |
| `<Index each={xs}>`                            | `<For each={xs} keyed={false}>`                                   |
| `batch(fn)`                                    | not needed: updates batch per microtask; `flush()` applies now    |
| `startTransition` / `useTransition`            | built-in transitions: `action(...)`, `isPending`, optimistic APIs |
| `createComputed`                               | `createMemo`, split `createEffect`, or `createSignal(fn)`         |
| `mergeProps` / `splitProps` / `unwrap`         | `merge` / `omit` / `snapshot`                                     |
| `produce`, `createMutable`, `modifyMutable`    | draft setters are the default in `createStore`                    |
| `createSelector`                               | `createProjection` (or `createStore(fn)`)                         |
| `<Ctx.Provider value={v}>`                     | `<Ctx value={v}>`                                                 |
| `classList={{ a: x() }}`                       | `class={{ a: x() }}` or `class={["base", { a: x() }]}`            |
| `use:dir={x}` / `attr:` / `on:` / `tabIndex`   | `ref={dir(x)}` / plain attributes / `onClick` / `tabindex`        |
| `onError` / `catchError`                       | `<Errored>` or `createEffect(c, { effect, error })`               |
| `from(source)` / `observable`                  | return an AsyncIterable from a computation                        |

Also:

- Reads lag writes: `setX(1); x()` still returns the old value until the
  microtask or `flush()`. In tests, `flush()` before asserting.
- No writes inside a memo, effect compute, or component body (dev throws).
  Write from event handlers, `onSettled`, or actions.
- No reactive reads at the top of a component body; read in JSX, a memo, or
  `untrack`. Flow callbacks (`<For>`, `<Show>`, `<Match>`) are owners, not
  tracking scopes: read their accessor arguments in JSX, not at the top.
- `<For>`: default gives a raw item and an index accessor; `keyed={false}`
  gives an item accessor and a plain number. `<Repeat>`: `i` is a number.
- `onClick={cond() ? a : b}` binds once; decide inside a stable handler.
- Inputs aren't strictly controlled: `value={x()}` writes only when the
  binding re-runs. Keep typing in a draft signal (`onInput`), commit on
  `onChange`/submit; when a handler rejects input, also set
  `e.currentTarget.value = next` (an unchanged signal won't revert the DOM).

## Primitives to reach for

| Primitive                                                          | Use                                                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `createSignal(0)` / `createSignal(() => fetchUser(id()))`          | plain signal / writable derived value, sync or async; read by calling it                |
| `createMemo(() => fetchX(id()))`                                   | read-only derived value; a Promise result is pending until it lands                     |
| `createProjection(async () => api.list(), [], { key: "id" })`      | read-only derived store with keyed reconciliation                                       |
| `createOptimisticStore(() => api.list(), [])`                      | store whose optimistic writes revert when the transition settles                        |
| `action(function* (x) { write(); yield api.put(x); refresh(d); })` | mutation with transition coordination; optimistic writes go inside                      |
| `until(() => confirmed(), { timeout })`                            | Promise that resolves when a predicate turns truthy; `yield` it in an action            |
| `isPending(() => d())`                                             | true while a change to `d` is in flight (input changed or `affects()` declared)         |
| `latest(d)`                                                        | peek at the in-flight value during a transition                                         |
| `refresh(d)`                                                       | re-ask the source after a server write; quiet unless preceded by `affects(d)`           |
| `<Loading on={id()}>` `<Errored>` `<Reveal>` `<Repeat>` `<For>`    | async boundary (`on` re-arms it), error boundary, sibling order, range list, keyed list |

## Pointers

- Full reference: `node_modules/solid-js/CHEATSHEET.md`; the same text is
  the `solid-2.0-cheatsheet` skill in `node_modules/solid-js/skills/`.
- Diagnostics: dev builds print `[CODE] message` plus an `in <App> › …`
  owner line and, when the build wrote source locations, an
  `at src/App.tsx:18:3` line. The first report of each code ends with a
  footer: the code's docs page, then
  `node_modules/solid-js/skills/reactivity-diagnostics/SKILL.md`, one section
  per code (`STRICT_READ_UNTRACKED`, `REACTIVE_WRITE_IN_OWNED_SCOPE`,
  `LOADING_ON_OUTSIDE_HOLD`, …). Fix the cause; never suppress a code.
- Evidence loops: `node_modules/@solidjs/diagnostics/skills/agent-loops/SKILL.md`
  (`captureArtifact`). With `@solidjs/vite-plugin`'s `diagnostics` option the
  dev server answers `POST /__solid/diagnostics` (`begin`, `active`, `whyDidRun`,
  `costs`, `end`).
- Lint: `eslint-plugin-solid`, config `v2`
  (`import solid from "eslint-plugin-solid/configs/v2"`) or `v2-strict`.
- Docs: https://v2.solidjs.com (Solid 2.0 docs; `/llms.txt` and
  `/llms-full.txt` for agents). Migration guide: `documentation/solid-2.0/MIGRATION.md`
  in the repository.
