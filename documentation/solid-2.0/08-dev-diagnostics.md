# RFC: Dev-mode diagnostics and errors

**Start here:** If you're migrating an app, read the beta tester guide first: [MIGRATION.md](MIGRATION.md)

## Summary

Solid 2.0 introduces a structured diagnostics system that catches common mistakes at development time. Every diagnostic has a code, severity (error or warning), and actionable message. Errors throw and halt execution; warnings log to the console. All diagnostics are stripped from production builds via `_SOLID_DEV_` / `__DEV__` guards.

Diagnostics can also be programmatically observed via `DEV.diagnostics.subscribe()` and `DEV.diagnostics.capture()` for tooling and testing.

## Diagnostic reference

### Errors (throw in dev)

These halt execution immediately. They indicate bugs that will cause incorrect behavior.

#### `SIGNAL_WRITE_IN_OWNED_SCOPE`

**Message:** "Writing to a Signal inside an owned scope (component, computation) is not allowed. Move the write outside or set the `ownedWrite` option if this is intentional."

Writing to a signal inside a reactive scope (effect compute, memo, component body) throws. This prevents feedback loops and ensures the reactive graph is predictable.

```js
// Throws in dev
createMemo(() => setCount(count() + 1));

// Fix: derive instead of writing back
const doubled = createMemo(() => count() * 2);

// Fix: write from an event handler
button.onclick = () => setCount(c => c + 1);

// Escape hatch: mark as ownedWrite (internal signals only)
const [ref, setRef] = createSignal(null, { ownedWrite: true });
```

#### `PENDING_ASYNC_UNTRACKED_READ`

**Message:** "Reading a pending async value directly in [context]. Async values must be read within a tracking scope (JSX, a memo, or an effect's compute function)."

Reading an async value that hasn't resolved yet outside a tracked scope (e.g. in a component body or effect callback) throws. The system can't suspend or retry an untracked read.

```jsx
// Throws if user() is async and pending
function Bad() {
  const name = user().name;
  return <div>{name}</div>;
}

// Fix: read in JSX (tracked by the compiler)
function Good() {
  return <div>{user().name}</div>;
}
```

#### `ASYNC_OUTSIDE_LOADING_BOUNDARY`

**Message:** "An async value was read outside a Loading boundary. The root mount will be deferred until all pending async settles."

**Severity:** `warn` (non-halting)

A render effect read pending async with no `Loading` ancestor catching it. The runtime handles this correctly — `render()` installs its top-level insert as a post-render effect, so the root DOM attach is withheld until all uncaught async settles, then attaches atomically. On the no-async happy path, `render()` still attaches synchronously via an internal tail `flush()`.

The diagnostic is an FYI, not an error: while async is pending the mount container will simply stay empty (or show its existing content, e.g. a static shell). Place a `Loading` boundary when you want explicit fallback UI or partial progressive mount — otherwise the permissive default is fine.

```jsx
// Warns (non-halting): no Loading ancestor
// Container stays empty until asyncUser() resolves, then mounts atomically.
render(() => <Profile user={asyncUser()} />, root);

// Explicit fallback UI: wrap in Loading
render(() => (
  <Loading fallback={<Spinner />}>
    <Profile user={asyncUser()} />
  </Loading>
), root);
```

**Debugging tip:** if your app doesn't mount, check the console for `ASYNC_OUTSIDE_LOADING_BOUNDARY` — it names the render effect whose pending async is holding the root.

**Scope:** the diagnostic only fires during the synchronous body of `render()` / `hydrate()`. Post-mount route transitions (including lazy route changes) run under their own transitions with the guard off, so they do not emit this warning.

#### `CLEANUP_IN_FORBIDDEN_SCOPE`

**Message:** "Cannot use onCleanup inside createTrackedEffect or onSettled; return a cleanup function instead"

`onCleanup` cannot be used inside `createTrackedEffect` or `onSettled` because these scopes manage cleanup through return values.

```js
// Throws
onSettled(() => {
  onCleanup(() => /* ... */);
});

// Fix: return cleanup
onSettled(() => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
});
```

#### Cannot create nested primitives in forbidden scope

**Message:** "Cannot create reactive primitives inside createTrackedEffect or owner-backed onSettled"

`createTrackedEffect` and `onSettled` run as leaf owners — you cannot nest `createSignal`, `createMemo`, `createEffect`, or other reactive primitives inside them.

```js
// Throws
onSettled(() => {
  const [s, setS] = createSignal(0);
});

// Fix: create primitives in the component body, use them in onSettled
const [s, setS] = createSignal(0);
onSettled(() => {
  console.log(s());
});
```

#### Invalid cleanup return value

**Message:** "[name] callback returned an invalid cleanup value. Return a cleanup function or undefined."

Effect, tracked effect, reaction, and `onSettled` callbacks must return either a cleanup function or `undefined`. Returning anything else (e.g. a number, string, or object) throws.

```js
// Throws
createEffect(
  () => count(),
  (value) => {
    return value; // not a function!
  }
);

// Fix: return a function or nothing
createEffect(
  () => count(),
  (value) => {
    console.log(value);
    return () => {}; // cleanup function
  }
);
```

#### `flush()` inside forbidden scope

**Message:** "Cannot call flush() from inside onSettled or createTrackedEffect. flush() is not reentrant there."

Calling `flush()` from inside `createTrackedEffect` or `onSettled` would cause re-entrancy. Schedule work outside instead.

#### Potential infinite loop

**Message:** "Potential Infinite Loop Detected."

The flush cycle exceeded 100,000 iterations. This usually means a reactive write triggers a re-read that triggers another write, endlessly.

### Warnings (console.warn in dev)

These log a warning but don't halt execution. They indicate patterns that will lose reactivity or cause subtle bugs.

#### `STRICT_READ_UNTRACKED`

**Message:** "Reactive value read directly in [context] will not update. Move it into a tracking scope (JSX, a memo, or an effect's compute function)."

Reading a signal, signal-backed prop, or store property at the top level of a component body (or in an effect callback) will not track. The value is captured once and never updates.

```jsx
// Warns: top-level read won't track
function Bad(props) {
  const n = props.count;
  return <div>{n}</div>;
}

// Fix: read in JSX
function Good(props) {
  return <div>{props.count}</div>;
}

// Fix: explicit one-time read
function AlsoGood(props) {
  const n = untrack(() => props.count);
  return <div>{n}</div>;
}
```

This also fires for store property access in the same contexts.

#### `PENDING_ASYNC_FORBIDDEN_SCOPE`

**Message:** "Reading a pending async value inside createTrackedEffect or onSettled will throw. Use createEffect instead which supports async-aware reactivity."

Warns that an async value read inside `createTrackedEffect` or `onSettled` will throw if it's ever pending, because these scopes can't suspend. Use `createEffect` (which supports async-aware reactivity) instead.

#### `NO_OWNER_EFFECT`

**Message:** "Effects created outside a reactive context will never be disposed"

An effect (`createEffect` or `createTrackedEffect`) was created without a parent owner. It will run indefinitely and never be cleaned up. Usually means the effect was created at module scope or after disposal.

```js
// Warns: no owner
createEffect(() => count(), (v) => console.log(v));

// Fix: create inside a component or createRoot
createRoot(() => {
  createEffect(() => count(), (v) => console.log(v));
});
```

#### `NO_OWNER_CLEANUP`

**Message:** "onCleanup called outside a reactive context will never be run"

`onCleanup` was called with no active owner. The cleanup function will never execute.

#### `NO_OWNER_BOUNDARY`

**Message:** "Boundaries created outside a reactive context will never be disposed."

A `Loading` or `Errored` boundary was created without a parent owner.

#### `RUN_WITH_DISPOSED_OWNER`

**Message:** "runWithOwner called with a disposed owner. Children created inside will never be disposed."

The owner passed to `runWithOwner` has already been disposed. Any reactive primitives created inside will leak.

## Programmatic diagnostics API

In dev mode, `DEV.diagnostics` provides two methods for tooling:

### `DEV.diagnostics.subscribe(listener)`

Registers a callback that fires for every diagnostic event. Returns an unsubscribe function.

```js
import { DEV } from "solid-js";

const unsub = DEV.diagnostics.subscribe((event) => {
  console.log(`[${event.severity}] ${event.code}: ${event.message}`);
});
// later: unsub();
```

### `DEV.diagnostics.capture()`

Returns a capture object for collecting diagnostics in a scoped region (useful in tests).

```js
const capture = DEV.diagnostics.capture();

// ... code that may emit diagnostics ...

const events = capture.stop();
// events: DiagnosticEvent[]
```

Each `DiagnosticEvent` has:

| Field | Type | Description |
|-------|------|-------------|
| `sequence` | `number` | Monotonically increasing counter |
| `code` | `DiagnosticCode` | Machine-readable code (e.g. `"STRICT_READ_UNTRACKED"`) |
| `kind` | `DiagnosticKind` | Category: `"strict-read"`, `"async"`, `"write"`, `"lifecycle"`, `"owner"` |
| `severity` | `"warn" \| "error"` | Whether this throws or just logs |
| `message` | `string` | Human-readable message |
| `ownerId` | `string?` | ID of the reactive owner where the diagnostic occurred |
| `ownerName` | `string?` | Debug name of the owner |
| `nodeName` | `string?` | Debug name of the signal/node involved |
| `data` | `object?` | Additional context |

## Diagnostic codes (quick reference)

| Code | Severity | Category | Trigger |
|------|----------|----------|---------|
| `SIGNAL_WRITE_IN_OWNED_SCOPE` | error | write | Signal write inside component/computation |
| `PENDING_ASYNC_UNTRACKED_READ` | error | async | Reading pending async outside tracking scope |
| `ASYNC_OUTSIDE_LOADING_BOUNDARY` | warn | async | Async computation outside Loading boundary (non-halting; root mount is deferred) |
| `CLEANUP_IN_FORBIDDEN_SCOPE` | error | lifecycle | `onCleanup` inside trackedEffect/onSettled |
| `STRICT_READ_UNTRACKED` | warn | strict-read | Untracked reactive read in component/effect body |
| `PENDING_ASYNC_FORBIDDEN_SCOPE` | warn | async | Pending async read in trackedEffect/onSettled |
| `NO_OWNER_EFFECT` | warn | lifecycle | Effect created without reactive owner |
| `NO_OWNER_CLEANUP` | warn | lifecycle | `onCleanup` called without owner |
| `NO_OWNER_BOUNDARY` | warn | lifecycle | Boundary created without owner |
| `RUN_WITH_DISPOSED_OWNER` | warn | owner | `runWithOwner` with disposed owner |
