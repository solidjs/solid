# Bitwise Operations in the Reactive System

## Overview
`@solidjs/signals` uses bitmasks in a few different places:

- reactive node dirtiness and lifecycle flags
- async/error status flags
- status propagation masks for boundaries

The definitions live in `src/core/constants.ts`. The old `ERROR_BIT` / `LOADING_BIT` names are no longer used in the codebase; the current names are `STATUS_*` and `REACTIVE_*`.

## Current Flag Groups

### Reactive flags
These track scheduler and node lifecycle state:

```typescript
export const REACTIVE_CHECK = 1 << 0;
export const REACTIVE_DIRTY = 1 << 1;
export const REACTIVE_RECOMPUTING_DEPS = 1 << 2;
export const REACTIVE_IN_HEAP = 1 << 3;
export const REACTIVE_IN_HEAP_HEIGHT = 1 << 4;
export const REACTIVE_ZOMBIE = 1 << 5;
export const REACTIVE_DISPOSED = 1 << 6;
export const REACTIVE_OPTIMISTIC_DIRTY = 1 << 7;
export const REACTIVE_SNAPSHOT_STALE = 1 << 8;
export const REACTIVE_LAZY = 1 << 9;
```

These flags are mostly used by the scheduler and heap-driven recomputation logic.

### Status flags
These track async and error state on computations:

```typescript
export const STATUS_NONE = 0;
export const STATUS_PENDING = 1 << 0;
export const STATUS_ERROR = 1 << 1;
export const STATUS_UNINITIALIZED = 1 << 2;
```

These are the flags boundary queues and async propagation care about.

### Effect kinds
These are numeric tags, not bitmasks:

```typescript
export const EFFECT_PURE = 0;
export const EFFECT_RENDER = 1;
export const EFFECT_USER = 2;
export const EFFECT_TRACKED = 3;
```

They are used for scheduling order and queue selection rather than bitwise masking.

## Common Operations

### Combine flags

```typescript
const mask = STATUS_PENDING | STATUS_ERROR;
```

### Check a flag

```typescript
if (node._statusFlags & STATUS_PENDING) {
  throw new NotReadyError();
}
```

### Clear a flag

```typescript
node._statusFlags &= ~STATUS_UNINITIALIZED;
```

## Where Status Masks Are Used

### Boundary propagation
Boundary-wrapped computeds remember which statuses should continue propagating upward:

```typescript
node._statusFlags &= ~node._propagationMask;
node._queue.notify(node, node._propagationMask, flags, actualError);
```

For example, loading boundaries are built around `STATUS_PENDING`, while error boundaries are built around `STATUS_ERROR`.

### Queue notification
Queue notification takes both:

- `mask`: which statuses this queue cares about
- `flags`: the node's actual current status flags

```typescript
notify(node, mask, flags, error?)
```

That allows a boundary queue to intercept one status, strip it from further propagation, and optionally forward the remaining ones.

### Reactive scheduling
Reactive flags are used to decide whether a node goes into the dirty heap, zombie heap, or needs optimistic-lane handling:

```typescript
const queue = sub._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue;
```

## Typical Combinations

| Combination | Meaning |
| --- | --- |
| `STATUS_PENDING` | async work is still unresolved |
| `STATUS_ERROR` | computation is in an error state |
| `STATUS_PENDING | STATUS_ERROR` | queue code is examining both async and error propagation |
| `REACTIVE_DIRTY | REACTIVE_OPTIMISTIC_DIRTY` | node needs recomputation and carries optimistic-lane semantics |

## Notes

- `STATUS_*` flags describe externally visible async/error state.
- `REACTIVE_*` flags describe internal scheduler state.
- Effect kinds such as `EFFECT_RENDER` are not bitmasks and should not be combined with `|`.

## Related Documentation

- See [QUEUE_NOTIFICATION_SYSTEM.md](./QUEUE_NOTIFICATION_SYSTEM.md) for how status masks move through queues.
- See [QUEUE_EXECUTION_CONTROL.md](./QUEUE_EXECUTION_CONTROL.md) for how dirty heaps, lanes, and effect queues are drained.