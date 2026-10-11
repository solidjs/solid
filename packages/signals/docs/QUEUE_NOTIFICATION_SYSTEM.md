# Queue System: Notification System

## Overview
The notification side of the queue system is about status propagation, not normal recomputation scheduling.

In the current implementation, notifications are mainly used to move `STATUS_PENDING` and `STATUS_ERROR` information through boundary queues and, at the root, into transition bookkeeping.

## The Main Participants

### `Queue`
The base queue does almost nothing by itself:

```typescript
notify(node, mask, flags, error?) {
  if (this._parent) return this._parent.notify(node, mask, flags, error);
  return false;
}
```

Its job is just to forward notifications upward through the queue tree.

### `GlobalQueue`
The root queue handles uncaught pending propagation:

```typescript
if (mask & STATUS_PENDING) {
  if (flags & STATUS_PENDING) {
    // record async reporters for the active transition
  }
  return true;
}
```

This is where the scheduler tracks async reporters during transitions and where dev-only "unhandled async" detection is triggered.

### `CollectionQueue`
This is the important specialized queue for boundaries. It is used by:

- `createLoadingBoundary()`
- `createErrorBoundary()`
- reveal-order coordination around loading boundaries

`CollectionQueue` watches one status family through `_collectionType`, usually `STATUS_PENDING` or `STATUS_ERROR`.

## How Boundary Notification Works

Boundary trees are wrapped in a computed whose `_notifyStatus()` forwards only the statuses that should still propagate:

```typescript
node._statusFlags &= ~node._propagationMask;
node._queue.notify(node, node._propagationMask, flags, actualError);
```

That means a boundary can observe a status, keep it local, and optionally let other statuses continue upward.

## What `CollectionQueue.notify()` Does

`CollectionQueue.notify()` intercepts statuses that match `_collectionType`.

For loading boundaries, that means:

- track pending sources in `_sources`
- mark the boundary as pending
- disable the boundary queue when the first pending source appears
- re-enable it once the tracked sources are gone

For error boundaries, the same mechanism is used for `STATUS_ERROR`, with special handling so pending+error situations can still forward error information appropriately.

Important current behaviors:

- there is no `ConditionalQueue` in the code anymore
- the queue stores sources, not just raw effect nodes
- `on` conditions can reset initialization state and source tracking
- reveal-order state can further affect whether the boundary is disabled or collapsed

## Notification Flow

1. A computation or effect changes status.
2. A boundary-wrapped computed decides which statuses should propagate.
3. The owning queue receives `notify(node, mask, flags, error?)`.
4. Boundary queues may:
   - capture the source
   - disable descendant effect execution
   - strip a handled status from further propagation
5. Unhandled pending propagation eventually reaches `GlobalQueue`, which records transition async reporters.

## Source Tracking

`CollectionQueue` does not just remember "something is pending". It tracks the actual source computations in `_sources`.

Later, `checkSources()` removes entries that are disposed or no longer carry the tracked status. Once `_sources` becomes empty, the boundary can clear its disabled state and stop showing fallback.

That source-based model is what lets loading and error boundaries settle correctly as upstream async work resolves.

## Practical Consequences

- Boundary queues are about propagation control, not general scheduling.
- Root queue notification is primarily about uncaught async and transitions.
- Loading and error handling are implemented by the same queue type with different status masks.

## Related Documentation

- See [QUEUE_EXECUTION_CONTROL.md](./QUEUE_EXECUTION_CONTROL.md) for how queues, heaps, and lanes are drained.
- See [BITWISE_OPERATIONS.md](./BITWISE_OPERATIONS.md) for the current `STATUS_*` and `REACTIVE_*` masks involved in propagation.