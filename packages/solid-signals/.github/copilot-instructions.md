# @solidjs/signals Development Guide

## Project Overview

This is a standalone reactive Signals implementation for the next-generation SolidJS (post 1.x). It's a **pre-alpha, experimental** package where every release may be breaking. The library implements fine-grained reactivity primitives optimized for rendering frameworks.

## Core Architecture

### The Reactive Graph

The system uses a **push-pull hybrid reactive graph** with three node types:

1. **Signals** (`RawSignal<T>`): Leaf reactive values with subscribers (`_subs` linked list)
2. **Computeds** (`Computed<T>`): Reactive computations that track dependencies (`_deps` linked list) and own child computations
3. **Effects** (`Effect<T>`): Terminal nodes that execute side effects when dependencies change

Key data structures in [src/core/core.ts](src/core/core.ts):
- Doubly-linked lists connect dependencies/subscribers via `Link` objects
- `Owner` hierarchy manages disposal and context propagation
- Height-based topological ordering via heaps ([src/core/heap.ts](src/core/heap.ts))

### Scheduling & Execution

**Critical**: Updates are batched and NOT synchronous.

- Signal writes schedule updates via `schedule()` in [src/core/scheduler.ts](src/core/scheduler.ts)
- Updates execute in next microtask unless explicitly flushed
- **Always call `flush()` after updates in tests** (see any test file)
- Two heaps manage execution order: `dirtyQueue` for normal updates, `zombieQueue` for disposed nodes

```typescript
// WRONG - reads stale value
const [count, setCount] = createSignal(0);
setCount(1);
console.log(count()); // Still 0!

// CORRECT - flush to get new value
setCount(1);
flush();
console.log(count()); // Now 1
```

### Build-time Constants

The codebase uses global constants replaced at build time:
- `__DEV__`: Development mode checks (defined in [rollup.config.js](rollup.config.js), [vite.config.ts](vite.config.ts))
- `__TEST__`: Test-specific behavior
- Always use these for debug-only code to enable tree-shaking in production

## API Layers

### Low-level Core ([src/core/](src/core/))

Internal primitives that power the public API:
- `signal()`, `computed()`, `effect()`: Raw node creation
- `read()`, `setSignal()`: Direct node access
- `createRoot()`, `dispose()`: Ownership management

### Public API ([src/signals.ts](src/signals.ts))

User-facing wrappers that return tuples/functions:
- `createSignal()`: Returns `[getter, setter]` tuple
- `createMemo()`: Returns `Accessor<T>` function
- `createEffect()`: Returns void, runs side effects

### Store System ([src/store/](src/store/))

Proxy-based reactive objects:
- `createStore()`: Creates deeply reactive objects/arrays via `Proxy`
- Tracks property access at fine granularity
- Uses symbols (`$TRACK`, `$PROXY`, `$TARGET`) for internal state
- Setter functions accept mutating callbacks: `setState(s => { s.foo = 'bar' })`

## Testing Patterns

All tests use Vitest with globals enabled ([vite.config.ts](vite.config.ts)):

```typescript
import { createSignal, flush } from "../src/index.js";

afterEach(() => flush()); // Clean up pending updates

it("test name", () => {
  const [count, setCount] = createSignal(0);
  setCount(1);
  expect(count()).toBe(0); // Not flushed yet
  flush();
  expect(count()).toBe(1); // Now updated
});
```

Run tests:
- `pnpm test`: Standard test run
- `pnpm test:watch`: Watch mode
- `pnpm test:gc`: With garbage collection exposed
- `pnpm bench`: Run benchmarks

## Key Conventions

1. **Internal properties use `_` prefix**: `_value`, `_subs`, `_deps`, `_flags` 
2. **Status/reactive flags are bitwise**: Check [src/core/constants.ts](src/core/constants.ts) for flags like `REACTIVE_DIRTY`, `STATUS_PENDING`
3. **Disposal is hierarchical**: Children dispose with parents via `Owner` tree
4. **Context flows down the owner tree**: Not via call stack ([src/core/context.ts](src/core/context.ts))
5. **Effects are deferred by default**: Use `defer: false` for synchronous execution (rare)

## Common Patterns

### Creating Reactive Roots

Always wrap reactive code in `createRoot()` to establish ownership:

```typescript
const dispose = createRoot(dispose => {
  const [count, setCount] = createSignal(0);
  createEffect(() => console.log(count()));
  return dispose; // Return cleanup function
});

// Later: dispose(); to clean up
```

### Boundaries

Boundaries control error and loading state propagation ([src/boundaries.ts](src/boundaries.ts)):
- `createErrorBoundary()`: Catches errors in child computations
- `createLoadBoundary()`: Manages pending state for async computations
- Use `_propagationMask` to control which status flags propagate

### Transitions & Optimistic Updates

[src/core/scheduler.ts](src/core/scheduler.ts) manages async transitions:
- Tracks pending signals during async updates
- Supports optimistic values via `_pendingValue`
- `activeTransition` global coordinates multi-node updates

## Development Workflow

Build: `pnpm build` (Rollup + TypeScript)
- Outputs separate dev/prod bundles with constant replacement
- Types generated via `pnpm types`

Format: `pnpm format` (Prettier with import sorting)

Key files to understand:
- [src/core/core.ts](src/core/core.ts): Core reactive primitives (~800 lines, read incrementally)
- [src/core/scheduler.ts](src/core/scheduler.ts): Update batching and queuing
- [src/core/heap.ts](src/core/heap.ts): Height-ordered execution
- [src/signals.ts](src/signals.ts): Public API surface
- [src/store/store.ts](src/store/store.ts): Proxy-based stores

## Debugging

- Signal nodes have optional `name` property for debugging: `createSignal(0, { name: "counter" })`
- Height values in heap determine execution order (higher = runs later)
- Check `_flags` and `_statusFlags` on nodes to understand state
- Use `untrack()` to read without creating dependencies
